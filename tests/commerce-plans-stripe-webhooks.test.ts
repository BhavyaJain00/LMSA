import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { MembershipPlan, Payment } from "@/lib/types";
import { stripeEnv } from "@/lib/server-env";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { joinCourseWithMembership } from "@/lib/commerce/membership-service";
import { subscriptionGrantsAccess } from "@/lib/commerce/subscriptions";
import { reconcileStripeSession } from "@/lib/payments/gateway";
import { parseStripeEvent, parseStripeSession } from "@/lib/payments/stripe";
import { handleStripeEvent } from "@/lib/payments/webhooks";
import { makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";

/**
 * Stripe membership webhooks: `customer.subscription.*`, `invoice.paid` and
 * `invoice.payment_failed` drive the `Subscription` row and record each
 * charge as an order with its own invoice number. Stripe is faked at the
 * `fetch` level; the handlers always read the subscription back from the API,
 * so `remote` below is what "Stripe says now".
 */

const DAY = 86_400;
/** Start of the current billing period: yesterday, so the membership is running while the tests execute. */
const T0 = Math.floor(Date.now() / 1000) - DAY;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

const member = makeUser({ id: "usr_member", name: "Mia Member" });
const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_paid", title: "Paid course", paidCourse: true, price: 5000 });
const plan: MembershipPlan = {
  id: "plan_all",
  slug: "all-access",
  name: "All access",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 0,
  access: { type: "all" },
  active: true,
  features: [],
  createdAt: iso(T0 - 30 * DAY),
  updatedAt: iso(T0 - 30 * DAY),
};

const SUB_ID = "sub_test1234567890";
const SESSION_ID = "cs_test_membership0001";
const metadata = { paymentId: "pay_m1", orderId: "ORD-PAY_M1", planId: plan.id, userId: member.id };

/** What the fake Stripe API returns for the subscription and its payment intents. */
let remote: { subscription: Record<string, unknown> | null; intents: Record<string, Record<string, unknown>> };
let calls: string[] = [];

function stripeSub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUB_ID,
    object: "subscription",
    status: "active",
    current_period_start: T0,
    current_period_end: T0 + 30 * DAY,
    trial_end: null,
    cancel_at_period_end: false,
    ended_at: null,
    canceled_at: null,
    customer: "cus_test123",
    metadata,
    items: { data: [{ id: "si_test123", price: { id: "price_test123456", product: "prod_test123" } }] },
    latest_invoice: { id: "in_first0001", subscription: SUB_ID, billing_reason: "subscription_create", status: "paid", amount_paid: 1900, amount_due: 1900, currency: "usd", payment_intent: "pi_first0000001" },
    ...overrides,
  };
}

const succeeded = (id: string) => ({ id, status: "succeeded", amount: 1900, amount_received: 1900, currency: "usd", latest_charge: { id: `ch_${id}`, status: "succeeded", paid: true, amount_refunded: 0, refunded: false, disputed: false } });

function event(type: string, object: Record<string, unknown>) {
  const parsed = parseStripeEvent({ id: `evt_${type.replace(/\W/g, "_")}_${calls.length}`, object: "event", type, livemode: false, data: { object } });
  assert.ok(parsed, "fixture is a Stripe event");
  return parsed;
}

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: "in_first0001",
  object: "invoice",
  subscription: SUB_ID,
  billing_reason: "subscription_create",
  status: "paid",
  amount_paid: 1900,
  amount_due: 1900,
  currency: "usd",
  payment_intent: "pi_first0000001",
  ...overrides,
});

const checkoutOrder = (overrides: Partial<Payment> = {}): Payment =>
  makePayment({ id: "pay_m1", userId: member.id, itemType: "plan", itemId: plan.id, planId: plan.id, itemTitle: plan.name, amount: 1900, originalAmount: 1900, gateway: "stripe", gatewayOrderId: SESSION_ID, ...overrides });

