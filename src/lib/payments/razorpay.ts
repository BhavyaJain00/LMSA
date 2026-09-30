import "server-only";
import { razorpayEnv } from "@/lib/server-env";
import { GatewayError, gatewayFetch, num, obj, readJson, str, stringMap, type GatewayRequestOptions } from "./http";

/**
 * Razorpay REST client (Orders, Payments, Refunds, Plans, Subscriptions)
 * implemented with `fetch`.
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

async function razorpayRequest(method: "GET" | "POST" | "PATCH", path: string, body?: Record<string, unknown>, opts: GatewayRequestOptions = {}): Promise<Record<string, unknown>> {
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
  /** Set on payments that pay a subscription invoice. */
  invoiceId?: string;
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
    invoiceId: str(raw.invoice_id),
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
/* Plans and subscriptions (memberships)                               */
/* ------------------------------------------------------------------ */

const PLAN_ID_RE = /^plan_[A-Za-z0-9]{6,40}$/;
const SUBSCRIPTION_ID_RE = /^sub_[A-Za-z0-9]{6,40}$/;

export function isRazorpayPlanId(id: string | undefined | null): id is string {
  return !!id && PLAN_ID_RE.test(id);
}

export function isRazorpaySubscriptionId(id: string | undefined | null): id is string {
  return !!id && SUBSCRIPTION_ID_RE.test(id);
}

/** Link to a subscription in the Razorpay dashboard (for administrators). */
export function razorpayDashboardSubscriptionUrl(subscriptionId: string): string {
  return `https://dashboard.razorpay.com/app/subscriptions/${encodeURIComponent(subscriptionId)}`;
}

export interface RazorpayPlan {
  id: string;
  /** "monthly" | "yearly" | "weekly" | "daily" */
  period: string;
  interval: number;
  amount: number;
  currency: string;
}

export function parseRazorpayPlan(raw: Record<string, unknown>): RazorpayPlan {
  const item = obj(raw.item);
  return {
    id: str(raw.id) ?? "",
    period: str(raw.period) ?? "",
    interval: num(raw.interval) ?? 1,
    amount: num(item.amount) ?? 0,
    currency: str(item.currency) ?? "",
  };
}

export async function fetchRazorpayPlan(planId: string): Promise<RazorpayPlan> {
  if (!isRazorpayPlanId(planId)) throw new GatewayError("Razorpay", "Invalid Razorpay plan id.", 400);
  return parseRazorpayPlan(await razorpayRequest("GET", `/plans/${encodeURIComponent(planId)}`));
}

/** Create a billing plan (Razorpay plans are immutable: a new price needs a new plan). */
export async function createRazorpayPlan(input: { name: string; amount: number; currency: string; interval: "month" | "year"; planId: string }): Promise<RazorpayPlan> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new GatewayError("Razorpay", "The membership price must be greater than zero.");
  const plan = parseRazorpayPlan(
    await razorpayRequest("POST", "/plans", {
      period: input.interval === "year" ? "yearly" : "monthly",
      interval: 1,
      item: { name: input.name.replace(/\s+/g, " ").trim().slice(0, 100) || "Membership", amount: input.amount, currency: input.currency.toUpperCase() },
      notes: { planId: input.planId },
    }),
  );
  if (!plan.id) throw new GatewayError("Razorpay", "Razorpay did not return a plan id.");
  return plan;
}

export interface RazorpaySubscription {
  id: string;
  planId: string | undefined;
  /** "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired" | "paused" */
  status: string;
  /** Unix seconds (unset before the first charge). */
  currentStart: number | undefined;
  currentEnd: number | undefined;
  /** When the next charge is attempted. */
  chargeAt: number | undefined;
  startAt: number | undefined;
  endedAt: number | undefined;
  paidCount: number;
  totalCount: number | undefined;
  shortUrl: string | undefined;
  hasScheduledChanges: boolean;
  notes: Record<string, string>;
}

export function parseRazorpaySubscription(raw: Record<string, unknown>): RazorpaySubscription {
  return {
    id: str(raw.id) ?? "",
    planId: str(raw.plan_id),
    status: str(raw.status) ?? "",
    currentStart: num(raw.current_start),
    currentEnd: num(raw.current_end),
    chargeAt: num(raw.charge_at),
    startAt: num(raw.start_at),
    endedAt: num(raw.ended_at),
    paidCount: num(raw.paid_count) ?? 0,
    totalCount: num(raw.total_count),
    shortUrl: str(raw.short_url),
    hasScheduledChanges: raw.has_scheduled_changes === true,
    notes: stringMap(raw.notes),
  };
}

