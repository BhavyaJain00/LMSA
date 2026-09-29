import "server-only";
import { stripeEnv } from "@/lib/server-env";
import { GatewayError, gatewayFetch, num, obj, readJson, str, stringMap, toFormBody, type GatewayRequestOptions } from "./http";

/**
 * Stripe REST client (Checkout Sessions, Refunds) implemented with `fetch`.
 * Docs: https://docs.stripe.com/api — form-encoded requests, Bearer auth.
 */

const API = "https://api.stripe.com/v1";
/** Pin the API version so response shapes do not change under us. */
const API_VERSION = "2024-06-20";

const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{8,200}$/;
const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9]{8,200}$/;

export function isStripeConfigured(): boolean {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(stripeEnv.secretKey);
}

export function isStripeWebhookConfigured(): boolean {
  return /^whsec_[A-Za-z0-9+/=_-]+$/.test(stripeEnv.webhookSecret);
}

export function stripeMode(): "test" | "live" | null {
  if (!isStripeConfigured()) return null;
  return /_live_/.test(stripeEnv.secretKey) ? "live" : "test";
}

export function isStripeSessionId(id: string | undefined | null): id is string {
  return !!id && SESSION_ID_RE.test(id);
}

export function isStripePaymentIntentId(id: string | undefined | null): id is string {
  return !!id && PAYMENT_INTENT_RE.test(id);
}

/** Link to a payment in the Stripe dashboard (for administrators). */
export function stripeDashboardPaymentUrl(paymentIntentId: string, mode: "test" | "live" | null = stripeMode()): string {
  return `https://dashboard.stripe.com/${mode === "live" ? "" : "test/"}payments/${encodeURIComponent(paymentIntentId)}`;
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  opts: GatewayRequestOptions & { idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  if (!isStripeConfigured()) throw new GatewayError("Stripe", "Stripe is not configured. Add STRIPE_SECRET_KEY to your .env file.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeEnv.secretKey}`,
    "Stripe-Version": API_VERSION,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await gatewayFetch(
    "Stripe",
    `${API}${path}`,
    {
      method,
      headers,
      body: body ? toFormBody(body).toString() : undefined,
    },
    opts.timeoutMs,
  );
  const json = await readJson(res);
  if (!res.ok) {
    const err = obj(json.error);
    const message = str(err.message) ?? `Stripe returned HTTP ${res.status}.`;
    throw new GatewayError("Stripe", message, res.status, str(err.code) ?? str(err.type));
  }
  return json;
}

/* ------------------------------------------------------------------ */
/* Checkout Sessions                                                   */
/* ------------------------------------------------------------------ */

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  /** "open" | "complete" | "expired" */
  status: string;
  /** "paid" | "unpaid" | "no_payment_required" */
  paymentStatus: string;
  amountTotal: number | undefined;
  currency: string | undefined;
  paymentIntentId: string | undefined;
  clientReferenceId: string | undefined;
  metadata: Record<string, string>;
  customerEmail: string | undefined;
  expiresAt: number | undefined;
  livemode: boolean;
}

/** Normalize a Checkout Session object (from the API or a webhook event). */
export function parseStripeSession(raw: Record<string, unknown>): StripeCheckoutSession {
  const pi = raw.payment_intent;
  return {
    id: str(raw.id) ?? "",
    url: str(raw.url) ?? null,
    status: str(raw.status) ?? "",
    paymentStatus: str(raw.payment_status) ?? "",
    amountTotal: num(raw.amount_total),
    currency: str(raw.currency),
    paymentIntentId: typeof pi === "string" ? pi : str(obj(pi).id),
    clientReferenceId: str(raw.client_reference_id),
    metadata: stringMap(raw.metadata),
    customerEmail: str(raw.customer_email) ?? str(obj(raw.customer_details).email),
    expiresAt: num(raw.expires_at),
    livemode: raw.livemode === true,
  };
}

/**
 * Whether a completed session says the money was received. The session's
 * `payment_status` never changes after a refund or a dispute, so fulfilment
 * also checks the PaymentIntent (`stripeSettlement`).
 */
export function isStripeSessionPaid(session: Pick<StripeCheckoutSession, "status" | "paymentStatus">): boolean {
  return session.status === "complete" && session.paymentStatus === "paid";
}

/* ------------------------------------------------------------------ */
/* Payment Intents                                                     */
/* ------------------------------------------------------------------ */

export interface StripeChargeState {
  id: string;
  /** "succeeded" | "pending" | "failed" */
  status: string;
  paid: boolean;
  amountRefunded: number;
  /** True once the charge is fully refunded. */
  refunded: boolean;
  disputed: boolean;
}

export interface StripePaymentIntent {
  id: string;
  /** "succeeded", "processing", "requires_payment_method", "canceled", … */
  status: string;
  amount: number;
  amountReceived: number;
  currency: string;
  /** The latest charge, when it was expanded. */
  latestCharge: StripeChargeState | null;
  metadata: Record<string, string>;
}

function parseChargeState(raw: unknown): StripeChargeState | null {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    status: str(o.status) ?? "",
    paid: o.paid === true,
    amountRefunded: num(o.amount_refunded) ?? 0,
    refunded: o.refunded === true,
    disputed: o.disputed === true,
  };
}

