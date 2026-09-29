import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  acquireRefundLock,
  applyRefund,
  fulfillPayment,
  isGatewayPaymentReference,
  hasOrderAccess,
  isAnyGatewayPaymentReference,
  isRefundInProgress,
  markPaymentFailed,
  mergeRefund,
  recordGatewayRefund,
  releaseRefundLock,
  restoreOrderAccess,
} from "@/lib/payments/fulfillment";
import { getDb } from "@/lib/db/store";
import { makeBatch, makeCoupon, makeCourse, makePayment, makeUser, resetDb } from "../helpers/db";

const learner = makeUser({ id: "usr_learner", name: "Lea Learner" });
const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_paid", title: "Paid course", price: 5000, paidCourse: true });
const certCourse = makeCourse({ id: "crs_cert", title: "Cert course", paidCertificate: true, certificatePrice: 2000 });
const batch = makeBatch({ id: "bat_paid", title: "Paid batch", paidBatch: true, amount: 8000, courseIds: [course.id], seatCount: 1 });
const coupon = makeCoupon({ id: "cpn_1", code: "TEN", usageLimit: 5, redemptionCount: 1 });

const order = (overrides: Parameters<typeof makePayment>[0]) =>
  makePayment({ gateway: "stripe", status: "pending", amount: 5000, originalAmount: 5000, itemTitle: "Paid course", ...overrides });

