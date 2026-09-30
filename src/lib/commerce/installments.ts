import type { Course, CourseInstallmentPlan, Payment } from "@/lib/types";
import { currencyExponent } from "@/lib/payments/amounts";

/**
 * Paying a course in installments (pure, client-safe).
 *
 * Every part of a payment plan is its own order (`Payment`): part 1 is the
 * checkout order, parts 2..N are created when part 1 is paid. All parts of a
 * plan share the buyer, the course and `installmentsTotal`, and their order
 * ids are derived from the first one (`ORD-AB12-CD34`, `ORD-AB12-CD34-2`, …),
 * which is how a plan is put back together from its rows.
 *
 * A scheduled part is a pending order whose `createdAt` is the date it falls
 * due; its amounts are copied from part 1, so every part charges the same.
 *
 * Access follows the plan: it starts with the first payment, continues while
 * the plan is on track or a part is overdue by at most `INSTALLMENT_GRACE_DAYS`
 * days, pauses after that, and is permanent once every part is paid.
 */

const DAY_MS = 86_400_000;

/** Days a part may stay unpaid after its due date before access is paused. */
export const INSTALLMENT_GRACE_DAYS = 7;
/** Days before the due date at which a learner paying by hand is reminded. */
export const INSTALLMENT_REMINDER_DAYS = 3;
/** Overdue days after which the "access is about to pause" warning is sent. */
export const INSTALLMENT_LAST_WARNING_DAYS = 4;

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 24;
export const MAX_INSTALLMENT_INTERVAL_DAYS = 365;
export const MAX_INSTALLMENT_SURCHARGE = 100;
export const DEFAULT_INSTALLMENT_INTERVAL_DAYS = 30;

/** `failureReason` prefix of parts closed because their plan was cancelled (not a declined payment). */
export const PLAN_CANCELLED_REASON = "Payment plan cancelled";

/* ------------------------------------------------------------------ */
/* Terms and amounts                                                   */
/* ------------------------------------------------------------------ */

export function isValidInstallmentPlan(plan: Partial<CourseInstallmentPlan> | null | undefined): plan is CourseInstallmentPlan {
  if (!plan) return false;
  const { count, intervalDays, surchargePercent } = plan;
  return (
    Number.isInteger(count) &&
    count! >= MIN_INSTALLMENTS &&
    count! <= MAX_INSTALLMENTS &&
    Number.isInteger(intervalDays) &&
    intervalDays! >= 1 &&
    intervalDays! <= MAX_INSTALLMENT_INTERVAL_DAYS &&
    typeof surchargePercent === "number" &&
    Number.isFinite(surchargePercent) &&
    surchargePercent >= 0 &&
    surchargePercent <= MAX_INSTALLMENT_SURCHARGE
  );
}

/**
 * The installment plan a course is sold with right now, or null. Needs the
 * platform switch, a paid course and a gateway that collects money (with no
 * gateway every order is free, so there is nothing to split).
 */
export function offeredInstallmentPlan(
  course: Pick<Course, "paidCourse" | "price" | "installments">,
  opts: { enabled: boolean; gateway: string },
): CourseInstallmentPlan | null {
  if (!opts.enabled || opts.gateway === "none") return null;
  if (!course.paidCourse || course.price <= 0) return null;
  return isValidInstallmentPlan(course.installments) ? course.installments : null;
}

/** Smallest amount step a gateway can charge, in app units (price × 100): whole units for zero-decimal currencies. */
function chargeUnit(currency: string): number {
  return currencyExponent(currency) === 0 ? 100 : 1;
}

export function ceilToChargeUnit(amount: number, currency: string): number {
  const unit = chargeUnit(currency);
  return Math.ceil(Math.max(0, amount) / unit) * unit;
}

/** Price of the course when paid in parts: the list price plus the plan's surcharge. */
export function installmentPlanPrice(price: number, plan: Pick<CourseInstallmentPlan, "surchargePercent">): number {
  return Math.round((Math.max(0, price) * (100 + Math.max(0, plan.surchargePercent))) / 100);
}

