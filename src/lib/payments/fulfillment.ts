import "server-only";
import type { Batch, Database, Payment, PaymentStatus } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { enrollUserInBatch, enrollUserInCourse } from "@/lib/services/enrollment";
import { issueCertificate } from "@/lib/services/progress";
import { notify, notifyMany, type NotifyInput } from "@/lib/services/notifications";
import { formatPrice } from "@/lib/utils";
import { couponOverflow } from "./coupon-rules";
import { assignInvoiceNumber, isInvoiceable } from "./invoice";

/**
 * Order fulfilment: the single place where a payment turns into access.
 *
 * `fulfillPayment` is called by every confirmation path — the Stripe return
 * URL, the Razorpay checkout callback, both webhooks, the admin "Mark as
 * paid" button and free/no-gateway orders. The pending → paid transition is
 * claimed inside one serialized `mutate`, so however many of those paths race
 * for the same order, exactly one of them enrolls the learner, redeems the
 * coupon, assigns the invoice number and sends the notifications.
 */

export type FulfillmentSource = "checkout" | "stripe_return" | "stripe_webhook" | "razorpay_checkout" | "razorpay_webhook" | "admin" | "sync";

export interface FulfillmentResult {
  payment: Payment;
  /** True when this call performed the fulfilment; false when the order had already been fulfilled. */
  fulfilled: boolean;
  /** Human readable note for administrators (e.g. the batch was full so no seat was allocated). */
  notice?: string;
  certificateCode?: string;
  /**
   * Granting access failed with an error (administrators were notified). The
   * order stays paid; the next confirmation of the same order (a webhook
   * retry, the return URL, the order page) grants it again.
   */
  accessFailed?: boolean;
}

export type FulfillmentOutcome = { ok: true; data: FulfillmentResult } | { ok: false; error: string };

/** Gateway payment ids that point at a real Stripe/Razorpay payment (not a manual reference). */
export function isGatewayPaymentReference(gateway: string, id: string | undefined | null): boolean {
  if (!id) return false;
  if (gateway === "stripe") return /^pi_[A-Za-z0-9]+$/.test(id);
  if (gateway === "razorpay") return /^pay_[A-Za-z0-9]+$/.test(id);
  return false;
}

/** A Stripe or Razorpay payment id, whatever the order's gateway is labelled now (an order confirmed by hand becomes "manual"). */
export function isAnyGatewayPaymentReference(id: string | undefined | null): boolean {
  return isGatewayPaymentReference("stripe", id) || isGatewayPaymentReference("razorpay", id);
}