async function setup(...payments: ReturnType<typeof makePayment>[]) {
  await resetDb({
    users: [learner, admin, makeUser({ id: "usr_other" })],
    courses: [course, certCourse],
    batches: [batch],
    coupons: [coupon],
    payments,
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
}

describe("fulfillPayment (store)", () => {
  before(() => mock.method(console, "info", () => undefined));
  after(() => mock.restoreAll());

  beforeEach(async () => {
    await setup(order({ id: "pay_1", userId: learner.id, itemId: course.id, couponId: coupon.id }));
  });

  it("marks the order paid, enrolls the learner, numbers the invoice and redeems the coupon", async () => {
    const result = await fulfillPayment("pay_1", "pi_abc123", { source: "stripe_webhook" });
    assert.ok(result.ok);
    assert.equal(result.data.fulfilled, true);
    assert.equal(result.data.payment.status, "paid");
    assert.equal(result.data.payment.gatewayPaymentId, "pi_abc123");
    assert.match(result.data.payment.invoiceNumber!, /^INV-\d{4}-00001$/);
    const db = await getDb();
    assert.equal(db.enrollments.filter((e) => e.userId === learner.id && e.courseId === course.id).length, 1);
    assert.equal(db.enrollments.find((e) => e.courseId === course.id)?.paymentId, "pay_1");
    assert.equal(db.coupons[0]!.redemptionCount, 2);
    assert.ok(db.notifications.some((n) => n.userId === learner.id && n.subject === "Payment received for Paid course"));
  });

  it("fulfils exactly once, however many confirmations race", async () => {
    const results = await Promise.all([
      fulfillPayment("pay_1", "pi_abc123", { source: "stripe_return" }),
      fulfillPayment("pay_1", "pi_abc123", { source: "stripe_webhook" }),
      fulfillPayment("pay_1", undefined, { source: "admin" }),
    ]);
    assert.ok(results.every((r) => r.ok));
    assert.equal(results.filter((r) => r.ok && r.data.fulfilled).length, 1);
    const db = await getDb();
    assert.equal(db.enrollments.length, 1);
    assert.equal(db.coupons[0]!.redemptionCount, 2);
    assert.equal(new Set(db.payments.map((p) => p.invoiceNumber)).size, 1);
  });

  it("flags a second real payment for an already paid order to the admins", async () => {
    await fulfillPayment("pay_1", "pi_first");
    const again = await fulfillPayment("pay_1", "pi_second");
    assert.ok(again.ok && !again.data.fulfilled);
    const db = await getDb();
    assert.ok(db.notifications.some((n) => n.userId === admin.id && n.subject.startsWith("Possible duplicate payment")));
    assert.equal(db.payments[0]!.gatewayPaymentId, "pi_first");
  });

  it("refuses missing and refunded orders", async () => {
    assert.deepEqual(await fulfillPayment("pay_missing"), { ok: false, error: "Payment not found." });
    await fulfillPayment("pay_1", "pi_first");
    await applyRefund("pay_1", { amount: 5000, refundId: "re_1" });
    assert.deepEqual(await fulfillPayment("pay_1", "pi_first"), { ok: false, error: "Refunded orders cannot be marked as paid." });
  });

  it("gives free orders no invoice number", async () => {
    await setup(order({ id: "pay_free", userId: learner.id, itemId: course.id, amount: 0, gateway: "free" }));
    const result = await fulfillPayment("pay_free");
    assert.ok(result.ok && result.data.fulfilled);
    assert.equal(result.ok && result.data.payment.invoiceNumber, undefined);
  });

  it("numbers invoices sequentially across orders", async () => {
    await setup(
      order({ id: "pay_a", userId: learner.id, itemId: course.id }),
      order({ id: "pay_b", userId: "usr_other", itemId: course.id }),
    );
    const [a, b] = await Promise.all([fulfillPayment("pay_a"), fulfillPayment("pay_b")]);
    const numbers = [a, b].map((r) => (r.ok ? r.data.payment.invoiceNumber : null)).sort();
    assert.deepEqual(numbers.map((n) => n?.slice(-5)), ["00001", "00002"]);
  });

  it("reports batch purchases that could not get a seat", async () => {
    await setup(
      order({ id: "pay_seat1", userId: "usr_other", itemType: "batch", itemId: batch.id, amount: 8000, itemTitle: "Paid batch" }),
      order({ id: "pay_seat2", userId: learner.id, itemType: "batch", itemId: batch.id, amount: 8000, itemTitle: "Paid batch" }),
    );
    const first = await fulfillPayment("pay_seat1");
    assert.ok(first.ok && !first.data.notice);
    const second = await fulfillPayment("pay_seat2");
    assert.ok(second.ok);
    assert.match(second.ok ? (second.data.notice ?? "") : "", /no seat could be allocated/);
    const db = await getDb();
    assert.equal(db.batchEnrollments.length, 1);
    assert.ok(db.notifications.some((n) => n.userId === admin.id && n.subject === "Order ORD-PAY_SEAT2 needs attention"));
  });
});

describe("failures and refunds (store)", () => {
  before(() => mock.method(console, "info", () => undefined));
  after(() => mock.restoreAll());

  beforeEach(async () => {
    await setup(order({ id: "pay_1", userId: learner.id, itemId: course.id, couponId: coupon.id, gatewayOrderId: "cs_new" }));
  });

  it("marks only pending orders (and the current checkout attempt) as failed", async () => {
    assert.equal(await markPaymentFailed("pay_1", "expired", { gatewayOrderId: "cs_old" }), false);
    assert.equal(await markPaymentFailed("pay_1", "x".repeat(400), { gatewayOrderId: "cs_new" }), true);
    const db = await getDb();
    assert.equal(db.payments[0]!.status, "failed");
    assert.equal(db.payments[0]!.failureReason?.length, 300);
    assert.equal(await markPaymentFailed("pay_1", "again"), false);
    // A later successful payment of a failed attempt still fulfils the order.
    const late = await fulfillPayment("pay_1", "pi_late");
    assert.ok(late.ok && late.data.fulfilled);
    assert.equal((await getDb()).payments[0]!.failureReason, undefined);
    assert.equal(await markPaymentFailed("pay_1", "too late"), false);
  });

  it("refunds once, revokes access and releases the coupon redemption", async () => {
    await fulfillPayment("pay_1", "pi_1");
    const refund = await applyRefund("pay_1", { amount: 999999, refundId: "re_1" });
    assert.ok(refund.ok && refund.data.changed);
    assert.equal(refund.ok && refund.data.payment.refundedAmount, 5000);
    let db = await getDb();
    assert.equal(db.enrollments.length, 0);
    assert.equal(db.coupons[0]!.redemptionCount, 1);
    const again = await applyRefund("pay_1", { amount: 5000, refundId: "re_1" });
    assert.ok(again.ok && !again.data.changed);
    db = await getDb();
    assert.equal(db.coupons[0]!.redemptionCount, 1);
    assert.deepEqual(await applyRefund("pay_missing", { amount: 1 }), { ok: false, error: "Payment not found." });
  });

  it("refuses to refund unpaid orders", async () => {
    assert.deepEqual(await applyRefund("pay_1", { amount: 5000 }), { ok: false, error: "Only paid orders can be refunded." });
  });

  it("records gateway refunds: partial keeps access, redeliveries count once, the full amount closes the order", async () => {
    await fulfillPayment("pay_1", "pi_1");
    assert.equal((await recordGatewayRefund("pay_1", { refundId: "re_part", amount: 1000 })).kind, "partial");
    assert.equal((await recordGatewayRefund("pay_1", { refundId: "re_part", amount: 1000 })).kind, "unchanged");
    let db = await getDb();
    assert.equal(db.payments[0]!.status, "paid");
    assert.equal(db.payments[0]!.refundedAmount, 1000);
    assert.equal(db.enrollments.length, 1);
    assert.equal(hasOrderAccess(db, db.payments[0]!), true);

    const full = await recordGatewayRefund("pay_1", { refundId: "re_rest", amount: 4000 });
    assert.equal(full.kind, "refunded");
    db = await getDb();
    assert.equal(db.payments[0]!.refundedAmount, 5000);
    assert.equal(db.enrollments.length, 0);
    assert.equal(hasOrderAccess(db, db.payments[0]!), false);
    assert.equal((await recordGatewayRefund("pay_missing", { amount: 1 })).kind, "missing");
  });

  it("does not refund orders that were never paid", async () => {
    assert.equal((await recordGatewayRefund("pay_1", { refundId: "re_x", amount: 100 })).kind, "not_paid");
  });

  it("restores access for a paid order whose enrollment went missing", async () => {
    await fulfillPayment("pay_1", "pi_1");
    const db = await getDb();
    db.enrollments.length = 0;
    assert.equal(await restoreOrderAccess("pay_1"), true);
    assert.equal((await getDb()).enrollments.length, 1);
    assert.equal(await restoreOrderAccess("pay_missing"), false);
  });

  it("revokes a paid certificate on refund", async () => {
    await setup(order({ id: "pay_cert", userId: learner.id, itemType: "certificate", itemId: certCourse.id, amount: 2000, itemTitle: "Certificate" }));
    await fulfillPayment("pay_cert");
    let db = await getDb();
    assert.equal(db.enrollments.find((e) => e.courseId === certCourse.id)?.purchasedCertificate, true);
    await applyRefund("pay_cert", { amount: 2000 });
    db = await getDb();
    assert.equal(db.enrollments.find((e) => e.courseId === certCourse.id)?.purchasedCertificate, false);
  });
});

describe("gateway helpers", () => {
  it("recognises real gateway payment ids", () => {
    assert.equal(isGatewayPaymentReference("stripe", "pi_3Nabc"), true);
    assert.equal(isGatewayPaymentReference("stripe", "ch_3Nabc"), false);
    assert.equal(isGatewayPaymentReference("razorpay", "pay_Nabc"), true);
    assert.equal(isGatewayPaymentReference("manual", "pay_Nabc"), false);
    assert.equal(isGatewayPaymentReference("stripe", undefined), false);
    assert.equal(isAnyGatewayPaymentReference("pay_Nabc"), true);
    assert.equal(isAnyGatewayPaymentReference("manual-ref-1"), false);
  });

  it("merges refunds idempotently, never lowering the total or exceeding the order", () => {
    const row = makePayment({ userId: "u", itemId: "c", status: "paid", amount: 5000 });
    const at = "2026-05-01T00:00:00.000Z";
    assert.equal(mergeRefund(row, { refundId: "re_1", amount: 1000 }, at), true);
    assert.equal(mergeRefund(row, { refundId: "re_1", amount: 1000 }, at), false);
    assert.equal(row.refundedAmount, 1000);
    assert.equal(mergeRefund(row, { refundId: "re_2", amount: 1500 }, at), true);
    assert.equal(row.refundedAmount, 2500);
    // An old, redelivered gateway total cannot lower the recorded amount.
    assert.equal(mergeRefund(row, { total: 1000 }, at), false);
    assert.equal(row.refundedAmount, 2500);
    assert.equal(mergeRefund(row, { total: 9999 }, at), true);
    assert.equal(row.refundedAmount, 5000);
    assert.deepEqual(row.refunds?.map((r) => r.id), ["re_1", "re_2"]);
    assert.equal(row.refundId, "re_2");
  });

  it("holds one refund lock per order", () => {
    assert.equal(acquireRefundLock("pay_lock"), true);
    assert.equal(acquireRefundLock("pay_lock"), false);
    assert.equal(isRefundInProgress("pay_lock"), true);
    releaseRefundLock("pay_lock");
    assert.equal(isRefundInProgress("pay_lock"), false);
    assert.equal(acquireRefundLock("pay_lock"), true);
    releaseRefundLock("pay_lock");
  });
});