export interface OrderAmounts {
  originalAmount: number;
  discountAmount: number;
  taxAmount: number;
  /** What the buyer pays. */
  amount: number;
}

/**
 * One part of an order split into `count` equal payments. The part is rounded
 * up to the currency's smallest chargeable unit, so N parts never collect less
 * than the full order (at most N − 1 units more). Discount and tax are shared
 * out proportionally and the part keeps the full order's relation between its
 * amounts (tax added on top, or already included in the price).
 */
export function splitOrder(full: OrderAmounts, count: number, currency: string): OrderAmounts {
  const parts = Math.max(1, Math.floor(count));
  if (full.amount <= 0) return { originalAmount: 0, discountAmount: 0, taxAmount: 0, amount: 0 };
  const amount = ceilToChargeUnit(Math.ceil(full.amount / parts), currency);
  const discountAmount = Math.floor(Math.max(0, full.discountAmount) / parts);
  const taxAmount = Math.min(amount, Math.round(Math.max(0, full.taxAmount) / parts));
  const taxOnTop = full.amount > full.originalAmount - full.discountAmount;
  return { originalAmount: amount + discountAmount - (taxOnTop ? taxAmount : 0), discountAmount, taxAmount, amount };
}

export interface InstallmentOffer {
  count: number;
  intervalDays: number;
  surchargePercent: number;
  /** One payment at the list price (before coupons and tax). */
  partAmount: number;
  /** All payments together. */
  total: number;
  /** What paying in parts costs on top of the list price. */
  extra: number;
}

/** "or N payments of X" for a course at its list price. */
export function installmentOffer(price: number, currency: string, plan: CourseInstallmentPlan): InstallmentOffer {
  const partAmount = ceilToChargeUnit(Math.ceil(installmentPlanPrice(price, plan) / plan.count), currency);
  const total = partAmount * plan.count;
  return { count: plan.count, intervalDays: plan.intervalDays, surchargePercent: plan.surchargePercent, partAmount, total, extra: Math.max(0, total - price) };
}

/** "every week", "every 2 weeks", "every 30 days". */
export function intervalPhrase(days: number): string {
  if (days === 1) return "every day";
  if (days % 7 === 0) return days === 7 ? "every week" : `every ${days / 7} weeks`;
  return `every ${days} days`;
}

/** Due dates of parts 1..count when the first part is paid at `startIso`. */
export function scheduleDates(startIso: string, count: number, intervalDays: number): string[] {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) throw new RangeError("Invalid start date");
  return Array.from({ length: Math.max(0, count) }, (_, i) => new Date(start + i * intervalDays * DAY_MS).toISOString());
}

export function installmentItemTitle(courseTitle: string, number: number, total: number): string {
  return `${courseTitle} · payment ${number} of ${total}`;
}

/* ------------------------------------------------------------------ */
/* Plans rebuilt from their orders                                     */
/* ------------------------------------------------------------------ */

type PartRef = Pick<Payment, "itemType" | "installmentNumber" | "installmentsTotal">;

/** An order that is one part of a course payment plan. */
export function isInstallmentOrder(p: PartRef): boolean {
  return p.itemType === "course" && (p.installmentsTotal ?? 0) >= MIN_INSTALLMENTS && (p.installmentNumber ?? 0) >= 1;
}

/** Order id of the first part of the plan `p` belongs to (the plan's key). */
export function planKeyOf(p: Pick<Payment, "orderId" | "installmentNumber">): string {
  const n = p.installmentNumber ?? 1;
  const suffix = `-${n}`;
  return n > 1 && p.orderId.endsWith(suffix) ? p.orderId.slice(0, -suffix.length) : p.orderId;
}

export function partOrderId(planKey: string, number: number): string {
  return number <= 1 ? planKey : `${planKey}-${number}`;
}

