import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, Gift, MembershipPlan, Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { applyRefund, fulfillPayment } from "@/lib/payments/fulfillment";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { GIFT_CODE_RE, generateGiftCode, giftStatus, isGiftDue, isGiftRedeemable, normalizeGiftCode, validateGiftInput } from "@/lib/commerce/gifts";
import { deliverDueGifts, findGiftByCode, getAdminGifts, getMyGifts, giftsToCsv, lookupGift, parseAdminGiftFilter, redeemGift, resolveGiftItem } from "@/lib/commerce/gift-service";
import { placeGiftOrderAction, sendGiftNowAction, setGiftsEnabledAction } from "@/lib/actions/gifts";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Gifts: code format and parsing, status and delivery timing, the checkout
 * form rules, the gift checkout, delivery (now and scheduled), redemption
 * (single use, guessing protection, access through the recipient's own
 * order), refunds taking the gift back, and the admin read models.
 */

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

describe("gift codes", () => {
  it("generates codes in the canonical form", () => {
    for (let i = 0; i < 50; i++) assert.match(generateGiftCode(), GIFT_CODE_RE);
  });

  it("only uses unambiguous characters, even from biased random bytes", () => {
    const code = generateGiftCode((b) => b.fill(255).map((_, i) => (i % 2 ? 255 : 7)));
    assert.match(code, GIFT_CODE_RE);
    assert.ok(!/[01OIL]/.test(code.slice(5)));
  });

  it("normalises typed and pasted codes", () => {
    assert.equal(normalizeGiftCode("gift 8f3k 2q9z 7mwd"), "GIFT-8F3K-2Q9Z-7MWD");
    assert.equal(normalizeGiftCode("8F3K-2Q9Z-7MWD"), "GIFT-8F3K-2Q9Z-7MWD");
    assert.equal(normalizeGiftCode("  GIFT-8F3K-2Q9Z-7MWD "), "GIFT-8F3K-2Q9Z-7MWD");
    assert.equal(normalizeGiftCode("GIFT-8F3K-2Q9Z-7MW"), null);
    assert.equal(normalizeGiftCode("GIFT-0F3K-2Q9Z-7MWD"), null);
    assert.equal(normalizeGiftCode(42), null);
  });

  it("finds a gift by code", () => {
    const gifts = [{ code: "GIFT-AAAA-BBBB-CCCC" }, { code: "GIFT-DDDD-EEEE-FFFF" }];
    assert.equal(findGiftByCode(gifts, "GIFT-DDDD-EEEE-FFFF"), gifts[1]);
    assert.equal(findGiftByCode(gifts, "GIFT-DDDD-EEEE-FFFG"), null);
  });
});

describe("gift status", () => {
  const now = Date.parse("2026-05-01T10:00:00Z");
  const g = (over: Partial<Gift> = {}) => ({ sendAt: undefined, sentAt: undefined, redeemedAt: undefined, ...over });

  it("follows the order first", () => {
    assert.equal(giftStatus(g(), { status: "pending" }, now), "awaiting_payment");
    assert.equal(giftStatus(g(), { status: "failed" }, now), "cancelled");
    assert.equal(giftStatus(g(), null, now), "cancelled");
    assert.equal(giftStatus(g({ redeemedAt: "x" }), { status: "refunded" }, now), "refunded");
  });

  it("then redemption and delivery", () => {
    assert.equal(giftStatus(g({ sendAt: "2026-05-03T09:00:00Z" }), { status: "paid" }, now), "scheduled");
    assert.equal(giftStatus(g({ sendAt: "2026-04-30T09:00:00Z" }), { status: "paid" }, now), "sending");
    assert.equal(giftStatus(g(), { status: "paid" }, now), "sending");
    assert.equal(giftStatus(g({ sentAt: "x" }), { status: "paid" }, now), "delivered");
    assert.equal(giftStatus(g({ sentAt: "x", redeemedAt: "y" }), { status: "paid" }, now), "redeemed");
  });

  it("is due once paid and its send time has come", () => {
    assert.equal(isGiftDue(g({ sendAt: "2026-05-01T09:59:00Z" }), { status: "paid" }, now), true);
    assert.equal(isGiftDue(g({ sendAt: "2026-05-01T10:01:00Z" }), { status: "paid" }, now), false);
    assert.equal(isGiftDue(g(), { status: "pending" }, now), false);
    assert.equal(isGiftDue(g({ sentAt: "x" }), { status: "paid" }, now), false);
  });

  it("can be redeemed when paid and unused, delivered or not", () => {
    assert.equal(isGiftRedeemable(g({ sendAt: "2099-01-01T00:00:00Z" }), { status: "paid" }), true);
    assert.equal(isGiftRedeemable(g({ redeemedAt: "x" }), { status: "paid" }), false);
    assert.equal(isGiftRedeemable(g(), { status: "refunded" }), false);
  });
});

