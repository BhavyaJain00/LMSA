import "server-only";
import type { Database, Payment, Settings } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { maskSecret, razorpayEnv, stripeEnv } from "@/lib/server-env";
import { formatDate, formatPrice, toDateKey } from "@/lib/utils";
import { notifyMany, type NotifyInput } from "@/lib/services/notifications";
import { amountMatches, fromGatewayAmount, toGatewayAmount } from "./amounts";
import { GatewayError } from "./http";
import { verifyRazorpayPaymentSignature } from "./signatures";
import { couponProblem } from "./coupon-rules";
import {
  cancelStripeSubscriptionNow,
  createStripeCheckoutSession,
  createStripeInstallmentSession,
  createStripeRefund,
  expireStripeCheckoutSession,
  isActiveStripeRefund,
  isStripeConfigured,
  isStripePaymentIntentId,
  isStripeSessionId,
  isStripeSessionPaid,
  isStripeWebhookConfigured,
  listStripeRefunds,
  pingStripe,
  retrieveStripeCheckoutSession,
  retrieveStripePaymentIntent,
  retrieveStripeSubscription,
  stripeDashboardPaymentUrl,
  stripeMode,
  stripeSettlement,
  type StripeCheckoutSession,
} from "./stripe";
import {
  cancelRazorpaySubscription,
  captureRazorpayPayment,
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayOrder,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  isActiveRazorpayRefund,
  isRazorpayConfigured,
  isRazorpayOrderId,
  isRazorpayPaymentReversed,
  isRazorpaySubscriptionId,
  isRazorpayWebhookConfigured,
  listRazorpayRefunds,
  pingRazorpay,
  razorpayDashboardPaymentUrl,
  razorpayMode,
  razorpayPublicKeyId,
  type RazorpayOrder,
  type RazorpayPayment,
} from "./razorpay";
import {
  closeReversedPayment,
  fulfillPayment,
  isGatewayPaymentReference,
  markPaymentFailed,
  type FulfillmentOutcome,
  type FulfillmentSource,
} from "./fulfillment";
import type { CheckoutNext, GatewayStatusView, RazorpayLaunchOptions, RealGateway } from "./types";
import {
  applyStripeSubscription,
  isRecurringMembershipOrder,
  settleRazorpayMembershipOrder,
  settleTrialOrder,
  startMembershipCheckout,
  syncRazorpayMembershipOrder,
} from "@/lib/commerce/memberships";
import { bundleCourses } from "@/lib/commerce/bundles";
import { autoChargeSubscriptionId, isInstallmentOrder, isValidInstallmentPlan } from "@/lib/commerce/installments";
import { adoptStripeInstallmentSubscription, syncStripeInstallmentSubscription } from "@/lib/commerce/installment-gateway";
import { bumpsOf, chargeAmount, isOrderBump } from "@/lib/commerce/upsells";

/**
 * Gateway abstraction used by checkout, the return/webhook handlers and the
 * admin screens. Stripe and Razorpay are called directly through their REST
 * APIs; "manual" and "none" need no API and are always available, so the
 * platform keeps working without any keys configured.
 */

export type GatewayId = Settings["commerce"]["paymentGateway"];

export const REAL_GATEWAYS: readonly RealGateway[] = ["stripe", "razorpay"];

export const GATEWAY_NAMES: Record<RealGateway, string> = { stripe: "Stripe", razorpay: "Razorpay" };

export function isRealGateway(gateway: string | undefined | null): gateway is RealGateway {
  return gateway === "stripe" || gateway === "razorpay";
}

/** Whether a gateway can take payments right now (keys present and well-formed). */
export function isConfigured(gateway: string): boolean {
  switch (gateway) {
    case "stripe":
      return isStripeConfigured();
    case "razorpay":
      return isRazorpayConfigured();
    case "manual":
    case "none":
      return true;
    default:
      return false;
  }
}

export function gatewayMode(gateway: string): "test" | "live" | null {
  if (gateway === "stripe") return stripeMode();
  if (gateway === "razorpay") return razorpayMode();
  return null;
}

