import "server-only";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { notifyMany, type NotifyInput } from "@/lib/services/notifications";
import { formatPrice } from "@/lib/utils";
import { amountMatches, fromGatewayAmount } from "@/lib/payments/amounts";
import { GatewayError } from "@/lib/payments/http";
import { fulfillPayment, type FulfillmentOutcome } from "@/lib/payments/fulfillment";
import {
  STRIPE_INSTALLMENTS_KIND,
  cancelStripeSubscriptionNow,
  isStripeConfigured,
  isStripeSessionId,
  isStripeSubscriptionId,
  retrieveStripeCheckoutSession,
  retrieveStripeSubscription,
  setStripeCancelAt,
  type StripeInvoice,
  type StripeSubscription,
} from "@/lib/payments/stripe";
import { sendInstallmentMessage } from "./installment-emails";
import { attachStripeSubscription, detachStripeSubscription } from "./installment-store";
import { autoChargeSubscriptionId, isInstallmentOrder, isOwedPart, planOfPayment, type InstallmentPlan } from "./installments";

/**
 * The Stripe side of payment plans. A course paid in parts through Stripe is
 * a subscription that bills the same amount every N days and ends by itself
 * after the last part; each invoice it pays settles the order of the next
 * part. This module follows that subscription (webhooks and API reads). It
 * imports nothing from `src/lib/payments/gateway.ts`, which calls into it.
 *
 * The subscription id lives on the orders of the parts that are still owed
 * (`gatewayOrderId`), so it is there exactly as long as Stripe is expected to
 * charge something.
 */

const DAY_SECONDS = 86_400;

export interface InstallmentEventOutcome {
  handled: boolean;
  message: string;
  retry?: boolean;
}

async function alertAdmins(input: NotifyInput): Promise<void> {
  try {
    const db = await getDb();
    await notifyMany(
      db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id),
      input,
    );
  } catch (error) {
    console.error("[installments] could not notify administrators:", error instanceof Error ? error.message : String(error));
  }
}

function transactionsLink(search: string): string {
  return `/admin/settings/transactions?search=${encodeURIComponent(search)}`;
}

/** Whether a Stripe subscription (or the snapshot of its metadata on an invoice) collects a payment plan. */
export function isInstallmentSubscription(metadata: Record<string, string>): boolean {
  return metadata.kind === STRIPE_INSTALLMENTS_KIND;
}

/** The first part of the plan a Stripe subscription collects: from its metadata, else from a part that carries its id. */
async function anchorFor(subscriptionId: string, metadata: Record<string, string>): Promise<Payment | null> {
  const db = await getDb();
  const byId = metadata.paymentId ? db.payments.find((p) => p.id === metadata.paymentId && isInstallmentOrder(p)) : undefined;
  const part = byId ?? db.payments.find((p) => p.gatewayOrderId === subscriptionId && isInstallmentOrder(p));
  if (!part) return null;
  const plan = planOfPayment(db.payments, part);
  return plan ? { ...plan.anchor } : null;
}

async function planOf(anchorId: string): Promise<InstallmentPlan | null> {
  const db = await getDb();
  const anchor = db.payments.find((p) => p.id === anchorId);
  return anchor ? planOfPayment(db.payments, anchor) : null;
}

/**
 * Tie the remaining parts of a plan to the Stripe subscription that was
 * created with its first payment: the parts follow Stripe's billing dates,
 * and the subscription is told to end halfway through its last period, after
 * the final invoice and well before another one could be created.
 * Idempotent; a failure to set the end date is retried by later events and is
 * also covered by cancelling the subscription when the last part is paid.
 */
