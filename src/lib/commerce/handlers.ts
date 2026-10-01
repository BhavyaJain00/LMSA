import "server-only";
import type { SubscriptionStatus } from "@/lib/types";
import { on } from "@/lib/events";
import { sendMembershipMessage, type MembershipMessage } from "./emails";
import { afterInstallmentPaid, afterInstallmentRefunded } from "./installment-gateway";
import { deliverGift } from "./gift-service";
import { completeCheckoutSessions } from "./checkout-sessions";

/**
 * Commerce reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 * `payment.paid` / `payment.refunded` of a course paid in installments: the
 * first payment ties a Stripe subscription to the plan and sends the
 * schedule, the last one stops the subscription; a refund (which closed the
 * plan's remaining parts) stops it too.
 *
 * `payment.paid` of a gift order: email the recipient now, unless the buyer
 * chose a later send time (then the delivery run sends it).
 *
 * `payment.paid` of anything sold at checkout: the buyer's open checkout of
 * that item is closed, so no "you left something in your checkout" reminder
 * follows the purchase (counted as recovered when a reminder went out).
 *
 * `subscription.changed`: tell the member when their membership starts,
 * needs a payment, or ends. Period-only changes (a renewal) are covered by
 * the payment receipt, and a recovered payment (past_due → active) needs no
 * extra message. Each message is deduplicated per membership and period, so
 * redelivered gateway events never repeat it.
 */

const ENDED: readonly SubscriptionStatus[] = ["cancelled", "expired"];

/** Which message a status transition deserves (null for none). Pure; exported for tests. */
export function messageForTransition(previous: SubscriptionStatus | null, next: SubscriptionStatus): MembershipMessage | null {
  if (previous === next) return null;
  if (previous === null || ENDED.includes(previous)) {
    if (next === "trialing") return "trial_started";
    if (next === "active") return "started";
    return null;
  }
  if (next === "past_due") return "payment_due";
  if (next === "cancelled") return "ended";
  if (next === "expired") return "expired";
  return null;
}

on(
  "subscription.changed",
  async (event) => {
    const { subscriptionId, previousStatus, status, currentPeriodEnd } = event.data;
    const kind = messageForTransition(previousStatus, status);
    if (!kind) return;
    await sendMembershipMessage(subscriptionId, kind, { dedupeKey: `membership:${subscriptionId}:${kind}:${currentPeriodEnd.slice(0, 10)}` });
  },
  { key: "commerce:membership-messages" },
);

on(
  "payment.paid",
  async (event) => {
    if (event.data.itemType === "course") await afterInstallmentPaid(event.data.paymentId);
  },
  { key: "commerce:installments-paid" },
);

on(
  "payment.refunded",
  async (event) => {
    if (event.data.itemType === "course" && event.data.full) await afterInstallmentRefunded(event.data.paymentId);
  },
  { key: "commerce:installments-refunded" },
);

on(
  "payment.paid",
  async (event) => {
    if (event.data.itemType === "gift") await deliverGift(event.data.itemId);
  },
  { key: "commerce:gift-delivery" },
);

on(
  "payment.paid",
  async (event) => {
    await completeCheckoutSessions(event.data.paymentId);
  },
  { key: "commerce:checkout-recovery" },
);
