import "server-only";
import type { Batch, Coupon, Course, Payment, PaymentItemType, PaymentStatus, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { hasRole } from "@/lib/auth/session";
import { enrollUserInBatch, enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { issueCertificate } from "@/lib/services/progress";
import { notify, notifyMany } from "@/lib/services/notifications";
import { formatPrice, shortCode, toDateKey } from "@/lib/utils";

/**
 * Commerce domain logic: billing items, access checks, coupons, order
 * summaries, fulfillment (enrollment after payment), refunds and the admin
 * transaction queries. Server Actions in `src/lib/actions/payments.ts` and
 * `src/lib/actions/coupons.ts` are thin, permission-checked wrappers around
 * these helpers.
 */

/* ------------------------------------------------------------------ */
/* Billing items                                                       */
/* ------------------------------------------------------------------ */

export const ITEM_TYPE_LABELS: Record<PaymentItemType, string> = {
  course: "Course",
  batch: "Batch",
  certificate: "Certificate",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  failed: "Cancelled",
  refunded: "Refunded",
};

export const GATEWAY_LABELS: Record<Settings["commerce"]["paymentGateway"], string> = {
  none: "No payment gateway",
  manual: "Manual payment",
  stripe: "Stripe",
  razorpay: "Razorpay",
};

export function gatewayLabel(gateway: string): string {
  if (gateway === "free") return "Free order";
  return (GATEWAY_LABELS as Record<string, string>)[gateway] ?? gateway;
}

export function parseItemType(raw: string | undefined | null): PaymentItemType | null {
  return raw === "course" || raw === "batch" || raw === "certificate" ? raw : null;
}

export interface BillingItem {
  type: PaymentItemType;
  /** Course id (course & certificate purchases) or batch id. */
  id: string;
  /** Title stored on the payment. */
  title: string;
  /** Name of the underlying course/batch. */
  name: string;
  description: string;
  imageUrl?: string;
  gradient?: string;
  /** Price in the smallest currency unit. */
  amount: number;
  currency: string;
  /** Public page of the item. */
  href: string;
  course: Course | null;
  batch: Batch | null;
}

function itemFromCourse(course: Course, type: "course" | "certificate"): BillingItem {
  const certificate = type === "certificate";
  return {
    type,
    id: course.id,
    title: certificate ? `Certificate for ${course.title}` : course.title,
    name: course.title,
    description: course.shortIntroduction,
    imageUrl: course.imageUrl,
    gradient: course.cardGradient,
    amount: certificate ? course.certificatePrice : course.price,
    currency: course.currency || "USD",
    href: certificate ? `/courses/${course.slug}/certification` : `/courses/${course.slug}`,
    course,
    batch: null,
  };
}

function itemFromBatch(batch: Batch): BillingItem {
  return {
    type: "batch",
    id: batch.id,
    title: batch.title,
    name: batch.title,
    description: batch.description,
    imageUrl: batch.imageUrl,
    gradient: "violet",
    amount: batch.amount,
    currency: batch.currency || "USD",
    href: `/batches/${batch.slug}`,
    course: null,
    batch,
  };
}

/** Resolve the thing being bought. Accepts an id or a slug. */
export async function getBillingItem(type: PaymentItemType, idOrSlug: string): Promise<BillingItem | null> {
  const db = await getDb();
  if (type === "batch") {
    const batch = db.batches.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
    return batch ? itemFromBatch(batch) : null;
  }
  const course = db.courses.find((c) => c.id === idOrSlug || c.slug === idOrSlug);
  return course ? itemFromCourse(course, type) : null;
}

/* ------------------------------------------------------------------ */
/* Access checks                                                       */
/* ------------------------------------------------------------------ */

export type BillingAccess =
  | { status: "ok" }
  /** The viewer already has access: send them to the item. */
  | { status: "owned"; redirectTo: string }
  /** The item costs nothing: use the direct enroll flow instead. */
  | { status: "free"; redirectTo: string }
  /** The viewer already placed an order that is awaiting confirmation. */
  | { status: "pending"; payment: Payment }
  | { status: "denied"; message: string; backHref: string; backLabel: string };

/**
 * Mirrors Frappe's validate_billing_access + order summary preconditions:
 * item exists and is published, the viewer is not already enrolled, batch
 * seats and start date, certificate not already purchased.
 */
export async function checkBillingAccess(user: User, item: BillingItem): Promise<BillingAccess> {
  const db = await getDb();
  const pending = db.payments.find((p) => p.userId === user.id && p.itemType === item.type && p.itemId === item.id && p.status === "pending");

  if (item.type === "course" && item.course) {
    const course = item.course;
    const manager = canManageCourse(user, course);
    const back = { backHref: `/courses/${course.slug}`, backLabel: "Checkout Course" };
    if (!db.settings.features.courses) return { status: "denied", message: "Courses are currently disabled on this platform.", ...back };
    if (!course.published && !manager) return { status: "denied", message: "This course is not available for purchase.", ...back };
    if (db.enrollments.some((e) => e.userId === user.id && e.courseId === course.id)) {
      return { status: "owned", redirectTo: `/courses/${course.slug}` };
    }
    if (course.upcoming && !manager) return { status: "denied", message: "This course is not open for enrollment yet.", ...back };
    if (!course.paidCourse || course.price <= 0) return { status: "free", redirectTo: `/courses/${course.slug}` };
    if (course.disableSelfLearning && !hasRole(user, "moderator", "course_creator", "batch_evaluator")) {
      return { status: "denied", message: "This course is only available through a batch. Please contact the Administrator.", ...back };
    }
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  if (item.type === "batch" && item.batch) {
    const batch = item.batch;
    const back = { backHref: `/batches/${batch.slug}`, backLabel: "Checkout Batch" };
    if (!db.settings.features.batches) return { status: "denied", message: "Batches are currently disabled on this platform.", ...back };
    if (!batch.published) return { status: "denied", message: "This batch is not available for purchase.", ...back };
    if (db.batchEnrollments.some((e) => e.userId === user.id && e.batchId === batch.id)) {
      return { status: "owned", redirectTo: `/batches/${batch.slug}` };
    }
    if (!batch.paidBatch || batch.amount <= 0) return { status: "free", redirectTo: `/batches/${batch.slug}` };
    if (!batch.allowSelfEnrollment) return { status: "denied", message: "To join this batch, please contact the Administrator.", ...back };
    const taken = db.batchEnrollments.filter((e) => e.batchId === batch.id).length;
    if (batch.seatCount > 0 && taken >= batch.seatCount) return { status: "denied", message: "Batch is sold out.", ...back };
    if (!batch.allowFuture && batch.startDate < toDateKey()) return { status: "denied", message: "Batch has already started.", ...back };
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  if (item.type === "certificate" && item.course) {
    const course = item.course;
    const back = { backHref: `/courses/${course.slug}`, backLabel: "Checkout Course" };
    if (!db.settings.features.certifications) return { status: "denied", message: "Certificates are disabled on this platform.", ...back };
    if (!course.paidCertificate || course.certificatePrice <= 0) {
      return { status: "denied", message: "This course does not offer a paid certificate.", ...back };
    }
    const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
    if (!enrollment) return { status: "denied", message: "Enroll in this course before purchasing its certificate.", ...back };
    if (enrollment.purchasedCertificate) return { status: "owned", redirectTo: `/courses/${course.slug}/certification` };
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  return { status: "denied", message: "Module Name is incorrect or does not exist.", backHref: "/courses", backLabel: "Browse courses" };
}

/* ------------------------------------------------------------------ */
/* Coupons                                                             */
/* ------------------------------------------------------------------ */

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function couponAppliesTo(coupon: Coupon, item: Pick<BillingItem, "type" | "id">): boolean {
  if (!coupon.applicableItems.length) return true;
  if (item.type === "batch") return coupon.applicableItems.some((a) => a.type === "batch" && a.id === item.id);
  // Course and certificate purchases match coupons listed for the course.
  return coupon.applicableItems.some((a) => a.type === "course" && a.id === item.id);
}

export type CouponCheck = { ok: true; coupon: Coupon } | { ok: false; error: string };

/** Validate a coupon code for an item (enabled, not expired, under usage limit, applicable). */
export async function validateCoupon(rawCode: string, item: Pick<BillingItem, "type" | "id">): Promise<CouponCheck> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, error: "Please enter a coupon code" };
  const db = await getDb();
  const coupon = db.coupons.find((c) => c.code.toUpperCase() === code);
  if (!coupon || !coupon.enabled) return { ok: false, error: `The coupon code '${code}' is invalid.` };
  if (coupon.expiresOn && coupon.expiresOn < toDateKey()) return { ok: false, error: "This coupon has expired." };
  if (coupon.usageLimit > 0 && coupon.redemptionCount >= coupon.usageLimit) {
    return { ok: false, error: "This coupon has reached its maximum usage limit." };
  }
  if (!couponAppliesTo(coupon, item)) {
    return { ok: false, error: `This coupon is not applicable to this ${ITEM_TYPE_LABELS[item.type]}.` };
  }
  return { ok: true, coupon };
}

/* ------------------------------------------------------------------ */
/* Order summary                                                       */
/* ------------------------------------------------------------------ */

/**
 * Indicative USD exchange rates (USD per unit of currency) used for the
 * optional "USD equivalent" line. A production deployment would plug an
 * exchange-rate provider in here.
 */
const USD_RATES: Record<string, number> = {
  EUR: 1.08,
  GBP: 1.27,
  INR: 0.012,
  AUD: 0.66,
  CAD: 0.73,
  SGD: 0.74,
  AED: 0.2723,
  JPY: 0.0067,
};

/** Convert an amount (smallest unit) into USD cents, optionally rounding up to a whole dollar. */
export function toUsdEquivalent(amount: number, currency: string, rounding: boolean): number | null {
  const code = currency.toUpperCase();
  const rate = USD_RATES[code];
  if (!rate || code === "USD") return null;
  const cents = Math.round(amount * rate);
  return rounding ? Math.ceil(cents / 100) * 100 : cents;
}

export interface OrderSummary {
  itemType: PaymentItemType;
  itemId: string;
  title: string;
  currency: string;
  originalAmount: number;
  discountAmount: number;
  subtotal: number;
  taxAmount: number;
  taxLabel: string;
  taxPercentage: number;
  total: number;
  coupon: { id: string; code: string; discountType: Coupon["discountType"]; value: number } | null;
  usdEquivalent: number | null;
}

export function computeOrderSummary(item: BillingItem, coupon: Coupon | null, settings: Settings): OrderSummary {
  const original = Math.max(0, Math.round(item.amount));
  let discount = 0;
  if (coupon) {
    discount =
      coupon.discountType === "percentage"
        ? Math.round((original * Math.min(100, Math.max(0, coupon.value))) / 100)
        : Math.min(original, Math.max(0, coupon.value));
  }
  const subtotal = Math.max(0, original - discount);
  const c = settings.commerce;
  const taxPercentage = c.applyTax ? Math.max(0, c.taxPercentage) : 0;
  const taxAmount = taxPercentage > 0 ? Math.round((subtotal * taxPercentage) / 100) : 0;
  const total = subtotal + taxAmount;
  return {
    itemType: item.type,
    itemId: item.id,
    title: item.title,
    currency: item.currency,
    originalAmount: original,
    discountAmount: discount,
    subtotal,
    taxAmount,
    taxLabel: c.taxLabel || "Tax",
    taxPercentage,
    total,
    coupon: coupon ? { id: coupon.id, code: coupon.code, discountType: coupon.discountType, value: coupon.value } : null,
    usdEquivalent: c.showUsdEquivalent ? toUsdEquivalent(total, item.currency, c.applyRounding) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export async function generateOrderId(): Promise<string> {
  const db = await getDb();
  const taken = new Set(db.payments.map((p) => p.orderId));
  let id = `ORD-${shortCode(2, 4)}`;
  while (taken.has(id)) id = `ORD-${shortCode(2, 4)}`;
  return id;
}

export async function getPaymentByOrderId(orderId: string): Promise<Payment | null> {
  const db = await getDb();
  return db.payments.find((p) => p.orderId === orderId || p.id === orderId) ?? null;
}

/** Most recent billing details the user entered, used to prefill checkout. */
export async function getSavedBillingDetails(userId: string): Promise<Pick<Payment, "billingName" | "address" | "gstin" | "pan" | "source"> | null> {
  const db = await getDb();
  const last = db.payments.filter((p) => p.userId === userId && p.address).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!last) return null;
  return { billingName: last.billingName, address: last.address, gstin: last.gstin, pan: last.pan, source: last.source };
}

export interface FulfillmentResult {
  payment: Payment;
  /** Human readable note (e.g. the batch was full so the seat could not be allocated). */
  notice?: string;
  certificateCode?: string;
}

/**
 * Mark a payment as paid and grant what was bought. Idempotent: calling it
 * again for an already-paid order re-applies access without double counting
 * coupon redemptions or notifications.
 */
export async function fulfillPayment(
  paymentId: string,
  opts: { gatewayPaymentId?: string } = {},
): Promise<{ ok: true; data: FulfillmentResult } | { ok: false; error: string }> {
  const db = await getDb();
  const existing = db.payments.find((p) => p.id === paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (existing.status === "refunded") return { ok: false, error: "Refunded orders cannot be marked as paid." };
  const wasPaid = existing.status === "paid";
  const now = new Date().toISOString();

  const payment = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId)!;
    row.status = "paid";
    row.paidAt = row.paidAt ?? now;
    if (opts.gatewayPaymentId && !row.gatewayPaymentId) row.gatewayPaymentId = opts.gatewayPaymentId;
    if (!wasPaid && row.couponId) {
      const coupon = d.coupons.find((c) => c.id === row.couponId);
      if (coupon) coupon.redemptionCount += 1;
    }
    return { ...row };
  });

  const user = db.users.find((u) => u.id === payment.userId);
  if (!user) return { ok: true, data: { payment, notice: "The learner account no longer exists, so no access was granted." } };

  let notice: string | undefined;
  let certificateCode: string | undefined;

  if (payment.itemType === "course") {
    const course = db.courses.find((c) => c.id === payment.itemId);
    if (course) await enrollUserInCourse(user.id, course.id, { paymentId: payment.id });
    else notice = "The course no longer exists, so no enrollment was created.";
  } else if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    if (batch) {
      const res = await enrollUserInBatch(user.id, batch.id, { paymentId: payment.id, source: payment.source });
      if (!res.ok) notice = `${res.error} The payment was recorded but the seat could not be allocated.`;
    } else {
      notice = "The batch no longer exists, so no enrollment was created.";
    }
  } else {
    const course = db.courses.find((c) => c.id === payment.itemId);
    if (course) {
      let enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
      if (!enrollment) enrollment = await enrollUserInCourse(user.id, course.id, { notifyInstructors: false });
      const enrollmentId = enrollment.id;
      const complete = await mutate((d) => {
        const row = d.enrollments.find((e) => e.id === enrollmentId);
        if (!row) return false;
        row.purchasedCertificate = true;
        return !!row.completedAt || row.progress >= 100;
      });
      if (complete && db.settings.features.certifications) {
        const cert = await issueCertificate(user, course);
        await mutate((d) => {
          const row = d.certificates.find((c) => c.id === cert.id);
          if (row && !row.published) row.published = true;
        });
        certificateCode = cert.code;
      }
    } else {
      notice = "The course no longer exists, so no certificate could be issued.";
    }
  }

  if (!wasPaid) {
    await notify(user.id, {
      type: payment.itemType === "certificate" ? "certificate" : "enrollment",
      subject: payment.amount > 0 ? `Payment received for ${payment.itemTitle}` : `You're enrolled: ${payment.itemTitle}`,
      message: `Order ${payment.orderId} · ${formatPrice(payment.amount, payment.currency)}`,
      link: `/billing/success/${payment.orderId}`,
    });
  }

  return { ok: true, data: { payment, notice, certificateCode } };
}

/** Refund a paid order: mark it refunded and remove the access it granted. */
export async function refundPayment(paymentId: string): Promise<{ ok: true; data: Payment } | { ok: false; error: string }> {
  const db = await getDb();
  const existing = db.payments.find((p) => p.id === paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (existing.status !== "paid") return { ok: false, error: "Only paid orders can be refunded." };

  const payment = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId)!;
    row.status = "refunded";
    return { ...row };
  });

  if (payment.itemType === "course") {
    const enrollment = db.enrollments.find((e) => e.userId === payment.userId && e.courseId === payment.itemId);
    if (enrollment) {
      if (enrollment.batchId) {
        // Access also comes from a batch: keep it, just detach the refunded payment.
        await mutate((d) => {
          const row = d.enrollments.find((e) => e.id === enrollment.id);
          if (row && row.paymentId === payment.id) row.paymentId = undefined;
        });
      } else {
        await unenrollUserFromCourse(payment.userId, payment.itemId);
      }
    }
  } else if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    await mutate((d) => {
      d.batchEnrollments = d.batchEnrollments.filter((e) => !(e.batchId === payment.itemId && e.userId === payment.userId));
    });
    if (batch) {
      const viaBatch = (await getDb()).enrollments.filter((e) => e.userId === payment.userId && e.batchId === batch.id && batch.courseIds.includes(e.courseId));
      for (const e of viaBatch) await unenrollUserFromCourse(payment.userId, e.courseId);
    }
  } else {
    await mutate((d) => {
      const enrollment = d.enrollments.find((e) => e.userId === payment.userId && e.courseId === payment.itemId);
      if (enrollment) enrollment.purchasedCertificate = false;
      const course = d.courses.find((c) => c.id === payment.itemId);
      const cert = d.certificates.find((c) => c.userId === payment.userId && c.courseId === payment.itemId);
      // Paid certificates are revoked (unpublished) with the refund; free ones stay.
      if (cert && course?.paidCertificate) cert.published = false;
    });
  }

  await notify(payment.userId, {
    type: "system",
    subject: `Your payment for ${payment.itemTitle} was refunded`,
    message: `Order ${payment.orderId} · ${formatPrice(payment.amount, payment.currency)}`,
    link: `/billing/success/${payment.orderId}`,
  });
  return { ok: true, data: payment };
}