async function setup(...payments: Payment[]) {
  await resetDb({
    users: [member, admin],
    courses: [course],
    plans: [plan],
    payments: payments.length ? payments : [checkoutOrder()],
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
  remote = { subscription: stripeSub(), intents: { pi_first0000001: succeeded("pi_first0000001"), pi_renewal000001: succeeded("pi_renewal000001") } };
  calls = [];
}

async function membership() {
  const db = await getDb();
  return db.subscriptions.find((s) => s.gatewaySubscriptionId === SUB_ID) ?? null;
}

before(() => {
  stripeEnv.secretKey = "sk_test_fixture123";
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
  mock.method(console, "error", () => undefined);
  mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push(`${init.method ?? "GET"} ${url.pathname}`);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === `/v1/subscriptions/${SUB_ID}`) {
      return remote.subscription ? reply(remote.subscription) : reply({ error: { type: "invalid_request_error", message: "No such subscription" } }, 404);
    }
    const intent = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(url.pathname)?.[1];
    if (intent && remote.intents[intent]) return reply(remote.intents[intent]);
    throw new TypeError(`unexpected request ${init.method ?? "GET"} ${url.pathname}`);
  });
});
after(() => mock.restoreAll());
beforeEach(() => setup());

describe("customer.subscription.created / updated", () => {
  it("creates the membership from the checkout order and links the order to it", async () => {
    const outcome = await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    assert.equal(outcome.handled, true);
    assert.match(outcome.message, /\(created\)/);
    const row = await membership();
    assert.ok(row);
    assert.deepEqual(
      { userId: row.userId, planId: row.planId, status: row.status, gateway: row.gateway, start: row.currentPeriodStart, end: row.currentPeriodEnd, cancel: row.cancelAtPeriodEnd },
      { userId: member.id, planId: plan.id, status: "active", gateway: "stripe", start: iso(T0), end: iso(T0 + 30 * DAY), cancel: false },
    );
    const db = await getDb();
    assert.equal(db.payments.find((p) => p.id === "pay_m1")?.subscriptionId, row.id);
    // The order itself is settled by the first invoice, not by the subscription event.
    assert.equal(db.payments.find((p) => p.id === "pay_m1")?.status, "pending");
  });

  it("is idempotent: a redelivered event neither duplicates the membership nor announces it twice", async () => {
    await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    await handleStripeEvent(event("customer.subscription.updated", stripeSub()));
    await settleEvents();
    const db = await getDb();
    assert.equal(db.subscriptions.length, 1);
    assert.equal(db.notifications.filter((n) => n.userId === member.id && /Welcome to All access/.test(n.subject)).length, 1);
  });

  it("waits while the first payment is still incomplete", async () => {
    remote.subscription = stripeSub({ status: "incomplete" });
    const outcome = await handleStripeEvent(event("customer.subscription.created", remote.subscription));
    assert.equal(outcome.handled, false);
    assert.equal(await membership(), null);
  });

  it("trusts what Stripe says now, not a stale payload", async () => {
    await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    // An old "past_due" snapshot is redelivered after the payment recovered: the API read wins.
    await handleStripeEvent(event("customer.subscription.updated", stripeSub({ status: "past_due", current_period_end: T0 - DAY })));
    const row = await membership();
    assert.equal(row?.status, "active");
    assert.equal(row?.currentPeriodEnd, iso(T0 + 30 * DAY));
  });

  it("ignores subscriptions that belong to no member or plan here", async () => {
    await setup(checkoutOrder({ id: "pay_other", itemId: plan.id }));
    remote.subscription = stripeSub({ metadata: {} });
    const outcome = await handleStripeEvent(event("customer.subscription.created", remote.subscription));
    assert.equal(outcome.handled, false);
    assert.equal((await getDb()).subscriptions.length, 0);
  });

  it("records a scheduled cancellation and its undo", async () => {
    await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    remote.subscription = stripeSub({ cancel_at_period_end: true });
    await handleStripeEvent(event("customer.subscription.updated", remote.subscription));
    assert.equal((await membership())?.cancelAtPeriodEnd, true);
    assert.equal((await membership())?.status, "active");
    remote.subscription = stripeSub({ cancel_at_period_end: false });
    await handleStripeEvent(event("customer.subscription.updated", remote.subscription));
    assert.equal((await membership())?.cancelAtPeriodEnd, false);
  });
});