export async function adoptStripeInstallmentSubscription(anchorId: string, live: StripeSubscription): Promise<void> {
  const db = await getDb();
  const anchor = db.payments.find((p) => p.id === anchorId);
  if (!anchor || !isInstallmentOrder(anchor) || anchor.status !== "paid") return;
  if (live.status === "canceled" || live.status === "incomplete_expired" || live.status === "unpaid") return;
  const period = live.currentPeriodStart && live.currentPeriodEnd ? live.currentPeriodEnd - live.currentPeriodStart : 0;
  const intervalDays = Math.round(period / DAY_SECONDS);
  const cycle = live.startDate && intervalDays > 0 ? { startIso: new Date(live.startDate * 1000).toISOString(), intervalDays } : undefined;
  await attachStripeSubscription(anchor.id, live.id, cycle);
  if (cycle && !live.cancelAt) {
    const cancelAt = live.startDate! + Math.round((anchor.installmentsTotal! - 0.5) * intervalDays * DAY_SECONDS);
    try {
      await setStripeCancelAt(live.id, cancelAt);
    } catch (error) {
      console.warn(`[installments] could not set the end date of ${live.id}: ${error instanceof GatewayError ? error.message : String(error)}`);
    }
  }
}

/** Stop a plan's Stripe subscription (nothing more is charged). Returns false when Stripe could not be reached. */
export async function cancelStripeInstallmentSubscription(subscriptionId: string | null | undefined): Promise<boolean> {
  if (!isStripeSubscriptionId(subscriptionId) || !isStripeConfigured()) return !subscriptionId;
  try {
    await cancelStripeSubscriptionNow(subscriptionId);
    return true;
  } catch (error) {
    console.warn(`[installments] could not cancel ${subscriptionId}: ${error instanceof GatewayError ? error.message : String(error)}`);
    return false;
  }
}

function describe(outcome: FulfillmentOutcome, what: string): InstallmentEventOutcome {
  if (!outcome.ok) return { handled: true, message: `${what}: ${outcome.error}` };
  if (outcome.data.accessFailed) return { handled: true, retry: true, message: `${what}: order ${outcome.data.payment.orderId} paid, access pending (retry requested)` };
  return { handled: true, message: `${what}: order ${outcome.data.payment.orderId} paid` };
}

/**
 * `invoice.paid` of a payment plan subscription. The first invoice settles
 * the checkout order (when the return URL has not already); each later one
 * settles the next part that is owed. Deduplicated by the invoice and payment
 * ids, so redelivered events settle nothing twice. Returns null when the
 * invoice does not belong to a payment plan.
 */
