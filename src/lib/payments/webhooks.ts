import "server-only";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { fromGatewayAmount } from "./amounts";
import { isRefundInProgress, markPaymentFailed, recordGatewayRefund, type GatewayRefundOutcome } from "./fulfillment";
import { reconcileRazorpayPayment, reconcileStripeSession, reportUnmatchedPayment, type SyncState } from "./gateway";
import { isStripeSessionPaid, parseStripeCharge, parseStripeInvoice, parseStripeSession, parseStripeSubscription, type StripeEvent } from "./stripe";
import { handleRazorpaySubscriptionEvent, handleStripeInvoicePaid, syncStripeSubscription } from "@/lib/commerce/memberships";
import {
  handleStripeInstallmentInvoiceFailed,
  handleStripeInstallmentInvoicePaid,
  isInstallmentSubscription,
  syncStripeInstallmentSubscription,
} from "@/lib/commerce/installment-gateway";
import { isRazorpaySubscriptionId, type RazorpayEvent, type RazorpayPayment } from "./razorpay";
import { allocateGroupRefund, isOrderBump } from "@/lib/commerce/upsells";

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
 * The order rows paid with one gateway payment: usually one, or an order and
 * its order bumps (charged in the same checkout). The main order comes first.
 */
async function rowsForGatewayPayment(gatewayPaymentId: string): Promise<Payment[]> {
  const db = await getDb();
  return db.payments
    .filter((p) => p.gatewayPaymentId === gatewayPaymentId)
    .sort((a, b) => Number(isOrderBump(a)) - Number(isOrderBump(b)))
    .map((p) => ({ ...p }));
}

/**
 * Record a refund the gateway reports on a payment shared by an order and its
 * bumps. `total` (the gateway's running total) is split across the rows; a
 * single refund tagged with one row's id goes to that row. Returns the
 * outcome for the main order (for the log line).
 */