describe("invoice.paid", () => {
  it("settles the checkout order with the first invoice and numbers its invoice", async () => {
    const outcome = await handleStripeEvent(event("invoice.paid", invoice()));
    assert.equal(outcome.handled, true);
    const db = await getDb();
    const order = db.payments.find((p) => p.id === "pay_m1")!;
    assert.equal(order.status, "paid");
    assert.equal(order.gatewayPaymentId, "pi_first0000001");
    assert.match(order.invoiceNumber!, /^INV-\d{4}-00001$/);
    assert.equal(db.payments.length, 1, "the first invoice is the checkout order, not a renewal");
    const row = await membership();
    assert.equal(row?.status, "active");
    assert.equal(order.subscriptionId, row?.id);
  });

  it("works when invoice.paid arrives before any subscription event, and only once", async () => {
    await handleStripeEvent(event("invoice.paid", invoice()));
    const again = await handleStripeEvent(event("invoice.paid", invoice()));
    assert.match(again.message, /already recorded/);
    await handleStripeEvent(event("customer.subscription.created", stripeSub()));
    const db = await getDb();
    assert.equal(db.subscriptions.length, 1);
    assert.equal(db.payments.length, 1);
  });

  it("leaves an order whose amount differs from the invoice for review", async () => {
    const outcome = await handleStripeEvent(event("invoice.paid", invoice({ amount_paid: 900 })));
    assert.match(outcome.message, /amount differs/);
    assert.equal((await getDb()).payments.find((p) => p.id === "pay_m1")?.status, "pending");
  });

  it("records each renewal as its own paid order with the next invoice number and extends the period", async () => {
    await handleStripeEvent(event("invoice.paid", invoice()));
    // One month later Stripe charges the renewal.
    remote.subscription = stripeSub({ current_period_start: T0 + 30 * DAY, current_period_end: T0 + 60 * DAY });
    const renewal = invoice({ id: "in_renewal0001", billing_reason: "subscription_cycle", payment_intent: "pi_renewal000001" });
    const outcome = await handleStripeEvent(event("invoice.paid", renewal));
    assert.equal(outcome.handled, true);
    assert.match(outcome.message, /renewal in_renewal0001: order ORD-\S+ paid/);

    const db = await getDb();
    const row = db.subscriptions[0]!;
    assert.equal(row.currentPeriodEnd, iso(T0 + 60 * DAY));
    const orders = db.payments.filter((p) => p.subscriptionId === row.id).sort((a, b) => a.invoiceNumber!.localeCompare(b.invoiceNumber!));
    assert.equal(orders.length, 2);
    const renewed = orders[1]!;
    assert.deepEqual(
      { type: renewed.itemType, planId: renewed.planId, title: renewed.itemTitle, status: renewed.status, amount: renewed.amount, currency: renewed.currency, gateway: renewed.gateway, gatewayOrderId: renewed.gatewayOrderId, pi: renewed.gatewayPaymentId, source: renewed.source, userId: renewed.userId },
      { type: "plan", planId: plan.id, title: "All access · renewal", status: "paid", amount: 1900, currency: "USD", gateway: "stripe", gatewayOrderId: "in_renewal0001", pi: "pi_renewal000001", source: "Renewal", userId: member.id },
    );
    assert.match(renewed.invoiceNumber!, /^INV-\d{4}-00002$/);
    assert.equal(renewed.billingName, orders[0]!.billingName, "billing details are carried over from the first order");

    // Redelivered: no third order.
    const again = await handleStripeEvent(event("invoice.paid", renewal));
    assert.match(again.message, /already recorded/);
    assert.equal((await getDb()).payments.length, 2);
  });

  it("carries the tax share of the first order over to renewals", async () => {
    await setup(checkoutOrder({ originalAmount: 1900, taxAmount: 342, amount: 2242, taxRate: 18, taxCountry: "IN" }));
    remote.subscription = stripeSub({ latest_invoice: invoice({ amount_paid: 2242, amount_due: 2242 }) });
    await handleStripeEvent(event("invoice.paid", invoice({ amount_paid: 2242, amount_due: 2242 })));
    await handleStripeEvent(event("invoice.paid", invoice({ id: "in_renewal0001", billing_reason: "subscription_cycle", payment_intent: "pi_renewal000001", amount_paid: 2242, amount_due: 2242 })));
    const renewed = (await getDb()).payments.find((p) => p.gatewayOrderId === "in_renewal0001")!;
    assert.deepEqual({ original: renewed.originalAmount, tax: renewed.taxAmount, total: renewed.amount, rate: renewed.taxRate, country: renewed.taxCountry }, { original: 1900, tax: 342, total: 2242, rate: 18, country: "IN" });
  });

  it("only refreshes the membership for a zero-amount invoice (a trial starting)", async () => {
    remote.subscription = stripeSub({ status: "trialing", trial_end: T0 + 7 * DAY, current_period_end: T0 + 7 * DAY });
    const outcome = await handleStripeEvent(event("invoice.paid", invoice({ amount_paid: 0, amount_due: 0, payment_intent: null })));
    assert.match(outcome.message, /zero-amount invoice/);
    const db = await getDb();
    assert.equal(db.subscriptions[0]?.status, "trialing");
    assert.equal(db.payments.length, 1);
    assert.equal(db.payments[0]!.status, "pending");
  });

  it("ignores invoices that are not for a subscription", async () => {
    const outcome = await handleStripeEvent(event("invoice.paid", invoice({ subscription: null })));
    assert.equal(outcome.handled, false);
    assert.deepEqual(calls, []);
  });
});