/** Tell admins that a manual order is waiting for confirmation. */
export async function notifyAdminsOfPendingOrder(payment: Payment, buyerName: string): Promise<void> {
  const db = await getDb();
  const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
  await notifyMany(admins, {
    type: "system",
    subject: `New order awaiting confirmation: ${payment.itemTitle}`,
    message: `${buyerName} placed order ${payment.orderId} for ${formatPrice(payment.amount, payment.currency)}.`,
    link: `/admin/settings/transactions?status=pending`,
    fromUserId: payment.userId,
  });
}

/* ------------------------------------------------------------------ */
/* Admin: transactions                                                 */
/* ------------------------------------------------------------------ */

export interface TransactionFilter {
  status: PaymentStatus | "all";
  type: PaymentItemType | "all";
  /** YYYY-MM-DD inclusive */
  from?: string;
  to?: string;
  search?: string;
}

export interface TransactionRow extends Payment {
  userName: string;
  userEmail: string;
  username: string | null;
  itemHref: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function param(sp: SearchParamsRecord | URLSearchParams, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

export function parseTransactionFilter(sp: SearchParamsRecord | URLSearchParams): TransactionFilter {
  const status = param(sp, "status");
  const from = param(sp, "from");
  const to = param(sp, "to");
  return {
    status: status === "pending" || status === "paid" || status === "failed" || status === "refunded" ? status : "all",
    type: parseItemType(param(sp, "type")) ?? "all",
    from: DATE_RE.test(from) ? from : undefined,
    to: DATE_RE.test(to) ? to : undefined,
    search: param(sp, "search").trim() || undefined,
  };
}

export async function getTransactions(filter: TransactionFilter): Promise<TransactionRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const q = filter.search?.toLowerCase();

  return db.payments
    .filter((p) => {
      if (filter.status !== "all" && p.status !== filter.status) return false;
      if (filter.type !== "all" && p.itemType !== filter.type) return false;
      const day = p.createdAt.slice(0, 10);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
      if (q) {
        const u = users.get(p.userId);
        const hay = `${p.orderId} ${p.billingName} ${p.itemTitle} ${u?.email ?? ""} ${u?.name ?? ""} ${p.couponCode ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const u = users.get(p.userId);
      let itemHref: string | null = null;
      if (p.itemType === "batch") {
        const b = batches.get(p.itemId);
        itemHref = b ? `/batches/${b.slug}` : null;
      } else {
        const c = courses.get(p.itemId);
        itemHref = c ? (p.itemType === "certificate" ? `/courses/${c.slug}/certification` : `/courses/${c.slug}`) : null;
      }
      return { ...p, userName: u?.name ?? "Deleted user", userEmail: u?.email ?? "", username: u?.username ?? null, itemHref };
    });
}

export interface TransactionStats {
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
  failedCount: number;
  /** Revenue from paid orders per currency (smallest unit). */
  revenue: { currency: string; amount: number }[];
}

export function summarizeTransactions(rows: Payment[]): TransactionStats {
  const revenue = new Map<string, number>();
  let paidCount = 0;
  let pendingCount = 0;
  let refundedCount = 0;
  let failedCount = 0;
  for (const p of rows) {
    if (p.status === "paid") {
      paidCount++;
      revenue.set(p.currency, (revenue.get(p.currency) ?? 0) + p.amount);
    } else if (p.status === "pending") pendingCount++;
    else if (p.status === "refunded") refundedCount++;
    else failedCount++;
  }
  return {
    paidCount,
    pendingCount,
    refundedCount,
    failedCount,
    revenue: Array.from(revenue, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
  };
}

function csvCell(value: string | number | undefined | null): string {
  let s = value === undefined || value === null ? "" : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const decimal = (cents: number) => (cents / 100).toFixed(2);

export function transactionsToCsv(rows: TransactionRow[]): string {
  const header = [
    "Order ID",
    "Created at",
    "Status",
    "Billing name",
    "Member",
    "Email",
    "Item type",
    "Item",
    "Currency",
    "Original amount",
    "Discount",
    "Tax",
    "Total",
    "Coupon",
    "Gateway",
    "Gateway payment ID",
    "Paid at",
    "Address line 1",
    "Address line 2",
    "City",
    "State",
    "Country",
    "Postal code",
    "GSTIN",
    "PAN",
    "Source",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.orderId,
        r.createdAt,
        PAYMENT_STATUS_LABELS[r.status],
        r.billingName,
        r.userName,
        r.userEmail,
        ITEM_TYPE_LABELS[r.itemType],
        r.itemTitle,
        r.currency,
        decimal(r.originalAmount),
        decimal(r.discountAmount),
        decimal(r.taxAmount),
        decimal(r.amount),
        r.couponCode ?? "",
        gatewayLabel(r.gateway),
        r.gatewayPaymentId ?? "",
        r.paidAt ?? "",
        r.address?.line1 ?? "",
        r.address?.line2 ?? "",
        r.address?.city ?? "",
        r.address?.state ?? "",
        r.address?.country ?? "",
        r.address?.pincode ?? "",
        r.gstin ?? "",
        r.pan ?? "",
        r.source ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/* Admin: coupons                                                      */
/* ------------------------------------------------------------------ */

export interface PurchasableItem {
  type: "course" | "batch";
  id: string;
  title: string;
  price: number;
  currency: string;
  published: boolean;
}

/** Courses and batches that coupons can target. */
export async function getPurchasableItems(): Promise<PurchasableItem[]> {
  const db = await getDb();
  const courses: PurchasableItem[] = db.courses
    .map((c) => ({ type: "course" as const, id: c.id, title: c.title, price: c.paidCourse ? c.price : 0, currency: c.currency, published: c.published }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const batches: PurchasableItem[] = db.batches
    .map((b) => ({ type: "batch" as const, id: b.id, title: b.title, price: b.paidBatch ? b.amount : 0, currency: b.currency, published: b.published }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return [...courses, ...batches];
}

export interface CouponRow extends Coupon {
  items: { type: "course" | "batch"; id: string; title: string }[];
  expired: boolean;
  exhausted: boolean;
}

export async function getCoupons(search?: string): Promise<CouponRow[]> {
  const db = await getDb();
  const titles = new Map<string, string>();
  for (const c of db.courses) titles.set(`course:${c.id}`, c.title);
  for (const b of db.batches) titles.set(`batch:${b.id}`, b.title);
  const today = toDateKey();
  const q = search?.trim().toUpperCase();
  return db.coupons
    .filter((c) => !q || c.code.toUpperCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      ...c,
      items: c.applicableItems.map((a) => ({ ...a, title: titles.get(`${a.type}:${a.id}`) ?? "Deleted item" })),
      expired: !!c.expiresOn && c.expiresOn < today,
      exhausted: c.usageLimit > 0 && c.redemptionCount >= c.usageLimit,
    }));
}
