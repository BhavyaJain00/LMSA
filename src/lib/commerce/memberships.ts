import "server-only";
import type { MembershipPlan, Payment } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { razorpayEnv } from "@/lib/server-env";
import { shortCode, uid } from "@/lib/utils";
import { amountMatches, fromGatewayAmount, toGatewayAmount } from "@/lib/payments/amounts";
import { GatewayError } from "@/lib/payments/http";
import { fulfillPayment, markPaymentFailed, type FulfillmentOutcome, type FulfillmentSource } from "@/lib/payments/fulfillment";
import { verifyRazorpaySubscriptionSignature } from "@/lib/payments/signatures";
import {
  createStripeRecurringPrice,
  createStripeSubscriptionSession,
  expireStripeCheckoutSession,
  isStripePriceId,
  retrieveStripePrice,
  retrieveStripeSubscription,
  type StripeInvoice,
  type StripeSubscription,
} from "@/lib/payments/stripe";
import {
  cancelRazorpaySubscription,
  createRazorpayPlan,
  createRazorpaySubscription,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  isRazorpayConfigured,
  isRazorpayPaymentReversed,
  isRazorpayPlanId,
  listRazorpaySubscriptionInvoices,
  type RazorpayPayment,
  type RazorpaySubscription,
} from "@/lib/payments/razorpay";
import { membershipTerms } from "@/lib/data/commerce";
import { isRecurringInterval } from "./plans";
import { razorpaySnapshot, stripeSnapshot } from "./snapshots";
import { upsertGatewaySubscription, type UpsertResult } from "./membership-store";

/**
 * Memberships through Stripe and Razorpay: recurring checkouts, confirming
 * them, following the gateway subscription (webhooks and API reads) and
 * recording each paid renewal as its own order with an invoice number.
 *
 * Settling the checkout order itself goes through `fulfillPayment` like any
 * other order (see `src/lib/payments/gateway.ts` for the Stripe return and
 * `reconcileStripeSession`); access comes from the subscription row, which
 * `upsertGatewaySubscription` keeps in step with the gateway.
 */

/** Billing cycles a Razorpay subscription is created for (it needs a total). */
const RAZORPAY_TOTAL_COUNT: Record<"month" | "year", number> = { month: 120, year: 10 };

export type MembershipCheckout = { gateway: "stripe"; sessionId: string; url: string } | { gateway: "razorpay"; subscriptionId: string };

/**
 * Whether paying this order starts a recurring gateway subscription: a
 * first membership order (not a renewal of an existing membership) for a
 * monthly/yearly plan, paid through Stripe or Razorpay. Lifetime plans and
 * renewals are one-time payments.
 */
export function isRecurringMembershipOrder(payment: Pick<Payment, "itemType" | "subscriptionId" | "gateway">, plan: Pick<MembershipPlan, "interval"> | null | undefined): boolean {
  return payment.itemType === "plan" && !payment.subscriptionId && !!plan && isRecurringInterval(plan.interval) && (payment.gateway === "stripe" || payment.gateway === "razorpay");
}

/* ------------------------------------------------------------------ */
/* Gateway prices                                                      */
/* ------------------------------------------------------------------ */

/**
 * Prices for amounts other than the plan's own price (tax added, another
 * currency) are created on demand and remembered per process, so a server
 * does not create a new gateway price for every checkout.
 */
const cacheState = globalThis as unknown as { __llMembershipPrices?: Map<string, string> };
const priceCache: Map<string, string> = (cacheState.__llMembershipPrices ??= new Map());

function planPriceMatches(plan: MembershipPlan, gatewayAmount: number, currency: string): boolean {
  return plan.currency.toUpperCase() === currency.toUpperCase() && toGatewayAmount(plan.price, plan.currency) === gatewayAmount;
}

async function rememberPrice(plan: MembershipPlan, gateway: "stripe" | "razorpay", id: string, ownPrice: boolean, cacheKey: string): Promise<void> {
  if (!ownPrice) {
    priceCache.set(cacheKey, id);
    return;
  }
  await mutate((d) => {
    const row = d.plans.find((p) => p.id === plan.id);
    if (row) row.gatewayPriceIds = { ...(row.gatewayPriceIds ?? {}), [gateway]: id };
  });
}