describe("invoice.payment_failed and recovery", () => {
  beforeEach(async () => {
    await handleStripeEvent(event("invoice.paid", invoice()));
    await settleEvents();
  });

  it("moves the membership to past due, tells the member once and keeps access during the grace period", async () => {
    remote.subscription = stripeSub({ status: "past_due" });
    const failed = invoice({ id: "in_failed0001", billing_reason: "subscription_cycle", status: "open", amount_paid: 0, payment_intent: "pi_failed0000001" });
    const outcome = await handleStripeEvent(event("invoice.payment_failed", failed));
    assert.match(outcome.message, /payment failed \(past_due\)/);
    await handleStripeEvent(event("invoice.payment_failed", failed));
    await settleEvents();

    const db = await getDb();
    const row = db.subscriptions[0]!;
    assert.equal(row.status, "past_due");
    assert.equal(subscriptionGrantsAccess(row, Date.parse(row.currentPeriodEnd) + 2 * DAY * 1000), true);
    assert.equal(db.notifications.filter((n) => n.userId === member.id && /^Action needed: payment for All access/.test(n.subject)).length, 1);
    assert.equal(db.payments.length, 1, "a failed invoice records no order");
  });

  it("returns to active when the retry succeeds and records the renewal", async () => {
    remote.subscription = stripeSub({ status: "past_due" });
    await handleStripeEvent(event("customer.subscription.updated", remote.subscription));
    remote.subscription = stripeSub({ current_period_start: T0 + 30 * DAY, current_period_end: T0 + 60 * DAY });
    await handleStripeEvent(event("invoice.paid", invoice({ id: "in_retry00001", billing_reason: "subscription_cycle", payment_intent: "pi_renewal000001" })));
    const db = await getDb();
    assert.equal(db.subscriptions[0]!.status, "active");
    assert.equal(db.payments.filter((p) => p.status === "paid").length, 2);
  });

  it("expires the membership when Stripe gives up (unpaid)", async () => {
    remote.subscription = stripeSub({ status: "unpaid" });
    await handleStripeEvent(event("customer.subscription.updated", remote.subscription));
    await settleEvents();
    const db = await getDb();
    assert.equal(db.subscriptions[0]!.status, "expired");
    assert.equal(subscriptionGrantsAccess(db.subscriptions[0]!), false);
    assert.ok(db.notifications.some((n) => n.userId === member.id && /has expired/.test(n.subject)));
  });
});

