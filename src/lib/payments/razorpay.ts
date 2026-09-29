import "server-only";
import { razorpayEnv } from "@/lib/server-env";
import { GatewayError, gatewayFetch, num, obj, readJson, str, stringMap, type GatewayRequestOptions } from "./http";

/**
 * Razorpay REST client (Orders, Payments, Refunds) implemented with `fetch`.
 * Docs: https://razorpay.com/docs/api — JSON requests, HTTP Basic auth with
 * key_id:key_secret. Amounts are in the currency's smallest unit.
 */

const API = "https://api.razorpay.com/v1";

const ORDER_ID_RE = /^order_[A-Za-z0-9]{6,40}$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{6,40}$/;

export function isRazorpayConfigured(): boolean {
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(razorpayEnv.keyId) && razorpayEnv.keySecret.length > 0;
}

export function isRazorpayWebhookConfigured(): boolean {
  return razorpayEnv.webhookSecret.length > 0;
}

export function razorpayMode(): "test" | "live" | null {
  if (!isRazorpayConfigured()) return null;
  return razorpayEnv.keyId.startsWith("rzp_live_") ? "live" : "test";
}

/** The public key id handed to Razorpay Checkout in the browser (not a secret). */
export function razorpayPublicKeyId(): string {
  return isRazorpayConfigured() ? razorpayEnv.keyId : "";
}

export function isRazorpayOrderId(id: string | undefined | null): id is string {
  return !!id && ORDER_ID_RE.test(id);
}

export function isRazorpayPaymentId(id: string | undefined | null): id is string {
  return !!id && PAYMENT_ID_RE.test(id);
}

/** Link to a payment in the Razorpay dashboard (for administrators). */
export function razorpayDashboardPaymentUrl(paymentId: string): string {
  return `https://dashboard.razorpay.com/app/payments/${encodeURIComponent(paymentId)}`;
}