async function adminIds(): Promise<string[]> {
  const db = await getDb();
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

/** Alert every administrator. Never throws: a failed alert must not undo the payment work around it. */
async function alertAdmins(input: NotifyInput): Promise<void> {
  try {
    await notifyMany(await adminIds(), input);
  } catch (error) {
    console.error("[payments] could not notify administrators:", error instanceof Error ? error.message : String(error));
  }
}

function transactionsLink(search: string): string {
  return `/admin/settings/transactions?search=${encodeURIComponent(search)}`;
}

/** Whether the buyer of an order currently has what it bought. */
export function hasOrderAccess(
  db: Pick<Database, "enrollments" | "batchEnrollments">,
  payment: Pick<Payment, "userId" | "itemType" | "itemId">,
): boolean {
  if (payment.itemType === "course") return db.enrollments.some((e) => e.userId === payment.userId && e.courseId === payment.itemId);
  if (payment.itemType === "batch") return db.batchEnrollments.some((e) => e.batchId === payment.itemId && e.userId === payment.userId);
  return db.enrollments.some((e) => e.userId === payment.userId && e.courseId === payment.itemId && e.purchasedCertificate);
}

/**
 * Orders whose access is being granted right now. The claiming call holds its
 * order here until `grantAccess` returns, so a confirmation racing with it
 * (return URL and webhook arrive together) does not grant a second time.
 */
const grantState = globalThis as unknown as { __llGrantingOrders?: Set<string> };
const granting: Set<string> = (grantState.__llGrantingOrders ??= new Set<string>());

/**
 * Mark an order as paid and grant what was bought. Idempotent: only the call
 * that moves the order from pending (or failed — a later successful retry of
 * a failed gateway attempt) to paid fulfils it; later calls return the paid
 * order with `fulfilled: false` (and grant the access again if an earlier
 * attempt failed to).
 */
export async function fulfillPayment(
  paymentId: string,
  gatewayPaymentId?: string,
  opts: { gatewayOrderId?: string; source?: FulfillmentSource } = {},
): Promise<FulfillmentOutcome> {
  const now = new Date();
  const claim = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { kind: "missing" as const };
    if (row.status === "refunded") return { kind: "refunded" as const, row: { ...row } };
    if (row.status === "paid") {
      // A second confirmation carrying a different real payment id means the learner paid twice
      // (also when the order was confirmed by hand meanwhile and relabelled "manual").
      const duplicate =
        !!gatewayPaymentId && isAnyGatewayPaymentReference(gatewayPaymentId) && !!row.gatewayPaymentId && row.gatewayPaymentId !== gatewayPaymentId;
      if (gatewayPaymentId && !row.gatewayPaymentId) row.gatewayPaymentId = gatewayPaymentId;
      return { kind: "already" as const, row: { ...row }, duplicate, missingAccess: !hasOrderAccess(d, row) };
    }
    row.status = "paid";
    row.paidAt = now.toISOString();
    if (gatewayPaymentId) row.gatewayPaymentId = gatewayPaymentId;
    if (opts.gatewayOrderId) row.gatewayOrderId = opts.gatewayOrderId;
    row.failureReason = undefined;
    row.checkoutUrl = undefined;
    if (isInvoiceable(row)) assignInvoiceNumber(d, row, now);
    let overLimit: { couponId: string; code: string; used: number; limit: number } | null = null;
    if (row.couponId) {
      const coupon = d.coupons.find((c) => c.id === row.couponId);
      if (coupon) {
        coupon.redemptionCount += 1;
        // Open orders reserve their use at checkout, so this only trips when an order without a
        // reservation (a cancelled checkout paid in another tab, an order recorded by hand) is paid.
        const over = couponOverflow(coupon, d.payments);
        if (over) overLimit = { couponId: coupon.id, code: coupon.code, ...over };
      }
    }
    // Another paid order for the same item (e.g. a cancelled attempt that was paid in another tab).
    const paidTwice =
      row.amount > 0 &&
      d.payments.some((p) => p.id !== row.id && p.status === "paid" && p.userId === row.userId && p.itemType === row.itemType && p.itemId === row.itemId);
    // Held until access is granted (released in `runGrant`).
    granting.add(row.id);
    return { kind: "claimed" as const, row: { ...row }, overLimit, paidTwice };
  });

  if (claim.kind === "missing") return { ok: false, error: "Payment not found." };
  if (claim.kind === "refunded") {
    if (gatewayPaymentId && isAnyGatewayPaymentReference(gatewayPaymentId) && claim.row.gatewayPaymentId !== gatewayPaymentId) {
      await alertAdmins({
        type: "system",
        subject: `Payment received for refunded order ${claim.row.orderId}`,
        message: `A new payment (${gatewayPaymentId}) arrived for an order that was already refunded. Refund it from the payment gateway's dashboard.`,
        link: transactionsLink(claim.row.orderId),
        dedupeKey: `paid-after-refund:${claim.row.id}:${gatewayPaymentId}`,
      });
    }
    return { ok: false, error: "Refunded orders cannot be marked as paid." };
  }
  if (claim.kind === "already") {
    if (claim.duplicate) {
      await alertAdmins({
        type: "system",
        subject: `Possible duplicate payment for order ${claim.row.orderId}`,
        message: `${claim.row.billingName} paid ${formatPrice(claim.row.amount, claim.row.currency)} again (${gatewayPaymentId}). The order was already paid with ${claim.row.gatewayPaymentId}; refund the duplicate from the gateway dashboard.`,
        link: transactionsLink(claim.row.orderId),
        dedupeKey: `duplicate-payment:${claim.row.id}:${gatewayPaymentId}`,
      });
    }
    if (claim.missingAccess) {
      // An earlier fulfilment could not grant access: try again (every step is idempotent).
      const retried = await runGrant(claim.row, false);
      if (retried) return { ok: true, data: { payment: claim.row, fulfilled: false, notice: retried.notice, accessFailed: retried.failed || undefined } };
    }
    return { ok: true, data: { payment: claim.row, fulfilled: false } };
  }

  const payment = claim.row;
  console.info(`[payments] order ${payment.orderId} paid (${payment.gateway}${opts.source ? `, via ${opts.source}` : ""})`);
  const granted = (await runGrant(payment, true)) ?? { learnerExists: true, failed: false };
  const couponNotice = claim.overLimit
    ? `Coupon ${claim.overLimit.code} has now been used ${claim.overLimit.used} times, more than its usage limit of ${claim.overLimit.limit}.`
    : undefined;

  if (granted.learnerExists) {
    await notify(payment.userId, {
      type: payment.itemType === "certificate" ? "certificate" : "enrollment",
      subject: payment.amount > 0 ? `Payment received for ${payment.itemTitle}` : `You're enrolled: ${payment.itemTitle}`,
      message: `Order ${payment.orderId} · ${formatPrice(payment.amount, payment.currency)}${payment.invoiceNumber && payment.amount > 0 ? ` · Invoice ${payment.invoiceNumber}` : ""}`,
      link: `/billing/success/${payment.orderId}`,
    });
  }
  if (claim.paidTwice) {
    await alertAdmins({
      type: "system",
      subject: `${payment.billingName} paid twice for ${payment.itemTitle}`,
      message: `Order ${payment.orderId} was paid although another order for the same item is already paid. Refund one of them; the learner keeps access through the other.`,
      link: transactionsLink(payment.itemTitle),
      fromUserId: payment.userId,
    });
  }
  if (granted.notice && payment.amount > 0 && !granted.failed) {
    // The money was taken but access could not be granted: an administrator has to act.
    await alertAdmins({
      type: "system",
      subject: `Order ${payment.orderId} needs attention`,
      message: granted.notice,
      link: transactionsLink(payment.orderId),
      fromUserId: payment.userId,
    });
  }
  if (claim.overLimit) {
    await alertAdmins({
      type: "system",
      subject: `Coupon ${claim.overLimit.code} is over its usage limit`,
      message: `Order ${payment.orderId} was paid with ${claim.overLimit.code}, which is now used ${claim.overLimit.used} times (limit ${claim.overLimit.limit}, counting open orders). Disable or edit the coupon if it should not be used again.`,
      link: "/admin/settings/coupons",
      dedupeKey: `coupon-over-limit:${claim.overLimit.couponId}:${payment.id}`,
    });
  }

  return {
    ok: true,
    data: {
      payment,
      fulfilled: true,
      notice: [granted.notice, couponNotice].filter(Boolean).join(" ") || undefined,
      certificateCode: granted.certificateCode,
      accessFailed: granted.failed || undefined,
    },
  };
}