/** A part closed with its plan (as opposed to a payment attempt that failed and can be retried). */
export function isCancelledPart(p: Pick<Payment, "status" | "failureReason">): boolean {
  return p.status === "failed" && (p.failureReason ?? "").startsWith(PLAN_CANCELLED_REASON);
}

/** A part that is still owed: awaiting payment, or its last payment attempt failed. */
export function isOwedPart(p: Pick<Payment, "status" | "failureReason">): boolean {
  return p.status === "pending" || (p.status === "failed" && !isCancelledPart(p));
}

/**
 * The Stripe subscription that charges a part automatically. The id stays on
 * the part's order until a Stripe invoice pays it (the invoice id replaces it)
 * or the subscription is released.
 */
export function autoChargeSubscriptionId(p: Pick<Payment, "gatewayOrderId"> | null | undefined): string | null {
  return p && /^sub_[A-Za-z0-9]{8,200}$/.test(p.gatewayOrderId ?? "") ? p.gatewayOrderId! : null;
}

export type InstallmentPartStatus = "paid" | "waived" | "scheduled" | "overdue" | "refunded" | "cancelled";

export interface InstallmentPart {
  number: number;
  orderId: string;
  /** Null when the order of this part does not exist (not scheduled yet, or deleted). */
  payment: Payment | null;
  amount: number;
  /** When the part falls due (part 1: when the order was placed). */
  dueAt: string | null;
  paidAt?: string;
  status: InstallmentPartStatus;
}

export type InstallmentPlanStatus = "awaiting_first" | "on_track" | "overdue" | "paused" | "completed" | "cancelled";

export const INSTALLMENT_PLAN_STATUS_LABELS: Record<InstallmentPlanStatus, string> = {
  awaiting_first: "Awaiting first payment",
  on_track: "On track",
  overdue: "Payment overdue",
  paused: "Access paused",
  completed: "Paid in full",
  cancelled: "Cancelled",
};

export interface InstallmentPlan {
  /** Order id of part 1. */
  key: string;
  anchor: Payment;
  userId: string;
  courseId: string;
  currency: string;
  /** Number of parts. */
  total: number;
  parts: InstallmentPart[];
  paidCount: number;
  paidAmount: number;
  /** Sum of the parts still owed. */
  outstandingAmount: number;
  /** The first part that is still owed. */
  next: InstallmentPart | null;
  /** Whole days the next part is past its due date (0 when it is not due yet). */
  overdueDays: number;
  /** When access pauses (or paused) while the next part stays unpaid. */
  pausesAt: string | null;
  status: InstallmentPlanStatus;
  /** Stripe charges the remaining parts by itself. */
  autoCharge: boolean;
  gatewaySubscriptionId: string | null;
  /** Days between two parts, read from the schedule (null before it exists). */
  intervalDays: number | null;
}

/**
 * `scheduled`: the orders of the later parts exist. Before that (the instant
 * between the first payment and the schedule being written) a missing part is
 * simply not due yet; afterwards a missing part means its order was removed.
 */
function partStatus(row: Payment | null, number: number, now: number, scheduled: boolean): InstallmentPartStatus {
  if (!row) return scheduled ? "cancelled" : "scheduled";
  if (row.status === "paid") return number > 1 && row.amount === 0 ? "waived" : "paid";
  if (row.status === "refunded") return "refunded";
  if (isCancelledPart(row)) return "cancelled";
  return now >= Date.parse(row.createdAt) ? "overdue" : "scheduled";
}

