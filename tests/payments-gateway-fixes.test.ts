import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Payment, Program } from "@/lib/types";
import { razorpayEnv, stripeEnv } from "@/lib/server-env";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { confirmRazorpayCheckout, reconcileStripeSession, syncPaymentStatus } from "@/lib/payments/gateway";
import { handleRazorpayEvent, handleStripeEvent } from "@/lib/payments/webhooks";
import { parseStripeEvent, parseStripeSession } from "@/lib/payments/stripe";
import { parseRazorpayEvent } from "@/lib/payments/razorpay";
import { confirmRazorpayPaymentAction } from "@/lib/actions/payments";
import { makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Review fixes, payments area: gateway reconciliation.
 *  1. A refunded or disputed payment never fulfils an unpaid order (Stripe and Razorpay).
 *  6. Webhooks reach orders relabelled "manual"; money for deleted orders alerts admins.
 *  7. Razorpay confirm never fulfils on the signature alone.
 *  8. The Razorpay confirm action checks the session and ownership.
 *  9. A fulfilment whose access grant failed is retried by the next confirmation.
 */

const learner = makeUser({ id: "usr_buyer", name: "Bea Buyer" });
const stranger = makeUser({ id: "usr_stranger" });
const admin = makeUser({ id: "usr_boss", roles: ["admin"] });
const course = makeCourse({ id: "crs_gw", title: "Gateway course", price: 5000, paidCourse: true });

type Reply = { status?: number; body: unknown };
type Handler = (url: URL, init: RequestInit) => Reply | Promise<Reply>;
let handler: Handler;
let calls: string[] = [];

function respond(routes: Record<string, Reply | (() => Reply)>): Handler {
  return (url, init) => {
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new TypeError(`unexpected request ${key}`);
    return typeof route === "function" ? route() : route;
  };
}

const offline: Handler = () => {
  throw new TypeError("fetch failed");
};

before(() => {
  stripeEnv.secretKey = "sk_test_fixture123";
  razorpayEnv.keyId = "rzp_test_fixture";
  razorpayEnv.keySecret = "rzp_secret_fixture";
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
  mock.method(console, "error", () => undefined);
  mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? "GET"} ${url.pathname}${url.search}`);
    const reply = await handler(url, init);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
});
after(() => mock.restoreAll());

async function setup(...payments: Payment[]) {
  await resetDb({
    users: [learner, stranger, admin],
    courses: [course],
    payments,
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
  handler = offline;
  calls = [];
}

const stripeOrder = (overrides: Partial<Payment> = {}) =>
  makePayment({ id: "pay_s1", userId: learner.id, itemId: course.id, itemTitle: course.title, amount: 5000, originalAmount: 5000, gateway: "stripe", gatewayOrderId: "cs_test_session001", ...overrides });

const rzpOrder = (overrides: Partial<Payment> = {}) =>
  makePayment({
    id: "pay_r1",
    userId: learner.id,
    itemId: course.id,
    itemTitle: course.title,
    amount: 50000,
    originalAmount: 50000,
    currency: "INR",
    gateway: "razorpay",
    gatewayOrderId: "order_fixture01",
    ...overrides,
  });

function paidSession(paymentId: string, paymentIntent = "pi_fixture0001") {
  return {
    object: "checkout.session",
    id: "cs_test_session001",
    status: "complete",
    payment_status: "paid",
    amount_total: 5000,
    currency: "usd",
    payment_intent: paymentIntent,
    client_reference_id: paymentId,
    metadata: { paymentId },
  };
}

function paymentIntent(charge: Partial<{ amount_refunded: number; refunded: boolean; disputed: boolean }> = {}) {
  return {
    id: "pi_fixture0001",
    status: "succeeded",
    amount: 5000,
    amount_received: 5000,
    currency: "usd",
    latest_charge: { id: "ch_fixture01", status: "succeeded", paid: true, amount_refunded: 0, refunded: false, disputed: false, ...charge },
  };
}

function rzpPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_Fixture0001",
    entity: "payment",
    order_id: "order_fixture01",
    amount: 50000,
    currency: "INR",
    status: "captured",
    captured: true,
    amount_refunded: 0,
    refund_status: null,
    notes: { paymentId: "pay_r1" },
    ...overrides,
  };
}

async function row(id: string): Promise<Payment> {
  const found = (await getDb()).payments.find((p) => p.id === id);
  assert.ok(found, `payment ${id}`);
  return found;
}

async function adminAlerts(pattern: RegExp): Promise<number> {
  return (await getDb()).notifications.filter((n) => n.userId === admin.id && pattern.test(n.subject)).length;
}

async function enrolled(): Promise<boolean> {
  return (await getDb()).enrollments.some((e) => e.userId === learner.id && e.courseId === course.id);
}

describe("finding 1: refunded or disputed Stripe payments never fulfil an order", () => {
  beforeEach(() => setup(stripeOrder()));

  it("closes a stuck order whose payment was refunded in the dashboard, and tells admins once", async () => {
    handler = respond({ "GET /v1/payment_intents/pi_fixture0001": { body: paymentIntent({ amount_refunded: 5000, refunded: true }) } });
    const session = parseStripeSession(paidSession("pay_s1"));
    const state = await reconcileStripeSession(await row("pay_s1"), session, "sync");
    assert.equal(state.state, "failed");
    const order = await row("pay_s1");
    assert.equal(order.status, "failed");
    assert.match(order.failureReason ?? "", /refunded/);
    assert.equal(order.invoiceNumber, undefined);
    assert.equal(await enrolled(), false);
    assert.ok(calls.some((c) => c.includes("expand%5B%5D=latest_charge")));
    // The learner reopens the return URL / Stripe resends the old snapshot: still nothing is granted.
    const replay = parseStripeEvent({ object: "event", id: "evt_1", type: "checkout.session.completed", data: { object: paidSession("pay_s1") } });
    assert.ok(replay);
    await handleStripeEvent(replay);
    assert.equal((await row("pay_s1")).status, "failed");
    assert.equal(await enrolled(), false);
    assert.equal(await adminAlerts(/was not fulfilled/), 1);
  });

  it("treats partial refunds and disputes the same way", async () => {
    handler = respond({ "GET /v1/payment_intents/pi_fixture0001": { body: paymentIntent({ amount_refunded: 100 }) } });
    assert.equal((await reconcileStripeSession(await row("pay_s1"), parseStripeSession(paidSession("pay_s1")), "sync")).state, "failed");
    await setup(stripeOrder());
    handler = respond({ "GET /v1/payment_intents/pi_fixture0001": { body: paymentIntent({ disputed: true }) } });
    const state = await reconcileStripeSession(await row("pay_s1"), parseStripeSession(paidSession("pay_s1")), "sync");
    assert.deepEqual(state.state, "failed");
    assert.match((await row("pay_s1")).failureReason ?? "", /disputed/);
    assert.equal(await enrolled(), false);
  });

  it("fulfils when the money is still there, and waits when Stripe cannot be asked", async () => {
    handler = offline;
    await assert.rejects(reconcileStripeSession(await row("pay_s1"), parseStripeSession(paidSession("pay_s1")), "stripe_return"));
    assert.equal((await row("pay_s1")).status, "pending");

    handler = respond({ "GET /v1/payment_intents/pi_fixture0001": { body: paymentIntent() } });
    const state = await reconcileStripeSession(await row("pay_s1"), parseStripeSession(paidSession("pay_s1")), "stripe_return");
    assert.equal(state.state, "paid");
    assert.equal((await row("pay_s1")).gatewayPaymentId, "pi_fixture0001");
    assert.equal(await enrolled(), true);
  });
});

describe("finding 1: refunded Razorpay payments never fulfil an order", () => {
  beforeEach(() => setup(rzpOrder()));

  it("re-reads a webhook snapshot: a payment refunded since then closes the order", async () => {
    handler = respond({ "GET /v1/payments/pay_Fixture0001": { body: rzpPayment({ status: "refunded", amount_refunded: 50000, refund_status: "full" }) } });
    const event = parseRazorpayEvent({ entity: "event", event: "payment.captured", payload: { payment: { entity: rzpPayment() } } });
    assert.ok(event);
    await handleRazorpayEvent(event);
    const order = await row("pay_r1");
    assert.equal(order.status, "failed");
    assert.match(order.failureReason ?? "", /refunded/);
    assert.equal(await enrolled(), false);
  });

  it("does not settle an order from a partially refunded captured payment", async () => {
    handler = respond({ "GET /v1/orders/order_fixture01/payments": { body: { entity: "collection", items: [rzpPayment({ amount_refunded: 10000, refund_status: "partial" })] } } });
    const state = await syncPaymentStatus(await row("pay_r1"));
    assert.equal(state.state, "failed");
    assert.equal((await row("pay_r1")).status, "failed");
    assert.equal(await enrolled(), false);
  });

  it("still fulfils a clean captured payment", async () => {
    handler = respond({ "GET /v1/orders/order_fixture01/payments": { body: { entity: "collection", items: [rzpPayment()] } } });
    assert.equal((await syncPaymentStatus(await row("pay_r1"))).state, "paid");
    assert.equal(await enrolled(), true);
  });
});

const signature = (orderId: string, paymentId: string) => createHmac("sha256", "rzp_secret_fixture").update(`${orderId}|${paymentId}`).digest("hex");

describe("finding 7: the Razorpay checkout signature alone never fulfils an order", () => {
  beforeEach(() => setup(rzpOrder()));

  it("answers 'processing' while Razorpay is unreachable, and settles once it answers", async () => {
    const input = { razorpayOrderId: "order_fixture01", razorpayPaymentId: "pay_Fixture0001", signature: signature("order_fixture01", "pay_Fixture0001") };
    handler = offline;
    assert.deepEqual(await confirmRazorpayCheckout(await row("pay_r1"), input), { state: "processing" });
    assert.equal((await row("pay_r1")).status, "pending");
    assert.equal(await enrolled(), false);

    handler = respond({ "GET /v1/payments/pay_Fixture0001": { body: rzpPayment() } });
    assert.equal((await confirmRazorpayCheckout(await row("pay_r1"), input)).state, "paid");
    assert.equal(await enrolled(), true);
  });

  it("rejects a forged signature", async () => {
    const state = await confirmRazorpayCheckout(await row("pay_r1"), { razorpayOrderId: "order_fixture01", razorpayPaymentId: "pay_Fixture0001", signature: "0".repeat(64) });
    assert.equal(state.state, "error");
    assert.equal(calls.length, 0);
  });
});

describe("finding 8: confirmRazorpayPaymentAction checks the session and ownership", () => {
  const input = () => ({ orderId: "ORD-PAY_R1", razorpayOrderId: "order_fixture01", razorpayPaymentId: "pay_Fixture0001", razorpaySignature: signature("order_fixture01", "pay_Fixture0001") });

  beforeEach(async () => {
    await setup(rzpOrder({ orderId: "ORD-PAY_R1" }));
    resetRequest();
  });

  it("refuses anonymous callers and answers foreign and missing orders alike", async () => {
    const anonymous = await confirmRazorpayPaymentAction(input());
    assert.equal(anonymous.ok, false);
    assert.equal(calls.length, 0);

    await createSession(stranger.id);
    const foreign = await confirmRazorpayPaymentAction(input());
    const missing = await confirmRazorpayPaymentAction({ ...input(), orderId: "ORD-NOPE", razorpayOrderId: "order_fixture01" });
    assert.deepEqual(foreign, { ok: false, error: "Order not found." });
    assert.deepEqual(missing, foreign);
    assert.equal(calls.length, 0);
    assert.equal((await row("pay_r1")).status, "pending");
  });

  it("lets the buyer confirm their own order", async () => {
    await createSession(learner.id);
    handler = respond({ "GET /v1/payments/pay_Fixture0001": { body: rzpPayment() } });
    const res = await confirmRazorpayPaymentAction(input());
    assert.ok(res.ok);
    assert.equal((await row("pay_r1")).status, "paid");
  });
});

describe("finding 6: late payments reach relabelled or deleted orders", () => {
  it("flags a Stripe payment for an order an admin already confirmed by hand", async () => {
    await setup(stripeOrder({ status: "paid", gateway: "manual", gatewayPaymentId: "manual_usr_boss_1", paidAt: "2026-01-15T12:00:00.000Z" }));
    const event = parseStripeEvent({ object: "event", id: "evt_late", type: "checkout.session.completed", data: { object: paidSession("pay_s1", "pi_latepayment1") } });
    assert.ok(event);
    const outcome = await handleStripeEvent(event);
    assert.equal(outcome.handled, true);
    assert.equal(await adminAlerts(/^Possible duplicate payment/), 1);
  });

  it("tells admins once about money received for a deleted order", async () => {
    await setup();
    const raw = { entity: "event", event: "payment.captured", payload: { payment: { entity: rzpPayment({ notes: { paymentId: "pay_deleted" } }) } } };
    for (let i = 0; i < 2; i++) {
      const event = parseRazorpayEvent(raw);
      assert.ok(event);
      assert.equal((await handleRazorpayEvent(event)).handled, true);
    }
    assert.equal(await adminAlerts(/payment without an order/), 1);
  });
});

describe("finding 9: an access grant that failed is retried", () => {
  it("keeps the order paid, alerts admins and grants access on the next confirmation", async () => {
    await setup(stripeOrder({ status: "pending" }));
    // A broken program row makes enrolling throw after the order was claimed.
    await (async () => {
      const db = await getDb();
      db.programs.push({ id: "prg_broken", courseIds: null } as unknown as Program);
    })();
    const first = await fulfillPayment("pay_s1", "pi_fixture0001");
    assert.ok(first.ok);
    assert.equal(first.data.accessFailed, true);
    assert.equal((await row("pay_s1")).status, "paid");
    assert.equal(await adminAlerts(/access could not be granted/), 1);

    (await getDb()).programs.length = 0;
    (await getDb()).enrollments.length = 0;
    const retry = await fulfillPayment("pay_s1", "pi_fixture0001");
    assert.ok(retry.ok && !retry.data.fulfilled && !retry.data.accessFailed);
    assert.equal(await enrolled(), true);
  });
});
