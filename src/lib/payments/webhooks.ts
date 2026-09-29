import "server-only";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { fromGatewayAmount } from "./amounts";
import { applyRefund, isRefundInProgress, markPaymentFailed, recordPartialRefund } from "./fulfillment";
import { reconcileRazorpayPayment, reconcileStripeSession } from "./gateway";
import { parseStripeCharge, parseStripeSession, type StripeEvent } from "./stripe";
import type { RazorpayEvent, RazorpayPayment } from "./razorpay";

/**
 * Webhook event handlers. Signature verification happens in the route
 * handlers before these run; everything here is idempotent because gateways
 * retry deliveries and may send events in any order.
 */

export interface WebhookOutcome {
  /** False for events this app does not act on (still acknowledged with 200). */
  handled: boolean;
  /** Short description for the server log (no personal data, no secrets). */
  message: string;
}

async function findPayment(predicate: (p: Payment) => boolean): Promise<Payment | null> {
  const db = await getDb();
  const row = db.payments.find(predicate);
  return row ? { ...row } : null;
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
      const payment = await findPayment((p) => p.gateway === "stripe" && ((!!paymentId && p.id === paymentId) || p.gatewayOrderId === session.id));
      if (!payment) return { handled: false, message: `no order for session ${session.id}` };

      if (event.type === "checkout.session.async_payment_failed") {
        const changed = await markPaymentFailed(payment.id, "Your bank could not complete the payment.", { gatewayOrderId: session.id });
        return { handled: true, message: `order ${payment.orderId} ${changed ? "marked failed" : "unchanged"} (async payment failed)` };
      }
      const state = await reconcileStripeSession(payment, session, "stripe_webhook");
      return { handled: true, message: `order ${payment.orderId}: ${state.state}` };
    }

    case "charge.refunded": {
      const charge = parseStripeCharge(event.object);
      if (!charge.paymentIntentId) return { handled: false, message: "refund without payment intent" };
      const payment = await findPayment((p) => p.gateway === "stripe" && p.gatewayPaymentId === charge.paymentIntentId);
      if (!payment) return { handled: false, message: `no order for ${charge.paymentIntentId}` };
      // An admin refund from Transactions records itself once the API call returns.
      if (isRefundInProgress(payment.id) || payment.status !== "paid") return { handled: true, message: `order ${payment.orderId} already refunded` };
      const refunded = fromGatewayAmount(charge.amountRefunded, payment.currency);
      if (charge.refunded || refunded >= payment.amount) {
        await applyRefund(payment.id, { amount: Math.min(payment.amount, refunded || payment.amount) });
        return { handled: true, message: `order ${payment.orderId} refunded from the Stripe dashboard` };
      }
      await recordPartialRefund(payment.id, { amount: refunded });
      return { handled: true, message: `order ${payment.orderId} partially refunded from the Stripe dashboard` };
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
  return findPayment((p) => p.gateway === "razorpay" && ((!!rzpOrderId && p.gatewayOrderId === rzpOrderId) || (!!ourId && p.id === ourId)));
}

export async function handleRazorpayEvent(event: RazorpayEvent): Promise<WebhookOutcome> {
  switch (event.event) {
    case "payment.authorized":
    case "payment.captured":
    case "order.paid": {
      if (!event.payment) return { handled: false, message: `${event.event} without payment entity` };
      const payment = await paymentForRazorpay(event.payment, event.order?.id);
      if (!payment) return { handled: false, message: `no order for ${event.payment.orderId ?? event.payment.id}` };
      const state = await reconcileRazorpayPayment(payment, event.payment, "razorpay_webhook");
      return { handled: true, message: `order ${payment.orderId}: ${state.state}` };
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
      const payment = await findPayment((p) => p.gateway === "razorpay" && p.gatewayPaymentId === refund.paymentId);
      if (!payment) return { handled: false, message: `no order for ${refund.paymentId}` };
      if (isRefundInProgress(payment.id) || payment.status !== "paid" || payment.refundId === refund.id) {
        return { handled: true, message: `order ${payment.orderId} already refunded` };
      }
      const refundedNow = fromGatewayAmount(refund.amount, payment.currency);
      const total = Math.min(payment.amount, (payment.refundedAmount ?? 0) + refundedNow);
      if (total >= payment.amount) {
        await applyRefund(payment.id, { refundId: refund.id, amount: total });
        return { handled: true, message: `order ${payment.orderId} refunded from the Razorpay dashboard` };
      }
      await recordPartialRefund(payment.id, { refundId: refund.id, amount: total });
      return { handled: true, message: `order ${payment.orderId} partially refunded from the Razorpay dashboard` };
    }

    default:
      return { handled: false, message: `ignored ${event.event}` };
  }
}