export async function handleStripeInstallmentInvoicePaid(invoice: StripeInvoice, source: "stripe_webhook" | "sync" = "stripe_webhook"): Promise<InstallmentEventOutcome | null> {
  const subscriptionId = invoice.subscriptionId;
  if (!subscriptionId) return null;
  const anchor = await anchorFor(subscriptionId, invoice.subscriptionMetadata);
  if (!anchor) return isInstallmentSubscription(invoice.subscriptionMetadata) ? { handled: false, message: `no payment plan for ${subscriptionId}` } : null;
  if (invoice.amountPaid <= 0) return { handled: true, message: `plan ${anchor.orderId}: zero-amount invoice` };

  const plan = await planOf(anchor.id);
  if (!plan) return { handled: false, message: `no payment plan for ${subscriptionId}` };
  const pi = invoice.paymentIntentId;
  const rows = plan.parts.map((p) => p.payment).filter((p): p is Payment => !!p);
  const recorded = rows.find((p) => (p.status === "paid" || p.status === "refunded") && (p.gatewayOrderId === invoice.id || (!!pi && p.gatewayPaymentId === pi)));
  if (recorded) return { handled: true, message: `invoice ${invoice.id}: already recorded on ${recorded.orderId}` };
  const paid = fromGatewayAmount(invoice.amountPaid, invoice.currency);

  // The first invoice pays the checkout order; the checkout session id stays on it for the return URL.
  if (anchor.status === "pending" || anchor.status === "failed") {
    if (!amountMatches(anchor.amount, anchor.currency, invoice.amountPaid, invoice.currency)) {
      return { handled: true, message: `invoice ${invoice.id}: amount differs from order ${anchor.orderId}; left for review` };
    }
    const outcome = await fulfillPayment(anchor.id, pi, { source });
    if (outcome.ok) await adoptStripeInstallmentSubscription(anchor.id, await retrieveStripeSubscription(subscriptionId, { timeoutMs: 15_000 }));
    return describe(outcome, `invoice ${invoice.id}`);
  }
  if (anchor.status === "paid" && invoice.billingReason === "subscription_create") {
    return { handled: true, message: `invoice ${invoice.id}: first payment of ${anchor.orderId} is already settled` };
  }

  const target = rows.find((p) => p.installmentNumber! > 1 && isOwedPart(p));
  if (!target) {
    // Stripe charged although nothing is owed (the plan is paid, was cancelled or refunded): stop it and tell the admins.
    await cancelStripeInstallmentSubscription(subscriptionId);
    await alertAdmins({
      type: "system",
      subject: `Extra payment on the plan of order ${anchor.orderId}`,
      message: `Stripe collected ${formatPrice(paid, invoice.currency.toUpperCase())} (${pi ?? invoice.id}) for a payment plan with nothing left to pay. The subscription was stopped; refund this charge in the Stripe dashboard.`,
      link: transactionsLink(anchor.orderId),
      dedupeKey: `installment-extra:${invoice.id}`,
    });
    return { handled: true, message: `invoice ${invoice.id}: nothing owed on plan ${anchor.orderId} (admins notified)` };
  }
  if (!amountMatches(target.amount, target.currency, invoice.amountPaid, invoice.currency)) {
    await alertAdmins({
      type: "system",
      subject: `Payment amount mismatch on order ${target.orderId}`,
      message: `Stripe collected ${formatPrice(paid, invoice.currency.toUpperCase())} for an installment of ${formatPrice(target.amount, target.currency)}. The order was not settled; review it in the Stripe dashboard.`,
      link: transactionsLink(target.orderId),
      dedupeKey: `installment-mismatch:${invoice.id}`,
    });
    return { handled: true, message: `invoice ${invoice.id}: amount differs from order ${target.orderId}; left for review` };
  }
  const outcome = await fulfillPayment(target.id, pi, { gatewayOrderId: invoice.id, source });
  return describe(outcome, `installment ${invoice.id}`);
}

/** `invoice.payment_failed` of a payment plan: the learner is told right away and can pay the part themselves. */
export async function handleStripeInstallmentInvoiceFailed(invoice: StripeInvoice): Promise<InstallmentEventOutcome | null> {
  if (!invoice.subscriptionId) return null;
  const anchor = await anchorFor(invoice.subscriptionId, invoice.subscriptionMetadata);
  if (!anchor) return isInstallmentSubscription(invoice.subscriptionMetadata) ? { handled: false, message: `no payment plan for ${invoice.subscriptionId}` } : null;
  const plan = await planOf(anchor.id);
  const owed = plan?.next?.payment;
  if (!plan || !owed) return { handled: true, message: `plan ${anchor.orderId}: nothing owed` };
  await sendInstallmentMessage(owed.id, "charge_failed", { dedupeKey: `installment:${owed.id}:charge_failed` });
  return { handled: true, message: `plan ${anchor.orderId}: charge for part ${owed.installmentNumber} failed` };
}

/**
 * Follow a payment plan subscription (`customer.subscription.*` events,
 * maintenance, "pay now"): tie it to its plan when the first payment is in,
 * settle a paid invoice whose webhook was missed, and when Stripe ended the
 * subscription with parts still owed, hand those parts over to pay links.
 * `fallbackGateway` is how they are collected from then on.
 */
