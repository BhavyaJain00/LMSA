import "server-only";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { fromGatewayAmount } from "./amounts";
import { isRefundInProgress, markPaymentFailed, recordGatewayRefund, type GatewayRefundOutcome } from "./fulfillment";
import { reconcileRazorpayPayment, reconcileStripeSession, reportUnmatchedPayment, type SyncState } from "./gateway";
import { isStripeSessionPaid, parseStripeCharge, parseStripeSession, type StripeEvent } from "./stripe";
import type { RazorpayEvent, RazorpayPayment } from "./razorpay";

/**
 * Webhook event handlers. Signature verification happens in the route
 * handlers before these run; everything here is idempotent because gateways
 * retry deliveries and may send events in any order.
 *
 * Orders are matched by our payment id or the gateway checkout id whatever
 * the order's gateway label is now: an order confirmed by hand is relabelled
 * "manual" while the learner may still pay in an open checkout, and that
 * payment must still reach it (and alert the admins as a duplicate).
 */

export interface WebhookOutcome {
  /** False for events this app does not act on (still acknowledged with 200). */
  handled: boolean;
  /** Short description for the server log (no personal data, no secrets). */
  message: string;
  /** Answer with a retryable status so the gateway delivers the event again later. */
  retry?: boolean;
}

async function findPayment(predicate: (p: Payment) => boolean): Promise<Payment | null> {
  const db = await getDb();
  const row = db.payments.find(predicate);
  return row ? { ...row } : null;
}

/**
 * An administrator is refunding this order from the app right now. That
 * request records the refund itself; if it times out, the redelivered event
 * records it then. Acknowledging the event now would lose it for good.
 */
function refundBusy(payment: Payment): WebhookOutcome {
  return { handled: false, retry: true, message: `order ${payment.orderId}: a refund is in progress, retry requested` };
}

/** A paid order whose access could not be granted asks for a redelivery: the next one grants it again. */
function settled(payment: Payment, state: SyncState): WebhookOutcome {
  if (state.state === "paid" && state.accessFailed) return { handled: true, retry: true, message: `order ${payment.orderId}: paid, access pending (retry requested)` };
  return { handled: true, message: `order ${payment.orderId}: ${state.state}` };
}

function refundMessage(payment: Payment, outcome: GatewayRefundOutcome, gateway: string): string {
  switch (outcome.kind) {
    case "refunded":
      return `order ${payment.orderId} refunded from the ${gateway} dashboard`;
    case "partial":
      return `order ${payment.orderId} partially refunded from the ${gateway} dashboard`;
    case "not_paid":
      return `order ${payment.orderId} is not paid; refund ignored`;
    case "missing":
      return `order ${payment.orderId} no longer exists`;
    default:
      return `order ${payment.orderId}: refund already recorded`;
  }
}

/* ------------------------------------------------------------------ */
/* Stripe                                                              */
/* ------------------------------------------------------------------ */

export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = parseStripeSession(event.object);
      const paymentId = session.metadata.paymentId || session.clientReferenceId;
      const payment = await findPayment((p) => (!!paymentId && p.id === paymentId) || (!!session.id && p.gatewayOrderId === session.id));
      if (!payment) {
        if (event.type !== "checkout.session.expired" && isStripeSessionPaid(session)) {
          await reportUnmatchedPayment({ gateway: "stripe", paymentRef: session.paymentIntentId ?? session.id, checkoutRef: session.id, amount: session.amountTotal, currency: session.currency });
          return { handled: true, message: `no order for paid session ${session.id} (admins notified)` };
        }
        return { handled: false, message: `no order for session ${session.id}` };
      }

      if (event.type === "checkout.session.async_payment_failed") {
        const changed = await markPaymentFailed(payment.id, "Your bank could not complete the payment.", { gatewayOrderId: session.id });
        return { handled: true, message: `order ${payment.orderId} ${changed ? "marked failed" : "unchanged"} (async payment failed)` };
      }
      return settled(payment, await reconcileStripeSession(payment, session, "stripe_webhook"));
    }

    case "charge.refunded": {
      const charge = parseStripeCharge(event.object);
      if (!charge.paymentIntentId) return { handled: false, message: "refund without payment intent" };
      const paymentIntentId = charge.paymentIntentId;
      const payment = await findPayment((p) => p.gatewayPaymentId === paymentIntentId);
      if (!payment) return { handled: false, message: `no order for ${paymentIntentId}` };
      if (isRefundInProgress(payment.id)) return refundBusy(payment);
      // `amount_refunded` is the charge's running total: redeliveries and out-of-order events cannot double count it.
      const outcome = await recordGatewayRefund(payment.id, { total: fromGatewayAmount(charge.amountRefunded, payment.currency), full: charge.refunded });
      return { handled: true, message: refundMessage(payment, outcome, "Stripe") };
    }

    default:
      return { handled: false, message: `ignored ${event.type}` };
  }
}