interface GrantOutcome {
  learnerExists: boolean;
  notice?: string;
  certificateCode?: string;
  /** `grantAccess` threw; administrators were notified. */
  failed: boolean;
}

/**
 * Grant an order's access with the per-order guard held. `held` is true for
 * the claiming call (which took the guard inside its `mutate`); other callers
 * skip the order (return null) while someone else is granting it. Errors are
 * reported to administrators instead of being thrown, because the order is
 * already paid and the caller must still answer the learner or the gateway.
 */
async function runGrant(payment: Payment, held: boolean): Promise<GrantOutcome | null> {
  if (!held) {
    if (granting.has(payment.id)) return null;
    granting.add(payment.id);
  }
  try {
    return { ...(await grantAccess(payment)), failed: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[payments] order ${payment.orderId} is paid but access could not be granted: ${reason}`);
    await alertAdmins({
      type: "system",
      subject: `Order ${payment.orderId} was paid but access could not be granted`,
      message: `${payment.billingName} paid for ${payment.itemTitle}, but enrolling them failed (${reason.slice(0, 200)}). It is retried automatically when the payment is confirmed again; enroll the learner by hand if it keeps failing.`,
      link: transactionsLink(payment.orderId),
      fromUserId: payment.userId,
      dedupeKey: `access-failed:${payment.id}`,
    });
    return {
      learnerExists: true,
      failed: true,
      notice: `Order ${payment.orderId} is paid, but access could not be granted yet. Administrators have been notified.`,
    };
  } finally {
    granting.delete(payment.id);
  }
}

/** Grant what a paid order bought. Every step is idempotent. */
async function grantAccess(payment: Payment): Promise<{ learnerExists: boolean; notice?: string; certificateCode?: string }> {
  const db = await getDb();
  const user = db.users.find((u) => u.id === payment.userId);
  if (!user) return { learnerExists: false, notice: `The learner account of order ${payment.orderId} no longer exists, so no access was granted.` };

  if (payment.itemType === "course") {
    const course = db.courses.find((c) => c.id === payment.itemId);
    if (!course) return { learnerExists: true, notice: `The course of order ${payment.orderId} no longer exists, so no enrollment was created.` };
    await enrollUserInCourse(user.id, course.id, { paymentId: payment.id });
    return { learnerExists: true };
  }

  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    if (!batch) return { learnerExists: true, notice: `The batch of order ${payment.orderId} no longer exists, so no enrollment was created.` };
    const res = await enrollUserInBatch(user.id, batch.id, { paymentId: payment.id, source: payment.source });
    if (!res.ok) return { learnerExists: true, notice: `${res.error} Order ${payment.orderId} was paid but no seat could be allocated in ${batch.title}.` };
    return { learnerExists: true };
  }

  const course = db.courses.find((c) => c.id === payment.itemId);
  if (!course) return { learnerExists: true, notice: `The course of order ${payment.orderId} no longer exists, so no certificate could be issued.` };
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
    return { learnerExists: true, certificateCode: cert.code };
  }
  return { learnerExists: true };
}

/**
 * Grant the access of a paid order whose buyer does not have it (an earlier
 * fulfilment failed half-way). No-op for unpaid orders and buyers who have
 * access. Returns true when the buyer has the access afterwards.
 */
export async function restoreOrderAccess(paymentId: string): Promise<boolean> {
  const db = await getDb();
  const row = db.payments.find((p) => p.id === paymentId);
  if (!row || row.status !== "paid") return false;
  if (hasOrderAccess(db, row)) return true;
  await runGrant({ ...row }, false);
  return hasOrderAccess(await getDb(), row);
}

/**
 * Mark a pending order as failed (gateway declined, checkout expired, learner
 * cancelled). No-op for orders that are no longer pending, so a late failure
 * event can never undo a payment. When `gatewayOrderId` is given, only the
 * checkout attempt with that id may fail the order (an expired old Stripe
 * session must not cancel a newer one).
 */
export async function markPaymentFailed(paymentId: string, reason?: string, opts: { gatewayOrderId?: string } = {}): Promise<boolean> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || row.status !== "pending") return false;
    if (opts.gatewayOrderId && row.gatewayOrderId && row.gatewayOrderId !== opts.gatewayOrderId) return false;
    row.status = "failed";
    row.failureReason = reason ? reason.slice(0, 300) : undefined;
    row.checkoutUrl = undefined;
    return true;
  });
}

/**
 * A gateway payment for an order that was never confirmed turned out to be
 * refunded or disputed (e.g. the admin refunded a stuck order in the gateway
 * dashboard). The order is closed instead of fulfilled and administrators are
 * told once. Paid and refunded orders are left alone.
 */
export async function closeReversedPayment(
  paymentId: string,
  info: { reason: string; gatewayName: string; gatewayPaymentId?: string },
): Promise<{ status: PaymentStatus | "missing"; payment?: Payment }> {
  const res = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { status: "missing" as const, changed: false };
    if (row.status === "paid" || row.status === "refunded") return { status: row.status, changed: false, payment: { ...row } };
    const changed = row.status !== "failed" || row.failureReason !== info.reason;
    row.status = "failed";
    row.failureReason = info.reason.slice(0, 300);
    row.checkoutUrl = undefined;
    if (info.gatewayPaymentId && !row.gatewayPaymentId) row.gatewayPaymentId = info.gatewayPaymentId;
    return { status: "failed" as const, changed, payment: { ...row } };
  });
  if (res.changed && res.payment) {
    const p = res.payment;
    console.warn(`[payments] order ${p.orderId} closed: ${info.gatewayName} payment ${info.gatewayPaymentId ?? "?"} was reversed before it was confirmed`);
    await alertAdmins({
      type: "system",
      subject: `Order ${p.orderId} was not fulfilled: the payment was reversed`,
      message: `${info.gatewayName} reports for ${info.gatewayPaymentId ?? "the payment of this order"}: ${info.reason} The order was still awaiting confirmation, so it was closed without granting access.`,
      link: transactionsLink(p.orderId),
      fromUserId: p.userId,
      dedupeKey: `reversed-payment:${p.id}:${info.gatewayPaymentId ?? ""}`,
    });
  }
  return { status: res.status, payment: res.payment };
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const lockState = globalThis as unknown as { __llRefundLocks?: Set<string> };
const refundLocks: Set<string> = (lockState.__llRefundLocks ??= new Set<string>());

/**
 * In-process lock that keeps two administrators (or an admin and a webhook)
 * from refunding the same order at once. Returns false when already held.
 */
export function acquireRefundLock(paymentId: string): boolean {
  if (refundLocks.has(paymentId)) return false;
  refundLocks.add(paymentId);
  return true;
}

export function releaseRefundLock(paymentId: string): void {
  refundLocks.delete(paymentId);
}

export function isRefundInProgress(paymentId: string): boolean {
  return refundLocks.has(paymentId);
}

/** What is known about a refund. Amounts are in app units. */
export interface RefundUpdate {
  /** Gateway refund id (re_… / rfnd_…). A refund already recorded under this id is never counted again. */
  refundId?: string;
  /** Amount of this refund. */
  amount?: number;
  /**
   * Total refunded on the gateway payment so far, as the gateway reports it.
   * Authoritative when present: the recorded amount becomes the larger of the
   * two (it only ever grows, so an old, redelivered event cannot lower it).
   */
  total?: number;
  at?: string;
}

function whole(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}

/**
 * Fold a refund into an order row (pure; call inside `mutate`). Refund ids
 * are remembered in `row.refunds`, so a redelivered or concurrent event is
 * counted once. The recorded total is recomputed from the gateway total when
 * known, otherwise from the previous total plus refunds with new ids, and is
 * never below the sum of the recorded refunds nor above the order amount.
 * Returns true when anything new was recorded.
 */
export function mergeRefund(row: Payment, update: RefundUpdate, at: string): boolean {
  const entries = (row.refunds ?? []).map((e) => ({ ...e }));
  const known = new Set(entries.map((e) => e.id));
  if (row.refundId) known.add(row.refundId);
  const id = update.refundId?.trim() || undefined;
  const isNew = !!id && !known.has(id);
  const amount = whole(update.amount);
  const reported = whole(update.total);
  const before = row.refundedAmount ?? (row.status === "refunded" ? row.amount : 0);

  if (id && isNew) entries.push({ id, amount: amount ?? 0, at });
  let total = before;
  if (reported !== undefined) total = Math.max(before, reported);
  else if (amount !== undefined && (!id || isNew)) total = before + amount;
  total = Math.max(total, entries.reduce((sum, e) => sum + e.amount, 0));
  total = Math.min(row.amount, total);

  const changed = total !== before || isNew;
  if (entries.length) row.refunds = entries;
  if (id && isNew) row.refundId = id;
  if (total !== before || row.refundedAmount === undefined) row.refundedAmount = total;
  if (changed || !row.refundedAt) row.refundedAt = at;
  return changed;
}

/** Mark a paid row refunded, release its coupon use and remove the access it granted (inside `mutate`). */
function closeAsRefunded(d: Database, row: Payment, at: string): void {
  row.status = "refunded";
  if (!row.refundedAt) row.refundedAt = at;
  // A refunded order no longer counts as a redemption of its coupon.
  if (row.couponId) {
    const coupon = d.coupons.find((c) => c.id === row.couponId);
    if (coupon) coupon.redemptionCount = Math.max(0, coupon.redemptionCount - 1);
  }
  revokeAccessIn(d, row);
}

async function notifyRefunded(payment: Payment): Promise<void> {
  const partial = (payment.refundedAmount ?? payment.amount) < payment.amount;
  await notify(payment.userId, {
    type: "system",
    subject: `Your payment for ${payment.itemTitle} was ${partial ? "partially " : ""}refunded`,
    message: `Order ${payment.orderId} · ${formatPrice(payment.refundedAmount ?? payment.amount, payment.currency)} refunded`,
    link: `/billing/success/${payment.orderId}`,
  });
  console.info(`[payments] order ${payment.orderId} refunded (${payment.gateway})`);
}

/**
 * Refund made by an administrator in the app: record it, mark the order
 * refunded (even for a partial amount) and remove the access it granted —
 * all in one serialized write. Idempotent: an order that is already refunded
 * only has the refund details merged in.
 */
export async function applyRefund(paymentId: string, update: RefundUpdate): Promise<{ ok: true; data: { payment: Payment; changed: boolean } } | { ok: false; error: string }> {
  const at = update.at ?? new Date().toISOString();
  const claim = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { kind: "missing" as const };
    if (row.status === "refunded") {
      mergeRefund(row, update, at);
      return { kind: "already" as const, row: { ...row } };
    }
    if (row.status !== "paid") return { kind: "not_paid" as const };
    mergeRefund(row, update, at);
    closeAsRefunded(d, row, at);
    return { kind: "claimed" as const, row: { ...row } };
  });
  if (claim.kind === "missing") return { ok: false, error: "Payment not found." };
  if (claim.kind === "not_paid") return { ok: false, error: "Only paid orders can be refunded." };
  if (claim.kind === "already") return { ok: true, data: { payment: claim.row, changed: false } };
  await notifyRefunded(claim.row);
  return { ok: true, data: { payment: claim.row, changed: true } };
}

export type GatewayRefundOutcome =
  /** The order is now fully refunded: marked refunded and its access removed. */
  | { kind: "refunded"; payment: Payment }
  /** A partial refund was recorded; the learner keeps access. */
  | { kind: "partial"; payment: Payment }
  /** Nothing new (a redelivered event, or the order was already refunded). */
  | { kind: "unchanged"; payment: Payment }
  /** The order is not paid (pending or cancelled): there is nothing to refund on it. */
  | { kind: "not_paid"; payment: Payment }
  | { kind: "missing" };

/**
 * Refund reported by a gateway (webhook, or found when checking the gateway):
 * decides between partial and full on the live row inside one `mutate`. A
 * partial refund keeps the learner's access; once everything was refunded
 * (or the gateway says so with `full`) the order is marked refunded and its
 * access removed.
 */
export async function recordGatewayRefund(paymentId: string, update: RefundUpdate & { full?: boolean }): Promise<GatewayRefundOutcome> {
  const at = update.at ?? new Date().toISOString();
  const res = await mutate((d): GatewayRefundOutcome => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { kind: "missing" };
    if (row.status === "refunded") {
      mergeRefund(row, update, at);
      return { kind: "unchanged", payment: { ...row } };
    }
    if (row.status !== "paid") return { kind: "not_paid", payment: { ...row } };
    const changed = mergeRefund(row, update, at);
    if (update.full || (row.amount > 0 && (row.refundedAmount ?? 0) >= row.amount)) {
      closeAsRefunded(d, row, at);
      return { kind: "refunded", payment: { ...row } };
    }
    return { kind: changed ? "partial" : "unchanged", payment: { ...row } };
  });
  if (res.kind === "refunded") await notifyRefunded(res.payment);
  return res;
}

/* ------------------------------------------------------------------ */
/* Access removal                                                      */
/* ------------------------------------------------------------------ */

/** Same effect as `unenrollUserFromCourse`, inside an existing `mutate`. */
function removeCourseEnrollment(d: Database, userId: string, courseId: string): void {
  d.enrollments = d.enrollments.filter((e) => !(e.userId === userId && e.courseId === courseId));
  d.progress = d.progress.filter((p) => !(p.userId === userId && p.courseId === courseId));
  d.videoWatches = d.videoWatches.filter((w) => !(w.userId === userId && w.courseId === courseId));
}

/**
 * Remove the access a refunded order granted (pure; call inside `mutate`).
 * Access that also comes from elsewhere is kept:
 *  - another paid order for the same item (the learner paid twice): the
 *    enrollment, seat or certificate stays and is re-pointed to that order;
 *  - an enrollment or seat created by a different order;
 *  - course access through a batch the learner still belongs to.
 */
export function revokeAccessIn(d: Database, payment: Pick<Payment, "id" | "userId" | "itemType" | "itemId">): void {
  const userId = payment.userId;
  const paidOrderFor = (itemType: Payment["itemType"], itemId: string) =>
    d.payments.find((p) => p.id !== payment.id && p.status === "paid" && p.userId === userId && p.itemType === itemType && p.itemId === itemId);
  const other = paidOrderFor(payment.itemType, payment.itemId);

  if (payment.itemType === "course") {
    const enrollment = d.enrollments.find((e) => e.userId === userId && e.courseId === payment.itemId);
    if (!enrollment) return;
    if (other) {
      if (!enrollment.paymentId || enrollment.paymentId === payment.id) enrollment.paymentId = other.id;
      return;
    }
    // Created by another purchase (e.g. a batch order): not this order's to remove.
    if (enrollment.paymentId && enrollment.paymentId !== payment.id) return;
    // Joining a batch does not stamp `batchId` on an enrollment that already existed, so a seat in
    // any batch that includes the course counts as well.
    const viaSeat = d.batchEnrollments.some((s) => s.userId === userId && d.batches.some((b) => b.id === s.batchId && b.courseIds.includes(payment.itemId)));
    if (enrollment.batchId || viaSeat) {
      // Access also comes from a batch: keep it, just detach the refunded payment.
      enrollment.paymentId = undefined;
      return;
    }
    removeCourseEnrollment(d, userId, payment.itemId);
    return;
  }

  if (payment.itemType === "batch") {
    const seat = d.batchEnrollments.find((e) => e.batchId === payment.itemId && e.userId === userId);
    if (other) {
      if (seat && (!seat.paymentId || seat.paymentId === payment.id)) seat.paymentId = other.id;
      for (const e of d.enrollments) if (e.userId === userId && e.paymentId === payment.id) e.paymentId = other.id;
      return;
    }
    if (seat?.paymentId && seat.paymentId !== payment.id) {
      // The seat was bought with another order: only forget this one.
      for (const e of d.enrollments) if (e.userId === userId && e.paymentId === payment.id) e.paymentId = undefined;
      return;
    }
    if (seat) d.batchEnrollments = d.batchEnrollments.filter((e) => e.id !== seat.id);
    const batch = d.batches.find((b) => b.id === payment.itemId);
    if (!batch) return;
    // Other batches the learner still belongs to keep their course access.
    const otherBatches = d.batchEnrollments
      .filter((e) => e.userId === userId && e.batchId !== batch.id)
      .map((e) => d.batches.find((b) => b.id === e.batchId))
      .filter((b): b is Batch => !!b);
    const viaBatch = d.enrollments.filter((e) => e.userId === userId && e.batchId === batch.id && batch.courseIds.includes(e.courseId));
    for (const e of viaBatch) {
      // Only rows this batch purchase created are removed. A row that existed
      // before the learner joined (a separate order or a free enrollment)
      // got this batch's payment id attached only if it had none, so it is
      // recognised by being older than the batch seat.
      const createdByBatch = e.paymentId === payment.id && (!seat || e.enrolledAt >= seat.enrolledAt);
      const otherBatch = otherBatches.find((b) => b.courseIds.includes(e.courseId));
      const courseOrder = paidOrderFor("course", e.courseId);
      if (createdByBatch && !otherBatch && !courseOrder) {
        removeCourseEnrollment(d, userId, e.courseId);
        continue;
      }
      e.batchId = otherBatch?.id;
      if (e.paymentId === payment.id) e.paymentId = courseOrder?.id;
    }
    return;
  }

  // Certificate: another paid certificate order for the course keeps it.
  if (other) return;
  const enrollment = d.enrollments.find((e) => e.userId === userId && e.courseId === payment.itemId);
  if (enrollment) enrollment.purchasedCertificate = false;
  const course = d.courses.find((c) => c.id === payment.itemId);
  const cert = d.certificates.find((c) => c.userId === userId && c.courseId === payment.itemId);
  // Paid certificates are revoked (unpublished) with the refund; free ones stay.
  if (cert && course?.paidCertificate) cert.published = false;
}
