import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { insertPendingOrder, validateCouponForBuyer, type BillingItem } from "@/lib/data/commerce";
import { COUPON_ATTEMPT_RULES, COUPON_LIMIT_REACHED, couponAttemptsBlocked, couponOverflow, recordRejectedCoupon } from "@/lib/payments/coupon-rules";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { reopenFailedOrder } from "@/lib/payments/gateway";
import { makeCoupon, makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Review fixes, payments area: coupons.
 *  2. A limited coupon is reserved atomically with the order that uses it
 *     (concurrent checkouts cannot over-redeem it); reopening a failed order
 *     re-checks it; an overflow at fulfilment alerts the admins.
 * 11. Rejected coupon codes are rate limited per buyer and per IP.
 */

const admin = makeUser({ id: "usr_cadmin", roles: ["admin"] });
const buyers = ["usr_c1", "usr_c2", "usr_c3", "usr_c4", "usr_c5"].map((id) => makeUser({ id }));
const courses = ["crs_c1", "crs_c2", "crs_c3", "crs_c4", "crs_c5"].map((id) => makeCourse({ id, price: 5000, paidCourse: true }));
const single = makeCoupon({ id: "cpn_once", code: "ONCE", usageLimit: 1, value: 100 });

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

beforeEach(async () => {
  await resetDb({
    users: [admin, ...buyers],
    courses,
    coupons: [single],
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
});

function draft(userId: string, courseId: string, overrides: Partial<Payment> = {}): Omit<Payment, "orderId"> {
  const { orderId: _orderId, ...rest } = makePayment({ userId, itemId: courseId, couponId: single.id, couponCode: single.code, amount: 0, discountAmount: 5000, gateway: "free", ...overrides });
  void _orderId;
  return rest;
}

describe("finding 2: coupon usage limit is enforced inside the order insert", () => {
  it("lets exactly one of five concurrent checkouts use a single-use code", async () => {
    const results = await Promise.all(buyers.map((b, i) => insertPendingOrder(draft(b.id, courses[i]!.id))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((x) => !x.ok)) assert.deepEqual(r, { ok: false, error: COUPON_LIMIT_REACHED });
    const db = await getDb();
    assert.equal(db.payments.filter((p) => p.couponId === single.id).length, 1);
  });

  it("does the same for one account buying several items at once", async () => {
    const results = await Promise.all(courses.map((c) => insertPendingOrder(draft(buyers[0]!.id, c.id))));
    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  it("releases the use when the reserving order fails, and re-checks it when a failed order reopens", async () => {
    const first = await insertPendingOrder(draft(buyers[0]!.id, courses[0]!.id, { gateway: "stripe", amount: 100 }));
    assert.ok(first.ok);
    // The first checkout expires: its reservation is released and another buyer takes the code.
    (await getDb()).payments[0]!.status = "failed";
    const second = await insertPendingOrder(draft(buyers[1]!.id, courses[1]!.id));
    assert.ok(second.ok);
    const reopened = await reopenFailedOrder(first.payment.id);
    assert.equal(reopened.ok, false);
    assert.match(reopened.ok ? "" : reopened.error, /maximum usage limit/);
    assert.equal((await getDb()).payments.find((p) => p.id === first.payment.id)?.status, "failed");

    // Once the other order is gone the order can be reopened again.
    (await getDb()).payments.find((p) => p.id === second.payment.id)!.status = "failed";
    assert.deepEqual(await reopenFailedOrder(first.payment.id), { ok: true });
  });

  it("returns the open order instead of reserving a second use", async () => {
    const a = await insertPendingOrder(draft(buyers[0]!.id, courses[0]!.id));
    const b = await insertPendingOrder(draft(buyers[0]!.id, courses[0]!.id));
    assert.ok(a.ok && b.ok && b.existing);
    assert.equal(b.payment.id, a.payment.id);
  });

  it("alerts admins when a paid order pushes the coupon over its limit", async () => {
    const reserved = await insertPendingOrder(draft(buyers[0]!.id, courses[0]!.id));
    assert.ok(reserved.ok);
    // A cancelled checkout (no reservation) is paid in another tab.
    const late = makePayment({ id: "pay_late", userId: buyers[1]!.id, itemId: courses[1]!.id, couponId: single.id, status: "failed", amount: 100 });
    (await getDb()).payments.push(late);
    const res = await fulfillPayment("pay_late", "pi_latefixture1");
    assert.ok(res.ok && res.data.fulfilled);
    assert.match(res.data.notice ?? "", /usage limit/);
    const db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === admin.id && /over its usage limit/.test(n.subject)).length, 1);
    assert.deepEqual(couponOverflow(db.coupons[0]!, db.payments), { used: 2, limit: 1 });
  });
});

describe("finding 11: coupon guessing is rate limited", () => {
  const item: Pick<BillingItem, "type" | "id" | "currency"> = { type: "course", id: "crs_c1", currency: "USD" };

  it("blocks a buyer after too many rejected codes, even for a valid code, without affecting others", async () => {
    resetRequest({ headers: { "x-forwarded-for": "198.51.100.7" } });
    for (let i = 0; i < COUPON_ATTEMPT_RULES.user.limit; i++) {
      const check = await validateCouponForBuyer(`GUESS${i}`, item, { userId: "usr_c1" });
      assert.equal(check.ok, false);
    }
    const blocked = await validateCouponForBuyer("ONCE", item, { userId: "usr_c1" });
    assert.deepEqual(blocked.ok, false);
    assert.match(blocked.ok ? "" : blocked.error, /Too many coupon codes/);

    resetRequest({ headers: { "x-forwarded-for": "198.51.100.8" } });
    assert.equal((await validateCouponForBuyer("ONCE", item, { userId: "usr_c2" })).ok, true);
  });

  it("counts only rejected codes", async () => {
    resetRequest({ headers: { "x-forwarded-for": "198.51.100.9" } });
    for (let i = 0; i < COUPON_ATTEMPT_RULES.user.limit + 5; i++) assert.equal((await validateCouponForBuyer("ONCE", item, { userId: "usr_c3" })).ok, true);
  });

  it("limits an IP across accounts, but never pools unknown IPs", () => {
    const limiter = new SlidingWindowRateLimiter();
    const now = Date.UTC(2026, 0, 1);
    for (let i = 0; i < COUPON_ATTEMPT_RULES.ip.limit; i++) recordRejectedCoupon({ userId: `usr_ip${i}`, ip: "203.0.113.5" }, limiter, now);
    assert.match(couponAttemptsBlocked({ userId: "usr_fresh", ip: "203.0.113.5" }, limiter, now) ?? "", /Please wait 10 minutes/);
    assert.equal(couponAttemptsBlocked({ userId: "usr_fresh", ip: "203.0.113.6" }, limiter, now), null);
    for (let i = 0; i < COUPON_ATTEMPT_RULES.ip.limit; i++) recordRejectedCoupon({ userId: `usr_unknown${i}`, ip: "unknown" }, limiter, now);
    assert.equal(couponAttemptsBlocked({ userId: "usr_fresh", ip: "unknown" }, limiter, now), null);
    // The window slides: ten minutes later the IP may try again.
    assert.equal(couponAttemptsBlocked({ userId: "usr_fresh", ip: "203.0.113.5" }, limiter, now + COUPON_ATTEMPT_RULES.ip.windowMs + 1), null);
  });
});
