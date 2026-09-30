import type { MembershipPlan, Subscription, SubscriptionStatus } from "@/lib/types";
import { addDaysIso, addInterval, isRecurringInterval, monthlyEquivalent } from "./plans";

/**
 * Membership lifecycle rules (pure, client-safe).
 *
 * Status meanings:
 *  - trialing   free trial; the first charge happens at `currentPeriodEnd`.
 *  - active     paid up until `currentPeriodEnd` (renews unless `cancelAtPeriodEnd`).
 *  - past_due   the renewal was not paid; access continues for a grace period
 *               while the gateway retries or the member pays the renewal order.
 *  - cancelled  ended by the member or an administrator; access runs until
 *               `currentPeriodEnd` (set to the end moment on an immediate cancel).
 *  - expired    ended because payment never arrived; no access.
 *
 * Stripe and Razorpay subscriptions are "gateway managed": their status and
 * periods come from the gateway (webhooks and API reads). Manual, free and
 * admin-granted memberships are advanced here by `advanceSubscription` and
 * renewed with one-time renewal orders.
 */

/** Days of access after an unpaid renewal (past_due) before lessons lock. */
export const GRACE_DAYS = 7;
/** Gateway renewals are confirmed by webhooks that can lag behind the period end. */
export const GATEWAY_LEEWAY_HOURS = 48;
/** How long before the period end a manual renewal order is created. */
export const RENEWAL_NOTICE_DAYS: Record<"month" | "year", number> = { month: 5, year: 14 };

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * Recurring Stripe/Razorpay subscriptions whose status and periods the
 * gateway reports. A membership paid once through a gateway (a lifetime plan,
 * a renewal order) has no gateway subscription id and is managed here.
 */
export function isGatewayManaged(sub: Pick<Subscription, "gateway" | "gatewaySubscriptionId">): boolean {
  return (sub.gateway === "stripe" || sub.gateway === "razorpay") && !!sub.gatewaySubscriptionId;
}

/** Not ended yet: the member cannot start a second membership while one is ongoing. */
export function isOngoing(sub: Pick<Subscription, "status">): boolean {
  return sub.status === "trialing" || sub.status === "active" || sub.status === "past_due";
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Last instant (ms) the subscription unlocks courses, or null when it grants nothing. */
export function subscriptionAccessUntil(sub: Pick<Subscription, "status" | "currentPeriodEnd" | "gateway" | "gatewaySubscriptionId">): number | null {
  const end = ms(sub.currentPeriodEnd);
  switch (sub.status) {
    case "trialing":
    case "active":
      return end + (isGatewayManaged(sub) ? GATEWAY_LEEWAY_HOURS * 3_600_000 : 0);
    case "past_due":
      return end + GRACE_DAYS * 86_400_000;
    case "cancelled":
      return end;
    default:
      return null;
  }
}

/** Whether the subscription unlocks its plan's courses at `now`. */
export function subscriptionGrantsAccess(sub: Pick<Subscription, "status" | "currentPeriodEnd" | "gateway" | "gatewaySubscriptionId">, now: number = Date.now()): boolean {
  const until = subscriptionAccessUntil(sub);
  return until !== null && now < until;
}

/** One free trial per member: only members who never had a membership get one. */
export function trialEligible(userSubscriptions: readonly Pick<Subscription, "id">[]): boolean {
  return userSubscriptions.length === 0;
}

/**
 * The status a manual (not gateway managed) subscription should move to at
 * `now`, or null when it stays as it is.
 */
export function advanceSubscription(
  sub: Pick<Subscription, "status" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "gateway" | "gatewaySubscriptionId">,
  now: number = Date.now(),
): SubscriptionStatus | null {
  if (isGatewayManaged(sub)) return null;
  const end = ms(sub.currentPeriodEnd);
  const graceEnd = end + GRACE_DAYS * 86_400_000;
  if (sub.status === "trialing" || sub.status === "active") {
    if (now < end) return null;
    if (sub.cancelAtPeriodEnd) return "cancelled";
    return now < graceEnd ? "past_due" : "expired";
  }
  if (sub.status === "past_due" && now >= graceEnd) return "expired";
  return null;
}

/**
 * Whether a manual subscription needs its renewal order now: it will renew
 * (recurring plan, not cancelled) and the period end is within the notice
 * window (or already passed).
 */
export function renewalDue(
  sub: Pick<Subscription, "status" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "gateway" | "gatewaySubscriptionId">,
  plan: Pick<MembershipPlan, "interval">,
  now: number = Date.now(),
): boolean {
  if (isGatewayManaged(sub) || sub.cancelAtPeriodEnd) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  if (!isRecurringInterval(plan.interval)) return false;
  const notice = RENEWAL_NOTICE_DAYS[plan.interval] * 86_400_000;
  return now >= ms(sub.currentPeriodEnd) - notice;
}

/**
 * The period a payment for a manual subscription buys: it starts where the
 * current paid (or trial) period ends, or now when the membership already
 * lapsed, and lasts one billing interval.
 */
export function extendedPeriod(
  sub: Pick<Subscription, "status" | "currentPeriodEnd"> | null,
  interval: MembershipPlan["interval"],
  now: number = Date.now(),
): { start: string; end: string } {
  const nowIso = new Date(now).toISOString();
  const currentEnd = sub ? ms(sub.currentPeriodEnd) : 0;
  const continues = !!sub && sub.status !== "expired" && currentEnd > now;
  const start = continues ? sub.currentPeriodEnd : nowIso;
  return { start, end: addInterval(start, interval) };
}

/** When the member is charged next (null when nothing renews). */
export function nextChargeDate(sub: Pick<Subscription, "status" | "currentPeriodEnd" | "cancelAtPeriodEnd">, plan: Pick<MembershipPlan, "interval"> | null): string | null {
  if (!plan || !isRecurringInterval(plan.interval) || sub.cancelAtPeriodEnd) return null;
  if (sub.status === "trialing" || sub.status === "active" || sub.status === "past_due") return sub.currentPeriodEnd;
  return null;
}

/** Lifetime memberships run until a date far in the future. */
export function isLifetime(plan: Pick<MembershipPlan, "interval"> | null | undefined): boolean {
  return plan?.interval === "one_time";
}

/* ------------------------------------------------------------------ */
/* Gateway snapshots                                                   */
/* ------------------------------------------------------------------ */

/** What a gateway currently says about a subscription (already normalized). */
export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Stripe subscription status → ours. `incomplete` (the first payment is still
 * being confirmed) returns null: it grants nothing and must not be announced
 * as a change.
 */
export function mapStripeStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return "expired";
    default:
      return null;
  }
}