export function parseStripePaymentIntent(raw: Record<string, unknown>): StripePaymentIntent {
  return {
    id: str(raw.id) ?? "",
    status: str(raw.status) ?? "",
    amount: num(raw.amount) ?? 0,
    amountReceived: num(raw.amount_received) ?? 0,
    currency: str(raw.currency) ?? "",
    latestCharge: raw.latest_charge && typeof raw.latest_charge === "object" ? parseChargeState(raw.latest_charge) : null,
    metadata: stringMap(raw.metadata),
  };
}

/** Read a PaymentIntent with its latest charge (refund and dispute state). */
export async function retrieveStripePaymentIntent(paymentIntentId: string, opts: GatewayRequestOptions = {}): Promise<StripePaymentIntent> {
  if (!isStripePaymentIntentId(paymentIntentId)) throw new GatewayError("Stripe", "Invalid payment id.", 400);
  const json = await stripeRequest("GET", `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand%5B%5D=latest_charge`, undefined, opts);
  return parseStripePaymentIntent(json);
}

export type StripeSettlement =
  /** The money is with the merchant: the order may be fulfilled. */
  | { kind: "succeeded" }
  /** The payment was refunded (fully or partly) or disputed: never fulfil it. */
  | { kind: "reversed"; reason: string }
  /** Not settled yet (still processing, or the charge could not be read). */
  | { kind: "incomplete" };

/**
 * Whether the money behind a paid Checkout Session is still with the
 * merchant. Stripe resends old `checkout.session.completed` snapshots and the
 * session keeps `payment_status: "paid"` after a refund, so every path that
 * fulfils an unpaid order asks the PaymentIntent first.
 */
export function stripeSettlement(pi: Pick<StripePaymentIntent, "status" | "latestCharge">): StripeSettlement {
  const charge = pi.latestCharge;
  if (charge?.disputed) return { kind: "reversed", reason: "The payment was disputed with the bank." };
  if (charge && (charge.refunded || charge.amountRefunded > 0)) {
    return { kind: "reversed", reason: charge.refunded ? "The payment was refunded." : "The payment was partially refunded." };
  }
  if (pi.status !== "succeeded" || !charge || !charge.paid || charge.status !== "succeeded") return { kind: "incomplete" };
  return { kind: "succeeded" };
}

export interface CreateStripeSessionInput {
  paymentId: string;
  orderId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  /** Amount in the currency's smallest unit (already converted). */
  unitAmount: number;
  currency: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createStripeCheckoutSession(input: CreateStripeSessionInput): Promise<StripeCheckoutSession> {
  if (!Number.isInteger(input.unitAmount) || input.unitAmount <= 0) throw new GatewayError("Stripe", "The order total must be greater than zero.");
  const productData: Record<string, unknown> = { name: input.title.replace(/\s+/g, " ").trim().slice(0, 250) || `Order ${input.orderId}` };
  const description = input.description?.replace(/\s+/g, " ").trim();
  if (description) productData.description = description.slice(0, 500);
  if (input.imageUrl && /^https:\/\/[^\s"'<>]+$/.test(input.imageUrl)) productData.images = [input.imageUrl];
  const email = input.customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail) ? input.customerEmail : undefined;

  const json = await stripeRequest("POST", "/checkout/sessions", {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.paymentId,
    customer_email: email,
    locale: "auto",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.unitAmount,
          product_data: productData,
        },
      },
    ],
    metadata: { paymentId: input.paymentId, orderId: input.orderId },
    payment_intent_data: {
      description: `Order ${input.orderId}`,
      metadata: { paymentId: input.paymentId, orderId: input.orderId },
    },
  });
  const session = parseStripeSession(json);
  if (!session.id || !session.url) throw new GatewayError("Stripe", "Stripe did not return a checkout URL.");
  return session;
}

