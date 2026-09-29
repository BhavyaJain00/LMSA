import "server-only";
import type { Database, Payment, Settings } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { maskSecret, razorpayEnv, stripeEnv } from "@/lib/server-env";
import { formatPrice } from "@/lib/utils";
import { notifyMany } from "@/lib/services/notifications";
import { amountMatches, fromGatewayAmount, toGatewayAmount } from "./amounts";
import { GatewayError } from "./http";
import { verifyRazorpayPaymentSignature } from "./signatures";
import {
  createStripeCheckoutSession,
  createStripeRefund,
  expireStripeCheckoutSession,
  isStripeConfigured,
  isStripeSessionId,
  isStripeSessionPaid,
  isStripeWebhookConfigured,
  pingStripe,
  retrieveStripeCheckoutSession,
  stripeDashboardPaymentUrl,
  stripeMode,
  type StripeCheckoutSession,
} from "./stripe";
import {
  captureRazorpayPayment,
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayOrder,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  isRazorpayConfigured,
  isRazorpayOrderId,
  isRazorpayWebhookConfigured,
  pingRazorpay,
  razorpayDashboardPaymentUrl,
  razorpayMode,
  razorpayPublicKeyId,
  type RazorpayOrder,
  type RazorpayPayment,
} from "./razorpay";
import { fulfillPayment, isGatewayPaymentReference, markPaymentFailed, type FulfillmentSource } from "./fulfillment";
import type { CheckoutNext, GatewayStatusView, RazorpayLaunchOptions, RealGateway } from "./types";

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
  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    return { description: batch?.description, imageUrl: batch?.imageUrl };
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