/**
 * Razorpay subscription status → ours. `created` means the checkout was never
 * completed; `authenticated` means the mandate is set up and the first charge
 * is scheduled (a trial when that is in the future).
 */
export function mapRazorpayStatus(status: string, opts: { chargeInFuture: boolean }): SubscriptionStatus | null {
  switch (status) {
    case "authenticated":
      return opts.chargeInFuture ? "trialing" : "active";
    case "active":
      return "active";
    case "pending":
    case "halted":
      return "past_due";
    case "cancelled":
      return "cancelled";
    case "completed":
    case "expired":
    case "paused":
      return "expired";
    default:
      return null;
  }
}

/**
 * Fold a gateway snapshot into a subscription row (call inside `mutate`).
 * A snapshot never moves an ongoing period backwards (gateways redeliver old
 * events); periods of an ended subscription are taken as reported, because
 * the end moment matters for access. Returns the previous status when
 * anything changed, `undefined` when nothing did.
 */
export function applySnapshot(sub: Subscription, snap: SubscriptionSnapshot, nowIso: string): { previousStatus: SubscriptionStatus } | undefined {
  const before = { status: sub.status, start: sub.currentPeriodStart, end: sub.currentPeriodEnd, cancel: sub.cancelAtPeriodEnd };
  const ending = snap.status === "cancelled" || snap.status === "expired";
  if (snap.currentPeriodEnd) {
    const newer = ms(snap.currentPeriodEnd) >= ms(sub.currentPeriodEnd);
    if (ending || newer) {
      sub.currentPeriodEnd = snap.currentPeriodEnd;
      if (snap.currentPeriodStart) sub.currentPeriodStart = snap.currentPeriodStart;
    }
  }
  sub.status = snap.status;
  if (snap.cancelAtPeriodEnd !== undefined) sub.cancelAtPeriodEnd = ending ? false : snap.cancelAtPeriodEnd;
  else if (ending) sub.cancelAtPeriodEnd = false;
  const changed = before.status !== sub.status || before.start !== sub.currentPeriodStart || before.end !== sub.currentPeriodEnd || before.cancel !== sub.cancelAtPeriodEnd;
  if (!changed) return undefined;
  sub.updatedAt = nowIso;
  return { previousStatus: before.status };
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/**
 * Monthly recurring revenue per currency: paying members only (trials and
 * lifetime plans excluded), yearly plans counted as a twelfth.
 */
export function monthlyRecurringRevenue(
  subs: readonly Pick<Subscription, "status" | "planId" | "cancelAtPeriodEnd">[],
  plans: readonly Pick<MembershipPlan, "id" | "interval" | "price" | "currency">[],
): Record<string, number> {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const out: Record<string, number> = {};
  for (const sub of subs) {
    if (sub.status !== "active" && sub.status !== "past_due") continue;
    const plan = byId.get(sub.planId);
    if (!plan || !isRecurringInterval(plan.interval)) continue;
    const code = plan.currency.toUpperCase();
    out[code] = (out[code] ?? 0) + monthlyEquivalent(plan);
  }
  for (const code of Object.keys(out)) out[code] = Math.round(out[code]!);
  return out;
}

/** The end of a trial that starts now. */
export function trialEnd(nowIso: string, trialDays: number): string {
  return addDaysIso(nowIso, trialDays);
}
