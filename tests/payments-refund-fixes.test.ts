import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Payment } from "@/lib/types";
import { stripeEnv } from "@/lib/server-env";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { acquireRefundLock, applyRefund, fulfillPayment, releaseRefundLock } from "@/lib/payments/fulfillment";
import { handleRazorpayEvent, handleStripeEvent } from "@/lib/payments/webhooks";
import { parseRazorpayEvent } from "@/lib/payments/razorpay";
import { parseStripeEvent } from "@/lib/payments/stripe";
import { refundPaymentAction } from "@/lib/actions/payments";
import { makeBatch, makeCourse, makeEnrollment, makePayment, makeProgress, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Review fixes, payments area: refunds.
 *  3. Razorpay `refund.processed` is idempotent (refund ids are remembered,
 *     totals only grow) and safe under concurrent deliveries.
 *  4. Refunding one of two paid orders for the same item keeps the access
 *     the other one grants (course, batch, certificate).
 *  5. Webhooks arriving during an in-app refund are retried, and a refund
 *     retried after a timeout records the earlier refund instead of sending
 *     a second one.
 */

const learner = makeUser({ id: "usr_rl", name: "Rae Learner" });
const admin = makeUser({ id: "usr_radmin", roles: ["admin"] });
const course = makeCourse({ id: "crs_rf", title: "Refund course", price: 50000, paidCourse: true, currency: "INR", paidCertificate: true, certificatePrice: 2000 });
const batch = makeBatch({ id: "bat_rf", title: "Refund batch", paidBatch: true, amount: 8000, courseIds: [course.id] });

before(() => {
  stripeEnv.secretKey = "sk_test_refunds123";
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

async function setup(payments: Payment[], extra: { enrollments?: ReturnType<typeof makeEnrollment>[] } = {}) {
  await resetDb({
    users: [learner, admin],
    courses: [course],
    batches: [batch],
    payments,
    enrollments: extra.enrollments ?? [],
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
}

async function row(id: string): Promise<Payment> {
  const found = (await getDb()).payments.find((p) => p.id === id);
  assert.ok(found);
  return found;
}

/* ------------------------------------------------------------------ */
/* Finding 3                                                           */
/* ------------------------------------------------------------------ */

const rzpPaid = () =>
  makePayment({ id: "pay_rz", userId: learner.id, itemId: course.id, currency: "INR", amount: 50000, originalAmount: 50000, gateway: "razorpay", gatewayPaymentId: "pay_RzFixture01", gatewayOrderId: "order_RzFixture1" });

function refundEvent(refundId: string, amount: number, cumulative?: number) {
  const payload: Record<string, unknown> = { refund: { entity: { id: refundId, entity: "refund", payment_id: "pay_RzFixture01", amount, currency: "INR", status: "processed" } } };
  if (cumulative !== undefined) {
    payload.payment = {
      entity: { id: "pay_RzFixture01", entity: "payment", amount: 50000, currency: "INR", status: cumulative >= 50000 ? "refunded" : "captured", captured: true, amount_refunded: cumulative, refund_status: cumulative >= 50000 ? "full" : "partial", notes: {} },
    };
  }
  const event = parseRazorpayEvent({ entity: "event", event: "refund.processed", payload });
  assert.ok(event);
  return event;
}

describe("finding 3: Razorpay refund.processed is idempotent", () => {
  beforeEach(async () => {
    await setup([rzpPaid()]);
    await fulfillPayment("pay_rz", "pay_RzFixture01");
  });

  it("counts a redelivered refund once (with the running total in the payload)", async () => {
    await handleRazorpayEvent(refundEvent("rfnd_R1", 10000, 10000));
    await handleRazorpayEvent(refundEvent("rfnd_R2", 10000, 20000));
    await handleRazorpayEvent(refundEvent("rfnd_R1", 10000, 10000));
    const order = await row("pay_rz");
    assert.equal(order.refundedAmount, 20000);
    assert.equal(order.status, "paid");
    assert.deepEqual(order.refunds?.map((r) => r.id), ["rfnd_R1", "rfnd_R2"]);
  });

  it("never turns alternating redeliveries into a full refund (without a running total)", async () => {
    for (const id of ["rfnd_R1", "rfnd_R2", "rfnd_R1", "rfnd_R2", "rfnd_R1"]) await handleRazorpayEvent(refundEvent(id, 10000));
    const order = await row("pay_rz");
    assert.equal(order.refundedAmount, 20000);
    assert.equal(order.status, "paid");
    assert.ok((await getDb()).enrollments.some((e) => e.userId === learner.id && e.courseId === course.id));
  });

  it("keeps both of two concurrent refunds", async () => {
    await Promise.all([handleRazorpayEvent(refundEvent("rfnd_R1", 10000)), handleRazorpayEvent(refundEvent("rfnd_R2", 10000))]);
    assert.equal((await row("pay_rz")).refundedAmount, 20000);
  });

  it("closes the order once everything was refunded", async () => {
    await handleRazorpayEvent(refundEvent("rfnd_R1", 20000, 20000));
    await handleRazorpayEvent(refundEvent("rfnd_R2", 30000, 50000));
    const order = await row("pay_rz");
    assert.equal(order.status, "refunded");
    assert.equal(order.refundedAmount, 50000);
    assert.equal((await getDb()).enrollments.some((e) => e.courseId === course.id), false);
  });
});

/* ------------------------------------------------------------------ */
/* Finding 4                                                           */
/* ------------------------------------------------------------------ */

describe("finding 4: refunding one of two paid orders keeps the other's access", () => {
  const paidOrder = (id: string, overrides: Partial<Payment> = {}) =>
    makePayment({ id, userId: learner.id, itemId: course.id, currency: "INR", amount: 50000, gateway: "manual", status: "pending", ...overrides });

  it("course: keeps the enrollment and its progress, re-pointed to the other order", async () => {
    await setup([paidOrder("pay_a"), paidOrder("pay_b")]);
    await fulfillPayment("pay_a", "manual_1");
    await fulfillPayment("pay_b", "manual_2");
    const lesson = { id: "les_rf", courseId: course.id, chapterId: "chp_rf" };
    (await getDb()).progress.push(makeProgress(lesson, learner.id));

    assert.ok((await applyRefund("pay_a", { amount: 50000 })).ok);
    let db = await getDb();
    const enrollment = db.enrollments.find((e) => e.userId === learner.id && e.courseId === course.id);
    assert.equal(enrollment?.paymentId, "pay_b");
    assert.equal(db.progress.length, 1);

    assert.ok((await applyRefund("pay_b", { amount: 50000 })).ok);
    db = await getDb();
    assert.equal(db.enrollments.some((e) => e.courseId === course.id), false);
    assert.equal(db.progress.length, 0);
  });

  it("course: keeps an enrollment another purchase created, and one a batch seat covers", async () => {
    await setup([paidOrder("pay_a", { status: "paid" })], { enrollments: [makeEnrollment({ userId: learner.id, courseId: course.id, paymentId: "pay_other" })] });
    await applyRefund("pay_a", { amount: 50000 });
    assert.equal((await getDb()).enrollments.length, 1);

    await setup([paidOrder("pay_a", { status: "paid" })], { enrollments: [makeEnrollment({ userId: learner.id, courseId: course.id, paymentId: "pay_a" })] });
    (await getDb()).batchEnrollments.push({ id: "ben_rf", batchId: batch.id, userId: learner.id, confirmationEmailSent: true, enrolledAt: "2026-01-20T00:00:00.000Z" });
    await applyRefund("pay_a", { amount: 50000 });
    const kept = (await getDb()).enrollments.find((e) => e.courseId === course.id);
    assert.ok(kept);
    assert.equal(kept.paymentId, undefined);
  });

  it("batch: keeps the seat when another paid order for the batch exists", async () => {
    const batchOrder = (id: string) => paidOrder(id, { itemType: "batch", itemId: batch.id, itemTitle: batch.title, amount: 8000 });
    await setup([batchOrder("pay_ba"), batchOrder("pay_bb")]);
    await fulfillPayment("pay_ba", "manual_1");
    await fulfillPayment("pay_bb", "manual_2");
    await applyRefund("pay_ba", { amount: 8000 });
    const db = await getDb();
    const seat = db.batchEnrollments.find((e) => e.batchId === batch.id && e.userId === learner.id);
    assert.equal(seat?.paymentId, "pay_bb");
    assert.ok(db.enrollments.some((e) => e.courseId === course.id));
  });

  it("certificate: keeps the purchased certificate when another paid order exists", async () => {
    const certOrder = (id: string) => paidOrder(id, { itemType: "certificate", itemTitle: "Certificate", amount: 2000 });
    await setup([certOrder("pay_ca"), certOrder("pay_cb")], { enrollments: [makeEnrollment({ userId: learner.id, courseId: course.id })] });
    await fulfillPayment("pay_ca", "manual_1");
    await fulfillPayment("pay_cb", "manual_2");
    await applyRefund("pay_ca", { amount: 2000 });
    assert.equal((await getDb()).enrollments.find((e) => e.courseId === course.id)?.purchasedCertificate, true);
    await applyRefund("pay_cb", { amount: 2000 });
    assert.equal((await getDb()).enrollments.find((e) => e.courseId === course.id)?.purchasedCertificate, false);
  });
});

/* ------------------------------------------------------------------ */
/* Finding 5                                                           */
/* ------------------------------------------------------------------ */

type Reply = { status?: number; body: unknown };
let stripeRefunds: { id: string; amount: number; status: string; metadata: Record<string, string> }[] = [];
let postReply: () => Reply;
let posts: { key: string | null; body: string }[] = [];

describe("finding 5: in-app refunds and webhooks do not lose or duplicate refunds", () => {
  const stripePaid = () =>
    makePayment({ id: "pay_st", userId: learner.id, itemId: course.id, currency: "USD", amount: 5000, originalAmount: 5000, gateway: "stripe", gatewayPaymentId: "pi_RefundFixture1", status: "pending" });

  before(() => {
    mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      let reply: Reply;
      if ((init.method ?? "GET") === "GET" && url.pathname === "/v1/refunds") reply = { body: { object: "list", data: stripeRefunds } };
      else if (init.method === "POST" && url.pathname === "/v1/refunds") {
        posts.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: String(init.body) });
        reply = postReply();
      } else throw new TypeError(`unexpected request ${url.pathname}`);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    });
  });

  beforeEach(async () => {
    await setup([stripePaid()]);
    await fulfillPayment("pay_st", "pi_RefundFixture1");
    stripeRefunds = [];
    posts = [];
    postReply = () => ({ body: { id: "re_Fixture0001", object: "refund", amount: 5000, status: "succeeded", metadata: { paymentId: "pay_st" } } });
    resetRequest();
    await createSession(admin.id);
  });

  it("asks for a redelivery of refund webhooks while a refund is being sent", async () => {
    assert.equal(acquireRefundLock("pay_st"), true);
    try {
      const event = parseStripeEvent({ object: "event", id: "evt_r", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_RefundFixture1", amount: 5000, amount_refunded: 5000, refunded: true, currency: "usd" } } });
      assert.ok(event);
      const outcome = await handleStripeEvent(event);
      assert.equal(outcome.retry, true);
      assert.equal((await row("pay_st")).status, "paid");
    } finally {
      releaseRefundLock("pay_st");
    }
  });

  it("sends a refund with a state-derived idempotency key and records its id", async () => {
    const res = await refundPaymentAction("pay_st");
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.key, "refund-pay_st-full-0");
    const order = await row("pay_st");
    assert.equal(order.status, "refunded");
    assert.deepEqual(order.refunds?.map((r) => r.id), ["re_Fixture0001"]);
  });

  it("records a refund that went through during a timed-out request instead of sending another", async () => {
    postReply = () => {
      stripeRefunds = [{ id: "re_Fixture0001", amount: 5000, status: "succeeded", metadata: { paymentId: "pay_st" } }];
      throw new TypeError("socket hang up");
    };
    const first = await refundPaymentAction("pay_st");
    assert.equal(first.ok, false);
    assert.match(first.ok ? "" : first.error, /Retrying is safe/);
    assert.equal((await row("pay_st")).status, "paid");

    const retry = await refundPaymentAction("pay_st");
    assert.ok(retry.ok, retry.ok ? "" : retry.error);
    assert.match(retry.message ?? "", /already gone through/);
    assert.equal(posts.length, 1);
    const order = await row("pay_st");
    assert.equal(order.status, "refunded");
    assert.equal(order.refundedAmount, 5000);
    assert.equal(order.refundId, "re_Fixture0001");
  });

  it("records a dashboard refund the webhook missed and asks the admin to review", async () => {
    stripeRefunds = [{ id: "re_Dashboard01", amount: 1500, status: "succeeded", metadata: {} }];
    const res = await refundPaymentAction("pay_st", { amount: "10.00" });
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error, /already shows/);
    assert.equal(posts.length, 0);
    const order = await row("pay_st");
    assert.equal(order.status, "paid");
    assert.equal(order.refundedAmount, 1500);
  });

  it("'already refunded in the dashboard' uses the gateway total instead of adding the typed amount again", async () => {
    // The webhook already recorded a 1500 partial refund; the admin now marks the order refunded.
    stripeRefunds = [{ id: "re_Dashboard01", amount: 1500, status: "succeeded", metadata: {} }];
    const webhook = parseStripeEvent({ object: "event", id: "evt_p", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_RefundFixture1", amount: 5000, amount_refunded: 1500, refunded: false, currency: "usd" } } });
    assert.ok(webhook);
    await handleStripeEvent(webhook);
    assert.equal((await row("pay_st")).refundedAmount, 1500);
    const res = await refundPaymentAction("pay_st", { amount: "15.00", recordOnly: true });
    assert.ok(res.ok, res.ok ? "" : res.error);
    const order = await row("pay_st");
    assert.equal(order.status, "refunded");
    assert.equal(order.refundedAmount, 1500);
    assert.equal(posts.length, 0);
  });
});