function razorpayOptions(db: Database, payment: Payment, order: RazorpayOrder): RazorpayLaunchOptions {
  const user = db.users.find((u) => u.id === payment.userId);
  const brand = db.settings.brand;
  return {
    keyId: razorpayPublicKeyId(),
    razorpayOrderId: order.id,
    orderId: payment.orderId,
    amount: order.amount,
    currency: order.currency || payment.currency.toUpperCase(),
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
  const db = await getDb();
  const amount = toGatewayAmount(payment.amount, payment.currency);

  if (payment.gateway === "stripe") {
    const user = db.users.find((u) => u.id === payment.userId);
    const details = itemDetails(db, payment);
    const session = await createStripeCheckoutSession({
      paymentId: payment.id,
      orderId: payment.orderId,
      title: payment.itemTitle,
      description: details.description,
      imageUrl: publicImageUrl(details.imageUrl),
      unitAmount: amount,
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
  return { kind: "razorpay", options: razorpayOptions(db, payment, order) };
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
        // The session expired (which failed the order): reopen the order for a new attempt.
        if (!(await reopenFailedOrder(payment.id))) return { ok: false, error: "This order was closed. Start a new checkout to buy it again." };
      }
      const current = (await getFreshPayment(payment.id)) ?? payment;
      return { ok: true, next: await createCheckout(current, checkoutUrls(current)) };
    }

    // Razorpay: an order can be attempted many times until it is paid.
    if (isRazorpayOrderId(payment.gatewayOrderId)) {
      const state = await syncRazorpayOrder(payment, "sync");
      if (state.state === "paid") return { ok: true, next: { kind: "redirect", url: orderPage }, message: "Your payment went through." };
      if (state.state === "error") return { ok: false, error: state.message };
      const order = await fetchRazorpayOrder(payment.gatewayOrderId);
      if (order.status !== "paid" && amountMatches(payment.amount, payment.currency, order.amount, order.currency)) {
        const db = await getDb();
        return { ok: true, next: { kind: "razorpay", options: razorpayOptions(db, payment, order) } };
      }
    }
    return { ok: true, next: await createCheckout(payment, checkoutUrls(payment)) };
  } catch (error) {
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}

async function getFreshPayment(paymentId: string): Promise<Payment | null> {
  const db = await getDb();
  const row = db.payments.find((p) => p.id === paymentId);
  return row ? { ...row } : null;
}

/** A Stripe session that merely expired leaves the order resumable. */
async function reopenFailedOrder(paymentId: string): Promise<boolean> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return false;
    if (row.status === "pending") return true;
    if (row.status !== "failed") return false;
    row.status = "pending";
    row.failureReason = undefined;
    return true;
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
  | { state: "paid"; payment: Payment }
  | { state: "processing" }
  | { state: "pending" }
  | { state: "failed"; reason?: string }
  | { state: "error"; message: string };

async function reportAmountMismatch(payment: Payment, received: string): Promise<SyncState> {
  const db = await getDb();
  const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
  console.error(`[payments] amount mismatch on order ${payment.orderId}: expected ${payment.amount} ${payment.currency}, received ${received}`);
  await notifyMany(admins, {
    type: "system",
    subject: `Payment amount mismatch on order ${payment.orderId}`,
    message: `Expected ${formatPrice(payment.amount, payment.currency)} but the gateway reported ${received}. The order was not fulfilled; review it in the gateway dashboard.`,
    link: `/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`,
  });
  return { state: "error", message: "The payment amount did not match this order. Our team has been notified." };
}

/** Apply what a Stripe Checkout Session says about `payment`. */
export async function reconcileStripeSession(payment: Payment, session: StripeCheckoutSession, source: FulfillmentSource): Promise<SyncState> {
  const belongs = session.metadata.paymentId === payment.id || session.clientReferenceId === payment.id;
  if (!belongs) return { state: "error", message: "This checkout session does not belong to the order." };

  if (isStripeSessionPaid(session)) {
    if (!amountMatches(payment.amount, payment.currency, session.amountTotal, session.currency)) {
      return reportAmountMismatch(payment, `${session.amountTotal ?? "?"} ${(session.currency ?? "?").toUpperCase()} (smallest unit)`);
    }
    const res = await fulfillPayment(payment.id, session.paymentIntentId, { gatewayOrderId: session.id, source });
    if (!res.ok) return { state: "error", message: res.error };
    return { state: "paid", payment: res.data.payment };
  }
  if (session.status === "complete") return { state: "processing" };
  if (session.status === "expired") {
    const reason = "The checkout session expired before the payment was completed.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: session.id });
    return { state: "failed", reason };
  }
  return { state: "pending" };
}

/** Apply what a Razorpay payment says about `payment` (captures authorized payments). */
export async function reconcileRazorpayPayment(payment: Payment, rp: RazorpayPayment, source: FulfillmentSource): Promise<SyncState> {
  const belongs = (!!rp.orderId && rp.orderId === payment.gatewayOrderId) || rp.notes.paymentId === payment.id;
  if (!belongs) return { state: "error", message: "This Razorpay payment does not belong to the order." };

  let current = rp;
  if (current.status === "authorized") {
    if (!amountMatches(payment.amount, payment.currency, current.amount, current.currency)) {
      return reportAmountMismatch(payment, `${current.amount} ${current.currency} (smallest unit)`);
    }
    try {
      current = await captureRazorpayPayment(current.id, current.amount, current.currency);
    } catch (error) {
      // Already captured by the account's auto-capture in the meantime: read it again.
      if (error instanceof GatewayError && error.status === 400) current = await fetchRazorpayPayment(current.id);
      else throw error;
    }
  }
  if (current.status === "captured" || current.status === "refunded" || current.captured) {
    if (!amountMatches(payment.amount, payment.currency, current.amount, current.currency)) {
      return reportAmountMismatch(payment, `${current.amount} ${current.currency} (smallest unit)`);
    }
    const res = await fulfillPayment(payment.id, current.id, { gatewayOrderId: current.orderId, source });
    if (!res.ok) return { state: "error", message: res.error };
    return { state: "paid", payment: res.data.payment };
  }
  if (current.status === "failed") {
    const reason = current.errorDescription ?? "The payment was declined.";
    await markPaymentFailed(payment.id, reason, { gatewayOrderId: current.orderId });
    return { state: "failed", reason };
  }
  return { state: "pending" };
}

/** Check a Razorpay order's payments and settle the order when one succeeded. Failed attempts leave it resumable. */
async function syncRazorpayOrder(payment: Payment, source: FulfillmentSource, timeoutMs?: number): Promise<SyncState> {
  if (!isRazorpayOrderId(payment.gatewayOrderId)) return { state: "pending" };
  const attempts = await fetchRazorpayOrderPayments(payment.gatewayOrderId, { timeoutMs });
  const good = attempts.find((p) => p.status === "captured") ?? attempts.find((p) => p.status === "authorized");
  if (good) return reconcileRazorpayPayment(payment, good, source);
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
    const state = await syncRazorpayOrder(payment, "sync");
    return { paid: state.state === "paid", reached: state.state !== "error" };
  } catch {
    return { paid: false, reached: false };
  }
}

/**
 * Handle the signature Razorpay Checkout hands the browser after a
 * successful payment. The HMAC proves Razorpay accepted a payment for our
 * order (whose amount we fixed server-side); the payment is then read back
 * to capture it when needed and double-check the amount.
 */
export async function confirmRazorpayCheckout(
  payment: Payment,
  input: { razorpayOrderId: string; razorpayPaymentId: string; signature: string },
): Promise<SyncState> {
  if (!isRazorpayConfigured()) return { state: "error", message: "Razorpay is not configured." };
  if (payment.gateway !== "razorpay" || !payment.gatewayOrderId || payment.gatewayOrderId !== input.razorpayOrderId) {
    return { state: "error", message: "This payment does not belong to the order." };
  }
  const valid = verifyRazorpayPaymentSignature(
    { orderId: input.razorpayOrderId, paymentId: input.razorpayPaymentId, signature: input.signature },
    razorpayEnv.keySecret,
  );
  if (!valid) return { state: "error", message: "We couldn't verify this payment. If you were charged, contact support with your order ID." };

  try {
    const rp = await fetchRazorpayPayment(input.razorpayPaymentId, { timeoutMs: 10_000 });
    return await reconcileRazorpayPayment(payment, rp, "razorpay_checkout");
  } catch (error) {
    if (error instanceof GatewayError && error.transient) {
      // Razorpay is briefly unreachable, but the signature already proves the payment for this order.
      const res = await fulfillPayment(payment.id, input.razorpayPaymentId, { gatewayOrderId: input.razorpayOrderId, source: "razorpay_checkout" });
      return res.ok ? { state: "paid", payment: res.data.payment } : { state: "error", message: res.error };
    }
    return { state: "error", message: gatewayErrorMessage(error) };
  }
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export interface GatewayRefundResult {
  /** Gateway refund id; undefined when nothing was sent through a gateway. */
  refundId?: string;
  /** Amount refunded now, in app units. */
  amount: number;
  viaGateway: boolean;
}

/**
 * Refund `amount` (app units; default: everything not refunded yet). Orders
 * paid through Stripe/Razorpay are refunded through the gateway API; manual
 * and free orders only need the local record (the admin returns the money).
 */
export async function refund(payment: Payment, amount?: number): Promise<GatewayRefundResult> {
  const remaining = Math.max(0, payment.amount - (payment.refundedAmount ?? 0));
  const value = amount ?? remaining;
  if (value <= 0 && payment.amount > 0) throw new GatewayError(payment.gateway, "Nothing is left to refund on this order.");
  if (value > remaining) throw new GatewayError(payment.gateway, `You can refund at most ${formatPrice(remaining, payment.currency)}.`);

  if (!isGatewayPaymentReference(payment.gateway, payment.gatewayPaymentId) || value <= 0) {
    return { amount: value, viaGateway: false };
  }
  const full = value === remaining;
  if (payment.gateway === "stripe") {
    if (!isStripeConfigured()) throw new GatewayError("Stripe", "Stripe is not configured, so the refund cannot be sent. Refund it in the Stripe dashboard and record it here.");
    const r = await createStripeRefund({
      paymentIntentId: payment.gatewayPaymentId!,
      amount: full ? undefined : toGatewayAmount(value, payment.currency),
      paymentId: payment.id,
      orderId: payment.orderId,
    });
    return { refundId: r.id, amount: r.amount > 0 ? Math.min(remaining, fromGatewayAmount(r.amount, payment.currency)) : value, viaGateway: true };
  }
  if (!isRazorpayConfigured()) throw new GatewayError("Razorpay", "Razorpay is not configured, so the refund cannot be sent. Refund it in the Razorpay dashboard and record it here.");
  const r = await createRazorpayRefund({
    paymentId: payment.gatewayPaymentId!,
    amount: full ? undefined : toGatewayAmount(value, payment.currency),
    ourPaymentId: payment.id,
    orderId: payment.orderId,
  });
  return { refundId: r.id, amount: r.amount > 0 ? Math.min(remaining, fromGatewayAmount(r.amount, payment.currency)) : value, viaGateway: true };
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
];

export const RAZORPAY_WEBHOOK_EVENTS = ["payment.authorized", "payment.captured", "payment.failed", "order.paid", "refund.processed"];

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