describe("gift form", () => {
  const now = Date.parse("2026-05-01T10:00:00Z");
  const input = (over: Partial<Parameters<typeof validateGiftInput>[0]> = {}) => ({ recipientEmail: "Friend@Example.com ", recipientName: "  Sam   Lee ", message: "Happy birthday!\r\nEnjoy", sendAt: "", ...over });

  it("normalises a valid gift", () => {
    const res = validateGiftInput(input(), { now });
    assert.deepEqual(res, { ok: true, value: { recipientEmail: "friend@example.com", recipientName: "Sam Lee", message: "Happy birthday!\nEnjoy", sendAt: undefined } });
  });

  it("refuses bad addresses, the buyer's own address and long texts", () => {
    const bad = validateGiftInput(input({ recipientEmail: "nope", message: "x".repeat(601) }), { now });
    assert.ok(!bad.ok);
    assert.ok(bad.errors.recipientEmail && bad.errors.message);
    const own = validateGiftInput(input({ recipientEmail: "me@example.com" }), { now, buyerEmail: "ME@example.com" });
    assert.ok(!own.ok && own.errors.recipientEmail);
  });

  it("schedules future sends, treats past or imminent times as now, and limits the horizon", () => {
    const later = validateGiftInput(input({ sendAt: "2026-05-10T09:00:00.000Z" }), { now });
    assert.ok(later.ok && later.value.sendAt === "2026-05-10T09:00:00.000Z");
    const soon = validateGiftInput(input({ sendAt: "2026-05-01T10:02:00Z" }), { now });
    assert.ok(soon.ok && soon.value.sendAt === undefined);
    const far = validateGiftInput(input({ sendAt: "2027-06-01T09:00:00Z" }), { now });
    assert.ok(!far.ok && far.errors.sendAt);
    const garbage = validateGiftInput(input({ sendAt: "no-date" }), { now });
    assert.ok(!garbage.ok && garbage.errors.sendAt);
  });
});

