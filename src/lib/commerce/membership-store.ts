import "server-only";
import type { Database, Payment, Subscription, SubscriptionStatus } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { emit } from "@/lib/events";
import { uid } from "@/lib/utils";
import { addInterval } from "./plans";
import { applySnapshot, extendedPeriod, isGatewayManaged, type SubscriptionSnapshot } from "./subscriptions";

/**
 * Every write to `subscriptions` goes through this module, so each status
 * change publishes exactly one `subscription.changed` event. It imports
 * nothing from the payment flows: order fulfilment (`src/lib/payments/
 * fulfillment.ts`) calls `grantMembership` and `revokeMembershipIn` from here.
 */

type Change = { subscription: Subscription; previousStatus: SubscriptionStatus | null };

/** Publish `subscription.changed` (safe inside `mutate`: dispatch is deferred). */
export function announce(change: Change): void {
  const s = change.subscription;
  emit("subscription.changed", {
    subscriptionId: s.id,
    userId: s.userId,
    planId: s.planId,
    status: s.status,
    previousStatus: change.previousStatus,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    currentPeriodEnd: s.currentPeriodEnd,
  });
}

/** Attach an order to a subscription when the order belongs to the same member and has no subscription yet. */
function linkOrder(d: Database, paymentId: string | undefined, sub: Subscription): void {
  if (!paymentId) return;
  const order = d.payments.find((p) => p.id === paymentId);
  if (order && order.itemType === "plan" && order.userId === sub.userId && !order.subscriptionId) order.subscriptionId = sub.id;
}

export interface GatewayUpsertInput {
  gateway: "stripe" | "razorpay";
  gatewaySubscriptionId: string;
  snapshot: SubscriptionSnapshot;
  /** Needed to create the row when it does not exist yet (from our order or the gateway metadata). */
  userId?: string;
  planId?: string;
  /** Our checkout order, linked to the subscription. */
  paymentId?: string;
}

export interface UpsertResult {
  subscription: Subscription | null;
  created: boolean;
  /** Status before this write (null for a new row); undefined when nothing changed. */
  previousStatus?: SubscriptionStatus | null;
}

/**
 * Create or update the row of a Stripe/Razorpay subscription from a gateway
 * snapshot. Idempotent and order-independent: events can arrive before the
 * checkout returns, twice, or out of order. A row created by hand for the
 * same checkout order (an administrator confirmed it before the gateway
 * did) is adopted instead of duplicated.
 */