/** Absolute URL on this deployment (APP_URL). */
export function absoluteUrl(path: string): string {
  return `${siteConfig.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Where the gateway sends the learner back after paying or cancelling. */
export function checkoutUrls(payment: Pick<Payment, "orderId" | "gateway">): { successUrl: string; cancelUrl: string } {
  const order = encodeURIComponent(payment.orderId);
  return {
    successUrl: payment.gateway === "stripe" ? absoluteUrl("/api/payments/stripe/return?session_id={CHECKOUT_SESSION_ID}") : absoluteUrl(`/billing/success/${order}`),
    cancelUrl: absoluteUrl(`/billing/cancelled?order=${order}`),
  };
}

/** Link to the payment in the gateway dashboard, for administrators. */
export function paymentDashboardUrl(payment: Pick<Payment, "gateway" | "gatewayPaymentId">): string | null {
  if (!payment.gatewayPaymentId || !isGatewayPaymentReference(payment.gateway, payment.gatewayPaymentId)) return null;
  return payment.gateway === "stripe" ? stripeDashboardPaymentUrl(payment.gatewayPaymentId) : razorpayDashboardPaymentUrl(payment.gatewayPaymentId);
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

function itemDetails(db: Database, payment: Payment): { description?: string; imageUrl?: string } {
  if (payment.itemType === "gift") {
    const gift = db.gifts.find((g) => g.id === payment.itemId);
    const target = gift?.itemType === "bundle" ? db.bundles.find((b) => b.id === gift.itemId) : gift?.itemType === "course" ? db.courses.find((c) => c.id === gift.itemId) : undefined;
    return { description: gift ? `A gift for ${gift.recipientName || gift.recipientEmail}, delivered by email with a redeem code` : undefined, imageUrl: target?.imageUrl };
  }
  if (payment.itemType === "plan") {
    const plan = db.plans.find((p) => p.id === (payment.planId ?? payment.itemId));
    return { description: plan ? `Membership: ${plan.name}` : undefined };
  }
  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    return { description: batch?.description, imageUrl: batch?.imageUrl };
  }
  if (payment.itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === payment.itemId);
    const courses = bundle ? bundleCourses(bundle, db.courses) : [];
    return {
      description: courses.length ? `Bundle of ${courses.length} courses: ${courses.map((c) => c.title).join(", ")}` : undefined,
      imageUrl: bundle?.imageUrl ?? courses.find((c) => c.imageUrl)?.imageUrl,
    };
  }
  const course = db.courses.find((c) => c.id === payment.itemId);
  return {
    description: payment.itemType === "certificate" ? `Certificate of completion for ${course?.title ?? payment.itemTitle}` : course?.shortIntroduction,
    imageUrl: course?.imageUrl,
  };
}

/** Public absolute URL for an image (relative uploads are resolved against APP_URL). */
function publicImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return absoluteUrl(url);
  return undefined;
}

async function saveCheckoutAttempt(paymentId: string, gateway: RealGateway, gatewayOrderId: string, checkoutUrl?: string): Promise<boolean> {
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

function razorpayOptions(db: Database, payment: Payment, target: { order: RazorpayOrder } | { subscriptionId: string }): RazorpayLaunchOptions {
  const user = db.users.find((u) => u.id === payment.userId);
  const brand = db.settings.brand;
  const order = "order" in target ? target.order : null;
  return {
    keyId: razorpayPublicKeyId(),
    ...(order ? { razorpayOrderId: order.id } : { razorpaySubscriptionId: (target as { subscriptionId: string }).subscriptionId }),
    orderId: payment.orderId,
    amount: order ? order.amount : toGatewayAmount(payment.amount, payment.currency),
    currency: order?.currency || payment.currency.toUpperCase(),
    name: brand.name,
    description: payment.itemTitle.slice(0, 255),
    image: publicImageUrl(brand.logoUrl),
    prefill: { name: payment.billingName, email: user?.email ?? "" },
    themeColor: /^#[0-9a-f]{6}$/i.test(brand.accentColor) ? brand.accentColor : undefined,
  };
}

/**
 * Start paying `payment` with its gateway. Stripe returns the hosted checkout
 * URL, Razorpay the options for its checkout modal; manual and free orders go
 * straight to the order page. The gateway session/order id is stored on the
 * payment so returns and webhooks can be matched to it.
 */
export async function createCheckout(payment: Payment, urls: { successUrl: string; cancelUrl: string }): Promise<CheckoutNext> {
  if (payment.status !== "pending") throw new GatewayError(payment.gateway, "This order can no longer be paid.");
  if (!isRealGateway(payment.gateway)) return { kind: "redirect", url: urls.successUrl };
  if (!isConfigured(payment.gateway)) {
    throw new GatewayError(GATEWAY_NAMES[payment.gateway], `${GATEWAY_NAMES[payment.gateway]} is not available right now. Please try again later or contact support.`);
  }
  if (isOrderBump(payment)) throw new GatewayError(payment.gateway, "This add-on is paid together with its main order.");
  const db = await getDb();
  // Order bumps still open are charged in the same checkout as their main order.
  const bumps = bumpsOf(db.payments, payment).filter((b) => b.status === "pending");
  const amount = toGatewayAmount(chargeAmount(db.payments, payment), payment.currency);

  // First order of a monthly/yearly membership: a recurring gateway subscription.
  const plan = payment.itemType === "plan" ? db.plans.find((p) => p.id === (payment.planId ?? payment.itemId)) : undefined;
  if (isRecurringMembershipOrder(payment, plan)) {
    const started = await startMembershipCheckout(payment, urls);
    if (started.gateway === "stripe") return { kind: "redirect", url: started.url };
    return { kind: "razorpay", options: razorpayOptions(db, payment, { subscriptionId: started.subscriptionId }) };
  }

  if (payment.gateway === "stripe") {
    const user = db.users.find((u) => u.id === payment.userId);
    const details = itemDetails(db, payment);
    // First part of a course paid in installments: a subscription that charges the remaining parts by itself.
    const terms = isInstallmentOrder(payment) && payment.installmentNumber === 1 ? db.courses.find((c) => c.id === payment.itemId)?.installments : undefined;
    if (isValidInstallmentPlan(terms)) {
      const session = await createStripeInstallmentSession({
        paymentId: payment.id,
        orderId: payment.orderId,
        userId: payment.userId,
        courseId: payment.itemId,
        title: payment.itemTitle.replace(/ · payment \d+ of \d+$/, ""),
        description: details.description,
        imageUrl: publicImageUrl(details.imageUrl),
        unitAmount: amount,
        currency: payment.currency,
        intervalDays: terms.intervalDays,
        count: payment.installmentsTotal!,
        customerEmail: user?.email,
        successUrl: urls.successUrl,
        cancelUrl: urls.cancelUrl,
      });
      if (!(await saveCheckoutAttempt(payment.id, "stripe", session.id, session.url ?? undefined))) {
        await expireStripeCheckoutSession(session.id).catch(() => undefined);
        throw new GatewayError("Stripe", "This order can no longer be paid.");
      }
      return { kind: "redirect", url: session.url! };
    }
    const session = await createStripeCheckoutSession({
      paymentId: payment.id,
      orderId: payment.orderId,
      title: payment.itemTitle,
      description: details.description,
      imageUrl: publicImageUrl(details.imageUrl),
      unitAmount: toGatewayAmount(payment.amount, payment.currency),
      extraItems: bumps.map((b) => {
        const extra = itemDetails(db, b);
        return { title: b.itemTitle, description: extra.description, imageUrl: publicImageUrl(extra.imageUrl), unitAmount: toGatewayAmount(b.amount, b.currency) };
      }),
      currency: payment.currency,
      customerEmail: user?.email,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    if (!(await saveCheckoutAttempt(payment.id, "stripe", session.id, session.url ?? undefined))) {
      await expireStripeCheckoutSession(session.id).catch(() => undefined);
      throw new GatewayError("Stripe", "This order can no longer be paid.");
    }
    return { kind: "redirect", url: session.url! };
  }

  const order = await createRazorpayOrder({ amount, currency: payment.currency, receipt: payment.orderId, paymentId: payment.id, orderId: payment.orderId });
  if (!(await saveCheckoutAttempt(payment.id, "razorpay", order.id))) throw new GatewayError("Razorpay", "This order can no longer be paid.");
  return { kind: "razorpay", options: razorpayOptions(db, payment, { order }) };
}

export type ResumeResult = { ok: true; next: CheckoutNext; message?: string } | { ok: false; error: string };

/**
 * Continue paying a pending order ("Complete payment", "Try again"). Reuses
 * the open Stripe session or Razorpay order when possible, starts a new one
 * when the old one expired, and fulfils the order instead when it turns out
 * to be paid already.
 */
export async function resumeCheckout(payment: Payment): Promise<ResumeResult> {
  const orderPage = `/billing/success/${encodeURIComponent(payment.orderId)}`;
  if (payment.status === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "This order is already paid." };
  if (payment.status !== "pending") return { ok: false, error: "This order was closed. Start a new checkout to buy it again." };
  if (!isRealGateway(payment.gateway)) return { ok: true, next: { kind: "redirect", url: orderPage } };
  const name = GATEWAY_NAMES[payment.gateway];
  if (!isConfigured(payment.gateway)) return { ok: false, error: `${name} payments are no longer available. Cancel this order and check out again.` };

  try {
    // An installment that a Stripe subscription charges by itself: pay its open invoice, never a second checkout.
    const planSubscription = isInstallmentOrder(payment) ? autoChargeSubscriptionId(payment) : null;
    if (planSubscription) {
      const synced = await syncStripeInstallmentSubscription(planSubscription, (await getDb()).settings.commerce.paymentGateway);
      const current = (await getFreshPayment(payment.id)) ?? payment;
      if (current.status === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment went through." };
      const invoice = synced.live.latestInvoice;
      if (autoChargeSubscriptionId(current)) {
        if (invoice && invoice.status === "open" && invoice.hostedInvoiceUrl) return { ok: true, next: { kind: "redirect", url: invoice.hostedInvoiceUrl } };
        if (Date.parse(current.createdAt) > Date.now()) {
          return { ok: false, error: `This payment is charged to your card automatically on ${formatDate(current.createdAt)}. There is nothing to do until then.` };
        }
        return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Stripe is collecting this payment. It can take a few minutes." };
      }
      // The subscription ended: the part is paid like any other order from now on.
      if (!isRealGateway(current.gateway)) return { ok: true, next: { kind: "redirect", url: orderPage } };
      return { ok: true, next: await createCheckout(current, checkoutUrls(current)) };
    }

    if (payment.gateway === "stripe") {
      if (isStripeSessionId(payment.gatewayOrderId)) {
        let session = await retrieveStripeCheckoutSession(payment.gatewayOrderId);
        // The learner's session is still open: send them back to it.
        if (session.status === "open" && session.url) return { ok: true, next: { kind: "redirect", url: session.url } };
        // Never leave an open session behind a new one (it could be paid twice).
        if (session.status === "open") session = await expireStripeCheckoutSession(session.id);
        const state = await reconcileStripeSession(payment, session, "sync");
        if (state.state === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment went through." };
        if (state.state === "processing") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment is still being processed." };
        if (state.state === "error") return { ok: false, error: state.message };
        // A completed session whose payment was refunded or disputed closed the order for good.
        if (state.state === "failed" && session.status !== "expired") return { ok: false, error: closedMessage(state.reason) };
        // The session expired (which failed the order): reopen the order for a new attempt.
        const reopened = await reopenFailedOrder(payment.id);
        if (!reopened.ok) return { ok: false, error: reopened.error };
      }
      const current = (await getFreshPayment(payment.id)) ?? payment;
      return { ok: true, next: await createCheckout(current, checkoutUrls(current)) };
    }

    // Razorpay membership: the subscription can be authorized until it is used.
    if (isRazorpaySubscriptionId(payment.gatewayOrderId)) {
      const state = await syncRazorpayMembershipOrder(payment, "sync");
      if (state.state === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your membership is active." };
      if (state.state === "processing") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment is still being processed." };
      if (state.state === "error") return { ok: false, error: state.message };
      if (state.state === "failed") return { ok: false, error: closedMessage(state.reason) };
      const db = await getDb();
      return { ok: true, next: { kind: "razorpay", options: razorpayOptions(db, payment, { subscriptionId: payment.gatewayOrderId }) } };
    }

    // Razorpay: an order can be attempted many times until it is paid.
    if (isRazorpayOrderId(payment.gatewayOrderId)) {
      const state = await syncRazorpayOrder(payment, "sync");
      if (state.state === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment went through." };
      if (state.state === "error") return { ok: false, error: state.message };
      if (state.state === "failed") return { ok: false, error: closedMessage(state.reason) };
      const order = await fetchRazorpayOrder(payment.gatewayOrderId);
      if (order.status !== "paid" && amountMatches(await expectedCharge(payment), payment.currency, order.amount, order.currency)) {
        const db = await getDb();
        return { ok: true, next: { kind: "razorpay", options: razorpayOptions(db, payment, { order }) } };
      }
    }
    return { ok: true, next: await createCheckout(payment, checkoutUrls(payment)) };
  } catch (error) {
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}

/** What the gateway should have charged for `payment`: its amount plus its open order bumps. */
async function expectedCharge(payment: Payment): Promise<number> {
  return chargeAmount((await getDb()).payments, payment);
}

async function getFreshPayment(paymentId: string): Promise<Payment | null> {
  const db = await getDb();
  const row = db.payments.find((p) => p.id === paymentId);
  return row ? { ...row } : null;
}

const ORDER_CLOSED = "This order was closed. Start a new checkout to buy it again.";

function closedMessage(reason: string | undefined): string {
  return reason ? `${reason} Start a new checkout to buy it again.` : ORDER_CLOSED;
}

/**
 * A Stripe session that merely expired leaves the order resumable. Reopening
 * reserves the order's coupon use again, so the coupon is re-checked in the
 * same serialized write (another checkout may have taken the last use while
 * the order was closed).
 */
export async function reopenFailedOrder(paymentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return mutate((d): { ok: true } | { ok: false; error: string } => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { ok: false, error: ORDER_CLOSED };
    if (row.status === "pending") return { ok: true };
    if (row.status !== "failed") return { ok: false, error: ORDER_CLOSED };
    if (row.couponId) {
      const problem = couponProblem(
        d.coupons.find((c) => c.id === row.couponId),
        { type: row.itemType, id: row.itemId, currency: row.currency },
        { payments: d.payments, userId: row.userId, defaultCurrency: d.settings.commerce.defaultCurrency, today: toDateKey() },
        row.couponCode,
      );
      if (problem) return { ok: false, error: closedMessage(problem) };
    }
    row.status = "pending";
    row.failureReason = undefined;
    // Order bumps cancelled with the order are offered again in the new checkout.
    for (const bump of bumpsOf(d.payments, row)) {
      if (bump.status !== "failed") continue;
      bump.status = "pending";
      bump.failureReason = undefined;
    }
    return { ok: true };
  });
}

/** Friendly message for a gateway failure (never includes secrets). */
export function gatewayErrorMessage(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  console.error("[payments] unexpected gateway error", error instanceof Error ? error.message : error);
  return "The payment provider could not be reached. Please try again in a moment.";
}

/* ------------------------------------------------------------------ */
/* Reconciliation (return URLs, webhooks, status checks)               */
/* ------------------------------------------------------------------ */

export type SyncState =
  /** `accessFailed`: the order is paid but granting access failed; confirming it again retries. */
  | { state: "paid"; payment: Payment; accessFailed?: boolean }
  | { state: "processing" }
  | { state: "pending" }
  | { state: "failed"; reason?: string }
  | { state: "error"; message: string };

async function alertAdmins(input: NotifyInput): Promise<void> {
  const db = await getDb();
  const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
  await notifyMany(admins, input);
}

async function reportAmountMismatch(payment: Payment, received: string): Promise<SyncState> {
  console.error(`[payments] amount mismatch on order ${payment.orderId}: expected ${payment.amount} ${payment.currency}, received ${received}`);
  await alertAdmins({
    type: "system",
    subject: `Payment amount mismatch on order ${payment.orderId}`,
    message: `Expected ${formatPrice(payment.amount, payment.currency)} but the gateway reported ${received}. The order was not fulfilled; review it in the gateway dashboard.`,
    link: `/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`,
    dedupeKey: `amount-mismatch:${payment.id}:${received}`,
  });
  return { state: "error", message: "The payment amount did not match this order. Our team has been notified." };
}

/**
 * Money arrived through a gateway for a checkout that matches no order here
 * (the order was deleted while the learner could still pay). Administrators
 * are told once per payment so it can be refunded or recorded by hand.
 */
export async function reportUnmatchedPayment(info: { gateway: RealGateway; paymentRef: string; checkoutRef?: string; amount?: number; currency?: string }): Promise<void> {
  const name = GATEWAY_NAMES[info.gateway];
  const amount =
    info.amount !== undefined && info.currency ? formatPrice(fromGatewayAmount(info.amount, info.currency), info.currency.toUpperCase()) : "a payment";
  console.warn(`[payments] ${name} payment ${info.paymentRef} matches no order`);
  await alertAdmins({
    type: "system",
    subject: `${name} payment without an order`,
    message: `${name} received ${amount} (${info.paymentRef}${info.checkoutRef && info.checkoutRef !== info.paymentRef ? `, checkout ${info.checkoutRef}` : ""}) for a checkout that no longer matches an order here; it may have been deleted. Refund it from the ${name} dashboard or record it under Transactions.`,
    link: "/admin/settings/transactions",
    dedupeKey: `unmatched-payment:${info.paymentRef}`,
  });
}

function paidState(res: FulfillmentOutcome): SyncState {
  if (!res.ok) return { state: "error", message: res.error };
  return { state: "paid", payment: res.data.payment, accessFailed: res.data.accessFailed };
}

async function currentRow(payment: Payment): Promise<Payment> {
  return (await getFreshPayment(payment.id)) ?? payment;
}

/** Orders a gateway payment may still turn into paid ones (fulfilment moves pending and failed orders to paid). */
function isSettling(row: Payment): boolean {
  return row.status === "pending" || row.status === "failed";
}

/** The gateway payment of an unpaid order was refunded or disputed: close the order instead of fulfilling it. */
async function closeReversed(payment: Payment, gateway: RealGateway, reason: string, gatewayPaymentId: string | undefined): Promise<SyncState> {
  const res = await closeReversedPayment(payment.id, { reason, gatewayName: GATEWAY_NAMES[gateway], gatewayPaymentId });
  if (res.status === "paid" && res.payment) return { state: "paid", payment: res.payment };
  if (res.status === "missing") return { state: "error", message: "Order not found." };
  if (res.status === "refunded") return { state: "failed", reason: "This order was refunded." };
  return { state: "failed", reason };
}

/** Apply what a Stripe Checkout Session says about `payment`. */
export async function reconcileStripeSession(payment: Payment, session: StripeCheckoutSession, source: FulfillmentSource): Promise<SyncState> {
  const belongs = session.metadata.paymentId === payment.id || session.clientReferenceId === payment.id;
  if (!belongs) return { state: "error", message: "This checkout session does not belong to the order." };
  if (session.mode === "subscription") {
    return isInstallmentOrder(payment) ? reconcileStripeInstallmentSession(payment, session, source) : reconcileStripeMembershipSession(payment, session, source);
  }

  if (isStripeSessionPaid(session)) {
    if (!amountMatches(await expectedCharge(payment), payment.currency, session.amountTotal, session.currency)) {
      return reportAmountMismatch(payment, `${session.amountTotal ?? "?"} ${(session.currency ?? "?").toUpperCase()} (smallest unit)`);
    }
    if (isSettling(await currentRow(payment))) {
      // The session keeps saying "paid" after a refund or a dispute (and Stripe resends old
      // snapshots for days), so only a PaymentIntent whose money is still here unlocks the order.
      if (!isStripePaymentIntentId(session.paymentIntentId)) return { state: "processing" };
      const settlement = stripeSettlement(await retrieveStripePaymentIntent(session.paymentIntentId, { timeoutMs: 15_000 }));
      if (settlement.kind === "reversed") {
        return closeReversed(payment, "stripe", `${settlement.reason} The order was not completed.`, session.paymentIntentId);
      }
      if (settlement.kind === "incomplete") return { state: "processing" };
    }
    return paidState(await fulfillPayment(payment.id, session.paymentIntentId, { gatewayOrderId: session.id, source }));
  }
  if (session.status === "complete") return { state: "processing" };
  if (session.status === "expired") {
    const reason = "The checkout session expired before the payment was completed.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: session.id });
    return { state: "failed", reason };
  }
  return { state: "pending" };
}

function reversedReason(rp: RazorpayPayment): string {
  const full = rp.status === "refunded" || rp.refundStatus === "full";
  return `${full ? "The payment was refunded." : "The payment was partially refunded."} The order was not completed.`;
}

/**
 * Apply what a Razorpay payment says about `payment` (captures authorized
 * payments). `live` means `rp` was just read from the API; webhook payloads
 * are snapshots, so they are read again before they may unlock an order.
 */
export async function reconcileRazorpayPayment(payment: Payment, rp: RazorpayPayment, source: FulfillmentSource, opts: { live?: boolean } = {}): Promise<SyncState> {
  const belongs = (!!rp.orderId && rp.orderId === payment.gatewayOrderId) || rp.notes.paymentId === payment.id;
  if (!belongs) return { state: "error", message: "This Razorpay payment does not belong to the order." };

  const row = await currentRow(payment);
  const settling = isSettling(row);
  let current = rp;
  // A redelivered "payment.captured" can describe a payment that was refunded since.
  if (settling && !opts.live && current.status !== "failed") current = await fetchRazorpayPayment(current.id);

  if (isRazorpayPaymentReversed(current)) {
    // Money that went back to the payer never unlocks an order (a refunded payment stays `captured: true`).
    if (settling) return closeReversed(payment, "razorpay", reversedReason(current), current.id);
    return row.status === "paid" ? { state: "paid", payment: row } : { state: "failed", reason: "This order was refunded." };
  }
  if (current.status === "authorized") {
    if (!settling) {
      // The order was settled meanwhile (confirmed by hand, refunded): don't capture a second payment.
      // Razorpay releases uncaptured authorizations to the payer on its own.
      if (row.gatewayPaymentId !== current.id) {
        await alertAdmins({
          type: "system",
          subject: `Extra Razorpay payment on order ${row.orderId} was not captured`,
          message: `${row.billingName} authorized another payment (${current.id}) for an order that is already ${row.status}. It was not captured, so Razorpay releases it back to the payer automatically.`,
          link: `/admin/settings/transactions?search=${encodeURIComponent(row.orderId)}`,
          dedupeKey: `uncaptured-extra:${current.id}`,
        });
      }
      return row.status === "paid" ? { state: "paid", payment: row } : { state: "failed", reason: "This order was refunded." };
    }
    if (!amountMatches(await expectedCharge(payment), payment.currency, current.amount, current.currency)) {
      return reportAmountMismatch(payment, `${current.amount} ${current.currency} (smallest unit)`);
    }
    try {
      current = await captureRazorpayPayment(current.id, current.amount, current.currency);
    } catch (error) {
      // Already captured by the account's auto-capture in the meantime: read it again.
      if (error instanceof GatewayError && error.status === 400) current = await fetchRazorpayPayment(current.id);
      else throw error;
    }
    if (isRazorpayPaymentReversed(current)) return closeReversed(payment, "razorpay", reversedReason(current), current.id);
  }
  if (current.status === "captured") {
    if (!amountMatches(await expectedCharge(payment), payment.currency, current.amount, current.currency)) {
      return reportAmountMismatch(payment, `${current.amount} ${current.currency} (smallest unit)`);
    }
    return paidState(await fulfillPayment(payment.id, current.id, { gatewayOrderId: current.orderId, source }));
  }
  if (current.status === "failed") {
    const reason = current.errorDescription ?? "The payment was declined.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: current.orderId });
    return { state: "failed", reason };
  }
  return { state: "pending" };
}

/**
 * Check a Razorpay order's payments and settle the order when one succeeded.
 * Failed attempts leave it resumable; a payment that was refunded closes it.
 */
async function syncRazorpayOrder(payment: Payment, source: FulfillmentSource, timeoutMs?: number): Promise<SyncState> {
  if (!isRazorpayOrderId(payment.gatewayOrderId)) return { state: "pending" };
  const attempts = await fetchRazorpayOrderPayments(payment.gatewayOrderId, { timeoutMs });
  const pick =
    attempts.find((p) => p.status === "captured" && !isRazorpayPaymentReversed(p)) ??
    attempts.find((p) => p.status === "authorized") ??
    attempts.find((p) => isRazorpayPaymentReversed(p));
  if (pick) return reconcileRazorpayPayment(payment, pick, source, { live: true });
  return { state: "pending" };
}

/**
 * Ask the gateway about a pending order and settle it (paid, failed, still
 * open). Used when learners come back to the order page and by the admin
 * "Check status" button, so orders complete even when webhooks are missing.
 */
export async function syncPaymentStatus(payment: Payment, opts: { timeoutMs?: number; source?: FulfillmentSource } = {}): Promise<SyncState> {
  if (payment.status === "paid") return { state: "paid", payment };
  if (payment.status !== "pending" || !isRealGateway(payment.gateway) || !isConfigured(payment.gateway)) return { state: "pending" };
  const source = opts.source ?? "sync";
  try {
    if (payment.gateway === "stripe") {
      if (!isStripeSessionId(payment.gatewayOrderId)) return { state: "pending" };
      const session = await retrieveStripeCheckoutSession(payment.gatewayOrderId, { timeoutMs: opts.timeoutMs });
      return await reconcileStripeSession(payment, session, source);
    }
    if (isRazorpaySubscriptionId(payment.gatewayOrderId)) return await syncRazorpayMembershipOrder(payment, source, opts.timeoutMs);
    return await syncRazorpayOrder(payment, source, opts.timeoutMs);
  } catch (error) {
    return { state: "error", message: gatewayErrorMessage(error) };
  }
}

/**
 * Close the open gateway checkout of a pending order so it can no longer be
 * paid (learner cancels, admin confirms a manual payment). When the gateway
 * reports that it was paid in the meantime, the order is fulfilled instead.
 * `reached` is false when the gateway could not be contacted.
 */
export async function closeGatewayCheckout(payment: Payment): Promise<{ paid: boolean; reached: boolean }> {
  if (payment.status !== "pending" || !isRealGateway(payment.gateway) || !payment.gatewayOrderId) return { paid: false, reached: true };
  if (!isConfigured(payment.gateway)) return { paid: false, reached: false };
  try {
    if (payment.gateway === "stripe") {
      if (!isStripeSessionId(payment.gatewayOrderId)) return { paid: false, reached: true };
      const session = await expireStripeCheckoutSession(payment.gatewayOrderId);
      if (isStripeSessionPaid(session) || session.status === "complete") {
        const state = await reconcileStripeSession(payment, session, "sync");
        return { paid: state.state === "paid" || state.state === "processing", reached: true };
      }
      return { paid: false, reached: true };
    }
    if (isRazorpaySubscriptionId(payment.gatewayOrderId)) {
      // A membership nobody authorized yet is cancelled so it can no longer be paid.
      const live = await fetchRazorpaySubscription(payment.gatewayOrderId, { timeoutMs: 10_000 });
      if (live.status === "created") {
        await cancelRazorpaySubscription(live.id, false);
        return { paid: false, reached: true };
      }
      const state = await settleRazorpayMembershipOrder(payment, live, "sync");
      return { paid: state.state === "paid" || state.state === "processing", reached: state.state !== "error" };
    }
    const state = await syncRazorpayOrder(payment, "sync");
    return { paid: state.state === "paid", reached: state.state !== "error" };
  } catch {
    return { paid: false, reached: false };
  }
}

/**
 * A completed Checkout Session in subscription mode (a membership). The
 * subscription row is written first, so access starts as soon as the order
 * settles: a trial settles as a zero-amount order; a charged first invoice
 * must match the order and its PaymentIntent must still hold the money.
 */
async function reconcileStripeMembershipSession(payment: Payment, session: StripeCheckoutSession, source: FulfillmentSource): Promise<SyncState> {
  if (session.status === "expired") {
    const reason = "The checkout session expired before the membership was started.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: session.id });
    return { state: "failed", reason };
  }
  if (session.status !== "complete") return { state: "pending" };
  if (!session.subscriptionId) return { state: "processing" };

  const live = await retrieveStripeSubscription(session.subscriptionId, { timeoutMs: 15_000 });
  const synced = await applyStripeSubscription(live, { paymentId: payment.id });
  if (!synced.subscription) return { state: "processing" };

  const charged = (session.amountTotal ?? 0) > 0;
  if (!charged) {
    if (session.paymentStatus !== "no_payment_required" && session.paymentStatus !== "paid") return { state: "processing" };
    await settleTrialOrder(payment.id);
    return paidState(await fulfillPayment(payment.id, undefined, { gatewayOrderId: session.id, source }));
  }
  return settleFirstSubscriptionCharge(payment, session, live.latestInvoice?.paymentIntentId, source, "The membership was not started.");
}

/**
 * Settle the order of a subscription-mode Checkout Session from its first
 * charge: the amount must match the order and the PaymentIntent must still
 * hold the money. `notStarted` completes the reason when it was reversed.
 */
async function settleFirstSubscriptionCharge(
  payment: Payment,
  session: StripeCheckoutSession,
  pi: string | undefined,
  source: FulfillmentSource,
  notStarted: string,
): Promise<SyncState> {
  if (session.paymentStatus !== "paid") return { state: "processing" };
  if (!amountMatches(payment.amount, payment.currency, session.amountTotal, session.currency)) {
    return reportAmountMismatch(payment, `${session.amountTotal ?? "?"} ${(session.currency ?? "?").toUpperCase()} (smallest unit)`);
  }
  if (isSettling(await currentRow(payment))) {
    if (!isStripePaymentIntentId(pi)) return { state: "processing" };
    const settlement = stripeSettlement(await retrieveStripePaymentIntent(pi, { timeoutMs: 15_000 }));
    if (settlement.kind === "reversed") return closeReversed(payment, "stripe", `${settlement.reason} ${notStarted}`, pi);
    if (settlement.kind === "incomplete") return { state: "processing" };
  }
  return paidState(await fulfillPayment(payment.id, pi, { gatewayOrderId: session.id, source }));
}

/**
 * A completed Checkout Session for a course paid in installments: its first
 * charge settles part 1, which schedules the remaining parts; they are then
 * tied to the subscription, which charges them on its billing dates and ends
 * after the last one. A first charge that was refunded or disputed closes the
 * order and stops the subscription.
 */
async function reconcileStripeInstallmentSession(payment: Payment, session: StripeCheckoutSession, source: FulfillmentSource): Promise<SyncState> {
  if (session.status === "expired") {
    const reason = "The checkout session expired before the first payment was made.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: session.id });
    return { state: "failed", reason };
  }
  if (session.status !== "complete") return { state: "pending" };
  if (!session.subscriptionId) return { state: "processing" };

  const live = await retrieveStripeSubscription(session.subscriptionId, { timeoutMs: 15_000 });
  const state = await settleFirstSubscriptionCharge(payment, session, live.latestInvoice?.paymentIntentId, source, "The payment plan was not started.");
  if (state.state === "paid") await adoptStripeInstallmentSubscription(payment.id, live);
  else if (state.state === "failed") await cancelStripeSubscriptionNow(live.id).catch(() => undefined);
  return state;
}

/** Whether Razorpay Checkout's `razorpay_signature` is genuine for this order/payment pair. */
export function isValidRazorpayCheckoutSignature(input: { razorpayOrderId: string; razorpayPaymentId: string; signature: string }): boolean {
  if (!isRazorpayConfigured()) return false;
  return verifyRazorpayPaymentSignature({ orderId: input.razorpayOrderId, paymentId: input.razorpayPaymentId, signature: input.signature }, razorpayEnv.keySecret);
}

/**
 * Handle the signature Razorpay Checkout hands the browser after a
 * successful payment. The HMAC proves Razorpay accepted a payment for our
 * order (whose amount we fixed server-side); the payment is then read back
 * to capture it when needed, double-check the amount and make sure it was
 * not refunded. The signature alone never fulfils an order.
 */
export async function confirmRazorpayCheckout(
  payment: Payment,
  input: { razorpayOrderId: string; razorpayPaymentId: string; signature: string },
): Promise<SyncState> {
  if (!isRazorpayConfigured()) return { state: "error", message: "Razorpay is not configured." };
  // Bound by the Razorpay order id, whatever the order is labelled now (an order confirmed by hand
  // becomes "manual" while the learner may still pay in an open Razorpay window).
  if (!payment.gatewayOrderId || payment.gatewayOrderId !== input.razorpayOrderId) {
    return { state: "error", message: "This payment does not belong to the order." };
  }
  if (!isValidRazorpayCheckoutSignature(input)) {
    return { state: "error", message: "We couldn't verify this payment. If you were charged, contact support with your order ID." };
  }

  try {
    const rp = await fetchRazorpayPayment(input.razorpayPaymentId, { timeoutMs: 10_000 });
    return await reconcileRazorpayPayment(payment, rp, "razorpay_checkout", { live: true });
  } catch (error) {
    // Razorpay is briefly unreachable: the signature proves a payment was made, not that it was
    // captured or kept. The order page asks Razorpay again (capturing and fulfilling it then).
    if (error instanceof GatewayError && error.transient) return { state: "processing" };
    return { state: "error", message: gatewayErrorMessage(error) };
  }
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

function gatewayNotConfigured(gateway: RealGateway): GatewayError {
  const name = GATEWAY_NAMES[gateway];
  return new GatewayError(name, `${name} is not configured, so the refund cannot be sent. Refund it in the ${name} dashboard and record it here.`);
}

/** What the gateway knows about the refunds of an order's payment. Amounts are in app units. */
export interface GatewayRefundLedger {
  /** Everything refunded on the payment so far (failed and cancelled refunds excluded). */
  total: number;
  /** Refunds this app sent for the order that are not recorded on it (e.g. the request timed out). */
  unrecorded: { id: string; amount: number }[];
  /** Refunds the gateway knows for the payment, whatever their status. */
  count: number;
}

/**
 * Read the refunds of a Stripe/Razorpay-paid order from the gateway. Checked
 * before every refund from the app, so a retry after a timed-out request
 * records the refund that went through instead of sending a second one.
 */
export async function readGatewayRefunds(payment: Payment): Promise<GatewayRefundLedger> {
  if (!refundsViaGateway(payment) || !isRealGateway(payment.gateway)) return { total: 0, unrecorded: [], count: 0 };
  const known = new Set((payment.refunds ?? []).map((r) => r.id));
  if (payment.refundId) known.add(payment.refundId);
  const toApp = (amount: number) => fromGatewayAmount(amount, payment.currency);
  const mine = await refundOwnership(payment);

  if (payment.gateway === "stripe") {
    if (!isStripeConfigured()) throw gatewayNotConfigured("stripe");
    const refunds = await listStripeRefunds(payment.gatewayPaymentId!, { timeoutMs: 15_000 });
    const active = refunds.filter(isActiveStripeRefund).filter((r) => mine(r.paymentId));
    return {
      total: active.reduce((sum, r) => sum + toApp(r.amount), 0),
      unrecorded: active.filter((r) => r.paymentId === payment.id && !known.has(r.id)).map((r) => ({ id: r.id, amount: toApp(r.amount) })),
      count: refunds.length,
    };
  }
  if (!isRazorpayConfigured()) throw gatewayNotConfigured("razorpay");
  const refunds = await listRazorpayRefunds(payment.gatewayPaymentId!, { timeoutMs: 15_000 });
  const active = refunds.filter(isActiveRazorpayRefund).filter((r) => mine(r.notes.paymentId));
  return {
    total: active.reduce((sum, r) => sum + toApp(r.amount), 0),
    unrecorded: active.filter((r) => r.notes.paymentId === payment.id && !known.has(r.id)).map((r) => ({ id: r.id, amount: toApp(r.amount) })),
    count: refunds.length,
  };
}

/**
 * Which gateway refunds count for `payment`. Usually all of them; when the
 * gateway payment is shared with order bumps, each row owns the refunds sent
 * for it (tagged with its id) and the main order also owns untagged ones
 * (made in the gateway dashboard).
 */
async function refundOwnership(payment: Payment): Promise<(taggedPaymentId: string | undefined) => boolean> {
  const db = await getDb();
  const group = db.payments.filter((p) => p.gatewayPaymentId === payment.gatewayPaymentId);
  if (group.length < 2) return () => true;
  const ids = new Set(group.map((p) => p.id));
  const main = !isOrderBump(payment);
  return (tag) => tag === payment.id || (main && (!tag || !ids.has(tag)));
}

/** Whether other order rows share this order's gateway payment (an order and its bumps). */
function sharesGatewayPayment(db: Pick<Database, "payments">, payment: Pick<Payment, "id" | "gatewayPaymentId">): boolean {
  return !!payment.gatewayPaymentId && db.payments.some((p) => p.id !== payment.id && p.gatewayPaymentId === payment.gatewayPaymentId);
}

/**
 * Send a refund of `amount` (app units) for a Stripe/Razorpay-paid order.
 * `ledger` is what `readGatewayRefunds` returned just before: the refund
 * count it carries makes the Stripe idempotency key, so a request retried in
 * the same state returns the first result instead of refunding twice.
 */
export async function sendGatewayRefund(payment: Payment, amount: number, ledger: GatewayRefundLedger): Promise<{ refundId: string; amount: number }> {
  if (!isRealGateway(payment.gateway) || !refundsViaGateway(payment)) throw new GatewayError(payment.gateway, "This order was not paid through a payment gateway.");
  const remaining = Math.max(0, payment.amount - Math.max(payment.refundedAmount ?? 0, ledger.total));
  if (remaining <= 0) throw new GatewayError(payment.gateway, "Nothing is left to refund on this order.");
  if (!Number.isFinite(amount) || amount <= 0) throw new GatewayError(payment.gateway, "The refund amount must be greater than zero.");
  if (amount > remaining) throw new GatewayError(payment.gateway, `You can refund at most ${formatPrice(remaining, payment.currency)}.`);
  // A payment shared with order bumps is always refunded by amount: "everything" would refund the other rows too.
  const full = amount === remaining && !sharesGatewayPayment(await getDb(), payment);
  const gatewayAmount = full ? undefined : toGatewayAmount(amount, payment.currency);
  const received = (value: number) => (value > 0 ? Math.min(remaining, fromGatewayAmount(value, payment.currency)) : amount);

  if (payment.gateway === "stripe") {
    if (!isStripeConfigured()) throw gatewayNotConfigured("stripe");
    const r = await createStripeRefund({
      paymentIntentId: payment.gatewayPaymentId!,
      amount: gatewayAmount,
      paymentId: payment.id,
      orderId: payment.orderId,
      idempotencyKey: `refund-${payment.id}-${gatewayAmount ?? "full"}-${ledger.count}`,
    });
    return { refundId: r.id, amount: received(r.amount) };
  }
  if (!isRazorpayConfigured()) throw gatewayNotConfigured("razorpay");
  const r = await createRazorpayRefund({ paymentId: payment.gatewayPaymentId!, amount: gatewayAmount, ourPaymentId: payment.id, orderId: payment.orderId });
  return { refundId: r.id, amount: received(r.amount) };
}

/** Whether refunding this order goes through a gateway API. */
export function refundsViaGateway(payment: Pick<Payment, "gateway" | "gatewayPaymentId">): boolean {
  return isGatewayPaymentReference(payment.gateway, payment.gatewayPaymentId);
}

/* ------------------------------------------------------------------ */
/* Admin status                                                        */
/* ------------------------------------------------------------------ */

export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

export const RAZORPAY_WEBHOOK_EVENTS = [
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.processed",
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
];

/** Configuration of every real gateway, safe to show to administrators (secrets are masked). */
export function getGatewayStatuses(): GatewayStatusView[] {
  const stripeKey = stripeEnv.secretKey;
  const stripeMissing: string[] = [];
  if (!stripeKey) stripeMissing.push("Missing STRIPE_SECRET_KEY");
  else if (!isStripeConfigured()) stripeMissing.push("STRIPE_SECRET_KEY is not a Stripe secret key (sk_test_… or sk_live_…)");
  const sMode = stripeMode();

  const rzpMissing: string[] = [];
  if (!razorpayEnv.keyId) rzpMissing.push("Missing RAZORPAY_KEY_ID");
  else if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(razorpayEnv.keyId)) rzpMissing.push("RAZORPAY_KEY_ID is not a Razorpay key id (rzp_test_… or rzp_live_…)");
  if (!razorpayEnv.keySecret) rzpMissing.push("Missing RAZORPAY_KEY_SECRET");

  return [
    {
      gateway: "stripe",
      label: "Stripe",
      configured: isStripeConfigured(),
      mode: sMode,
      maskedKey: maskSecret(stripeKey),
      keyLabel: "STRIPE_SECRET_KEY",
      missing: stripeMissing,
      webhookConfigured: isStripeWebhookConfigured(),
      webhookSecretVar: "STRIPE_WEBHOOK_SECRET",
      webhookUrl: absoluteUrl("/api/payments/stripe/webhook"),
      webhookEvents: STRIPE_WEBHOOK_EVENTS,
      dashboardUrl: `https://dashboard.stripe.com/${sMode === "live" ? "" : "test/"}webhooks`,
      docsUrl: "https://docs.stripe.com/webhooks",
      note: "Hosted Stripe Checkout: cards, wallets and local payment methods enabled in your Stripe dashboard.",
    },
    {
      gateway: "razorpay",
      label: "Razorpay",
      configured: isRazorpayConfigured(),
      mode: razorpayMode(),
      maskedKey: maskSecret(razorpayEnv.keyId),
      keyLabel: "RAZORPAY_KEY_ID",
      missing: rzpMissing,
      webhookConfigured: isRazorpayWebhookConfigured(),
      webhookSecretVar: "RAZORPAY_WEBHOOK_SECRET",
      webhookUrl: absoluteUrl("/api/payments/razorpay/webhook"),
      webhookEvents: RAZORPAY_WEBHOOK_EVENTS,
      dashboardUrl: "https://dashboard.razorpay.com/app/webhooks",
      docsUrl: "https://razorpay.com/docs/webhooks/",
      note: "Razorpay Checkout modal: cards, UPI, netbanking and wallets. International currencies need to be enabled on your Razorpay account.",
    },
  ];
}

/** Authenticated no-op call used by the admin "Test connection" button. */
export async function testGatewayConnection(gateway: RealGateway): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!isConfigured(gateway)) return { ok: false, error: `${GATEWAY_NAMES[gateway]} is not configured.` };
  try {
    if (gateway === "stripe") {
      const res = await pingStripe();
      return { ok: true, message: `Connected to Stripe (${res.livemode ? "live" : "test"} mode).` };
    }
    await pingRazorpay();
    return { ok: true, message: `Connected to Razorpay (${razorpayMode() ?? "test"} mode).` };
  } catch (error) {
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}