describe("customer.subscription.deleted", () => {
  it("ends the membership at the moment Stripe ended it and locks its courses", async () => {
    await handleStripeEvent(event("invoice.paid", invoice()));
    assert.deepEqual(await joinCourseWithMembership(member, course), { ok: true, alreadyEnrolled: false });
    assert.equal(resolveCourseAccess(await getDb(), member.id, course.id).via, "membership");

    const endedAt = Math.floor(Date.now() / 1000) - 60;
    remote.subscription = stripeSub({ status: "canceled", cancel_at_period_end: true, ended_at: endedAt, canceled_at: endedAt, current_period_end: Math.floor(Date.now() / 1000) + 20 * DAY });
    const outcome = await handleStripeEvent(event("customer.subscription.deleted", remote.subscription));
    assert.match(outcome.message, /cancelled/);
    await settleEvents();

    const db = await getDb();
    const row = db.subscriptions[0]!;
    assert.deepEqual({ status: row.status, end: row.currentPeriodEnd, cancel: row.cancelAtPeriodEnd }, { status: "cancelled", end: iso(endedAt), cancel: false });
    const access = resolveCourseAccess(db, member.id, course.id);
    assert.equal(access.granted, false);
    assert.equal(access.blocked, "membership_lapsed");
    assert.ok(db.enrollments.some((e) => e.userId === member.id && e.courseId === course.id), "the enrollment and its progress are kept");
    assert.ok(db.notifications.some((n) => n.userId === member.id && /membership has ended/.test(n.subject)));
    assert.equal(db.payments.find((p) => p.id === "pay_m1")?.status, "paid", "the paid order is untouched");
  });
});

describe("checkout return for a membership (mode=subscription)", () => {
  const session = (overrides: Record<string, unknown> = {}) =>
    parseStripeSession({ id: SESSION_ID, mode: "subscription", status: "complete", payment_status: "paid", amount_total: 1900, currency: "usd", client_reference_id: "pay_m1", metadata, subscription: SUB_ID, ...overrides });

  it("starts a free trial as a zero-amount order without an invoice", async () => {
    remote.subscription = stripeSub({ status: "trialing", trial_end: T0 + 7 * DAY, current_period_end: T0 + 7 * DAY, latest_invoice: invoice({ amount_paid: 0, amount_due: 0, payment_intent: null }) });
    const state = await reconcileStripeSession(checkoutOrder(), session({ payment_status: "no_payment_required", amount_total: 0 }), "stripe_return");
    assert.equal(state.state, "paid");
    await settleEvents();
    const db = await getDb();
    const order = db.payments[0]!;
    assert.deepEqual({ status: order.status, amount: order.amount, discount: order.discountAmount, title: order.itemTitle }, { status: "paid", amount: 0, discount: 1900, title: "All access · free trial" });
    const row = db.subscriptions[0]!;
    assert.deepEqual({ status: row.status, end: row.currentPeriodEnd }, { status: "trialing", end: iso(T0 + 7 * DAY) });
    assert.ok(db.notifications.some((n) => n.userId === member.id && /free trial of All access has started/.test(n.subject)));
  });

  it("settles a charged first period once the payment intent holds the money", async () => {
    const state = await reconcileStripeSession(checkoutOrder(), session(), "stripe_return");
    assert.equal(state.state, "paid");
    const db = await getDb();
    assert.equal(db.payments[0]!.gatewayPaymentId, "pi_first0000001");
    assert.equal(db.subscriptions[0]!.status, "active");
    // The webhook for the same invoice then finds it recorded.
    const outcome = await handleStripeEvent(event("invoice.paid", invoice()));
    assert.match(outcome.message, /already recorded/);
    assert.equal((await getDb()).payments.length, 1);
  });

  it("does not start a membership whose first payment was refunded", async () => {
    remote.intents.pi_first0000001 = { ...succeeded("pi_first0000001"), latest_charge: { id: "ch_1", status: "succeeded", paid: true, amount_refunded: 1900, refunded: true, disputed: false } };
    const state = await reconcileStripeSession(checkoutOrder(), session(), "stripe_return");
    assert.equal(state.state, "failed");
    assert.equal((await getDb()).payments[0]!.status, "failed");
  });

  it("fails the order when the session expired and refuses a session of another order", async () => {
    const expired = await reconcileStripeSession(checkoutOrder(), session({ status: "expired", payment_status: "unpaid", subscription: null }), "sync");
    assert.equal(expired.state, "failed");
    assert.equal((await getDb()).payments[0]!.status, "failed");
    await setup();
    const foreign = await reconcileStripeSession(checkoutOrder(), session({ client_reference_id: "pay_else", metadata: { paymentId: "pay_else" } }), "sync");
    assert.equal(foreign.state, "error");
    assert.equal((await getDb()).subscriptions.length, 0);
  });
});
