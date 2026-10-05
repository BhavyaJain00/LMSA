import "server-only";
import type { Course, MembershipPlan, Payment, Subscription, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { formatDate, uid } from "@/lib/utils";
import { enrollUserInCourse } from "@/lib/services/enrollment";
import { assertPrerequisitesMet } from "@/lib/services/drip";
import { toGatewayAmount } from "@/lib/payments/amounts";
import { fulfillPayment, markPaymentFailed } from "@/lib/payments/fulfillment";
import { closeGatewayCheckout, gatewayErrorMessage, isConfigured } from "@/lib/payments/gateway";
import {
  cancelStripeSubscriptionNow,
  changeStripeSubscriptionPrice,
  retrieveStripeSubscription,
  setStripeCancelAtPeriodEnd,
} from "@/lib/payments/stripe";
import { cancelRazorpaySubscription, changeRazorpaySubscriptionPlan } from "@/lib/payments/razorpay";
import { computeOrderSummary, insertPendingOrder, itemFromPlan, orderTaxFields } from "@/lib/data/commerce";
import { membershipOrderFor, resolveCourseAccess } from "./access";
import { sendMembershipMessage } from "./emails";
import { patchSubscription } from "./membership-store";
import {
  applyStripeSubscription,
  ensureRazorpayPlan,
  ensureStripePrice,
  syncRazorpaySubscription,
  syncStripeSubscription,
} from "./memberships";
import { addDaysIso, isRecurringInterval } from "./plans";
import { advanceSubscription, isGatewayManaged, isOngoing, renewalDue } from "./subscriptions";

/**
 * What members and administrators can do with a membership: cancel at the
 * period end, resume, change plan, cancel immediately, extend, grant — plus
 * renewal orders and the periodic maintenance of memberships managed here
 * (manual payment, free, lifetime). Stripe and Razorpay memberships are
 * changed through the gateway first and the local row follows its answer.
 */

export type ServiceResult = { ok: true; message: string } | { ok: false; error: string };

/** Days before a trial ends that the member is reminded. */
export const TRIAL_REMINDER_DAYS = 3;
/** Gateway memberships whose period ended this long ago without news are read back from the gateway. */
const STALE_SYNC_MS = 60 * 60 * 1000;
/** At most this many gateway reads per maintenance run. */
const MAX_SYNCS_PER_RUN = 10;

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: gatewayErrorMessage(error) };
}

/** Close the unpaid renewal orders of a membership (it ended, was cancelled or changed plan). */
async function closeRenewalOrders(subscriptionId: string, reason: string): Promise<void> {
  const db = await getDb();
  const open = db.payments.filter((p) => p.subscriptionId === subscriptionId && p.itemType === "plan" && p.status === "pending" && p.source === "Renewal");
  for (const order of open) await markPaymentFailed(order.id, reason);
}

async function planOf(sub: Pick<Subscription, "planId">): Promise<MembershipPlan | null> {
  const db = await getDb();
  return db.plans.find((p) => p.id === sub.planId) ?? null;
}

/* ------------------------------------------------------------------ */
/* Member self-service                                                 */
/* ------------------------------------------------------------------ */

/** Stop renewing: access continues until the current period ends. */
export async function cancelAtPeriodEnd(sub: Subscription): Promise<ServiceResult> {
  if (!isOngoing(sub)) return { ok: false, error: "This membership has already ended." };
  if (sub.cancelAtPeriodEnd) return { ok: false, error: "This membership is already set to end." };
  const plan = await planOf(sub);
  if (plan && !isRecurringInterval(plan.interval)) return { ok: false, error: "Lifetime memberships never renew, so there is nothing to cancel." };
  try {
    if (isGatewayManaged(sub) && sub.gateway === "stripe") {
      await applyStripeSubscription(await setStripeCancelAtPeriodEnd(sub.gatewaySubscriptionId!, true));
    } else if (isGatewayManaged(sub) && sub.gateway === "razorpay") {
      await cancelRazorpaySubscription(sub.gatewaySubscriptionId!, true);
    }
  } catch (error) {
    return fail(error);
  }
  // Razorpay does not report a scheduled cancellation, and manual memberships only have this flag.
  const res = await patchSubscription(sub.id, (row) => {
    if (row.cancelAtPeriodEnd) return false;
    row.cancelAtPeriodEnd = true;
    return true;
  });
  if (!isGatewayManaged(sub)) await closeRenewalOrders(sub.id, "The membership was cancelled.");
  const end = res?.subscription.currentPeriodEnd ?? sub.currentPeriodEnd;
  await sendMembershipMessage(sub.id, "cancel_scheduled");
  return { ok: true, message: `Your membership will end on ${formatDate(end)}. You keep full access until then.` };
}