export async function syncStripeInstallmentSubscription(subscriptionId: string, fallbackGateway: string): Promise<InstallmentEventOutcome & { live: StripeSubscription }> {
  const live = await retrieveStripeSubscription(subscriptionId, { timeoutMs: 15_000 });
  const anchor = await anchorFor(live.id, live.metadata);
  if (!anchor) return { handled: false, message: `no payment plan for ${live.id}`, live };

  const latest = live.latestInvoice;
  if (latest && latest.status === "paid" && latest.amountPaid > 0) {
    // The subscription object has no metadata snapshot on its expanded invoice: pass the subscription's own.
    await handleStripeInstallmentInvoicePaid({ ...latest, subscriptionId: live.id, subscriptionMetadata: live.metadata }, "sync");
  }
  const ended = live.status === "canceled" || live.status === "incomplete_expired" || live.status === "unpaid";
  if (ended) {
    const released = await detachStripeSubscription(live.id, fallbackGateway);
    return { handled: true, message: `plan ${anchor.orderId}: subscription ${live.status}${released.length ? `, ${released.length} part(s) moved to pay links` : ""}`, live };
  }
  const fresh = await planOf(anchor.id);
  if (fresh?.anchor.status === "paid") await adoptStripeInstallmentSubscription(anchor.id, live);
  return { handled: true, message: `plan ${anchor.orderId}: subscription ${live.status}`, live };
}

/**
 * Bookkeeping after a part of a payment plan was paid (from the
 * `payment.paid` event): the first payment ties a Stripe subscription to the
 * plan and sends the schedule; the last one stops the subscription and
 * congratulates the learner.
 */
export async function afterInstallmentPaid(paymentId: string): Promise<void> {
  const db = await getDb();
  const part = db.payments.find((p) => p.id === paymentId);
  if (!part || !isInstallmentOrder(part) || part.status !== "paid") return;

  if (part.installmentNumber === 1 && part.gateway === "stripe" && isStripeSessionId(part.gatewayOrderId) && isStripeConfigured()) {
    try {
      const session = await retrieveStripeCheckoutSession(part.gatewayOrderId, { timeoutMs: 15_000 });
      if (session.mode === "subscription" && session.subscriptionId) {
        await adoptStripeInstallmentSubscription(part.id, await retrieveStripeSubscription(session.subscriptionId, { timeoutMs: 15_000 }));
      }
    } catch (error) {
      console.warn(`[installments] could not read the Stripe subscription of order ${part.orderId}: ${error instanceof GatewayError ? error.message : String(error)}`);
    }
  }

  const plan = planOfPayment((await getDb()).payments, part);
  if (!plan) return;
  if (plan.status === "completed") {
    // Parts settled by hand (or waived) still carry the subscription that would have charged them.
    const leftover = new Set(plan.parts.map((p) => autoChargeSubscriptionId(p.payment)).filter((id): id is string => !!id));
    for (const id of leftover) await cancelStripeInstallmentSubscription(id);
    // A waived remainder is announced by the administrator's action instead.
    if (part.amount > 0) await sendInstallmentMessage(plan.anchor.id, "completed", { dedupeKey: `installment:${plan.anchor.id}:completed` });
    return;
  }
  if (part.installmentNumber === 1) await sendInstallmentMessage(part.id, "started", { dedupeKey: `installment:${part.id}:started` });
}

/**
 * Bookkeeping after a part of a payment plan was refunded (from the
 * `payment.refunded` event): the refund already closed the plan's remaining
 * parts, so its Stripe subscription must stop charging.
 */
export async function afterInstallmentRefunded(paymentId: string): Promise<void> {
  const db = await getDb();
  const part = db.payments.find((p) => p.id === paymentId);
  if (!part || !isInstallmentOrder(part)) return;
  const plan = planOfPayment(db.payments, part);
  if (!plan || plan.status !== "cancelled") return;
  const ids = new Set(plan.parts.map((p) => autoChargeSubscriptionId(p.payment)).filter((id): id is string => !!id));
  for (const id of ids) {
    const stopped = await cancelStripeInstallmentSubscription(id);
    if (!stopped) {
      await alertAdmins({
        type: "system",
        subject: `Stop the Stripe subscription of order ${plan.key}`,
        message: `The payment plan of order ${plan.key} was cancelled after a refund, but its Stripe subscription (${id}) could not be stopped. Cancel it in the Stripe dashboard so nothing more is charged.`,
        link: transactionsLink(plan.key),
        dedupeKey: `installment-stop:${id}`,
      });
    }
  }
}