/** A recurring Stripe Price for `gatewayAmount` of `plan` (reused when the plan already has one). */
export async function ensureStripePrice(plan: MembershipPlan, gatewayAmount: number, currency: string): Promise<string> {
  if (!isRecurringInterval(plan.interval)) throw new GatewayError("Stripe", "Lifetime plans have no recurring price.");
  const own = planPriceMatches(plan, gatewayAmount, currency);
  const stored = plan.gatewayPriceIds?.stripe;
  if (own && isStripePriceId(stored)) return stored;
  const key = `stripe:${plan.id}:${plan.interval}:${gatewayAmount}:${currency.toUpperCase()}`;
  const cached = priceCache.get(key);
  if (cached) return cached;
  // Keep all prices of a plan on one Stripe product.
  const productId = isStripePriceId(stored) ? (await retrieveStripePrice(stored).catch(() => null))?.productId : undefined;
  const price = await createStripeRecurringPrice({
    unitAmount: gatewayAmount,
    currency,
    interval: plan.interval,
    productId,
    productName: plan.name,
    planId: plan.id,
    idempotencyKey: `plan-price-${key}`,
  });
  await rememberPrice(plan, "stripe", price.id, own, key);
  return price.id;
}

/** A Razorpay plan billing `gatewayAmount` per interval (reused when the membership plan already has one). */
export async function ensureRazorpayPlan(plan: MembershipPlan, gatewayAmount: number, currency: string): Promise<string> {
  if (!isRecurringInterval(plan.interval)) throw new GatewayError("Razorpay", "Lifetime plans have no recurring price.");
  const own = planPriceMatches(plan, gatewayAmount, currency);
  const stored = plan.gatewayPriceIds?.razorpay;
  if (own && isRazorpayPlanId(stored)) return stored;
  const key = `razorpay:${plan.id}:${plan.interval}:${gatewayAmount}:${currency.toUpperCase()}`;
  const cached = priceCache.get(key);
  if (cached) return cached;
  const created = await createRazorpayPlan({ name: plan.name, amount: gatewayAmount, currency, interval: plan.interval, planId: plan.id });
  await rememberPrice(plan, "razorpay", created.id, own, key);
  return created.id;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

async function saveMembershipAttempt(paymentId: string, gateway: "stripe" | "razorpay", gatewayOrderId: string, checkoutUrl?: string): Promise<boolean> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || row.status !== "pending") return false;
    row.gateway = gateway;
    row.gatewayOrderId = gatewayOrderId;
    row.checkoutUrl = checkoutUrl;
    row.failureReason = undefined;
    return true;
  });
}

/**
 * Open the gateway checkout of a first membership order: a Stripe Checkout
 * Session in subscription mode, or a Razorpay subscription the member
 * authorizes in Razorpay Checkout. A free trial (first membership only)
 * delays the first charge. The session/subscription id is stored on the
 * order so the return, the webhooks and status checks find it.
 */