/**
 * Create a subscription the member authorizes in Razorpay Checkout.
 * `startAt` (unix seconds) delays the first charge, which is how a free
 * trial works on Razorpay. `totalCount` is the number of billing cycles.
 */
export async function createRazorpaySubscription(input: {
  planId: string;
  totalCount: number;
  startAt?: number;
  notes: Record<string, string>;
}): Promise<RazorpaySubscription> {
  if (!isRazorpayPlanId(input.planId)) throw new GatewayError("Razorpay", "Invalid Razorpay plan id.", 400);
  const body: Record<string, unknown> = { plan_id: input.planId, total_count: input.totalCount, quantity: 1, customer_notify: 1, notes: input.notes };
  if (input.startAt) body.start_at = input.startAt;
  const sub = parseRazorpaySubscription(await razorpayRequest("POST", "/subscriptions", body));
  if (!sub.id) throw new GatewayError("Razorpay", "Razorpay did not return a subscription id.");
  return sub;
}

export async function fetchRazorpaySubscription(subscriptionId: string, opts: GatewayRequestOptions = {}): Promise<RazorpaySubscription> {
  if (!isRazorpaySubscriptionId(subscriptionId)) throw new GatewayError("Razorpay", "Invalid Razorpay subscription id.", 400);
  return parseRazorpaySubscription(await razorpayRequest("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`, undefined, opts));
}

/** Cancel now, or at the end of the current billing cycle (which cannot be undone on Razorpay). */
export async function cancelRazorpaySubscription(subscriptionId: string, atCycleEnd: boolean): Promise<RazorpaySubscription> {
  if (!isRazorpaySubscriptionId(subscriptionId)) throw new GatewayError("Razorpay", "Invalid Razorpay subscription id.", 400);
  return parseRazorpaySubscription(
    await razorpayRequest("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
  );
}

export interface RazorpayInvoice {
  id: string;
  subscriptionId: string | undefined;
  paymentId: string | undefined;
  /** "issued" | "paid" | "partially_paid" | "expired" | "cancelled" */
  status: string;
  amountPaid: number;
  currency: string;
  /** Unix seconds of the billing cycle the invoice covers. */
  billingStart: number | undefined;
  billingEnd: number | undefined;
}

export function parseRazorpayInvoice(raw: Record<string, unknown>): RazorpayInvoice {
  return {
    id: str(raw.id) ?? "",
    subscriptionId: str(raw.subscription_id),
    paymentId: str(raw.payment_id),
    status: str(raw.status) ?? "",
    amountPaid: num(raw.amount_paid) ?? 0,
    currency: str(raw.currency) ?? "",
    billingStart: num(raw.billing_start),
    billingEnd: num(raw.billing_end),
  };
}

/** Invoices of a subscription, newest first (one per billing cycle). */
export async function listRazorpaySubscriptionInvoices(subscriptionId: string, opts: GatewayRequestOptions = {}): Promise<RazorpayInvoice[]> {
  if (!isRazorpaySubscriptionId(subscriptionId)) throw new GatewayError("Razorpay", "Invalid Razorpay subscription id.", 400);
  const json = await razorpayRequest("GET", `/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&count=50`, undefined, opts);
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((i) => parseRazorpayInvoice(obj(i))).filter((i) => i.id);
}

/** Switch a subscription to another plan from its next billing cycle. */
export async function changeRazorpaySubscriptionPlan(subscriptionId: string, planId: string): Promise<RazorpaySubscription> {
  if (!isRazorpaySubscriptionId(subscriptionId)) throw new GatewayError("Razorpay", "Invalid Razorpay subscription id.", 400);
  if (!isRazorpayPlanId(planId)) throw new GatewayError("Razorpay", "Invalid Razorpay plan id.", 400);
  return parseRazorpaySubscription(
    await razorpayRequest("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { plan_id: planId, schedule_change_at: "cycle_end", customer_notify: 1 }),
  );
}

/* ------------------------------------------------------------------ */
/* Webhook payloads                                                    */
/* ------------------------------------------------------------------ */

export interface RazorpayEvent {
  event: string;
  payment: RazorpayPayment | null;
  order: RazorpayOrder | null;
  refund: RazorpayRefund | null;
  subscription: RazorpaySubscription | null;
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
  const subscription = entity("subscription");
  return {
    event,
    payment: payment ? parseRazorpayPayment(payment) : null,
    order: order ? parseRazorpayOrder(order) : null,
    refund: refund ? parseRazorpayRefund(refund) : null,
    subscription: subscription ? parseRazorpaySubscription(subscription) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Connection check                                                    */
/* ------------------------------------------------------------------ */

export async function pingRazorpay(): Promise<void> {
  await razorpayRequest("GET", "/orders?count=1", undefined, { timeoutMs: 10_000 });
}