/** Put a plan together from its first part and every order of the same buyer and course. */
export function buildInstallmentPlan(anchor: Payment, payments: readonly Payment[], now: number = Date.now()): InstallmentPlan {
  const total = anchor.installmentsTotal ?? MIN_INSTALLMENTS;
  const key = anchor.orderId;
  const rows = new Map<number, Payment>();
  for (const p of payments) {
    if (p.userId !== anchor.userId || p.itemId !== anchor.itemId || !isInstallmentOrder(p)) continue;
    if (planKeyOf(p) === key && partOrderId(key, p.installmentNumber!) === p.orderId) rows.set(p.installmentNumber!, p);
  }
  rows.set(1, anchor);
  const scheduled = rows.size > 1;

  const parts: InstallmentPart[] = [];
  for (let n = 1; n <= total; n++) {
    const row = rows.get(n) ?? null;
    parts.push({
      number: n,
      orderId: partOrderId(key, n),
      payment: row,
      amount: row?.amount ?? anchor.amount,
      dueAt: row?.createdAt ?? null,
      paidAt: row?.paidAt,
      status: partStatus(row, n, now, scheduled),
    });
  }

  const settled = parts.filter((p) => p.status === "paid" || p.status === "waived");
  const owed = parts.filter((p) => p.status === "scheduled" || p.status === "overdue");
  const next = owed[0] ?? null;
  const dueMs = next?.dueAt ? Date.parse(next.dueAt) : NaN;
  const lateMs = Number.isFinite(dueMs) ? now - dueMs : -1;

  let status: InstallmentPlanStatus;
  if (anchor.status === "pending") status = "awaiting_first";
  else if (anchor.status !== "paid" || parts.some((p) => p.status === "refunded" || p.status === "cancelled")) status = "cancelled";
  else if (!next) status = "completed";
  else if (lateMs < 0) status = "on_track";
  else status = lateMs > INSTALLMENT_GRACE_DAYS * DAY_MS ? "paused" : "overdue";

  const second = rows.get(2);
  const from = anchor.paidAt ? Date.parse(anchor.paidAt) : NaN;
  const gap = second && Number.isFinite(from) ? Math.round((Date.parse(second.createdAt) - from) / DAY_MS) : NaN;
  const subscriptionId = autoChargeSubscriptionId(next?.payment);
  const live = status === "on_track" || status === "overdue" || status === "paused";

  return {
    key,
    anchor,
    userId: anchor.userId,
    courseId: anchor.itemId,
    currency: anchor.currency,
    total,
    parts,
    paidCount: settled.length,
    paidAmount: settled.reduce((sum, p) => sum + p.amount, 0),
    outstandingAmount: status === "cancelled" ? 0 : owed.reduce((sum, p) => sum + p.amount, 0),
    next: live ? next : null,
    overdueDays: live && lateMs > 0 ? Math.floor(lateMs / DAY_MS) : 0,
    pausesAt: live && Number.isFinite(dueMs) ? new Date(dueMs + INSTALLMENT_GRACE_DAYS * DAY_MS).toISOString() : null,
    status,
    autoCharge: live && !!subscriptionId,
    gatewaySubscriptionId: live ? subscriptionId : null,
    intervalDays: Number.isFinite(gap) && gap > 0 ? gap : null,
  };
}

/** Every payment plan in `payments`, newest first. */
export function installmentPlans(payments: readonly Payment[], now: number = Date.now()): InstallmentPlan[] {
  const byBuyerAndCourse = new Map<string, Payment[]>();
  const anchors: Payment[] = [];
  for (const p of payments) {
    if (!isInstallmentOrder(p)) continue;
    const group = `${p.userId}\u0000${p.itemId}`;
    const list = byBuyerAndCourse.get(group);
    if (list) list.push(p);
    else byBuyerAndCourse.set(group, [p]);
    if (p.installmentNumber === 1) anchors.push(p);
  }
  return anchors
    .map((anchor) => buildInstallmentPlan(anchor, byBuyerAndCourse.get(`${anchor.userId}\u0000${anchor.itemId}`) ?? [anchor], now))
    .sort((a, b) => b.anchor.createdAt.localeCompare(a.anchor.createdAt));
}