export async function startMembershipCheckout(payment: Payment, urls: { successUrl: string; cancelUrl: string }): Promise<MembershipCheckout> {
  const db = await getDb();
  const plan = db.plans.find((p) => p.id === (payment.planId ?? payment.itemId));
  if (!plan || !isRecurringInterval(plan.interval)) throw new GatewayError(payment.gateway, "This membership plan is no longer available.");
  const user = db.users.find((u) => u.id === payment.userId);
  const { trialDays } = membershipTerms(db, payment.userId, plan);
  const amount = toGatewayAmount(payment.amount, payment.currency);

  if (payment.gateway === "stripe") {
    const own = planPriceMatches(plan, amount, payment.currency);
    const session = await createStripeSubscriptionSession({
      paymentId: payment.id,
      orderId: payment.orderId,
      planId: plan.id,
      userId: payment.userId,
      title: plan.name,
      description: plan.description.replace(/[#*_`>[\]()]/g, "").slice(0, 300) || undefined,
      unitAmount: amount,
      currency: payment.currency,
      interval: plan.interval,
      priceId: own && isStripePriceId(plan.gatewayPriceIds?.stripe) ? plan.gatewayPriceIds?.stripe : undefined,
      trialDays,
      customerEmail: user?.email,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    if (!(await saveMembershipAttempt(payment.id, "stripe", session.id, session.url ?? undefined))) {
      await expireStripeCheckoutSession(session.id).catch(() => undefined);
      throw new GatewayError("Stripe", "This order can no longer be paid.");
    }
    return { gateway: "stripe", sessionId: session.id, url: session.url! };
  }

  if (payment.gateway !== "razorpay") throw new GatewayError(payment.gateway, "This order is not paid through a payment gateway.");
  const razorpayPlanId = await ensureRazorpayPlan(plan, amount, payment.currency);
  const sub = await createRazorpaySubscription({
    planId: razorpayPlanId,
    totalCount: RAZORPAY_TOTAL_COUNT[plan.interval],
    startAt: trialDays > 0 ? Math.floor(Date.now() / 1000) + trialDays * 86_400 : undefined,
    notes: { paymentId: payment.id, orderId: payment.orderId, planId: plan.id, userId: payment.userId, trialDays: String(trialDays) },
  });
  if (!(await saveMembershipAttempt(payment.id, "razorpay", sub.id))) {
    await cancelRazorpaySubscription(sub.id, false).catch(() => undefined);
    throw new GatewayError("Razorpay", "This order can no longer be paid.");
  }
  return { gateway: "razorpay", subscriptionId: sub.id };
}

/**
 * A membership checkout that started a free trial charged nothing: the order
 * is settled as a zero-amount "trial start" (no invoice), and each charge
 * after the trial is recorded as its own renewal order.
 */
export async function settleTrialOrder(paymentId: string): Promise<void> {
  await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || row.itemType !== "plan" || (row.status !== "pending" && row.status !== "failed") || row.amount === 0) return;
    row.discountAmount = row.originalAmount;
    row.taxAmount = 0;
    row.amount = 0;
    if (!/free trial/i.test(row.itemTitle)) row.itemTitle = `${row.itemTitle} · free trial`;
  });
}

/* ------------------------------------------------------------------ */
/* Stripe                                                              */
/* ------------------------------------------------------------------ */

async function orderContext(paymentId: string | undefined): Promise<{ userId?: string; planId?: string; paymentId?: string }> {
  if (!paymentId) return {};
  const db = await getDb();
  const order = db.payments.find((p) => p.id === paymentId && p.itemType === "plan");
  return order ? { userId: order.userId, planId: order.planId ?? order.itemId, paymentId: order.id } : {};
}

/** Fold a Stripe subscription object into its row (creating it from our order or the metadata). */
export async function applyStripeSubscription(live: StripeSubscription, hints: { paymentId?: string } = {}): Promise<UpsertResult> {
  const snapshot = stripeSnapshot(live);
  if (!snapshot) {
    const db = await getDb();
    const row = db.subscriptions.find((s) => s.gateway === "stripe" && s.gatewaySubscriptionId === live.id);
    return { subscription: row ? { ...row } : null, created: false };
  }
  const fromOrder = await orderContext(hints.paymentId ?? live.metadata.paymentId);
  return upsertGatewaySubscription({
    gateway: "stripe",
    gatewaySubscriptionId: live.id,
    snapshot,
    userId: fromOrder.userId ?? live.metadata.userId,
    planId: fromOrder.planId ?? live.metadata.planId,
    paymentId: fromOrder.paymentId,
  });
}

/** Read a Stripe subscription and update its row. */
export async function syncStripeSubscription(subscriptionId: string, hints: { paymentId?: string } = {}): Promise<UpsertResult & { live: StripeSubscription }> {
  const live = await retrieveStripeSubscription(subscriptionId, { timeoutMs: 15_000 });
  return { ...(await applyStripeSubscription(live, hints)), live };
}

export interface MembershipEventOutcome {
  handled: boolean;
  message: string;
  retry?: boolean;
}

/**
 * Record one paid renewal as its own order (invoice number, receipt, the
 * `payment.paid` event). Deduplicated by the gateway invoice/payment id, so
 * redelivered webhooks record it once. Billing details and the tax share
 * are taken from the membership's earlier orders.
 */
export async function recordRenewalPayment(input: {
  subscriptionId: string;
  gateway: "stripe" | "razorpay";
  /** App units (price × 100). */
  amount: number;
  currency: string;
  gatewayPaymentId?: string;
  /** Gateway invoice id (or payment id when there is no invoice). */
  gatewayOrderId: string;
  source: FulfillmentSource;
}): Promise<FulfillmentOutcome | null> {
  const nowIso = new Date().toISOString();
  const inserted = await mutate((d): Payment | null => {
    const duplicate = d.payments.some((p) => p.gatewayOrderId === input.gatewayOrderId || (!!input.gatewayPaymentId && p.gatewayPaymentId === input.gatewayPaymentId));
    if (duplicate) return null;
    const sub = d.subscriptions.find((s) => s.id === input.subscriptionId);
    if (!sub) return null;
    const plan = d.plans.find((p) => p.id === sub.planId);
    const user = d.users.find((u) => u.id === sub.userId);
    const earlier = d.payments
      .filter((p) => p.subscriptionId === sub.id && p.itemType === "plan")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const template = earlier.find((p) => p.amount > 0) ?? earlier[0];
    const taxAmount = template && template.amount > 0 && template.taxAmount > 0 ? Math.round((input.amount * template.taxAmount) / template.amount) : 0;
    const taken = new Set(d.payments.map((p) => p.orderId));
    let orderId = `ORD-${shortCode(2, 4)}`;
    while (taken.has(orderId)) orderId = `ORD-${shortCode(2, 4)}`;
    const row: Payment = {
      id: uid("pay"),
      orderId,
      userId: sub.userId,
      itemType: "plan",
      itemId: sub.planId,
      itemTitle: `${plan?.name ?? "Membership"} · renewal`,
      planId: sub.planId,
      subscriptionId: sub.id,
      originalAmount: input.amount - taxAmount,
      discountAmount: 0,
      taxAmount,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      billingName: template?.billingName ?? user?.name ?? "Member",
      address: template?.address,
      gstin: template?.gstin,
      pan: template?.pan,
      taxCountry: template?.taxCountry,
      taxRate: template?.taxRate,
      source: "Renewal",
      gateway: input.gateway,
      gatewayOrderId: input.gatewayOrderId,
      status: "pending",
      createdAt: nowIso,
    };
    d.payments.push(row);
    return { ...row };
  });
  if (!inserted) return null;
  return fulfillPayment(inserted.id, input.gatewayPaymentId, { gatewayOrderId: input.gatewayOrderId, source: input.source });
}

function describe(outcome: FulfillmentOutcome | null, what: string): MembershipEventOutcome {
  if (!outcome) return { handled: true, message: `${what}: already recorded` };
  if (!outcome.ok) return { handled: true, message: `${what}: ${outcome.error}` };
  if (outcome.data.accessFailed) return { handled: true, retry: true, message: `${what}: order ${outcome.data.payment.orderId} paid, access pending (retry requested)` };
  return { handled: true, message: `${what}: order ${outcome.data.payment.orderId} paid` };
}

/**
 * `invoice.paid`: the first invoice of a membership settles its checkout
 * order; every later invoice becomes a renewal order. Zero-amount invoices
 * (a trial starting) only refresh the subscription.
 */
export async function handleStripeInvoicePaid(invoice: StripeInvoice): Promise<MembershipEventOutcome> {
  if (!invoice.subscriptionId) return { handled: false, message: `invoice ${invoice.id} is not for a subscription` };
  const synced = await syncStripeSubscription(invoice.subscriptionId);
  const sub = synced.subscription;
  if (!sub) return { handled: false, message: `no membership for ${invoice.subscriptionId}` };
  if (invoice.amountPaid <= 0) return { handled: true, message: `membership ${sub.id}: zero-amount invoice` };

  const db = await getDb();
  const pi = invoice.paymentIntentId;
  const known = db.payments.find((p) => p.gatewayOrderId === invoice.id || (!!pi && p.gatewayPaymentId === pi));
  if (known) {
    if (known.status === "paid" || known.status === "refunded") return { handled: true, message: `invoice ${invoice.id}: already recorded on ${known.orderId}` };
    return describe(await fulfillPayment(known.id, pi, { source: "stripe_webhook" }), `invoice ${invoice.id}`);
  }

  if (invoice.billingReason === "subscription_create") {
    // The checkout order of this membership (the return URL may not have settled it yet).
    const order = db.payments.find((p) => p.subscriptionId === sub.id && p.itemType === "plan" && p.gateway === "stripe" && (p.status === "pending" || p.status === "failed") && p.amount > 0);
    if (order) {
      if (!amountMatches(order.amount, order.currency, invoice.amountPaid, invoice.currency)) {
        return { handled: true, message: `invoice ${invoice.id}: amount differs from order ${order.orderId}; left for review` };
      }
      return describe(await fulfillPayment(order.id, pi, { source: "stripe_webhook" }), `invoice ${invoice.id}`);
    }
  }

  const outcome = await recordRenewalPayment({
    subscriptionId: sub.id,
    gateway: "stripe",
    amount: fromGatewayAmount(invoice.amountPaid, invoice.currency),
    currency: invoice.currency,
    gatewayPaymentId: pi,
    gatewayOrderId: invoice.id,
    source: "stripe_webhook",
  });
  return describe(outcome, `renewal ${invoice.id}`);
}

/* ------------------------------------------------------------------ */
/* Razorpay                                                            */
/* ------------------------------------------------------------------ */

/** Fold a Razorpay subscription entity into its row (creating it from our order or the notes). */
export async function applyRazorpaySubscription(live: RazorpaySubscription, hints: { paymentId?: string } = {}): Promise<UpsertResult> {
  const snapshot = razorpaySnapshot(live);
  if (!snapshot) {
    const db = await getDb();
    const row = db.subscriptions.find((s) => s.gateway === "razorpay" && s.gatewaySubscriptionId === live.id);
    return { subscription: row ? { ...row } : null, created: false };
  }
  const fromOrder = await orderContext(hints.paymentId ?? live.notes.paymentId);
  return upsertGatewaySubscription({
    gateway: "razorpay",
    gatewaySubscriptionId: live.id,
    snapshot,
    userId: fromOrder.userId ?? live.notes.userId,
    planId: fromOrder.planId ?? live.notes.planId,
    paymentId: fromOrder.paymentId,
  });
}

export async function syncRazorpaySubscription(subscriptionId: string, hints: { paymentId?: string } = {}): Promise<UpsertResult & { live: RazorpaySubscription }> {
  const live = await fetchRazorpaySubscription(subscriptionId, { timeoutMs: 15_000 });
  return { ...(await applyRazorpaySubscription(live, hints)), live };
}

/** The pending checkout order of a Razorpay membership (its gateway order id is the subscription id). */
async function checkoutOrderFor(subscriptionId: string): Promise<Payment | null> {
  const db = await getDb();
  const row = db.payments.find((p) => p.itemType === "plan" && p.gatewayOrderId === subscriptionId);
  return row ? { ...row } : null;
}

export type MembershipSettleState =
  | { state: "paid"; payment: Payment; accessFailed?: boolean }
  | { state: "processing" }
  | { state: "pending" }
  | { state: "failed"; reason?: string }
  | { state: "error"; message: string };

function settled(res: FulfillmentOutcome): MembershipSettleState {
  if (!res.ok) return { state: "error", message: res.error };
  return { state: "paid", payment: res.data.payment, accessFailed: res.data.accessFailed };
}

/**
 * Settle the checkout order of a Razorpay membership from what Razorpay
 * reports: a trial settles as a zero-amount order once the mandate is
 * authorized; a charged first cycle settles with its captured payment (the
 * amount must match the order). `payment` is the captured first payment when
 * the caller already has it (checkout callback, `subscription.charged`).
 */
export async function settleRazorpayMembershipOrder(
  order: Payment,
  live: RazorpaySubscription,
  source: FulfillmentSource,
  firstPayment?: RazorpayPayment | null,
): Promise<MembershipSettleState> {
  await applyRazorpaySubscription(live, { paymentId: order.id });
  const snapshot = razorpaySnapshot(live);
  if (!snapshot) return live.status === "created" ? { state: "pending" } : { state: "failed", reason: "The membership was not set up." };
  if (snapshot.status === "cancelled" || snapshot.status === "expired") {
    if (order.status === "pending") await markPaymentFailed(order.id, "The membership checkout was not completed.");
    return { state: "failed", reason: "The membership was cancelled before it started." };
  }
  if (snapshot.status === "trialing") {
    await settleTrialOrder(order.id);
    return settled(await fulfillPayment(order.id, undefined, { gatewayOrderId: live.id, source }));
  }
  let charge = firstPayment && firstPayment.status === "captured" ? firstPayment : null;
  if (!charge && live.paidCount > 0) {
    const invoices = await listRazorpaySubscriptionInvoices(live.id, { timeoutMs: 10_000 });
    const first = invoices.filter((i) => i.status === "paid" && i.paymentId).sort((a, b) => (a.billingStart ?? 0) - (b.billingStart ?? 0))[0];
    if (first?.paymentId) charge = await fetchRazorpayPayment(first.paymentId, { timeoutMs: 10_000 });
  }
  if (!charge || charge.status !== "captured") return { state: "processing" };
  // Money that went back to the payer never settles an order (a partly refunded payment stays "captured").
  if (isRazorpayPaymentReversed(charge)) {
    const reason = "The first payment was refunded, so the membership order was not completed.";
    if (order.status === "pending") await markPaymentFailed(order.id, reason);
    return { state: "failed", reason };
  }
  if (!amountMatches(order.amount, order.currency, charge.amount, charge.currency)) {
    return { state: "error", message: "The payment amount did not match this order. Our team has been notified." };
  }
  return settled(await fulfillPayment(order.id, charge.id, { gatewayOrderId: live.id, source }));
}

/**
 * Razorpay Checkout's success callback for a membership. The signature
 * (HMAC of `payment_id|subscription_id` with the key secret) proves Razorpay
 * accepted the mandate for our subscription; the subscription and payment
 * are then read back before anything is granted.
 */
export async function confirmRazorpayMembership(
  order: Payment,
  input: { subscriptionId: string; paymentId: string; signature: string },
): Promise<MembershipSettleState> {
  if (!isRazorpayConfigured()) return { state: "error", message: "Razorpay is not configured." };
  if (!order.gatewayOrderId || order.gatewayOrderId !== input.subscriptionId) return { state: "error", message: "This payment does not belong to the order." };
  if (!verifyRazorpaySubscriptionSignature(input, razorpayEnv.keySecret)) {
    return { state: "error", message: "We couldn't verify this payment. If you were charged, contact support with your order ID." };
  }
  try {
    const [live, rp] = await Promise.all([
      fetchRazorpaySubscription(input.subscriptionId, { timeoutMs: 10_000 }),
      fetchRazorpayPayment(input.paymentId, { timeoutMs: 10_000 }).catch(() => null),
    ]);
    return await settleRazorpayMembershipOrder(order, live, "razorpay_checkout", rp);
  } catch (error) {
    if (error instanceof GatewayError && error.transient) return { state: "processing" };
    return { state: "error", message: error instanceof GatewayError ? error.message : "Razorpay could not be reached. Please try again in a moment." };
  }
}

/** Status check for a pending Razorpay membership order (order page, admin "Check status"). */
export async function syncRazorpayMembershipOrder(order: Payment, source: FulfillmentSource, timeoutMs = 10_000): Promise<MembershipSettleState> {
  if (!order.gatewayOrderId) return { state: "pending" };
  const live = await fetchRazorpaySubscription(order.gatewayOrderId, { timeoutMs });
  return settleRazorpayMembershipOrder(order, live, source);
}

/**
 * Razorpay `subscription.*` webhooks. The subscription is read back from the
 * API (payloads can be stale); `subscription.charged` settles the checkout
 * order of the first cycle or records a renewal order for later cycles.
 */
export async function handleRazorpaySubscriptionEvent(event: string, entity: RazorpaySubscription, payment: RazorpayPayment | null): Promise<MembershipEventOutcome> {
  const live = await fetchRazorpaySubscription(entity.id, { timeoutMs: 15_000 });
  const order = await checkoutOrderFor(live.id);

  if (order && order.status === "pending") {
    const state = await settleRazorpayMembershipOrder(order, live, "razorpay_webhook", event === "subscription.charged" ? payment : null);
    if (state.state === "paid" && state.accessFailed) return { handled: true, retry: true, message: `order ${order.orderId}: paid, access pending (retry requested)` };
    return { handled: true, message: `order ${order.orderId}: ${state.state}` };
  }

  const synced = await applyRazorpaySubscription(live, { paymentId: order?.id });
  const sub = synced.subscription;
  if (!sub) return { handled: false, message: `no membership for ${live.id}` };
  if (event !== "subscription.charged" || !payment || payment.status !== "captured") return { handled: true, message: `membership ${sub.id}: ${sub.status}` };

  // The first cycle's charge settled the checkout order already; anything else is a renewal.
  const db = await getDb();
  if (db.payments.some((p) => p.gatewayPaymentId === payment.id)) return { handled: true, message: `payment ${payment.id}: already recorded` };
  const outcome = await recordRenewalPayment({
    subscriptionId: sub.id,
    gateway: "razorpay",
    amount: fromGatewayAmount(payment.amount, payment.currency),
    currency: payment.currency,
    gatewayPaymentId: payment.id,
    gatewayOrderId: payment.invoiceId ?? payment.id,
    source: "razorpay_webhook",
  });
  return describe(outcome, `renewal ${payment.id}`);
}