/** Undo a scheduled cancellation. */
export async function resumeMembership(sub: Subscription): Promise<ServiceResult> {
  if (!sub.cancelAtPeriodEnd) return { ok: false, error: "This membership is not set to end." };
  if (!isOngoing(sub)) return { ok: false, error: "This membership has ended. Choose a plan to join again." };
  if (isGatewayManaged(sub) && sub.gateway === "razorpay") {
    return { ok: false, error: "A scheduled Razorpay cancellation can't be undone. You can subscribe again once the current period ends." };
  }
  try {
    if (isGatewayManaged(sub) && sub.gateway === "stripe") await applyStripeSubscription(await setStripeCancelAtPeriodEnd(sub.gatewaySubscriptionId!, false));
  } catch (error) {
    return fail(error);
  }
  await patchSubscription(sub.id, (row) => {
    if (!row.cancelAtPeriodEnd) return false;
    row.cancelAtPeriodEnd = false;
    return true;
  });
  await sendMembershipMessage(sub.id, "resumed");
  return { ok: true, message: "Your membership will continue. Welcome back!" };
}

/** Plans a member can switch to from `current`. */
export function changeTargets(plans: readonly MembershipPlan[], current: MembershipPlan | null): MembershipPlan[] {
  if (!current || !isRecurringInterval(current.interval)) return [];
  return plans.filter((p) => p.active && p.id !== current.id && isRecurringInterval(p.interval));
}

/**
 * Move a membership to another monthly/yearly plan. Stripe prorates the
 * difference on the next invoice; Razorpay bills the new plan from the next
 * cycle; memberships managed here switch now and renew at the new price.
 * The new plan's courses are unlocked right away in every case.
 */
export async function changeMembershipPlan(sub: Subscription, target: MembershipPlan): Promise<ServiceResult> {
  if (!isOngoing(sub)) return { ok: false, error: "This membership has ended. Choose a plan to join again." };
  const current = await planOf(sub);
  if (!changeTargets([target], current).length) return { ok: false, error: "You can't switch to this plan." };
  const db = await getDb();
  // Taxed for the member's billing country (their latest membership order), like their renewals.
  const lastOrder = db.payments
    .filter((p) => p.subscriptionId === sub.id && p.itemType === "plan" && p.status === "paid")
    .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt))[0];
  const summary = computeOrderSummary(itemFromPlan(target), null, db.settings, { rules: db.taxRules, country: lastOrder?.taxCountry ?? lastOrder?.address?.country ?? null });
  const amount = toGatewayAmount(summary.total, summary.currency);
  try {
    if (isGatewayManaged(sub) && sub.gateway === "stripe") {
      const live = await retrieveStripeSubscription(sub.gatewaySubscriptionId!, { timeoutMs: 15_000 });
      if (!live.itemId) return { ok: false, error: "Stripe did not return the membership's billing item. Please try again." };
      const priceId = await ensureStripePrice(target, amount, summary.currency);
      const updated = await changeStripeSubscriptionPrice({
        subscriptionId: live.id,
        itemId: live.itemId,
        priceId,
        planId: target.id,
        idempotencyKey: `plan-change-${sub.id}-${target.id}-${live.currentPeriodEnd ?? 0}`,
      });
      await applyStripeSubscription(updated);
    } else if (isGatewayManaged(sub) && sub.gateway === "razorpay") {
      const razorpayPlanId = await ensureRazorpayPlan(target, amount, summary.currency);
      await changeRazorpaySubscriptionPlan(sub.gatewaySubscriptionId!, razorpayPlanId);
    }
  } catch (error) {
    return fail(error);
  }
  await patchSubscription(sub.id, (row) => {
    row.planId = target.id;
    row.cancelAtPeriodEnd = false;
    return true;
  });
  if (!isGatewayManaged(sub)) await closeRenewalOrders(sub.id, "The membership moved to another plan.");
  await sendMembershipMessage(sub.id, "plan_changed", { previousPlanName: current?.name });
  const when = isGatewayManaged(sub) && sub.gateway === "stripe" ? "Any price difference is prorated on your next invoice." : "The new price applies from your next renewal.";
  return { ok: true, message: `You're now on ${target.name}. ${when}` };
}