/* ------------------------------------------------------------------ */
/* Checkout, delivery and redemption                                   */
/* ------------------------------------------------------------------ */

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });
const friend = makeUser({ id: "usr_friend", name: "Sam Friend", email: "sam@example.com" });
const other = makeUser({ id: "usr_other", name: "Olly Other", email: "olly@example.com" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_py", slug: "python", title: "Python", paidCourse: true, price: 5000, currency: "USD" });
const course2 = makeCourse({ id: "crs_js", slug: "js", title: "JavaScript", paidCourse: true, price: 4000, currency: "USD" });
const free = makeCourse({ id: "crs_free", slug: "free", title: "Free", paidCourse: false, price: 0 });
const bundle: Bundle = { id: "bnd_1", slug: "starter", title: "Starter", description: "", courseIds: [course.id, course2.id], price: 7000, currency: "USD", published: true, createdAt: at(-5), updatedAt: at(-5) };
const plan: MembershipPlan = {
  id: "pln_m",
  slug: "monthly",
  name: "Monthly",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 0,
  access: { type: "all" },
  active: true,
  features: [],
  createdAt: at(-5),
  updatedAt: at(-5),
};

const CODE = "GIFT-AAAA-BBBB-CCCC";

function giftFixture(over: Partial<Gift> = {}, order: Partial<Payment> = {}): { gift: Gift; payment: Payment } {
  const gift: Gift = { id: "gft_1", code: CODE, purchaserId: buyer.id, recipientEmail: friend.email, recipientName: "Sam", itemType: "course", itemId: course.id, paymentId: "pay_gift", createdAt: at(-1), ...over };
  const payment = makePayment({ id: "pay_gift", userId: buyer.id, itemType: "gift", itemId: gift.id, giftId: gift.id, itemTitle: "Gift: Python", amount: 5000, originalAmount: 5000, gateway: "manual", status: "paid", paidAt: at(-1), ...order });
  return { gift, payment };
}

async function setup(fixture: { gifts?: Gift[]; payments?: Payment[]; enrollments?: ReturnType<typeof makeEnrollment>[]; giftsEnabled?: boolean; gateway?: "manual" | "none" } = {}) {
  await resetDb({
    users: [buyer, friend, other, admin],
    courses: [course, course2, free],
    bundles: [bundle],
    plans: [plan],
    gifts: fixture.gifts ?? [],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrollments ?? [],
    settings: {
      email: { enabled: false },
      gamification: { enabled: false },
      commerce: { paymentGateway: fixture.gateway ?? "manual" },
      growth: { giftsEnabled: fixture.giftsEnabled ?? true, bundlesEnabled: true, subscriptionsEnabled: true },
    },
  });
  resetRequest();
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

const billing = { billingName: "Bea Buyer", line1: "1 Main Street", city: "Lisbon", country: "Portugal", source: "Search engine", consent: "on" };

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

describe("giftable items", () => {
  it("accepts paid courses, bundles on sale and active plans", async () => {
    await setup();
    assert.ok((await resolveGiftItem("course", "python")).ok);
    assert.ok((await resolveGiftItem("bundle", "starter")).ok);
    assert.ok((await resolveGiftItem("plan", "monthly")).ok);
  });

  it("refuses free courses, unknown items and everything while gifts are off", async () => {
    await setup();
    assert.ok(!(await resolveGiftItem("course", "free")).ok);
    assert.ok(!(await resolveGiftItem("course", "nope")).ok);
    await setup({ giftsEnabled: false });
    assert.ok(!(await resolveGiftItem("course", "python")).ok);
  });
});

describe("gift checkout", () => {
  it("creates the gift and a pending manual order for the buyer", async () => {
    await setup();
    await createSession(buyer.id);
    const target = await captureRedirect(() =>
      placeGiftOrderAction(null, form({ giftType: "course", itemId: course.id, recipientEmail: "sam@example.com", recipientName: "Sam", message: "Enjoy", sendAt: "", expectedTotal: "5000", ...billing })),
    );
    assert.match(target, /^\/billing\/success\/ORD-/);
    const db = await getDb();
    assert.equal(db.gifts.length, 1);
    const gift = db.gifts[0]!;
    assert.match(gift.code, GIFT_CODE_RE);
    const order = db.payments.find((p) => p.id === gift.paymentId)!;
    assert.equal(order.itemType, "gift");
    assert.equal(order.itemId, gift.id);
    assert.equal(order.status, "pending");
    assert.equal(order.amount, 5000);
    assert.equal(order.itemTitle, "Gift: Python");
  });

  it("validates the recipient and refuses a changed price", async () => {
    await setup();
    await createSession(buyer.id);
    const own = await placeGiftOrderAction(null, form({ giftType: "course", itemId: course.id, recipientEmail: buyer.email, expectedTotal: "5000", ...billing }));
    assert.ok(!own.ok && own.fieldErrors?.recipientEmail);
    const price = await placeGiftOrderAction(null, form({ giftType: "course", itemId: course.id, recipientEmail: "sam@example.com", expectedTotal: "4000", ...billing }));
    assert.ok(!price.ok);
    assert.equal((await getDb()).gifts.length, 0);
  });

  it("delivers right away when the order is paid", async () => {
    const { gift, payment } = giftFixture({}, { status: "pending", paidAt: undefined });
    await setup({ gifts: [gift], payments: [payment] });
    const res = await fulfillPayment(payment.id, undefined, { source: "admin" });
    assert.ok(res.ok);
    await settleEvents();
    const db = await getDb();
    assert.ok(db.gifts[0]!.sentAt, "sent");
    // Nobody got the course yet: the gift is redeemed by the recipient.
    assert.equal(db.enrollments.length, 0);
    assert.ok(db.notifications.some((n) => n.userId === friend.id && n.dedupeKey === `gift:${gift.id}:received`));
    assert.ok(db.notifications.some((n) => n.userId === buyer.id && n.dedupeKey === `gift:${gift.id}:delivered`));
  });

  it("holds a scheduled gift until its send time", async () => {
    const { gift, payment } = giftFixture({ sendAt: at(3) }, { status: "pending", paidAt: undefined });
    await setup({ gifts: [gift], payments: [payment] });
    await fulfillPayment(payment.id, undefined, { source: "admin" });
    await settleEvents();
    assert.equal((await getDb()).gifts[0]!.sentAt, undefined);
    assert.deepEqual(await deliverDueGifts({ force: true }), { delivered: 0 });
    assert.deepEqual(await deliverDueGifts({ force: true, now: new Date(Date.now() + 4 * DAY) }), { delivered: 1 });
    assert.ok((await getDb()).gifts[0]!.sentAt);
    // Never twice.
    assert.deepEqual(await deliverDueGifts({ force: true, now: new Date(Date.now() + 5 * DAY) }), { delivered: 0 });
  });

  it("lets the buyer send a scheduled gift now, but not someone else", async () => {
    const { gift, payment } = giftFixture({ sendAt: at(3) });
    await setup({ gifts: [gift], payments: [payment] });
    await createSession(other.id);
    assert.ok(!(await sendGiftNowAction(gift.id)).ok);
    await createSession(buyer.id);
    const res = await sendGiftNowAction(gift.id);
    assert.ok(res.ok, res.ok ? "" : res.error);
    const row = (await getDb()).gifts[0]!;
    assert.ok(row.sentAt);
    assert.equal(row.sendAt, undefined);
  });
});

describe("redeeming a gift", () => {
  it("gives the recipient the course through a zero-amount order of their own, once", async () => {
    const { gift, payment } = giftFixture({ sentAt: at(-1) });
    await setup({ gifts: [gift], payments: [payment] });
    const res = await redeemGift(friend, "gift aaaa bbbb cccc", "203.0.113.5");
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(res.href, "/courses/python");
    await settleEvents();
    const db = await getDb();
    const order = db.payments.find((p) => p.userId === friend.id)!;
    assert.equal(order.itemType, "course");
    assert.equal(order.amount, 0);
    assert.equal(order.giftId, gift.id);
    assert.equal(order.status, "paid");
    const access = resolveCourseAccess(db, friend.id, course.id);
    assert.ok(access.granted);
    assert.equal(access.via, "purchase");
    assert.equal(db.gifts[0]!.redeemedBy, friend.id);

    const again = await redeemGift(other, CODE, "203.0.113.6");
    assert.ok(!again.ok && /already used/.test(again.error));
    const mine = await redeemGift(friend, CODE, "203.0.113.5");
    assert.ok(!mine.ok && /already redeemed/.test(mine.error));
  });

  it("keeps the code for someone else when the recipient already has the course", async () => {
    const { gift, payment } = giftFixture();
    const owned = makePayment({ id: "pay_own", userId: friend.id, itemId: course.id, status: "paid", paidAt: at(-9) });
    await setup({ gifts: [gift], payments: [payment, owned], enrollments: [makeEnrollment({ userId: friend.id, courseId: course.id, paymentId: "pay_own" })] });
    const res = await redeemGift(friend, CODE, null);
    assert.ok(!res.ok && /already have/.test(res.error));
    assert.equal((await getDb()).gifts[0]!.redeemedAt, undefined);
    assert.ok((await redeemGift(other, CODE, null)).ok);
  });

  it("refuses unpaid and refunded gifts", async () => {
    const pending = giftFixture({}, { status: "pending", paidAt: undefined });
    await setup({ gifts: [pending.gift], payments: [pending.payment] });
    assert.ok(!(await redeemGift(friend, CODE, null)).ok);
    const refunded = giftFixture({}, { status: "refunded", refundedAt: at(0) });
    await setup({ gifts: [refunded.gift], payments: [refunded.payment] });
    const res = await redeemGift(friend, CODE, null);
    assert.ok(!res.ok && /refunded/.test(res.error));
  });

  it("locks out guessing after too many wrong codes", async () => {
    const { gift, payment } = giftFixture();
    await setup({ gifts: [gift], payments: [payment] });
    const guesser = makeUser({ id: "usr_guess" });
    for (let i = 0; i < 10; i++) {
      const res = await redeemGift(guesser, `GIFT-ZZZZ-ZZZZ-ZZZ${"23456789AB"[i]}`, null);
      assert.ok(!res.ok);
    }
    const blocked = await redeemGift(guesser, CODE, null);
    assert.ok(!blocked.ok && /Too many/.test(blocked.error));
    const preview = await lookupGift(CODE, guesser, null);
    assert.equal(preview.preview, null);
    assert.match(preview.error ?? "", /Too many/);
  });

  it("unlocks every course of a gifted bundle", async () => {
    const { gift, payment } = giftFixture({ itemType: "bundle", itemId: bundle.id });
    await setup({ gifts: [gift], payments: [payment] });
    assert.ok((await redeemGift(friend, CODE, null)).ok);
    await settleEvents();
    const db = await getDb();
    assert.deepEqual(db.enrollments.filter((e) => e.userId === friend.id).map((e) => e.courseId).sort(), [course2.id, course.id].sort());
    assert.equal(resolveCourseAccess(db, friend.id, course2.id).via, "bundle");
  });

  it("starts a membership for one billing period from a gifted plan", async () => {
    const { gift, payment } = giftFixture({ itemType: "plan", itemId: plan.id });
    await setup({ gifts: [gift], payments: [payment] });
    assert.ok((await redeemGift(friend, CODE, null)).ok);
    await settleEvents();
    const db = await getDb();
    const sub = db.subscriptions.find((s) => s.userId === friend.id);
    assert.ok(sub);
    assert.equal(sub.status, "active");
    assert.equal(sub.planId, plan.id);
    const days = (Date.parse(sub.currentPeriodEnd) - Date.parse(sub.currentPeriodStart)) / DAY;
    assert.ok(days >= 28 && days <= 31, `period of ${days} days`);
  });

  it("takes the course back from the recipient when the gift is refunded", async () => {
    const { gift, payment } = giftFixture();
    await setup({ gifts: [gift], payments: [payment] });
    assert.ok((await redeemGift(friend, CODE, null)).ok);
    await settleEvents();
    const refund = await applyRefund(payment.id, { amount: 5000 });
    assert.ok(refund.ok);
    await settleEvents();
    const db = await getDb();
    assert.equal(db.enrollments.filter((e) => e.userId === friend.id).length, 0);
    assert.equal(db.payments.find((p) => p.userId === friend.id)!.status, "refunded");
    assert.equal(resolveCourseAccess(db, friend.id, course.id).granted, false);
  });
});

describe("gift read models", () => {
  it("lists a member's sent and received gifts", async () => {
    const { gift, payment } = giftFixture({ sentAt: at(-1) });
    await setup({ gifts: [gift], payments: [payment] });
    const mine = await getMyGifts(buyer);
    assert.equal(mine.sent.length, 1);
    assert.equal(mine.sent[0]!.status, "delivered");
    const theirs = await getMyGifts(friend);
    assert.equal(theirs.received.length, 1);
    assert.equal(theirs.sent.length, 0);
  });

  it("filters, pages, totals and exports the admin list", async () => {
    const a = giftFixture({ sentAt: at(-1) });
    const b = giftFixture({ id: "gft_2", code: "GIFT-DDDD-EEEE-FFFF", paymentId: "pay_gift2", recipientEmail: "=evil@example.com", createdAt: at(0) }, { id: "pay_gift2", status: "pending", paidAt: undefined, itemId: "gft_2", giftId: "gft_2" });
    await setup({ gifts: [a.gift, b.gift], payments: [a.payment, b.payment] });
    const filter = parseAdminGiftFilter(new URLSearchParams("gstatus=delivered&gq=sam&gpage=0"));
    assert.deepEqual(filter, { status: "delivered", search: "sam", page: 1 });
    const res = await getAdminGifts(filter);
    assert.deepEqual(
      res.rows.map((r) => r.id),
      ["gft_1"],
    );
    assert.deepEqual(res.stats, { total: 2, paid: 1, redeemed: 0, scheduled: 0, revenue: [{ currency: "USD", amount: 5000 }] });
    const csv = giftsToCsv((await getAdminGifts(parseAdminGiftFilter({}), { all: true })).rows);
    assert.ok(csv.includes("'=evil@example.com"), "formula injection neutralised");
    assert.equal(csv.trim().split("\r\n").length, 3);
  });

  it("only administrators switch gift sales", async () => {
    await setup();
    await createSession(buyer.id);
    assert.ok(!(await setGiftsEnabledAction(false)).ok);
    await createSession(admin.id);
    assert.ok((await setGiftsEnabledAction(false)).ok);
    assert.equal((await getDb()).settings.growth.giftsEnabled, false);
  });
});