export async function upsertGatewaySubscription(input: GatewayUpsertInput): Promise<UpsertResult> {
  const nowIso = new Date().toISOString();
  const result = await mutate((d): UpsertResult & { change?: Change } => {
    let row = d.subscriptions.find((s) => s.gateway === input.gateway && s.gatewaySubscriptionId === input.gatewaySubscriptionId);
    if (!row && input.paymentId) {
      const order = d.payments.find((p) => p.id === input.paymentId);
      const adopt = order?.subscriptionId ? d.subscriptions.find((s) => s.id === order.subscriptionId && !s.gatewaySubscriptionId) : undefined;
      if (adopt) {
        adopt.gateway = input.gateway;
        adopt.gatewaySubscriptionId = input.gatewaySubscriptionId;
        row = adopt;
      }
    }
    if (row) {
      const applied = applySnapshot(row, input.snapshot, nowIso);
      linkOrder(d, input.paymentId, row);
      if (!applied) return { subscription: { ...row }, created: false };
      const copy = { ...row };
      return { subscription: copy, created: false, previousStatus: applied.previousStatus, change: { subscription: copy, previousStatus: applied.previousStatus } };
    }

    const user = input.userId ? d.users.find((u) => u.id === input.userId) : undefined;
    const plan = input.planId ? d.plans.find((p) => p.id === input.planId) : undefined;
    if (!user || !plan) return { subscription: null, created: false };
    const start = input.snapshot.currentPeriodStart ?? nowIso;
    const created: Subscription = {
      id: uid("sub"),
      userId: user.id,
      planId: plan.id,
      status: input.snapshot.status,
      currentPeriodStart: start,
      currentPeriodEnd: input.snapshot.currentPeriodEnd ?? addInterval(start, plan.interval),
      cancelAtPeriodEnd: input.snapshot.cancelAtPeriodEnd ?? false,
      gateway: input.gateway,
      gatewaySubscriptionId: input.gatewaySubscriptionId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    d.subscriptions.push(created);
    linkOrder(d, input.paymentId, created);
    const copy = { ...created };
    return { subscription: copy, created: true, previousStatus: null, change: { subscription: copy, previousStatus: null } };
  });
  if (result.change) announce(result.change);
  return { subscription: result.subscription, created: result.created, previousStatus: result.previousStatus };
}

/**
 * Grant what a paid membership order bought (called by order fulfilment,
 * once per order). Gateway-managed subscriptions are driven by their gateway,
 * so their orders only need the link; every other paid membership order —
 * manual confirmation, a free order, a one-time Stripe/Razorpay payment for a
 * lifetime plan or a renewal — starts a membership or extends it by one
 * billing interval from where the current period ends.
 */
export async function grantMembership(payment: Pick<Payment, "id" | "userId" | "itemId" | "planId" | "subscriptionId" | "gateway">): Promise<{ notice?: string }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const res = await mutate((d): { notice?: string; change?: Change } => {
    const order = d.payments.find((p) => p.id === payment.id);
    const plan = d.plans.find((p) => p.id === (payment.planId ?? payment.itemId));
    if (!order || !plan) return { notice: "The membership plan of this order no longer exists, so no membership was started." };
    const existing = order.subscriptionId ? d.subscriptions.find((s) => s.id === order.subscriptionId) : undefined;

    if (existing) {
      if (isGatewayManaged(existing)) return {};
      const previousStatus = existing.status;
      const period = extendedPeriod(existing, plan.interval, now);
      const ended = previousStatus === "cancelled" || previousStatus === "expired";
      existing.planId = plan.id;
      existing.status = "active";
      existing.currentPeriodStart = period.start;
      existing.currentPeriodEnd = period.end;
      if (ended) existing.cancelAtPeriodEnd = false;
      existing.updatedAt = nowIso;
      return { change: { subscription: { ...existing }, previousStatus } };
    }

    const period = extendedPeriod(null, plan.interval, now);
    const created: Subscription = {
      id: uid("sub"),
      userId: order.userId,
      planId: plan.id,
      status: "active",
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false,
      // Paid once (manual, free or a one-time gateway payment): renewed with renewal orders.
      gateway: order.gateway === "stripe" || order.gateway === "razorpay" || order.gateway === "free" || order.gateway === "none" ? order.gateway : "manual",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    d.subscriptions.push(created);
    order.subscriptionId = created.id;
    return { change: { subscription: { ...created }, previousStatus: null } };
  });
  if (res.change) announce(res.change);
  return res.notice ? { notice: res.notice } : {};
}

/**
 * Start a manual free trial right when a manual-gateway membership order is
 * placed: the member learns while an administrator confirms the payment,
 * which then extends the membership from the end of the trial.
 */
export async function startManualTrial(paymentId: string, trialDays: number): Promise<Subscription | null> {
  const now = new Date();
  const res = await mutate((d): Change | null => {
    const order = d.payments.find((p) => p.id === paymentId);
    if (!order || order.status !== "pending" || order.subscriptionId || order.itemType !== "plan") return null;
    const plan = d.plans.find((p) => p.id === (order.planId ?? order.itemId));
    if (!plan) return null;
    const created: Subscription = {
      id: uid("sub"),
      userId: order.userId,
      planId: plan.id,
      status: "trialing",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() + trialDays * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      gateway: "manual",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    d.subscriptions.push(created);
    order.subscriptionId = created.id;
    return { subscription: { ...created }, previousStatus: null };
  });
  if (res) announce(res);
  return res?.subscription ?? null;
}

/**
 * A refunded membership order (pure; call inside `mutate`): a membership
 * managed here ends now when the refunded order paid for its current period
 * (a newer paid order keeps it running). Gateway subscriptions keep billing
 * until they are cancelled through the gateway, so they are left as they are.
 */
export function revokeMembershipIn(d: Database, payment: Pick<Payment, "id" | "subscriptionId" | "paidAt">): void {
  if (!payment.subscriptionId) return;
  const sub = d.subscriptions.find((s) => s.id === payment.subscriptionId);
  if (!sub || isGatewayManaged(sub) || sub.status === "expired" || sub.status === "cancelled") return;
  const paidAt = payment.paidAt ?? "";
  const newer = d.payments.some((p) => p.id !== payment.id && p.subscriptionId === sub.id && p.status === "paid" && (p.paidAt ?? "") > paidAt);
  if (newer) return;
  const nowIso = new Date().toISOString();
  const previousStatus = sub.status;
  sub.status = "cancelled";
  sub.currentPeriodEnd = nowIso;
  sub.cancelAtPeriodEnd = false;
  sub.updatedAt = nowIso;
  announce({ subscription: { ...sub }, previousStatus });
}

/** Apply a status/period patch to one subscription and announce it when anything changed. */
export async function patchSubscription(
  subscriptionId: string,
  patch: (sub: Subscription, d: Database) => boolean,
): Promise<{ subscription: Subscription; changed: boolean } | null> {
  const nowIso = new Date().toISOString();
  const res = await mutate((d) => {
    const row = d.subscriptions.find((s) => s.id === subscriptionId);
    if (!row) return null;
    const previousStatus = row.status;
    const changed = patch(row, d);
    if (changed) row.updatedAt = nowIso;
    return { subscription: { ...row }, changed, previousStatus };
  });
  if (!res) return null;
  if (res.changed) announce({ subscription: res.subscription, previousStatus: res.previousStatus });
  return { subscription: res.subscription, changed: res.changed };
}

export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  const db = await getDb();
  const row = db.subscriptions.find((s) => s.id === subscriptionId);
  return row ? { ...row } : null;
}