async function recordSharedRefund(rows: Payment[], update: { total?: number; full?: boolean; refundId?: string; amount?: number; tag?: string }): Promise<GatewayRefundOutcome> {
  const main = rows[0]!;
  if (rows.length === 1) return recordGatewayRefund(main.id, update);
  if (update.full) {
    let outcome: GatewayRefundOutcome = { kind: "missing" };
    for (const row of rows) {
      const res = await recordGatewayRefund(row.id, { full: true, total: row.amount, ...(row.id === main.id ? { refundId: update.refundId } : {}) });
      if (row.id === main.id) outcome = res;
    }
    return outcome;
  }
  if (update.total === undefined) {
    // One refund without the running total: it belongs to the row it was sent for, else to the main order.
    const target = rows.find((r) => r.id === update.tag) ?? main;
    return recordGatewayRefund(target.id, { refundId: update.refundId, amount: update.amount });
  }
  const split = allocateGroupRefund(
    rows.map((r) => ({ id: r.id, amount: r.amount, refundedAmount: r.status === "refunded" ? (r.refundedAmount ?? r.amount) : (r.refundedAmount ?? 0), main: r.id === main.id })),
    update.total,
    false,
  );
  let outcome: GatewayRefundOutcome = { kind: "unchanged", payment: main };
  for (const row of rows) {
    const share = split.get(row.id) ?? 0;
    if (share <= 0) continue;
    const tagged = update.tag === row.id || (row.id === main.id && !rows.some((r) => r.id === update.tag));
    const res = await recordGatewayRefund(row.id, { total: share, ...(tagged ? { refundId: update.refundId } : {}) });
    if (row.id === main.id) outcome = res;
  }
  return outcome;
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
      const rows = await rowsForGatewayPayment(paymentIntentId);
      const payment = rows[0];
      if (!payment) return { handled: false, message: `no order for ${paymentIntentId}` };
      const busy = rows.find((r) => isRefundInProgress(r.id));
      if (busy) return refundBusy(busy);
      // `amount_refunded` is the charge's running total: redeliveries and out-of-order events cannot double count it.
      const outcome = await recordSharedRefund(rows, { total: fromGatewayAmount(charge.amountRefunded, payment.currency), full: charge.refunded });
      return { handled: true, message: refundMessage(payment, outcome, "Stripe") };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Payloads can be stale or arrive out of order: the subscription is read back from Stripe.
      const sub = parseStripeSubscription(event.object);
      if (!sub.id) return { handled: false, message: "subscription event without id" };
      if (isInstallmentSubscription(sub.metadata)) {
        const db = await getDb();
        const res = await syncStripeInstallmentSubscription(sub.id, db.settings.commerce.paymentGateway);
        return { handled: res.handled, message: res.message, retry: res.retry };
      }
      const res = await syncStripeSubscription(sub.id);
      if (!res.subscription) return { handled: false, message: `no membership for ${sub.id}` };
      return { handled: true, message: `membership ${res.subscription.id}: ${res.subscription.status}${res.created ? " (created)" : ""}` };
    }

    case "invoice.paid": {
      // Invoices of a course payment plan settle its parts; every other subscription invoice is a membership.
      const invoice = parseStripeInvoice(event.object);
      return (await handleStripeInstallmentInvoicePaid(invoice)) ?? handleStripeInvoicePaid(invoice);
    }

    case "invoice.payment_failed": {
      // The subscription turns past_due; the member is told when its status changes.
      const invoice = parseStripeInvoice(event.object);
      if (!invoice.subscriptionId) return { handled: false, message: `invoice ${invoice.id} is not for a subscription` };
      const installment = await handleStripeInstallmentInvoiceFailed(invoice);
      if (installment) return installment;
      const res = await syncStripeSubscription(invoice.subscriptionId);
      if (!res.subscription) return { handled: false, message: `no membership for ${invoice.subscriptionId}` };
      return { handled: true, message: `membership ${res.subscription.id}: payment failed (${res.subscription.status})` };
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
      // Membership charges pay a subscription invoice; the `subscription.*` events record them.
      if ((!payment && event.payment.invoiceId) || (payment && isRazorpaySubscriptionId(payment.gatewayOrderId))) {
        return { handled: false, message: `${event.payment.id} belongs to a membership subscription` };
      }
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
      const rows = await rowsForGatewayPayment(razorpayPaymentId);
      const payment = rows[0];
      if (!payment) return { handled: false, message: `no order for ${razorpayPaymentId}` };
      const busy = rows.find((r) => isRefundInProgress(r.id));
      if (busy) return refundBusy(busy);
      // The payment entity in the payload carries the running refunded total; the refund id is
      // remembered on the order, so a redelivered event is never counted twice.
      const rp = event.payment && event.payment.id === razorpayPaymentId ? event.payment : null;
      const total = rp && rp.amountRefunded > 0 ? fromGatewayAmount(rp.amountRefunded, payment.currency) : undefined;
      const outcome = await recordSharedRefund(rows, {
        refundId: refund.id || undefined,
        amount: fromGatewayAmount(refund.amount, payment.currency),
        // A shared payment's running total covers every row: a tagged refund is placed by its tag instead.
        total: rows.length > 1 && refund.notes.paymentId ? undefined : total,
        full: rp?.refundStatus === "full" || rp?.status === "refunded",
        tag: refund.notes.paymentId,
      });
      return { handled: true, message: refundMessage(payment, outcome, "Razorpay") };
    }

    case "subscription.authenticated":
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.pending":
    case "subscription.halted":
    case "subscription.cancelled":
    case "subscription.completed":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.updated": {
      if (!event.subscription?.id) return { handled: false, message: `${event.event} without subscription entity` };
      return handleRazorpaySubscriptionEvent(event.event, event.subscription, event.payment);
    }

    default:
      return { handled: false, message: `ignored ${event.event}` };
  }
}
