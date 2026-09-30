import type { StripeSubscription } from "@/lib/payments/stripe";
import type { RazorpaySubscription } from "@/lib/payments/razorpay";
import { mapRazorpayStatus, mapStripeStatus, type SubscriptionSnapshot } from "./subscriptions";

/**
 * Normalize what Stripe and Razorpay report about a subscription into a
 * `SubscriptionSnapshot` (pure; type-only imports of the gateway clients).
 * Returns null for states that grant nothing and must not be recorded yet
 * (a Stripe subscription still `incomplete`, a Razorpay one only `created`).
 */

function iso(seconds: number | undefined): string | undefined {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}

export function stripeSnapshot(sub: Pick<StripeSubscription, "status" | "currentPeriodStart" | "currentPeriodEnd" | "trialEnd" | "cancelAtPeriodEnd" | "endedAt" | "canceledAt">, nowMs: number = Date.now()): SubscriptionSnapshot | null {
  const status = mapStripeStatus(sub.status);
  if (!status) return null;
  let end = sub.currentPeriodEnd;
  if (status === "trialing" && sub.trialEnd) end = sub.trialEnd;
  // A canceled subscription keeps its old period end on Stripe; access stops when it ended.
  if (status === "cancelled") end = sub.endedAt ?? sub.canceledAt ?? Math.floor(nowMs / 1000);
  if (status === "expired" && sub.endedAt) end = sub.endedAt;
  return {
    status,
    currentPeriodStart: iso(sub.currentPeriodStart),
    currentPeriodEnd: iso(end),
    cancelAtPeriodEnd: status === "cancelled" || status === "expired" ? false : sub.cancelAtPeriodEnd,
  };
}

/**
 * Razorpay has no trial status: a trial is a subscription whose first charge
 * was deferred with `start_at`. Checkouts from this app record the trial
 * length in the subscription notes (`trialDays`), which tells a trial apart
 * from a mandate whose immediate first charge is still being processed.
 */
export function razorpaySnapshot(
  sub: Pick<RazorpaySubscription, "status" | "currentStart" | "currentEnd" | "chargeAt" | "startAt" | "endedAt" | "notes">,
  nowMs: number = Date.now(),
): SubscriptionSnapshot | null {
  const nowSec = Math.floor(nowMs / 1000);
  const firstCharge = sub.chargeAt ?? sub.startAt;
  const trialRequested = Number(sub.notes.trialDays ?? "0") > 0;
  const chargeInFuture = trialRequested && !sub.currentStart && !!firstCharge && firstCharge > nowSec;
  const status = mapRazorpayStatus(sub.status, { chargeInFuture });
  if (!status) return null;
  // The trial started when the row was created; only its end is reported.
  if (status === "trialing") return { status, currentPeriodEnd: iso(firstCharge) };
  if (status === "cancelled" || status === "expired") {
    return { status, currentPeriodStart: iso(sub.currentStart), currentPeriodEnd: iso(sub.endedAt ?? Math.min(sub.currentEnd ?? nowSec, nowSec)), cancelAtPeriodEnd: false };
  }
  return { status, currentPeriodStart: iso(sub.currentStart), currentPeriodEnd: iso(sub.currentEnd ?? firstCharge) };
}
