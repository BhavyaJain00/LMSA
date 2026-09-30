import "server-only";
import type { CourseInstallmentPlan, Payment, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/services/notifications";
import { formatPrice } from "@/lib/utils";
import { fulfillPayment, restoreOrderAccess } from "@/lib/payments/fulfillment";
import { closeGatewayCheckout, gatewayErrorMessage, isConfigured, isRealGateway, resumeCheckout } from "@/lib/payments/gateway";
import type { CheckoutNext } from "@/lib/payments/types";
import { sendInstallmentMessage } from "./installment-emails";
import { cancelStripeInstallmentSubscription, syncStripeInstallmentSubscription } from "./installment-gateway";
import { cancelScheduleIn, preparePartForPayment, zeroOwedParts } from "./installment-store";
import {
  autoChargeSubscriptionId,
  installmentPlans,
  isInstallmentOrder,
  isOwedPart,
  isScheduled,
  planOfPayment,
  reminderDue,
  type InstallmentPlan,
} from "./installments";

/**
 * What learners and administrators do with payment plans: pay a part (the
 * "Pay installment" link), keep plans current (reminders, the pause notice,
 * catching up on missed Stripe webhooks), and the administrator actions —
 * cancel a plan, waive what is left, send a reminder, and set which courses
 * can be paid in parts.
 */

export type ServiceResult = { ok: true; message: string } | { ok: false; error: string };

const HOUR_MS = 3_600_000;
/** Stripe charges a part about an hour after its date: auto-charged parts are read back only after this. */
const STRIPE_SYNC_AFTER_MS = 2 * HOUR_MS;
const MAX_SYNCS_PER_RUN = 10;
/** Lazy runs (page loads) happen at most this often; the cron endpoint forces a run. */
const LAZY_INTERVAL_MS = 5 * 60 * 1000;

const runState = globalThis as unknown as { __llInstallmentMaintenance?: { lastRunAt: number } };
const maintenance = (runState.__llInstallmentMaintenance ??= { lastRunAt: 0 });

async function adminIds(): Promise<string[]> {
  const db = await getDb();
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

function reminderKey(part: Pick<Payment, "id">, kind: string): string {
  return `installment:${part.id}:${kind}`;
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

export interface InstallmentMaintenanceResult {
  skipped: boolean;
  /** Reminder and pause notices sent to learners. */
  reminders: number;
  /** Plans whose access was paused by this run. */
  paused: number;
  /** Stripe plans read back because a charge seemed to be missing. */
  synced: number;
  /** First payments whose schedule was written late (an earlier attempt failed). */
  scheduled: number;
}

/**
 * Keep payment plans current: remind learners before and after a part falls
 * due, announce a pause (learner and administrators), read Stripe plans back
 * when a charge seems to be missing, and write the schedule of a first
 * payment whose fulfilment was interrupted. Idempotent (each notice is sent
 * once per part). Runs lazily from the commerce pages and from
 * `/api/cron/commerce`; `userId` limits a run to one learner.
 */
export async function runInstallmentMaintenance(opts: { now?: Date; force?: boolean; userId?: string } = {}): Promise<InstallmentMaintenanceResult> {
  const now = (opts.now ?? new Date()).getTime();
  const result: InstallmentMaintenanceResult = { skipped: false, reminders: 0, paused: 0, synced: 0, scheduled: 0 };
  if (!opts.force && !opts.userId) {
    if (now - maintenance.lastRunAt < LAZY_INTERVAL_MS) return { ...result, skipped: true };
    maintenance.lastRunAt = now;
  }

  const db = await getDb();
  const gateway = db.settings.commerce.paymentGateway;
  const rows = opts.userId ? db.payments.filter((p) => p.userId === opts.userId) : db.payments;
  const plans = installmentPlans(rows, now);

  for (const plan of plans.filter((p) => p.anchor.status === "paid" && p.status !== "cancelled" && p.status !== "completed" && !isScheduled(p))) {
    if (await restoreOrderAccess(plan.anchor.id)) result.scheduled++;
  }

  let syncs = 0;
  for (const plan of plans) {
    const part = plan.next?.payment;
    if (!part || !plan.next?.dueAt) continue;
    if (plan.autoCharge && plan.gatewaySubscriptionId && syncs < MAX_SYNCS_PER_RUN && now - Date.parse(plan.next.dueAt) > STRIPE_SYNC_AFTER_MS && isConfigured("stripe")) {
      syncs++;
      try {
        await syncStripeInstallmentSubscription(plan.gatewaySubscriptionId, gateway);
        result.synced++;
        const fresh = await getDb();
        if (fresh.payments.find((p) => p.id === part.id)?.status === "paid") continue;
      } catch (error) {
        console.warn(`[installments] could not refresh plan ${plan.key}: ${gatewayErrorMessage(error)}`);
      }
    }
    const kind = reminderDue(plan, now);
    if (!kind) continue;
    const sent = await sendInstallmentMessage(part.id, kind, { dedupeKey: reminderKey(part, kind) });
    if (!sent) continue;
    result.reminders++;
    if (kind === "paused") {
      result.paused++;
      await notifyMany(await adminIds(), {
        type: "system",
        subject: `Access paused: ${part.itemTitle}`,
        message: `${part.billingName} is ${plan.overdueDays} days late with ${formatPrice(part.amount, part.currency)} (order ${part.orderId}), so the course is locked until it is paid.`,
        link: `/admin/settings/plans?tab=installments&status=paused`,
        dedupeKey: `installment-paused:${part.id}`,
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Learner: pay a part                                                 */
/* ------------------------------------------------------------------ */

export type PayResult = { ok: true; next: CheckoutNext; message?: string } | { ok: false; error: string };

/**
 * "Pay installment" for a part of the learner's own plan: an automatic Stripe
 * charge that failed is paid on Stripe's invoice page; otherwise the part is
 * paid through the platform's gateway like any order (a failed attempt is
 * reopened, and a part scheduled before the gateway changed moves to the
 * current one). With manual payment the order page shows the instructions.
 */
export async function payInstallment(user: Pick<User, "id">, orderId: string): Promise<PayResult> {
  const db = await getDb();
  const row = db.payments.find((p) => p.orderId === orderId);
  if (!row || row.userId !== user.id || !isInstallmentOrder(row)) return { ok: false, error: "Order not found." };
  const orderPage = `/billing/success/${encodeURIComponent(row.orderId)}`;
  if (row.status === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "This payment is already done." };
  const plan = planOfPayment(db.payments, row);
  if (!plan || plan.status === "cancelled" || !isOwedPart(row)) return { ok: false, error: "This payment plan was cancelled, so nothing is due. Contact us if you'd like to continue." };
  if (plan.status === "awaiting_first" && row.installmentNumber !== 1) return { ok: false, error: "Pay the first installment before the next ones." };

  let part: Payment = { ...row };
  const gateway = db.settings.commerce.paymentGateway;
  if (!autoChargeSubscriptionId(part)) {
    // A checkout still open on a gateway that is no longer active is closed before the part moves.
    if (part.status === "pending" && part.gateway !== gateway && isRealGateway(part.gateway) && part.gatewayOrderId) {
      const closed = await closeGatewayCheckout(part);
      if (closed.paid) return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment went through." };
      if (!closed.reached) return { ok: false, error: "The payment provider could not be reached. Please try again in a moment." };
      await mutate((d) => {
        const r = d.payments.find((p) => p.id === part.id);
        if (r && r.status === "pending") {
          r.gatewayOrderId = undefined;
          r.checkoutUrl = undefined;
        }
      });
    }
    part = (await preparePartForPayment(part.id, gateway === "none" ? "manual" : gateway)) ?? part;
  }
  if (part.status !== "pending") return { ok: false, error: "This payment can no longer be made." };
  if (!isRealGateway(part.gateway)) return { ok: true, next: { kind: "redirect", url: orderPage } };
  return resumeCheckout(part);
}

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */

async function planByKey(key: string): Promise<InstallmentPlan | null> {
  const db = await getDb();
  const anchor = db.payments.find((p) => p.orderId === key && isInstallmentOrder(p) && p.installmentNumber === 1);
  return anchor ? planOfPayment(db.payments, anchor) : null;
}

/** Stop the Stripe subscription that would charge the rest of a plan; false when Stripe could not be reached. */
async function stopAutoCharge(plan: InstallmentPlan): Promise<boolean> {
  const ids = new Set(plan.parts.map((p) => (p.payment && isOwedPart(p.payment) ? autoChargeSubscriptionId(p.payment) : null)).filter((id): id is string => !!id));
  for (const id of ids) if (!(await cancelStripeInstallmentSubscription(id))) return false;
  return true;
}

function planIsOpen(plan: InstallmentPlan): boolean {
  return plan.status === "on_track" || plan.status === "overdue" || plan.status === "paused";
}

/**
 * Cancel a plan: nothing more is collected (a Stripe subscription is stopped)
 * and the remaining parts are closed. The learner keeps the enrollment and
 * its progress, but the lessons lock until they buy the course.
 */
export async function cancelInstallmentPlan(key: string, actor: Pick<User, "id">): Promise<ServiceResult> {
  const plan = await planByKey(key);
  if (!plan) return { ok: false, error: "Payment plan not found." };
  if (!planIsOpen(plan)) return { ok: false, error: "Only running payment plans can be cancelled." };
  if (!(await stopAutoCharge(plan))) return { ok: false, error: "Stripe could not be reached to stop the automatic payments. Try again in a moment." };
  const closed = await mutate((d) => cancelScheduleIn(d, plan.anchor, "cancelled by an administrator."));
  await sendInstallmentMessage(plan.anchor.id, "cancelled", { dedupeKey: `installment:${plan.anchor.id}:cancelled` });
  await audit(actor, "installments.cancel", { type: "payment", id: plan.anchor.id }, { orderId: plan.key, closedParts: closed.length });
  return { ok: true, message: `The plan of order ${plan.key} was cancelled; ${closed.length} payment${closed.length === 1 ? "" : "s"} will not be collected.` };
}

/**
 * Waive what a plan still owes: the remaining parts are settled as free
 * orders (no invoice), so the course is the learner's for good.
 */
export async function waiveInstallments(key: string, actor: Pick<User, "id">): Promise<ServiceResult> {
  const plan = await planByKey(key);
  if (!plan) return { ok: false, error: "Payment plan not found." };
  if (!planIsOpen(plan)) return { ok: false, error: "Only running payment plans can be waived." };
  if (!(await stopAutoCharge(plan))) return { ok: false, error: "Stripe could not be reached to stop the automatic payments. Try again in a moment." };
  // Close open gateway checkouts first so a waived part cannot be paid as well.
  for (const part of plan.parts) {
    const row = part.payment;
    if (!row || row.status !== "pending" || !isRealGateway(row.gateway) || !row.gatewayOrderId || autoChargeSubscriptionId(row)) continue;
    const closed = await closeGatewayCheckout(row);
    if (!closed.reached) return { ok: false, error: "The payment provider could not be reached to close an open checkout. Try again in a moment." };
  }
  const ids = await zeroOwedParts(plan.anchor);
  for (const id of ids) await fulfillPayment(id, undefined, { source: "admin" });
  await sendInstallmentMessage(plan.anchor.id, "waived", { dedupeKey: `installment:${plan.anchor.id}:waived` });
  await audit(actor, "installments.waive", { type: "payment", id: plan.anchor.id }, { orderId: plan.key, waivedParts: ids.length, amount: plan.outstandingAmount, currency: plan.currency });
  return { ok: true, message: `${ids.length} remaining payment${ids.length === 1 ? " was" : "s were"} waived. The learner keeps the course.` };
}

/** Remind the learner of the part that is due next (right now, whatever reminders went out already). */
export async function remindInstallment(key: string, actor: Pick<User, "id">): Promise<ServiceResult> {
  const plan = await planByKey(key);
  const part = plan?.next?.payment;
  if (!plan || !part || !planIsOpen(plan)) return { ok: false, error: "Nothing is due on this plan." };
  const kind = plan.status === "paused" ? "paused" : plan.status === "overdue" ? "due" : "upcoming";
  const sent = await sendInstallmentMessage(part.id, kind, { dedupeKey: `${reminderKey(part, "manual")}:${new Date().toISOString().slice(0, 10)}` });
  if (!sent) return { ok: false, error: "A reminder for this payment was already sent today." };
  await audit(actor, "installments.remind", { type: "payment", id: part.id }, { orderId: part.orderId });
  return { ok: true, message: `Reminder sent to ${part.billingName}.` };
}

/** Offer a course in installments (`plan`), or stop offering it (null). Running plans are not affected. */
export async function setCourseInstallments(courseId: string, plan: CourseInstallmentPlan | null, actor: Pick<User, "id">): Promise<ServiceResult> {
  const found = await mutate((d) => {
    const course = d.courses.find((c) => c.id === courseId);
    if (!course) return null;
    course.installments = plan ?? undefined;
    course.updatedAt = new Date().toISOString();
    return { title: course.title, paid: course.paidCourse && course.price > 0 };
  });
  if (!found) return { ok: false, error: "Course not found." };
  await audit(actor, plan ? "installments.offer" : "installments.withdraw", { type: "course", id: courseId }, plan ? { count: plan.count, intervalDays: plan.intervalDays, surchargePercent: plan.surchargePercent } : undefined);
  if (!plan) return { ok: true, message: `${found.title} is no longer sold in installments. Running plans continue.` };
  return { ok: true, message: found.paid ? `${found.title} can now be paid in ${plan.count} installments.` : `Saved. ${found.title} is free, so installments show once it has a price.` };
}