/* ------------------------------------------------------------------ */
/* Razorpay                                                            */
/* ------------------------------------------------------------------ */

async function paymentForRazorpay(rp: RazorpayPayment | null, orderId?: string): Promise<Payment | null> {
  const rzpOrderId = rp?.orderId ?? orderId;
  const ourId = rp?.notes.paymentId;
  return findPayment((p) => (!!rzpOrderId && p.gatewayOrderId === rzpOrderId) || (!!ourId && p.id === ourId));
}

export async function handleRazorpayEvent(event: RazorpayEvent): Promise<WebhookOutcome> {
  switch (event.event) {
    case "payment.authorized":
    case "payment.captured":
    case "order.paid": {
      if (!event.payment) return { handled: false, message: `${event.event} without payment entity` };
      const payment = await paymentForRazorpay(event.payment, event.order?.id);
      if (!payment) {
        // Money was taken for a checkout whose order is gone (deleted while the Razorpay window was open).
        if (event.payment.status === "captured" || event.event === "order.paid") {
          await reportUnmatchedPayment({
            gateway: "razorpay",
            paymentRef: event.payment.id,
            checkoutRef: event.payment.orderId ?? event.order?.id,
            amount: event.payment.amount,
            currency: event.payment.currency,
          });
          return { handled: true, message: `no order for ${event.payment.id} (admins notified)` };
        }
        return { handled: false, message: `no order for ${event.payment.orderId ?? event.payment.id}` };
      }
      return settled(payment, await reconcileRazorpayPayment(payment, event.payment, "razorpay_webhook"));
    }

    case "payment.failed": {
      if (!event.payment) return { handled: false, message: "payment.failed without payment entity" };
      const payment = await paymentForRazorpay(event.payment);
      if (!payment) return { handled: false, message: `no order for ${event.payment.orderId ?? event.payment.id}` };
      const changed = await markPaymentFailed(payment.id, event.payment.errorDescription ?? "The payment was declined.", {
        gatewayOrderId: event.payment.orderId,
      });
      return { handled: true, message: `order ${payment.orderId} ${changed ? "marked failed" : "unchanged"}` };
    }

    case "refund.processed": {
      const refund = event.refund;
      if (!refund?.paymentId) return { handled: false, message: "refund without payment id" };
      const razorpayPaymentId = refund.paymentId;
      const payment = await findPayment((p) => p.gatewayPaymentId === razorpayPaymentId);
      if (!payment) return { handled: false, message: `no order for ${razorpayPaymentId}` };
      if (isRefundInProgress(payment.id)) return refundBusy(payment);
      // The payment entity in the payload carries the running refunded total; the refund id is
      // remembered on the order, so a redelivered event is never counted twice.
      const rp = event.payment && event.payment.id === razorpayPaymentId ? event.payment : null;
      const total = rp && rp.amountRefunded > 0 ? fromGatewayAmount(rp.amountRefunded, payment.currency) : undefined;
      const outcome = await recordGatewayRefund(payment.id, {
        refundId: refund.id || undefined,
        amount: fromGatewayAmount(refund.amount, payment.currency),
        total,
        full: rp?.refundStatus === "full" || rp?.status === "refunded",
      });
      return { handled: true, message: refundMessage(payment, outcome, "Razorpay") };
    }

    default:
      return { handled: false, message: `ignored ${event.event}` };
  }
}