async function razorpayRequest(method: "GET" | "POST", path: string, body?: Record<string, unknown>, opts: GatewayRequestOptions = {}): Promise<Record<string, unknown>> {
  if (!isRazorpayConfigured()) throw new GatewayError("Razorpay", "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your .env file.");
  const auth = Buffer.from(`${razorpayEnv.keyId}:${razorpayEnv.keySecret}`, "utf8").toString("base64");
  const headers: Record<string, string> = { Authorization: `Basic ${auth}`, Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  const res = await gatewayFetch("Razorpay", `${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }, opts.timeoutMs);
  const json = await readJson(res);
  if (!res.ok) {
    const err = obj(json.error);
    const message = str(err.description) ?? `Razorpay returned HTTP ${res.status}.`;
    throw new GatewayError("Razorpay", message, res.status, str(err.code) ?? str(err.reason));
  }
  return json;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export interface RazorpayOrder {
  id: string;
  amount: number;
  amountPaid: number;
  currency: string;
  /** "created" | "attempted" | "paid" */
  status: string;
  receipt?: string;
  notes: Record<string, string>;
}

export function parseRazorpayOrder(raw: Record<string, unknown>): RazorpayOrder {
  return {
    id: str(raw.id) ?? "",
    amount: num(raw.amount) ?? 0,
    amountPaid: num(raw.amount_paid) ?? 0,
    currency: str(raw.currency) ?? "",
    status: str(raw.status) ?? "",
    receipt: str(raw.receipt),
    notes: stringMap(raw.notes),
  };
}

export async function createRazorpayOrder(input: { amount: number; currency: string; receipt: string; paymentId: string; orderId: string }): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new GatewayError("Razorpay", "The order total must be greater than zero.");
  const json = await razorpayRequest("POST", "/orders", {
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    receipt: input.receipt.slice(0, 40),
    notes: { paymentId: input.paymentId, orderId: input.orderId },
  });
  const order = parseRazorpayOrder(json);
  if (!order.id) throw new GatewayError("Razorpay", "Razorpay did not return an order id.");
  return order;
}

export async function fetchRazorpayOrder(orderId: string, opts: GatewayRequestOptions = {}): Promise<RazorpayOrder> {
  if (!isRazorpayOrderId(orderId)) throw new GatewayError("Razorpay", "Invalid Razorpay order id.", 400);
  return parseRazorpayOrder(await razorpayRequest("GET", `/orders/${encodeURIComponent(orderId)}`, undefined, opts));
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface RazorpayPayment {
  id: string;
  orderId?: string;
  amount: number;
  currency: string;
  /** "created" | "authorized" | "captured" | "refunded" | "failed" */
  status: string;
  captured: boolean;
  method?: string;
  email?: string;
  errorDescription?: string;
  amountRefunded: number;
  refundStatus?: string;
  notes: Record<string, string>;
}

export function parseRazorpayPayment(raw: Record<string, unknown>): RazorpayPayment {
  return {
    id: str(raw.id) ?? "",
    orderId: str(raw.order_id),
    amount: num(raw.amount) ?? 0,
    currency: str(raw.currency) ?? "",
    status: str(raw.status) ?? "",
    captured: raw.captured === true,
    method: str(raw.method),
    email: str(raw.email),
    errorDescription: str(raw.error_description),
    amountRefunded: num(raw.amount_refunded) ?? 0,
    refundStatus: str(raw.refund_status),
    notes: stringMap(raw.notes),
  };
}

/**
 * Whether money of this payment went back to the payer. A refunded payment
 * keeps `captured: true`, and a partly refunded one keeps `status: "captured"`,
 * so neither of those alone proves the order was paid.
 */
export function isRazorpayPaymentReversed(p: Pick<RazorpayPayment, "status" | "amountRefunded" | "refundStatus">): boolean {
  return p.status === "refunded" || p.amountRefunded > 0 || p.refundStatus === "partial" || p.refundStatus === "full";
}

export async function fetchRazorpayPayment(paymentId: string, opts: GatewayRequestOptions = {}): Promise<RazorpayPayment> {
  if (!isRazorpayPaymentId(paymentId)) throw new GatewayError("Razorpay", "Invalid Razorpay payment id.", 400);
  return parseRazorpayPayment(await razorpayRequest("GET", `/payments/${encodeURIComponent(paymentId)}`, undefined, opts));
}

/** Payments attempted against an order. */
export async function fetchRazorpayOrderPayments(orderId: string, opts: GatewayRequestOptions = {}): Promise<RazorpayPayment[]> {
  if (!isRazorpayOrderId(orderId)) throw new GatewayError("Razorpay", "Invalid Razorpay order id.", 400);
  const json = await razorpayRequest("GET", `/orders/${encodeURIComponent(orderId)}/payments`, undefined, opts);
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((i) => parseRazorpayPayment(obj(i)));
}

/** Capture an authorized payment (accounts without automatic capture). */
export async function captureRazorpayPayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment> {
  if (!isRazorpayPaymentId(paymentId)) throw new GatewayError("Razorpay", "Invalid Razorpay payment id.", 400);
  return parseRazorpayPayment(await razorpayRequest("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: currency.toUpperCase() }));
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

export interface RazorpayRefund {
  id: string;
  paymentId?: string;
  amount: number;
  currency: string;
  /** "pending" | "processed" | "failed" */
  status: string;
  notes: Record<string, string>;
}

export function parseRazorpayRefund(raw: Record<string, unknown>): RazorpayRefund {
  return {
    id: str(raw.id) ?? "",
    paymentId: str(raw.payment_id),
    amount: num(raw.amount) ?? 0,
    currency: str(raw.currency) ?? "",
    status: str(raw.status) ?? "",
    notes: stringMap(raw.notes),
  };
}

export async function createRazorpayRefund(input: { paymentId: string; amount?: number; ourPaymentId: string; orderId: string }): Promise<RazorpayRefund> {
  if (!isRazorpayPaymentId(input.paymentId)) throw new GatewayError("Razorpay", "This order has no Razorpay payment to refund.");
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount <= 0)) {
    throw new GatewayError("Razorpay", "The refund amount must be greater than zero.");
  }
  const body: Record<string, unknown> = {
    notes: { paymentId: input.ourPaymentId, orderId: input.orderId },
    receipt: `refund-${input.orderId}`.slice(0, 40),
  };
  if (input.amount !== undefined) body.amount = input.amount;
  const refund = parseRazorpayRefund(await razorpayRequest("POST", `/payments/${encodeURIComponent(input.paymentId)}/refund`, body));
  if (!refund.id) throw new GatewayError("Razorpay", "Razorpay did not return a refund id.");
  if (refund.status === "failed") throw new GatewayError("Razorpay", "Razorpay could not complete the refund.");
  return refund;
}

/** Refunds that return money (failed refunds do not). */
export function isActiveRazorpayRefund(refund: Pick<RazorpayRefund, "status">): boolean {
  return refund.status !== "failed";
}

/** Refunds of a payment (up to 100). */
export async function listRazorpayRefunds(paymentId: string, opts: GatewayRequestOptions = {}): Promise<RazorpayRefund[]> {
  if (!isRazorpayPaymentId(paymentId)) throw new GatewayError("Razorpay", "This order has no Razorpay payment to refund.");
  const json = await razorpayRequest("GET", `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`, undefined, opts);
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((i) => parseRazorpayRefund(obj(i))).filter((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* Webhook payloads                                                    */
/* ------------------------------------------------------------------ */

export interface RazorpayEvent {
  event: string;
  payment: RazorpayPayment | null;
  order: RazorpayOrder | null;
  refund: RazorpayRefund | null;
}

/** Normalize a webhook body (`{ entity: "event", event, payload: { payment: { entity } … } }`). */
export function parseRazorpayEvent(raw: Record<string, unknown>): RazorpayEvent | null {
  const event = str(raw.event);
  if (raw.entity !== "event" || !event) return null;
  const payload = obj(raw.payload);
  const entity = (key: string) => {
    const e = obj(obj(payload[key]).entity);
    return Object.keys(e).length ? e : null;
  };
  const payment = entity("payment");
  const order = entity("order");
  const refund = entity("refund");
  return {
    event,
    payment: payment ? parseRazorpayPayment(payment) : null,
    order: order ? parseRazorpayOrder(order) : null,
    refund: refund ? parseRazorpayRefund(refund) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Connection check                                                    */
/* ------------------------------------------------------------------ */

export async function pingRazorpay(): Promise<void> {
  await razorpayRequest("GET", "/orders?count=1", undefined, { timeoutMs: 10_000 });
}
