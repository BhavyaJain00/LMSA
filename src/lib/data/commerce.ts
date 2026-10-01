import "server-only";
import type { Batch, Bundle, Coupon, Course, CourseInstallmentPlan, CurrencyPrice, Database, MembershipPlan, Notification, Payment, PaymentItemType, PaymentStatus, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { hasRole } from "@/lib/auth/session";
import { notifyMany } from "@/lib/services/notifications";
import { sendPaymentReminderEmail } from "@/lib/email";
import { assertPrerequisitesMet } from "@/lib/services/drip";
import { formatPrice, shortCode, toDateKey, uid } from "@/lib/utils";
import { getRequestInfo } from "@/lib/auth/request-info";
import { currentSubscription, ownedCourseIds, resolveCourseAccess } from "@/lib/commerce/access";
import { bundleCourses, isBundleOnSale } from "@/lib/commerce/bundles";
import { installmentPlanPrice, isInstallmentOrder, offeredInstallmentPlan, splitOrder, type OrderAmounts } from "@/lib/commerce/installments";
import { intervalNoun, isRecurringInterval, planAccessLabel } from "@/lib/commerce/plans";
import { isOngoing, trialEligible, trialEnd } from "@/lib/commerce/subscriptions";
import { bumpOrderId, isOrderBump } from "@/lib/commerce/upsells";
import { applyTax, resolveTax, type TaxContext } from "@/lib/commerce/tax";
import { pickPrice, selectableCurrencies } from "@/lib/commerce/currency";
import {
  couponAppliesTo,
  couponAttemptsBlocked,
  couponProblem,
  couponUsesTaken,
  normalizeCouponCode,
  recordRejectedCoupon,
} from "@/lib/payments/coupon-rules";
import { resolveSeatsOrder, seatsPurchaseProblem, type SeatsOrder } from "@/lib/growth/teams";

/**
 * Commerce domain logic: billing items, access checks, coupons, order
 * summaries, reminders and the admin transaction queries. Fulfilment
 * (access after payment), refunds, gateways and invoices live in
 * `src/lib/payments/*`. Server Actions in `src/lib/actions/payments.ts` and
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
  plan: "Membership",
  bundle: "Bundle",
  gift: "Gift",
  seats: "Team seats",
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

/**
 * Status wording for one order: failed orders with a gateway reason read as
 * "Payment failed", otherwise "Cancelled"; partial refunds are called out.
 */
export function paymentStatusLabel(p: Pick<Payment, "status" | "failureReason" | "refundedAmount" | "amount"> & Partial<Pick<Payment, "itemType" | "installmentNumber" | "installmentsTotal" | "createdAt">>): string {
  if (isScheduledPart(p)) return "Scheduled";
  if (p.status === "failed") return p.failureReason ? "Payment failed" : "Cancelled";
  if (p.status === "refunded") return p.refundedAmount !== undefined && p.refundedAmount > 0 && p.refundedAmount < p.amount ? "Partially refunded" : "Refunded";
  if (p.status === "pending") return "Awaiting payment";
  return p.refundedAmount ? "Paid · partially refunded" : "Paid";
}

/**
 * A part of a payment plan that is not due yet: a pending order whose
 * `createdAt` (its due date) lies in the future.
 */
export function isScheduledPart(p: Pick<Payment, "status"> & Partial<Pick<Payment, "itemType" | "installmentNumber" | "installmentsTotal" | "createdAt">>, now: number = Date.now()): boolean {
  if (p.status !== "pending" || !p.itemType || !p.createdAt || (p.installmentNumber ?? 0) < 2) return false;
  return isInstallmentOrder({ itemType: p.itemType, installmentNumber: p.installmentNumber, installmentsTotal: p.installmentsTotal }) && Date.parse(p.createdAt) > now;
}

export function parseItemType(raw: string | undefined | null): PaymentItemType | null {
  return raw === "course" || raw === "batch" || raw === "certificate" || raw === "plan" || raw === "bundle" || raw === "gift" || raw === "seats" ? raw : null;
}

export interface BillingItem {
  type: PaymentItemType;
  /** Course id (course & certificate purchases), batch id, membership plan id or bundle id. */
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
  /** Membership plan (itemType "plan"). */
  plan?: MembershipPlan | null;
  /** Course bundle (itemType "bundle"). */
  bundle?: Bundle | null;
  /** Team seats order (itemType "seats"), priced on the server from the team's courses. */
  seats?: SeatsOrder | null;
}

/**
 * Fixed prices in other currencies an item can be sold at: courses (not
 * their certificates), bundles and lifetime plans. Plans that renew are
 * always billed in their own currency, because the gateway's recurring
 * price is created in it.
 */
function currencyPricesOf(item: BillingItem): readonly CurrencyPrice[] | undefined {
  if (item.type === "course") return item.course?.prices;
  if (item.type === "bundle") return item.bundle?.prices;
  if (item.type === "plan" && item.plan && !isRecurringInterval(item.plan.interval)) return item.plan.prices;
  return undefined;
}

/** The item's own price, before any currency choice. */
function defaultPriceOf(item: BillingItem): { amount: number; currency: string } {
  if (item.type === "course" && item.course) return { amount: item.course.price, currency: item.course.currency || "USD" };
  if (item.type === "bundle" && item.bundle) return { amount: item.bundle.price, currency: item.bundle.currency || "USD" };
  if (item.type === "plan" && item.plan) return { amount: item.plan.price, currency: item.plan.currency || "USD" };
  return { amount: item.amount, currency: item.currency };
}

/** Currencies a buyer can pay this item in (the default first). */
export function itemCurrencies(item: BillingItem, settings: Pick<Settings, "growth">): string[] {
  return selectableCurrencies(defaultPriceOf(item), currencyPricesOf(item), settings.growth.multiCurrency);
}

/**
 * The item priced in the buyer's currency: its fixed price in `currency`
 * when multi-currency is on and one is defined, else its default price.
 * Every order, bump, gift and summary is priced from the result, so the
 * page and the server action always agree.
 */
export function priceItemIn(item: BillingItem, currency: string | null | undefined, settings: Pick<Settings, "growth">): BillingItem {
  const picked = pickPrice(defaultPriceOf(item), currencyPricesOf(item), currency, settings.growth.multiCurrency);
  if (picked.isDefault) return item;
  return { ...item, amount: picked.amount, currency: picked.currency };
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

export function itemFromPlan(plan: MembershipPlan): BillingItem {
  return {
    type: "plan",
    id: plan.id,
    title: plan.name,
    name: plan.name,
    description: `${planAccessLabel(plan.access)} · ${plan.interval === "one_time" ? "pay once, keep access" : `billed every ${intervalNoun(plan.interval)}`}`,
    gradient: "purple",
    amount: plan.price,
    currency: plan.currency || "USD",
    href: "/pricing",
    course: null,
    batch: null,
    plan,
  };
}

export function itemFromSeats(order: SeatsOrder): BillingItem {
  return {
    type: "seats",
    id: order.ref,
    title: order.title,
    name: order.org.name,
    description: order.description,
    gradient: "blue",
    amount: order.quote.amount,
    currency: order.quote.currency || "USD",
    // A team's first order comes from the purchase page; later ones from the team page.
    href: order.firstPurchase ? "/team/buy" : `/team?org=${encodeURIComponent(order.org.slug)}`,
    course: null,
    batch: null,
    seats: order,
  };
}

export function itemFromBundle(bundle: Bundle, courses: readonly Pick<Course, "id" | "title" | "imageUrl" | "cardGradient">[]): BillingItem {
  const included = bundleCourses(bundle, courses);
  return {
    type: "bundle",
    id: bundle.id,
    title: bundle.title,
    name: bundle.title,
    description: included.length ? `${included.length} course${included.length === 1 ? "" : "s"}: ${included.map((c) => c.title).join(", ")}` : "Course bundle",
    imageUrl: bundle.imageUrl ?? included.find((c) => c.imageUrl)?.imageUrl,
    gradient: included[0]?.cardGradient ?? "teal",
    amount: bundle.price,
    currency: bundle.currency || "USD",
    href: `/bundles/${bundle.slug}`,
    course: null,
    batch: null,
    bundle,
  };
}

/** Resolve the thing being bought. Accepts an id or a slug. */
export async function getBillingItem(type: PaymentItemType, idOrSlug: string): Promise<BillingItem | null> {
  const db = await getDb();
  if (type === "batch") {
    const batch = db.batches.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
    return batch ? itemFromBatch(batch) : null;
  }
  if (type === "plan") {
    const plan = db.plans.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
    return plan ? itemFromPlan(plan) : null;
  }
  if (type === "bundle") {
    const bundle = db.bundles.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
    return bundle ? itemFromBundle(bundle, db.courses) : null;
  }
  if (type === "seats") {
    // `<orgId>-<seats>`: the price is always recomputed from the team's courses.
    const resolved = resolveSeatsOrder(db, idOrSlug);
    return resolved.ok ? itemFromSeats(resolved.order) : null;
  }
  // Gifts are bought through their own checkout (/gift).
  if (type !== "course" && type !== "certificate") return null;
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
    // Enrolled learners own the course, unless the enrollment came from a membership that lapsed
    // or from a payment plan that is paused or was cancelled.
    const courseAccess = resolveCourseAccess(db, user.id, course.id);
    if (courseAccess.granted) return { status: "owned", redirectTo: `/courses/${course.slug}` };
    // A paused payment plan is resumed by paying the part that is overdue, not by a new checkout.
    const owed = courseAccess.blocked === "installment_overdue" ? courseAccess.installments?.next?.payment : null;
    if (owed) return { status: "pending", payment: owed };
    if (course.upcoming && !manager) return { status: "denied", message: "This course is not open for enrollment yet.", ...back };
    if (!course.paidCourse || course.price <= 0) return { status: "free", redirectTo: `/courses/${course.slug}` };
    if (course.disableSelfLearning && !hasRole(user, "moderator", "course_creator", "batch_evaluator")) {
      return { status: "denied", message: "This course is only available through a batch. Please contact the Administrator.", ...back };
    }
    // Shared prerequisite rule (drip area): paid checkout is blocked until every prerequisite is completed.
    const gate = await assertPrerequisitesMet(user.id, course.id);
    if (!gate.ok) {
      const first = gate.missing[0];
      return {
        status: "denied",
        message: gate.error,
        backHref: first ? `/courses/${first.slug}` : `/courses/${course.slug}`,
        backLabel: first ? (gate.missing.length === 1 ? "Go to the prerequisite" : "Go to the first prerequisite") : "Checkout Course",
      };
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

  if (item.type === "bundle" && item.bundle) {
    const bundle = item.bundle;
    if (!db.settings.growth.bundlesEnabled || !db.settings.features.courses) {
      return { status: "denied", message: "Bundles are not available at the moment.", backHref: "/courses", backLabel: "Browse courses" };
    }
    if (!isBundleOnSale(bundle, db.courses)) return { status: "denied", message: "This bundle is not available for purchase.", backHref: "/bundles", backLabel: "See all bundles" };
    const included = bundleCourses(bundle, db.courses).map((c) => c.id);
    if (ownedCourseIds(db, user.id, included).length === included.length) return { status: "owned", redirectTo: `/bundles/${bundle.slug}` };
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  if (item.type === "seats" && item.seats) {
    const order = item.seats;
    const back = { backHref: item.href, backLabel: "Back to your team" };
    const problem = seatsPurchaseProblem(db, user, order);
    if (problem) return { status: "denied", message: problem, ...back };
    if (order.quote.amount <= 0) return { status: "denied", message: "This team order has nothing to pay. Contact us to add the seats.", ...back };
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  if (item.type === "plan" && item.plan) {
    const plan = item.plan;
    const back = { backHref: "/pricing", backLabel: "See membership plans" };
    if (!db.settings.growth.subscriptionsEnabled) return { status: "denied", message: "Memberships are not available at the moment.", ...back };
    if (!plan.active) return { status: "denied", message: "This membership plan is no longer offered.", ...back };
    const current = currentSubscription(db, user.id);
    if (current && isOngoing(current)) return { status: "owned", redirectTo: "/settings/subscription" };
    if (pending) return { status: "pending", payment: pending };
    return { status: "ok" };
  }

  return { status: "denied", message: "Module Name is incorrect or does not exist.", backHref: "/courses", backLabel: "Browse courses" };
}

/* ------------------------------------------------------------------ */
/* Membership checkout terms                                           */
/* ------------------------------------------------------------------ */

export interface MembershipTerms {
  /** Free days before the first charge for this buyer (0 = charged at checkout). */
  trialDays: number;
  /** Billed every month/year; false for lifetime plans. */
  recurring: boolean;
  interval: MembershipPlan["interval"];
  /** When a trial that starts now ends and the first charge is due (null without a trial). */
  trialEndsAt: string | null;
}

/**
 * What a member signs up for when buying `plan`: one free trial per member
 * (never for someone who had a membership before) and whether it renews.
 */
export function membershipTerms(db: Pick<Database, "subscriptions">, userId: string, plan: MembershipPlan): MembershipTerms {
  const recurring = isRecurringInterval(plan.interval);
  const trialDays = recurring && plan.trialDays > 0 && trialEligible(db.subscriptions.filter((s) => s.userId === userId)) ? plan.trialDays : 0;
  return { trialDays, recurring, interval: plan.interval, trialEndsAt: trialDays > 0 ? trialEnd(new Date().toISOString(), trialDays) : null };
}

/* ------------------------------------------------------------------ */
/* Installment checkout                                                */
/* ------------------------------------------------------------------ */

export interface InstallmentCheckout {
  plan: CourseInstallmentPlan;
  /** The whole plan as one order: the course price plus the plan's surcharge, the coupon and tax. */
  full: OrderSummary;
  /** What each of the `plan.count` payments charges. */
  part: OrderAmounts;
  /** All payments together. */
  total: number;
}

/**
 * The "pay in parts" option of a course checkout, or null when the course is
 * not sold in installments (or a coupon makes it free). The plan is priced
 * as one order first, so a coupon and the tax apply to it exactly once, and
 * is then split into equal payments.
 */
export function installmentCheckout(item: BillingItem, coupon: Coupon | null, settings: Settings, tax?: TaxContext | null): InstallmentCheckout | null {
  if (item.type !== "course" || !item.course) return null;
  const plan = offeredInstallmentPlan(item.course, { enabled: settings.growth.installmentsEnabled, gateway: settings.commerce.paymentGateway });
  if (!plan) return null;
  const full = computeOrderSummary({ ...item, amount: installmentPlanPrice(item.amount, plan) }, coupon, settings, tax);
  const part = splitOrder({ originalAmount: full.originalAmount, discountAmount: full.discountAmount, taxAmount: full.taxAmount, amount: full.total }, plan.count, full.currency);
  if (part.amount <= 0) return null;
  return { plan, full, part, total: part.amount * plan.count };
}

/* ------------------------------------------------------------------ */
/* Coupons                                                             */
/* ------------------------------------------------------------------ */

// The rules live in `src/lib/payments/coupon-rules.ts` (pure, usable inside `mutate`).
export { normalizeCouponCode, couponAppliesTo, couponUsesTaken };

export type CouponCheck = { ok: true; coupon: Coupon } | { ok: false; error: string };

/**
 * Validate a coupon code for an item (enabled, not expired, under usage limit,
 * applicable). Fixed-amount coupons are stored in the platform's default
 * currency and only apply to items priced in that currency. This is the
 * friendly early check; the authoritative one runs inside the serialized
 * write that creates the order (`insertPendingOrder`).
 */
export async function validateCoupon(rawCode: string, item: Pick<BillingItem, "type" | "id" | "currency">): Promise<CouponCheck> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, error: "Please enter a coupon code" };
  const db = await getDb();
  const coupon = db.coupons.find((c) => c.code.toUpperCase() === code);
  const problem = couponProblem(coupon, item, { payments: db.payments, defaultCurrency: db.settings.commerce.defaultCurrency, today: toDateKey() }, code);
  if (problem || !coupon) return { ok: false, error: problem ?? `The coupon code '${code}' is invalid.` };
  return { ok: true, coupon };
}

/**
 * `validateCoupon` for a buyer, with guessing protection: once too many codes
 * were rejected for this account (or IP address) recently, every check is
 * refused for a while, so private codes cannot be found by trying them.
 */
export async function validateCouponForBuyer(rawCode: string, item: Pick<BillingItem, "type" | "id" | "currency">, buyer: { userId: string }): Promise<CouponCheck> {
  if (!normalizeCouponCode(rawCode)) return { ok: false, error: "Please enter a coupon code" };
  const { ip } = await getRequestInfo();
  const keys = { userId: buyer.userId, ip };
  const blocked = couponAttemptsBlocked(keys);
  if (blocked) return { ok: false, error: blocked };
  const check = await validateCoupon(rawCode, item);
  if (!check.ok) recordRejectedCoupon(keys);
  return check;
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
  /** The tax is part of the price (carved out) instead of added on top. */
  taxInclusive: boolean;
  /** Buyer country the tax was resolved for (by-country tax only). */
  taxCountry: string | null;
  total: number;
  coupon: { id: string; code: string; discountType: Coupon["discountType"]; value: number } | null;
  usdEquivalent: number | null;
}

/**
 * Price one order: the coupon comes off the price, then the buyer's tax is
 * added (exclusive) or carved out (inclusive). `tax` carries the tax rules
 * and the buyer's country for by-country tax; without it the default single
 * rate applies.
 */
export function computeOrderSummary(item: BillingItem, coupon: Coupon | null, settings: Settings, tax?: TaxContext | null): OrderSummary {
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
  const applied = resolveTax(settings, tax);
  const { taxAmount, total } = applyTax(subtotal, applied, item.currency);
  return {
    itemType: item.type,
    itemId: item.id,
    title: item.title,
    currency: item.currency,
    originalAmount: original,
    discountAmount: discount,
    subtotal,
    taxAmount,
    taxLabel: applied.name,
    taxPercentage: taxAmount > 0 ? applied.rate : 0,
    taxInclusive: taxAmount > 0 && applied.inclusive,
    taxCountry: applied.country,
    total,
    coupon: coupon ? { id: coupon.id, code: coupon.code, discountType: coupon.discountType, value: coupon.value } : null,
    usdEquivalent: c.showUsdEquivalent ? toUsdEquivalent(total, item.currency, c.applyRounding) : null,
  };
}

/** The tax facts an order row keeps for its invoice (country and rate of a by-country tax, the rate of any tax). */
export function orderTaxFields(summary: Pick<OrderSummary, "taxAmount" | "taxPercentage" | "taxCountry">): Pick<Payment, "taxCountry" | "taxRate"> {
  if (summary.taxAmount <= 0) return summary.taxCountry ? { taxCountry: summary.taxCountry } : {};
  return { ...(summary.taxCountry ? { taxCountry: summary.taxCountry } : {}), taxRate: summary.taxPercentage };
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

/**
 * Insert a new order unless the buyer already has an open (pending) order
 * for the same item — checked and written in one serialized mutation so a
 * double-submitted checkout cannot create two orders. The order id is made
 * unique inside the same mutation.
 *
 * A pending order reserves a use of its coupon, so the coupon is checked
 * again here, against the live data and in the same write that makes the
 * reservation: concurrent checkouts cannot all pass a snapshot check and
 * over-redeem a limited code.
 */
export type InsertOrderResult = { ok: true; payment: Payment; existing: boolean; bump?: Payment } | { ok: false; error: string };

/**
 * `bump` is an order bump ticked at checkout: it is inserted in the same
 * write as `<order id>-B`, linked to the new order (`upsellOfPaymentId`), and
 * charged together with it. An existing open order is returned without one.
 */
export async function insertPendingOrder(draft: Omit<Payment, "orderId">, bump?: Omit<Payment, "orderId" | "upsellOfPaymentId">): Promise<InsertOrderResult> {
  const today = toDateKey();
  return mutate((d): InsertOrderResult => {
    const open = d.payments.find((p) => p.userId === draft.userId && p.itemType === draft.itemType && p.itemId === draft.itemId && p.status === "pending");
    if (open) return { ok: true, payment: { ...open }, existing: true };
    if (draft.couponId) {
      const coupon = d.coupons.find((c) => c.id === draft.couponId);
      const problem = couponProblem(
        coupon,
        { type: draft.itemType, id: draft.itemId, currency: draft.currency },
        { payments: d.payments, defaultCurrency: d.settings.commerce.defaultCurrency, today },
        draft.couponCode,
      );
      if (problem) return { ok: false, error: problem };
    }
    const taken = new Set(d.payments.map((p) => p.orderId));
    let orderId = `ORD-${shortCode(2, 4)}`;
    while (taken.has(orderId)) orderId = `ORD-${shortCode(2, 4)}`;
    const payment: Payment = { ...draft, orderId };
    d.payments.push(payment);
    if (!bump) return { ok: true, payment: { ...payment }, existing: false };
    const added: Payment = { ...bump, orderId: bumpOrderId(orderId), upsellOfPaymentId: payment.id };
    d.payments.push(added);
    return { ok: true, payment: { ...payment }, existing: false, bump: { ...added } };
  });
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
/* Payment reminders                                                   */
/* ------------------------------------------------------------------ */

export const PAYMENT_REMINDER_SUBJECT = "Complete Your Enrollment - Don't miss out!";
/** A learner is reminded about the same order at most once per day. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Unpaid orders older than this are considered abandoned and no longer reminded in bulk. */
const REMINDER_WINDOW_DAYS = 7;
const REMINDER_WINDOW_MS = REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/**
 * Automatic reminders wait this long after the order was placed, so a
 * learner who is still on the checkout page is not nudged right away
 * (Frappe reminds about unpaid orders on the following day).
 */
const AUTO_REMINDER_GRACE_MS = 60 * 60 * 1000;

export type ReminderSkipReason = "not_pending" | "has_access" | "sold_out" | "recently_reminded" | "no_user";
export type ReminderCheck = { ok: true } | { ok: false; reason: ReminderSkipReason; message: string };

function reminderLink(payment: Pick<Payment, "orderId">): string {
  return `/billing/success/${payment.orderId}`;
}

/** When this order was last reminded: the recorded stamp, or the newest reminder notification for older data. */
function lastReminderTime(db: Database, payment: Payment): number | null {
  if (payment.lastReminderAt) {
    const t = new Date(payment.lastReminderAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  const link = reminderLink(payment);
  let latest: number | null = null;
  for (const n of db.notifications) {
    if (n.userId !== payment.userId || n.link !== link || n.subject !== PAYMENT_REMINDER_SUBJECT) continue;
    const t = new Date(n.createdAt).getTime();
    if (latest === null || t > latest) latest = t;
  }
  return latest;
}

/** Pure eligibility check against a database snapshot (safe to call inside `mutate`). */
function evaluateReminder(db: Database, payment: Payment, now: number): ReminderCheck {
  if (payment.status !== "pending") return { ok: false, reason: "not_pending", message: "Only unpaid orders can be reminded." };
  if (isOrderBump(payment)) return { ok: false, reason: "not_pending", message: "Add-ons are paid together with their main order, which is reminded instead." };
  const user = db.users.find((u) => u.id === payment.userId && u.enabled);
  if (!user) return { ok: false, reason: "no_user", message: "The learner account no longer exists or is disabled." };

  if (payment.itemType === "course") {
    // The later parts of a payment plan are reminded on their own schedule (due soon, overdue, paused).
    if (isInstallmentOrder(payment) && payment.installmentNumber! > 1) {
      return { ok: false, reason: "has_access", message: "Installments are reminded automatically around their due date." };
    }
    if (db.enrollments.some((e) => e.userId === payment.userId && e.courseId === payment.itemId)) {
      return { ok: false, reason: "has_access", message: "The learner is already enrolled in this course." };
    }
  } else if (payment.itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === payment.itemId);
    const included = bundle ? bundleCourses(bundle, db.courses).map((c) => c.id) : [];
    if (included.length && ownedCourseIds(db, payment.userId, included, now).length === included.length) {
      return { ok: false, reason: "has_access", message: "The learner already has every course of this bundle." };
    }
  } else if (payment.itemType === "batch") {
    if (db.batchEnrollments.some((e) => e.userId === payment.userId && e.batchId === payment.itemId)) {
      return { ok: false, reason: "has_access", message: "The learner is already enrolled in this batch." };
    }
    const batch = db.batches.find((b) => b.id === payment.itemId);
    const taken = db.batchEnrollments.filter((e) => e.batchId === payment.itemId).length;
    if (batch && batch.seatCount > 0 && taken >= batch.seatCount) return { ok: false, reason: "sold_out", message: "This batch is sold out." };
  } else if (payment.itemType === "plan") {
    const running = currentSubscription(db, payment.userId, now);
    if (running && isOngoing(running) && running.id !== payment.subscriptionId) {
      return { ok: false, reason: "has_access", message: "The member already has a running membership." };
    }
  } else if (db.enrollments.some((e) => e.userId === payment.userId && e.courseId === payment.itemId && e.purchasedCertificate)) {
    return { ok: false, reason: "has_access", message: "The learner already purchased this certificate." };
  }

  const last = lastReminderTime(db, payment);
  if (last !== null && now - last < REMINDER_COOLDOWN_MS) {
    return { ok: false, reason: "recently_reminded", message: "A reminder for this order was already sent in the last 24 hours." };
  }
  return { ok: true };
}

/**
 * Whether an unpaid order should get a reminder (Frappe: payment reminder
 * job). Skips learners who already got access another way, sold-out
 * batches and orders reminded within the last day.
 */
export async function checkReminderEligibility(payment: Payment): Promise<ReminderCheck> {
  const db = await getDb();
  return evaluateReminder(db, payment, Date.now());
}

function reminderNotification(payment: Payment, now: Date): Notification {
  return {
    id: uid("ntf"),
    userId: payment.userId,
    type: "system",
    subject: PAYMENT_REMINDER_SUBJECT,
    message: `Your order ${payment.orderId} for ${payment.itemTitle} (${formatPrice(payment.amount, payment.currency)}) is still awaiting payment. Complete it to secure your spot.`,
    link: reminderLink(payment),
    read: false,
    dedupeKey: `payment-reminder:${payment.id}:${toDateKey(now)}`,
    createdAt: now.toISOString(),
  };
}

/**
 * Remind every eligible order among `paymentIds` in one serialized write:
 * eligibility is re-checked against the live data inside `mutate`, and the
 * notification and the `lastReminderAt` stamp are written together, so two
 * concurrent runs can never remind the same order twice in a day.
 */
async function remindPayments(paymentIds: string[], now: Date): Promise<{ sent: number; skipped: number; firstError: string | null }> {
  if (!paymentIds.length) return { sent: 0, skipped: 0, firstError: null };
  const wanted = new Set(paymentIds);
  const result = await mutate((d) => {
    let sent = 0;
    let skipped = 0;
    let firstError: string | null = null;
    const reminded: Payment[] = [];
    const stamp = now.toISOString();
    for (const payment of d.payments) {
      if (!wanted.has(payment.id)) continue;
      const check = evaluateReminder(d, payment, now.getTime());
      if (!check.ok) {
        skipped++;
        firstError ??= check.message;
        continue;
      }
      d.notifications.push(reminderNotification(payment, now));
      payment.lastReminderAt = stamp;
      reminded.push({ ...payment });
      sent++;
    }
    return { sent, skipped, firstError, reminded };
  });
  // Email copy of each reminder (Settings → Email and the learner's "payments" preference decide).
  for (const payment of result.reminded) {
    try {
      await sendPaymentReminderEmail(payment.id, reminderLink(payment));
    } catch (error) {
      console.error("[email] could not queue a payment reminder:", error instanceof Error ? error.message : String(error));
    }
  }
  return { sent: result.sent, skipped: result.skipped, firstError: result.firstError };
}

/** Send the in-app payment reminder for one unpaid order (eligibility re-checked atomically). */
export async function sendPaymentReminder(payment: Payment): Promise<ReminderCheck> {
  const result = await remindPayments([payment.id], new Date());
  if (result.sent) return { ok: true };
  return { ok: false, reason: "recently_reminded", message: result.firstError ?? "This order can no longer be reminded." };
}

function remindableCandidates(db: Database, now: number, minAgeMs = 0): Payment[] {
  return db.payments.filter((p) => {
    if (p.status !== "pending") return false;
    // Scheduled parts of a payment plan are not abandoned checkouts, and order bumps go with their main order.
    if ((isInstallmentOrder(p) && p.installmentNumber! > 1) || isOrderBump(p)) return false;
    const created = new Date(p.createdAt).getTime();
    return created >= now - REMINDER_WINDOW_MS && created <= now - minAgeMs;
  });
}

/** Remind every eligible learner with an unpaid order from the last week. Returns counts. */
export async function sendPendingPaymentReminders(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const db = await getDb();
  const ids = remindableCandidates(db, now.getTime()).map((p) => p.id);
  const { sent, skipped } = await remindPayments(ids, now);
  return { sent, skipped };
}

/**
 * Daily automatic payment reminders (Frappe runs this as a scheduled job).
 * There is no scheduler here, so admin pages call it on load. It is
 * idempotent and cheap: nothing is written unless an order is due, and each
 * unpaid order is reminded at most once per day (tracked by `lastReminderAt`).
 * Orders younger than an hour are left alone. Does nothing while
 * "Send payment reminders" is off.
 */
export async function runAutomaticPaymentReminders(now: Date = new Date()): Promise<number> {
  try {
    const db = await getDb();
    if (!db.settings.commerce.sendPaymentReminders) return 0;
    const at = now.getTime();
    const due = remindableCandidates(db, at, AUTO_REMINDER_GRACE_MS).filter((p) => evaluateReminder(db, p, at).ok);
    if (!due.length) return 0;
    const { sent } = await remindPayments(
      due.map((p) => p.id),
      now,
    );
    return sent;
  } catch (error) {
    // A reminder failure must never break the admin page that triggered it.
    console.error("Automatic payment reminders failed", error);
    return 0;
  }
}

/** Number of unpaid orders from the last week (shown next to "Send reminders"). */
export async function countRemindableOrders(): Promise<number> {
  const db = await getDb();
  return remindableCandidates(db, Date.now()).length;
}

/** Unpaid orders from the last week whose reminder was sent automatically or manually today, and the latest send time. */
export async function getReminderActivity(): Promise<{ remindedToday: number; lastSentAt: string | null }> {
  const db = await getDb();
  const today = toDateKey(new Date());
  let remindedToday = 0;
  let lastSentAt: string | null = null;
  for (const p of db.payments) {
    if (!p.lastReminderAt) continue;
    if (toDateKey(new Date(p.lastReminderAt)) === today) remindedToday++;
    if (!lastSentAt || p.lastReminderAt > lastSentAt) lastSentAt = p.lastReminderAt;
  }
  return { remindedToday, lastSentAt };
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
  const bundles = new Map(db.bundles.map((b) => [b.id, b]));
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
        const hay = `${p.orderId} ${p.billingName} ${p.itemTitle} ${u?.email ?? ""} ${u?.name ?? ""} ${p.couponCode ?? ""} ${p.invoiceNumber ?? ""} ${p.gatewayPaymentId ?? ""} ${p.gatewayOrderId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const u = users.get(p.userId);
      return { ...p, userName: u?.name ?? "Deleted user", userEmail: u?.email ?? "", username: u?.username ?? null, itemHref: itemHrefFor(p, courses, batches, bundles) };
    });
}

function itemHrefFor(p: Pick<Payment, "itemType" | "itemId">, courses: Map<string, Course>, batches: Map<string, Batch>, bundles: Map<string, Bundle>): string | null {
  if (p.itemType === "plan") return "/pricing";
  if (p.itemType === "bundle") {
    const bundle = bundles.get(p.itemId);
    return bundle ? `/bundles/${bundle.slug}` : null;
  }
  if (p.itemType === "batch") {
    const b = batches.get(p.itemId);
    return b ? `/batches/${b.slug}` : null;
  }
  const c = courses.get(p.itemId);
  return c ? (p.itemType === "certificate" ? `/courses/${c.slug}/certification` : `/courses/${c.slug}`) : null;
}

/* ------------------------------------------------------------------ */
/* Learner: order history                                              */
/* ------------------------------------------------------------------ */

export interface OrderHistoryRow extends Payment {
  itemHref: string | null;
  imageUrl?: string;
  gradient?: string;
}

/** A learner's orders, newest first, with links to what they bought. */
export async function getOrderHistory(userId: string): Promise<OrderHistoryRow[]> {
  const db = await getDb();
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const bundles = new Map(db.bundles.map((b) => [b.id, b]));
  return db.payments
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const course = p.itemType === "course" || p.itemType === "certificate" ? courses.get(p.itemId) : undefined;
      const batch = p.itemType === "batch" ? batches.get(p.itemId) : undefined;
      const bundle = p.itemType === "bundle" ? bundles.get(p.itemId) : undefined;
      const bundleItem = bundle ? itemFromBundle(bundle, db.courses) : undefined;
      return {
        ...p,
        itemHref: itemHrefFor(p, courses, batches, bundles),
        imageUrl: course?.imageUrl ?? batch?.imageUrl ?? bundleItem?.imageUrl,
        gradient: course?.cardGradient ?? bundleItem?.gradient ?? (batch ? "violet" : undefined),
      };
    });
}

export interface TransactionStats {
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
  failedCount: number;
  /** Net revenue per currency (smallest unit): paid orders minus anything refunded on them, plus what was kept on partially refunded orders. */
  revenue: { currency: string; amount: number }[];
  /** Money returned to buyers per currency (smallest unit). */
  refunded: { currency: string; amount: number }[];
}

function refundedOn(p: Payment): number {
  if (p.status === "refunded") return Math.min(p.amount, p.refundedAmount ?? p.amount);
  return Math.min(p.amount, p.refundedAmount ?? 0);
}

export function summarizeTransactions(rows: Payment[]): TransactionStats {
  const revenue = new Map<string, number>();
  const refunded = new Map<string, number>();
  let paidCount = 0;
  let pendingCount = 0;
  let refundedCount = 0;
  let failedCount = 0;
  for (const p of rows) {
    if (p.status === "paid" || p.status === "refunded") {
      const back = refundedOn(p);
      revenue.set(p.currency, (revenue.get(p.currency) ?? 0) + p.amount - back);
      if (back > 0) refunded.set(p.currency, (refunded.get(p.currency) ?? 0) + back);
      if (p.status === "paid") paidCount++;
      else refundedCount++;
    } else if (p.status === "pending") pendingCount++;
    else failedCount++;
  }
  const list = (m: Map<string, number>) => Array.from(m, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
  return { paidCount, pendingCount, refundedCount, failedCount, revenue: list(revenue).filter((r) => r.amount > 0), refunded: list(refunded) };
}

/** One CSV cell: quoted when needed, spreadsheet formulas neutralised. */
export function csvCell(value: string | number | undefined | null): string {
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
    "Gateway order ID",
    "Gateway payment ID",
    "Paid at",
    "Invoice number",
    "Refunded amount",
    "Refunded at",
    "Refund ID",
    "Failure reason",
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
        paymentStatusLabel(r),
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
        r.gatewayOrderId ?? "",
        r.gatewayPaymentId ?? "",
        r.paidAt ?? "",
        r.invoiceNumber ?? "",
        refundedOn(r) > 0 ? decimal(refundedOn(r)) : "",
        r.refundedAt ?? "",
        r.refundId ?? "",
        r.failureReason ?? "",
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

/* ------------------------------------------------------------------ */
/* Admin: manually recorded transactions                               */
/* ------------------------------------------------------------------ */

export interface RecordableItem {
  type: PaymentItemType;
  id: string;
  title: string;
  /** Default price in the smallest currency unit. */
  price: number;
  currency: string;
}

/** Everything an admin can record a payment against: courses, batches, paid certificates, membership plans and bundles. */
export async function getRecordableItems(): Promise<RecordableItem[]> {
  const db = await getDb();
  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  const courses = db.courses.map((c) => ({ type: "course" as const, id: c.id, title: c.title, price: c.paidCourse ? c.price : 0, currency: c.currency || "USD" })).sort(byTitle);
  const batches = db.batches.map((b) => ({ type: "batch" as const, id: b.id, title: b.title, price: b.paidBatch ? b.amount : 0, currency: b.currency || "USD" })).sort(byTitle);
  const certificates = db.courses
    .filter((c) => c.paidCertificate)
    .map((c) => ({ type: "certificate" as const, id: c.id, title: `Certificate for ${c.title}`, price: c.certificatePrice, currency: c.currency || "USD" }))
    .sort(byTitle);
  const plans = db.plans
    .map((p) => ({ type: "plan" as const, id: p.id, title: `${p.name}${p.active ? "" : " (retired)"}`, price: p.price, currency: p.currency || "USD" }))
    .sort(byTitle);
  const bundles = db.bundles
    .map((b) => ({ type: "bundle" as const, id: b.id, title: `${b.title}${b.published ? "" : " (unpublished)"}`, price: b.price, currency: b.currency || "USD" }))
    .sort(byTitle);
  return [...courses, ...batches, ...certificates, ...plans, ...bundles];
}