/* ------------------------------------------------------------------ */
/* Renewal orders (memberships managed here)                           */
/* ------------------------------------------------------------------ */

/**
 * The unpaid renewal order of a manual/free/lifetime-style membership,
 * created when missing. It is paid like any order (manual confirmation or a
 * one-time Stripe/Razorpay checkout from the order page) and extends the
 * membership by one period when paid. With no payment gateway (or a free
 * price) the renewal is granted immediately.
 */
export async function openRenewalOrder(sub: Subscription, opts: { notifyMember?: boolean } = {}): Promise<Payment | null> {
  const db = await getDb();
  const plan = db.plans.find((p) => p.id === sub.planId);
  const user = db.users.find((u) => u.id === sub.userId);
  if (!plan || !user || !isRecurringInterval(plan.interval) || isGatewayManaged(sub)) return null;
  const open = db.payments.find((p) => p.subscriptionId === sub.id && p.itemType === "plan" && p.status === "pending");
  if (open) return { ...open };

  // A checkout for the same plan that was never paid would block the renewal (one open order per item).
  const stale = db.payments.find((p) => p.userId === sub.userId && p.itemType === "plan" && p.itemId === plan.id && p.status === "pending" && p.subscriptionId !== sub.id);
  if (stale) {
    const closed = await closeGatewayCheckout({ ...stale });
    if (closed.paid || !closed.reached) return null;
    await markPaymentFailed(stale.id, "Replaced by your membership renewal.");
  }

  const settings = db.settings;
  const template = db.payments
    .filter((p) => p.subscriptionId === sub.id && p.itemType === "plan" && p.status === "paid")
    .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt))[0];
  // Renewals are taxed for the member's billing country, as their first order was.
  const summary = computeOrderSummary(itemFromPlan(plan), null, settings, {
    rules: db.taxRules,
    country: template?.taxCountry ?? template?.address?.country ?? null,
    vatId: template?.buyerVatId ?? null,
  });
  const gateway = settings.commerce.paymentGateway;
  const free = summary.total <= 0 || gateway === "none";
  const inserted = await insertPendingOrder({
    id: uid("pay"),
    userId: sub.userId,
    itemType: "plan",
    itemId: plan.id,
    itemTitle: `${plan.name} · renewal`,
    planId: plan.id,
    subscriptionId: sub.id,
    originalAmount: summary.originalAmount,
    discountAmount: summary.discountAmount,
    taxAmount: summary.taxAmount,
    amount: summary.total,
    currency: summary.currency,
    ...orderTaxFields(summary),
    billingName: template?.billingName ?? user.name,
    address: template?.address,
    gstin: template?.gstin,
    pan: template?.pan,
    ...(template?.buyerVatId ? { buyerVatId: template.buyerVatId } : {}),
    source: "Renewal",
    gateway: summary.total <= 0 ? "free" : gateway,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (!inserted.ok) return null;
  const order = inserted.payment;
  if (free) {
    await fulfillPayment(order.id, undefined, { source: "checkout" });
    return order;
  }
  if (opts.notifyMember !== false) {
    await sendMembershipMessage(sub.id, "renewal_due", { order, dedupeKey: `membership:${sub.id}:renewal_due:${sub.currentPeriodEnd.slice(0, 10)}` });
  }
  return order;
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

export interface MaintenanceResult {
  skipped: boolean;
  /** Status changes of memberships managed here (past due, ended, expired). */
  advanced: number;
  renewalOrders: number;
  trialReminders: number;
  /** Gateway memberships read back because their webhooks seem to be missing. */
  synced: number;
}

const runState = globalThis as unknown as { __llMembershipMaintenance?: { lastRunAt: number } };
const maintenance = (runState.__llMembershipMaintenance ??= { lastRunAt: 0 });
/** Lazy runs (page loads) happen at most this often; the cron endpoint forces a run. */
const LAZY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keep memberships current: move manual memberships to past due, ended or
 * expired when their period runs out, open renewal orders ahead of the
 * period end, remind members before a trial ends, and read gateway
 * memberships back when their renewal webhook seems to be missing. Runs
 * lazily from the membership pages and the admin area, and from
 * `/api/cron/commerce`. `userId` limits a run to one member (their page).
 */
export async function runMembershipMaintenance(opts: { now?: Date; force?: boolean; userId?: string } = {}): Promise<MaintenanceResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const result: MaintenanceResult = { skipped: false, advanced: 0, renewalOrders: 0, trialReminders: 0, synced: 0 };
  if (!opts.force && !opts.userId) {
    if (nowMs - maintenance.lastRunAt < LAZY_INTERVAL_MS) return { ...result, skipped: true };
    maintenance.lastRunAt = nowMs;
  }

  const db = await getDb();
  const subs = db.subscriptions.filter((s) => !opts.userId || s.userId === opts.userId).map((s) => ({ ...s }));

  for (const sub of subs) {
    if (!advanceSubscription(sub, nowMs)) continue;
    const res = await patchSubscription(sub.id, (row) => {
      const next = advanceSubscription(row, nowMs);
      if (!next) return false;
      row.status = next;
      if (next === "cancelled" || next === "expired") row.cancelAtPeriodEnd = false;
      return true;
    });
    if (!res?.changed) continue;
    result.advanced++;
    if (res.subscription.status === "cancelled" || res.subscription.status === "expired") await closeRenewalOrders(sub.id, "The membership ended.");
  }

  const fresh = await getDb();
  for (const sub of fresh.subscriptions.filter((s) => !opts.userId || s.userId === opts.userId)) {
    const plan = fresh.plans.find((p) => p.id === sub.planId);
    if (plan && renewalDue(sub, plan, nowMs)) {
      const hasOpen = fresh.payments.some((p) => p.subscriptionId === sub.id && p.itemType === "plan" && p.status === "pending");
      if (!hasOpen && (await openRenewalOrder({ ...sub }))) result.renewalOrders++;
    }
    const end = Date.parse(sub.currentPeriodEnd);
    if (sub.status === "trialing" && !sub.cancelAtPeriodEnd && end > nowMs && end - nowMs <= TRIAL_REMINDER_DAYS * 86_400_000) {
      await sendMembershipMessage(sub.id, "trial_ending", { dedupeKey: `membership:${sub.id}:trial_ending:${sub.currentPeriodEnd.slice(0, 10)}` });
      result.trialReminders++;
    }
  }

  const stale = fresh.subscriptions
    .filter((s) => (!opts.userId || s.userId === opts.userId) && isGatewayManaged(s) && isOngoing(s) && Date.parse(s.currentPeriodEnd) < nowMs - STALE_SYNC_MS && isConfigured(s.gateway))
    .slice(0, MAX_SYNCS_PER_RUN);
  for (const sub of stale) {
    try {
      if (sub.gateway === "stripe") await syncStripeSubscription(sub.gatewaySubscriptionId!);
      else await syncRazorpaySubscription(sub.gatewaySubscriptionId!);
      result.synced++;
    } catch (error) {
      console.warn(`[memberships] could not refresh membership ${sub.id}: ${gatewayErrorMessage(error)}`);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */

/** End a membership now (gateway subscriptions are cancelled on the gateway first). */
export async function cancelMembershipNow(sub: Subscription, actor: Pick<User, "id">): Promise<ServiceResult> {
  if (sub.status === "cancelled" || sub.status === "expired") return { ok: false, error: "This membership has already ended." };
  try {
    if (isGatewayManaged(sub) && sub.gateway === "stripe") await applyStripeSubscription(await cancelStripeSubscriptionNow(sub.gatewaySubscriptionId!));
    else if (isGatewayManaged(sub) && sub.gateway === "razorpay") await cancelRazorpaySubscription(sub.gatewaySubscriptionId!, false);
  } catch (error) {
    return fail(error);
  }
  const nowIso = new Date().toISOString();
  await patchSubscription(sub.id, (row) => {
    if (row.status === "cancelled" && Date.parse(row.currentPeriodEnd) <= Date.now()) return false;
    row.status = "cancelled";
    row.currentPeriodEnd = nowIso;
    row.cancelAtPeriodEnd = false;
    return true;
  });
  await closeRenewalOrders(sub.id, "The membership was cancelled by an administrator.");
  await audit(actor, "membership.cancel", { type: "subscription", id: sub.id }, { immediately: true, gateway: sub.gateway });
  return { ok: true, message: "The membership was cancelled and its courses are locked for the member." };
}

/** Schedule the end of a membership at its period end (administrator). */
export async function cancelMembershipAtPeriodEndByAdmin(sub: Subscription, actor: Pick<User, "id">): Promise<ServiceResult> {
  const res = await cancelAtPeriodEnd(sub);
  if (res.ok) await audit(actor, "membership.cancel", { type: "subscription", id: sub.id }, { immediately: false, gateway: sub.gateway });
  return res.ok ? { ok: true, message: `The membership will end on ${formatDate(sub.currentPeriodEnd)}.` } : res;
}

/**
 * Add days to a membership managed here (a goodwill extension, a payment
 * received outside the site). An ended or past-due membership becomes active
 * again from today. Gateway memberships are billed by the gateway, so their
 * periods can't be changed here.
 */
export async function extendMembership(sub: Subscription, days: number, actor: Pick<User, "id">): Promise<ServiceResult> {
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { ok: false, error: "Enter between 1 and 3650 days." };
  if (isGatewayManaged(sub)) return { ok: false, error: `This membership is billed by ${sub.gateway === "stripe" ? "Stripe" : "Razorpay"}; change its dates in the gateway dashboard.` };
  const nowMs = Date.now();
  const res = await patchSubscription(sub.id, (row) => {
    const running = isOngoing(row) && Date.parse(row.currentPeriodEnd) > nowMs;
    const base = running ? row.currentPeriodEnd : new Date(nowMs).toISOString();
    if (!running) row.currentPeriodStart = base;
    row.currentPeriodEnd = addDaysIso(base, days);
    if (row.status !== "trialing") row.status = "active";
    return true;
  });
  if (!res) return { ok: false, error: "Membership not found." };
  await audit(actor, "membership.extend", { type: "subscription", id: sub.id }, { days });
  return { ok: true, message: `Extended by ${days} day${days === 1 ? "" : "s"}, until ${formatDate(res.subscription.currentPeriodEnd)}.` };
}

/**
 * Give a member a complimentary membership: a zero-amount order (kept for
 * the record) starts it, lasting `days` or one billing period.
 */
export async function grantMembershipByAdmin(input: { userId: string; planId: string; days?: number }, actor: Pick<User, "id">): Promise<ServiceResult> {
  const db = await getDb();
  const user = db.users.find((u) => u.id === input.userId);
  const plan = db.plans.find((p) => p.id === input.planId);
  if (!user) return { ok: false, error: "This member no longer exists." };
  if (!plan) return { ok: false, error: "This plan no longer exists." };
  if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650)) return { ok: false, error: "Enter between 1 and 3650 days." };
  if (db.subscriptions.some((s) => s.userId === user.id && isOngoing(s))) {
    return { ok: false, error: `${user.name} already has a running membership. Extend it instead.` };
  }
  const nowIso = new Date().toISOString();
  const inserted = await insertPendingOrder({
    id: uid("pay"),
    userId: user.id,
    itemType: "plan",
    itemId: plan.id,
    itemTitle: `${plan.name} · complimentary`,
    planId: plan.id,
    originalAmount: plan.price,
    discountAmount: plan.price,
    taxAmount: 0,
    amount: 0,
    currency: plan.currency,
    billingName: user.name,
    source: "Granted by an administrator",
    gateway: "free",
    status: "pending",
    createdAt: nowIso,
  });
  if (!inserted.ok) return { ok: false, error: inserted.error };
  if (inserted.existing) return { ok: false, error: `${user.name} has an unpaid order for this plan (${inserted.payment.orderId}). Confirm or cancel it first.` };
  const res = await fulfillPayment(inserted.payment.id, undefined, { source: "admin" });
  if (!res.ok) return { ok: false, error: res.error };
  const subscriptionId = (await getDb()).payments.find((p) => p.id === inserted.payment.id)?.subscriptionId;
  if (subscriptionId && input.days) {
    await patchSubscription(subscriptionId, (row) => {
      row.currentPeriodEnd = addDaysIso(row.currentPeriodStart, input.days!);
      return true;
    });
  }
  await audit(actor, "membership.grant", { type: "user", id: user.id }, { planId: plan.id, days: input.days ?? null });
  return { ok: true, message: `${user.name} now has ${plan.name}.` };
}

/** Read a gateway membership back from Stripe/Razorpay (admin "Refresh"). */
export async function refreshFromGateway(sub: Subscription): Promise<ServiceResult> {
  if (!isGatewayManaged(sub)) return { ok: false, error: "This membership is not billed through a payment gateway." };
  if (!isConfigured(sub.gateway)) return { ok: false, error: `${sub.gateway === "stripe" ? "Stripe" : "Razorpay"} is not configured.` };
  try {
    const res = sub.gateway === "stripe" ? await syncStripeSubscription(sub.gatewaySubscriptionId!) : await syncRazorpaySubscription(sub.gatewaySubscriptionId!);
    return { ok: true, message: `Up to date: ${res.subscription?.status ?? sub.status}.` };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Opening a course with a membership                                  */
/* ------------------------------------------------------------------ */

/**
 * "Start learning" on a course the member's plan includes: enrolls them
 * without a checkout. The enrollment points at the membership's order, so
 * its lessons lock again if the membership lapses (progress is kept).
 */
export async function joinCourseWithMembership(user: Pick<User, "id">, course: Course): Promise<{ ok: true; alreadyEnrolled: boolean } | { ok: false; error: string }> {
  const db = await getDb();
  const access = resolveCourseAccess(db, user.id, course.id);
  if (access.granted) return { ok: true, alreadyEnrolled: true };
  if (!access.membership) return { ok: false, error: "Your membership doesn't include this course." };
  if (!course.published || course.upcoming) return { ok: false, error: "This course is not open for enrollment yet." };
  if (course.disableSelfLearning) return { ok: false, error: "This course is only available through a batch." };
  const gate = await assertPrerequisitesMet(user.id, course.id);
  if (!gate.ok) return { ok: false, error: gate.error };
  const order = membershipOrderFor(db, access.membership.subscription);
  if (!order) return { ok: false, error: "We couldn't find the order behind your membership. Please contact support." };
  await enrollUserInCourse(user.id, course.id, { paymentId: order.id, memberType: "student", confirmationEmail: true });
  return { ok: true, alreadyEnrolled: false };
}