/** The plan an order is part of, or null when it is not an installment (or its first part is gone). */
export function planOfPayment(payments: readonly Payment[], payment: Payment, now: number = Date.now()): InstallmentPlan | null {
  if (!isInstallmentOrder(payment)) return null;
  const key = planKeyOf(payment);
  const anchor = payment.installmentNumber === 1 ? payment : payments.find((p) => p.orderId === key && p.userId === payment.userId && p.itemId === payment.itemId && isInstallmentOrder(p));
  return anchor ? buildInstallmentPlan(anchor, payments, now) : null;
}

/**
 * The plan that decides a buyer's access to a course: the newest one that was
 * started and not cancelled, else the newest cancelled one (so the course page
 * can explain why the lessons are locked), else null.
 */
export function planForCourse(payments: readonly Payment[], userId: string, courseId: string, now: number = Date.now()): InstallmentPlan | null {
  const mine = payments.filter((p) => p.userId === userId && p.itemId === courseId && isInstallmentOrder(p));
  if (!mine.length) return null;
  const plans = installmentPlans(mine, now).filter((p) => p.status !== "awaiting_first" && !!p.anchor.paidAt);
  return plans.find((p) => p.status !== "cancelled") ?? plans[0] ?? null;
}

/** Whether the orders of parts 2..N of a plan have been written (false right after the first payment, until they are). */
export function isScheduled(plan: Pick<InstallmentPlan, "parts">): boolean {
  return plan.parts.some((p) => p.number > 1 && !!p.payment);
}

/** Whether the plan unlocks the course's lessons. */
export function planGrantsAccess(plan: Pick<InstallmentPlan, "status">): boolean {
  return plan.status === "on_track" || plan.status === "overdue" || plan.status === "completed";
}

export type InstallmentReminder = "upcoming" | "due" | "last_warning" | "paused";

/**
 * The reminder the next part of a plan calls for at the moment (each kind is
 * sent once per part). Parts charged automatically by Stripe are not announced
 * ahead, and get a day for the charge to go through before "due" is sent.
 */
export function reminderDue(plan: Pick<InstallmentPlan, "status" | "next" | "overdueDays" | "autoCharge">, now: number = Date.now()): InstallmentReminder | null {
  if (!plan.next?.dueAt) return null;
  if (plan.status === "paused") return "paused";
  if (plan.status === "overdue") {
    if (plan.overdueDays >= INSTALLMENT_LAST_WARNING_DAYS) return "last_warning";
    return plan.autoCharge && plan.overdueDays < 1 ? null : "due";
  }
  if (plan.status === "on_track" && !plan.autoCharge) {
    return Date.parse(plan.next.dueAt) - now <= INSTALLMENT_REMINDER_DAYS * DAY_MS ? "upcoming" : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Admin form                                                          */
/* ------------------------------------------------------------------ */

export interface InstallmentFormInput {
  count: string;
  intervalDays: string;
  surchargePercent: string;
}

/** Validate the "pay in parts" settings of a course. */
export function validateInstallmentInput(input: InstallmentFormInput): { ok: true; plan: CourseInstallmentPlan } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const count = /^\d{1,2}$/.test(input.count.trim()) ? Number(input.count) : NaN;
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) errors.count = `Enter ${MIN_INSTALLMENTS} to ${MAX_INSTALLMENTS} payments.`;
  const intervalDays = /^\d{1,3}$/.test(input.intervalDays.trim()) ? Number(input.intervalDays) : NaN;
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > MAX_INSTALLMENT_INTERVAL_DAYS) errors.intervalDays = `Enter 1 to ${MAX_INSTALLMENT_INTERVAL_DAYS} days.`;
  const rawSurcharge = input.surchargePercent.trim() || "0";
  const surchargePercent = /^\d{1,3}(\.\d{1,2})?$/.test(rawSurcharge) ? Number(rawSurcharge) : NaN;
  if (!Number.isFinite(surchargePercent) || surchargePercent < 0 || surchargePercent > MAX_INSTALLMENT_SURCHARGE) errors.surchargePercent = `Enter 0 to ${MAX_INSTALLMENT_SURCHARGE} percent.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, plan: { count, intervalDays, surchargePercent } };
}