export async function retrieveStripeCheckoutSession(sessionId: string, opts: GatewayRequestOptions = {}): Promise<StripeCheckoutSession> {
  if (!isStripeSessionId(sessionId)) throw new GatewayError("Stripe", "Invalid checkout session id.", 400);
  const json = await stripeRequest("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, opts);
  return parseStripeSession(json);
}

/**
 * Expire an open Checkout Session so it can no longer be paid. Returns the
 * session afterwards; a session that already closed (paid or expired) is
 * returned as it is, so callers can react to a payment that just went through.
 */
export async function expireStripeCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
  if (!isStripeSessionId(sessionId)) throw new GatewayError("Stripe", "Invalid checkout session id.", 400);
  try {
    return parseStripeSession(await stripeRequest("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}));
  } catch (error) {
    // "Only Checkout Sessions with a status of open can be expired": read its final state instead.
    if (error instanceof GatewayError && error.status >= 400 && error.status < 500) return retrieveStripeCheckoutSession(sessionId);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export interface StripeRefund {
  id: string;
  amount: number;
  /** "pending" | "requires_action" | "succeeded" | "failed" | "canceled" */
  status: string;
  /** Our payment id, when the refund was sent by this app (refund metadata). */
  paymentId?: string;
}

export function parseStripeRefund(raw: Record<string, unknown>): StripeRefund {
  return { id: str(raw.id) ?? "", amount: num(raw.amount) ?? 0, status: str(raw.status) ?? "", paymentId: stringMap(raw.metadata).paymentId };
}

/** Refunds that return money (failed and canceled refunds do not). */
export function isActiveStripeRefund(refund: Pick<StripeRefund, "status">): boolean {
  return refund.status !== "failed" && refund.status !== "canceled";
}

export async function createStripeRefund(input: {
  paymentIntentId: string;
  amount?: number;
  paymentId: string;
  orderId: string;
  /** Same key for the same refund attempt: a retried request returns the first result instead of refunding twice. */
  idempotencyKey: string;
}): Promise<StripeRefund> {
  if (!isStripePaymentIntentId(input.paymentIntentId)) {
    throw new GatewayError("Stripe", "This order has no Stripe payment to refund.");
  }
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount <= 0)) {
    throw new GatewayError("Stripe", "The refund amount must be greater than zero.");
  }
  const json = await stripeRequest(
    "POST",
    "/refunds",
    {
      payment_intent: input.paymentIntentId,
      amount: input.amount,
      reason: "requested_by_customer",
      metadata: { paymentId: input.paymentId, orderId: input.orderId },
    },
    { idempotencyKey: input.idempotencyKey },
  );
  const refund = parseStripeRefund(json);
  if (!refund.id) throw new GatewayError("Stripe", "Stripe did not return a refund id.");
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new GatewayError("Stripe", `Stripe could not complete the refund (status: ${refund.status}).`);
  }
  return refund;
}

/** Refunds of a PaymentIntent, newest first (up to 100). */
export async function listStripeRefunds(paymentIntentId: string, opts: GatewayRequestOptions = {}): Promise<StripeRefund[]> {
  if (!isStripePaymentIntentId(paymentIntentId)) throw new GatewayError("Stripe", "This order has no Stripe payment to refund.");
  const json = await stripeRequest("GET", `/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100`, undefined, opts);
  const data = Array.isArray(json.data) ? json.data : [];
  return data.map((r) => parseStripeRefund(obj(r))).filter((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* Webhook payloads                                                    */
/* ------------------------------------------------------------------ */

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  object: Record<string, unknown>;
}

/** Normalize a webhook event envelope. Returns null for anything that is not an event. */
export function parseStripeEvent(raw: Record<string, unknown>): StripeEvent | null {
  if (raw.object !== "event") return null;
  const id = str(raw.id);
  const type = str(raw.type);
  if (!id || !type) return null;
  return { id, type, livemode: raw.livemode === true, object: obj(obj(raw.data).object) };
}

export interface StripeCharge {
  id: string;
  paymentIntentId: string | undefined;
  amount: number;
  amountRefunded: number;
  currency: string;
  /** True once the charge is fully refunded. */
  refunded: boolean;
}

export function parseStripeCharge(raw: Record<string, unknown>): StripeCharge {
  const pi = raw.payment_intent;
  return {
    id: str(raw.id) ?? "",
    paymentIntentId: typeof pi === "string" ? pi : str(obj(pi).id),
    amount: num(raw.amount) ?? 0,
    amountRefunded: num(raw.amount_refunded) ?? 0,
    currency: str(raw.currency) ?? "",
    refunded: raw.refunded === true,
  };
}

/* ------------------------------------------------------------------ */
/* Connection check                                                    */
/* ------------------------------------------------------------------ */

/** Cheap authenticated call used by the admin "Test connection" button. */
export async function pingStripe(): Promise<{ livemode: boolean }> {
  const json = await stripeRequest("GET", "/balance", undefined, { timeoutMs: 10_000 });
  return { livemode: json.livemode === true };
}
