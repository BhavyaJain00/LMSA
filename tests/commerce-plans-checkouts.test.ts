import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, CheckoutSession, MembershipPlan, Payment } from "@/lib/types";
import { validateCoupon } from "@/lib/data/commerce";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import {
  RECOVERY_WINDOW_DAYS,
  completeSession,
  completingPayment,
  delayLabel,
  dueReminder,
  isFinalReminder,
  recoveryStats,
  sessionStatus,
  validateRecoverySettings,
} from "@/lib/commerce/checkout-recovery";
import { checkoutsToCsv, completeCheckoutSessions, getAdminCheckouts, parseCheckoutFilter, processAbandonedCheckouts, trackCheckoutView } from "@/lib/commerce/checkout-sessions";
import { saveRecoverySettingsAction, sendDueCheckoutRemindersAction, stopCheckoutRemindersAction } from "@/lib/actions/payments";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Abandoned-checkout recovery: session status and reminder timing, closing
 * a session on purchase (recovered after a reminder), the report numbers,
 * the settings form, tracking checkout visits, the reminder run (one email
 * per due reminder, a single-use coupon with the last one, nothing for
 * buyers who already own the item or opted out), the `payment.paid`
 * handler, the admin list + CSV and the admin actions.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number, from = Date.now()) => new Date(from - ms).toISOString();
const DELAYS = [1, 24, 72];

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: "chk_1",
  userId: "usr_buyer",
  email: "bea@example.com",
  itemType: "course",
  itemId: "crs_py",
  startedAt: ago(3 * HOUR),
  lastStepAt: ago(2 * HOUR),
  reminderCount: 0,
  ...over,
});

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("checkout session status", () => {
  const now = Date.parse("2026-05-01T12:00:00Z");

  it("is open until the first reminder delay, then abandoned", () => {
    assert.equal(sessionStatus(session({ lastStepAt: ago(30 * 60_000, now) }), DELAYS, now), "open");
    assert.equal(sessionStatus(session({ lastStepAt: ago(HOUR, now) }), DELAYS, now), "abandoned");
    assert.equal(sessionStatus(session({ lastStepAt: ago(5 * HOUR, now) }), [6, 24], now), "open");
  });

  it("is purchased, or recovered when bought after a reminder", () => {
    assert.equal(sessionStatus(session({ completedPaymentId: "pay_1" }), DELAYS, now), "completed");
    assert.equal(sessionStatus(session({ completedPaymentId: "pay_1", recoveredAt: ago(0, now) }), DELAYS, now), "recovered");
  });
});

describe("reminder timing", () => {
  const now = Date.parse("2026-05-01T12:00:00Z");

  it("sends nothing before the first delay", () => {
    assert.equal(dueReminder(session({ lastStepAt: ago(59 * 60_000, now) }), DELAYS, now), null);
  });

  it("sends each reminder once its delay has passed", () => {
    assert.equal(dueReminder(session({ lastStepAt: ago(HOUR, now) }), DELAYS, now), 0);
    assert.equal(dueReminder(session({ lastStepAt: ago(25 * HOUR, now), reminderCount: 1 }), DELAYS, now), 1);
    assert.equal(dueReminder(session({ lastStepAt: ago(25 * HOUR, now), reminderCount: 2 }), DELAYS, now), null);
    assert.equal(dueReminder(session({ lastStepAt: ago(73 * HOUR, now), reminderCount: 2 }), DELAYS, now), 2);
    assert.equal(dueReminder(session({ lastStepAt: ago(100 * HOUR, now), reminderCount: 3 }), DELAYS, now), null);
  });

  it("sends only the latest reminder when several fell due at once", () => {
    assert.equal(dueReminder(session({ lastStepAt: ago(30 * HOUR, now) }), DELAYS, now), 1);
    assert.equal(dueReminder(session({ lastStepAt: ago(80 * HOUR, now) }), DELAYS, now), 2);
  });

  it("never reminds purchased, stale or broken sessions", () => {
    assert.equal(dueReminder(session({ lastStepAt: ago(2 * HOUR, now), completedPaymentId: "pay_1" }), DELAYS, now), null);
    assert.equal(dueReminder(session({ lastStepAt: ago((RECOVERY_WINDOW_DAYS + 1) * DAY, now) }), DELAYS, now), null);
    assert.equal(dueReminder(session({ lastStepAt: "not a date" }), DELAYS, now), null);
  });

  it("knows the final reminder", () => {
    assert.equal(isFinalReminder(2, DELAYS), true);
    assert.equal(isFinalReminder(1, DELAYS), false);
    assert.equal(isFinalReminder(0, [12]), true);
  });
});

describe("closing a session on purchase", () => {
  const s = session({ startedAt: "2026-05-01T10:00:00.000Z" });
  const pay = (over: Partial<Payment>) => makePayment({ userId: "usr_buyer", itemId: "crs_py", status: "paid", paidAt: "2026-05-01T11:00:00.000Z", ...over });

  it("finds the buyer's paid order of the item placed after the session started", () => {
    const match = pay({ id: "p_ok" });
    assert.equal(completingPayment(s, [pay({ id: "p_before", paidAt: "2026-04-30T10:00:00.000Z" }), pay({ id: "p_pending", status: "pending" }), pay({ id: "p_other", itemId: "crs_js" }), match]), match);
    assert.equal(completingPayment(s, [pay({ id: "p_user", userId: "usr_other" })]), null);
    assert.equal(completingPayment({ ...s, userId: undefined }, [match]), null);
  });

  it("counts a purchase as recovered after a reminder or with the sent code", () => {
    const plain = session();
    assert.equal(completeSession(plain, { id: "p1", paidAt: "2026-05-01T11:00:00.000Z" }, "x"), true);
    assert.equal(plain.recoveredAt, undefined);
    assert.equal(completeSession(plain, { id: "p2", paidAt: "2026-05-01T12:00:00.000Z" }, "x"), false, "closed once");
    assert.equal(plain.completedPaymentId, "p1");

    const reminded = session({ reminderCount: 1 });
    completeSession(reminded, { id: "p1", paidAt: "2026-05-01T11:00:00.000Z" }, "x");
    assert.equal(reminded.recoveredAt, "2026-05-01T11:00:00.000Z");

    const withCode = session({ couponSent: "COMEBACK-AB12" });
    completeSession(withCode, { id: "p1", couponCode: "comeback-ab12" }, "2026-05-02T00:00:00.000Z");
    assert.equal(withCode.recoveredAt, "2026-05-02T00:00:00.000Z");
  });
});

describe("recovery report", () => {
  const now = Date.parse("2026-05-10T12:00:00Z");
  const sessions = [
    session({ id: "a", lastStepAt: ago(10 * 60_000, now), startedAt: ago(DAY, now) }),
    session({ id: "b", lastStepAt: ago(5 * HOUR, now), startedAt: ago(DAY, now), reminderCount: 1 }),
    session({ id: "c", completedPaymentId: "p_c", startedAt: ago(DAY, now) }),
    session({ id: "d", completedPaymentId: "p_d", recoveredAt: ago(HOUR, now), reminderCount: 2, startedAt: ago(2 * DAY, now) }),
    session({ id: "e", completedPaymentId: "p_e", recoveredAt: ago(HOUR, now), reminderCount: 1, startedAt: ago(3 * DAY, now) }),
    session({ id: "old", lastStepAt: ago(60 * DAY, now), startedAt: ago(60 * DAY, now), reminderCount: 3 }),
  ];
  const payments = [
    { id: "p_c", amount: 5000, currency: "USD", status: "paid" as const },
    { id: "p_d", amount: 9000, currency: "EUR", status: "paid" as const, refundedAmount: 1000 },
    { id: "p_e", amount: 5000, currency: "USD", status: "refunded" as const },
  ];

  it("counts started, bought, abandoned, reminded and recovered checkouts", () => {
    const stats = recoveryStats(sessions, payments, DELAYS, { now });
    assert.equal(stats.started, 6);
    assert.equal(stats.completed, 3);
    assert.equal(stats.abandoned, 2);
    assert.equal(stats.reminded, 4);
    assert.equal(stats.recovered, 2);
    assert.equal(stats.recoveryRate, 50);
    assert.equal(stats.conversionRate, 50);
    // Recovered revenue less refunds: the fully refunded order counts nothing.
    assert.deepEqual(stats.recoveredRevenue, [{ currency: "EUR", amount: 8000 }]);
  });

  it("limits the report to sessions started in the period", () => {
    const stats = recoveryStats(sessions, payments, DELAYS, { now, since: now - 7 * DAY });
    assert.equal(stats.started, 5);
    assert.equal(stats.reminded, 3);
    assert.equal(recoveryStats([], [], DELAYS, { now }).recoveryRate, 0);
  });
});

describe("reminder settings form", () => {
  it("sorts the delays and accepts 0% (no code)", () => {
    assert.deepEqual(validateRecoverySettings({ enabled: true, delays: "72, 1;24", couponPercent: "0" }), { ok: true, value: { enabled: true, delaysHours: [1, 24, 72], couponPercent: 0 } });
    assert.deepEqual(validateRecoverySettings({ enabled: false, delays: "6", couponPercent: "" }), { ok: true, value: { enabled: false, delaysHours: [6], couponPercent: 0 } });
  });

  it("refuses bad delays and discounts", () => {
    for (const delays of ["", "1,2,3,4,5,6", "0", "721", "1.5", "a", "24, 24"]) {
      const res = validateRecoverySettings({ enabled: true, delays, couponPercent: "10" });
      assert.ok(!res.ok && res.errors.delays, `"${delays}" is refused`);
    }
    for (const couponPercent of ["91", "-1", "12.5", "ten"]) {
      const res = validateRecoverySettings({ enabled: true, delays: "1", couponPercent });
      assert.ok(!res.ok && res.errors.couponPercent, `"${couponPercent}" is refused`);
    }
  });

  it("labels delays", () => {
    assert.equal(delayLabel(1), "1 hour");
    assert.equal(delayLabel(36), "36 hours");
    assert.equal(delayLabel(24), "1 day");
    assert.equal(delayLabel(72), "3 days");
  });
});

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });
const optedOut = makeUser({
  id: "usr_out",
  name: "Otto Out",
  email: "otto@example.com",
  emailPreferences: { enrollment: true, announcements: true, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: false },
});
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", email: "ada@example.com", roles: ["admin"] });
const course = makeCourse({ id: "crs_py", slug: "python", title: "Python", paidCourse: true, price: 5000, currency: "USD" });
const course2 = makeCourse({ id: "crs_js", slug: "js", title: "JavaScript", paidCourse: true, price: 4000, currency: "USD" });
const monthly: MembershipPlan = {
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function setup(fixture: { sessions?: CheckoutSession[]; payments?: Payment[]; enrollments?: ReturnType<typeof makeEnrollment>[]; enabled?: boolean; emailEnabled?: boolean; couponPercent?: number; bundles?: Bundle[] } = {}) {
  await resetDb({
    users: [buyer, optedOut, admin],
    courses: [course, course2],
    plans: [monthly],
    bundles: fixture.bundles ?? [],
    checkoutSessions: fixture.sessions ?? [],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrollments ?? [],
    settings: {
      email: { enabled: fixture.emailEnabled ?? true },
      gamification: { enabled: false },
      commerce: { paymentGateway: "manual" },
      growth: {
        abandonedCheckoutEnabled: fixture.enabled ?? true,
        abandonedCheckoutDelaysHours: DELAYS,
        abandonedCheckoutCouponPercent: fixture.couponPercent ?? 15,
        subscriptionsEnabled: true,
        bundlesEnabled: true,
      },
    },
  });
  resetRequest();
}

const remindersTo = async (email: string) => (await getDb()).emails.filter((e) => e.to === email);

describe("tracking checkout visits", () => {
  it("opens one session per buyer and item, refreshed on later visits", async () => {
    await setup();
    await trackCheckoutView(buyer, { type: "course", id: course.id });
    let db = await getDb();
    assert.equal(db.checkoutSessions.length, 1);
    const first = db.checkoutSessions[0]!;
    assert.equal(first.userId, buyer.id);
    assert.equal(first.email, buyer.email);
    assert.equal(first.reminderCount, 0);

    // A visit within a minute writes nothing.
    await trackCheckoutView(buyer, { type: "course", id: course.id });
    assert.equal((await getDb()).checkoutSessions[0]!.lastStepAt, first.lastStepAt);

    // An older visit is refreshed (restarting the reminder clock), not duplicated.
    await setup({ sessions: [session({ id: "chk_old", lastStepAt: ago(3 * HOUR), reminderCount: 1 })] });
    await trackCheckoutView(buyer, { type: "course", id: course.id });
    db = await getDb();
    assert.equal(db.checkoutSessions.length, 1);
    assert.ok(Date.now() - Date.parse(db.checkoutSessions[0]!.lastStepAt) < 60_000);
    assert.equal(db.checkoutSessions[0]!.reminderCount, 1);
  });

  it("tracks every sellable item but not gifts", async () => {
    await setup();
    await trackCheckoutView(buyer, { type: "plan", id: monthly.id });
    await trackCheckoutView(buyer, { type: "gift", id: "gft_1" });
    await trackCheckoutView(buyer, { type: "course", id: course2.id });
    assert.deepEqual((await getDb()).checkoutSessions.map((s) => `${s.itemType}:${s.itemId}`).sort(), ["course:crs_js", "plan:pln_m"]);
  });
});

describe("reminder run", () => {
  it("sends the first reminder once and records it", async () => {
    await setup({ sessions: [session()] });
    const run = await processAbandonedCheckouts({ force: true });
    assert.equal(run.sent, 1);
    assert.equal(run.coupons, 0);
    const s = (await getDb()).checkoutSessions[0]!;
    assert.equal(s.reminderCount, 1);
    assert.ok(s.lastReminderAt);
    const mails = await remindersTo(buyer.email);
    assert.equal(mails.length, 1);
    assert.match(mails[0]!.subject, /You left Python in your checkout/);
    assert.match(mails[0]!.html, /\/billing\/course\/crs_py/);

    // Nothing more is due yet.
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    assert.equal((await remindersTo(buyer.email)).length, 1);
  });

  it("puts a single-use coupon for the item in the last reminder", async () => {
    await setup({ sessions: [session({ lastStepAt: ago(73 * HOUR), reminderCount: 2 })] });
    const run = await processAbandonedCheckouts({ force: true });
    assert.equal(run.sent, 1);
    assert.equal(run.coupons, 1);
    const db = await getDb();
    const s = db.checkoutSessions[0]!;
    assert.equal(s.reminderCount, 3);
    assert.match(s.couponSent ?? "", /^COMEBACK-[A-Z0-9]+$/);
    const coupon = db.coupons.find((c) => c.code === s.couponSent)!;
    assert.equal(coupon.value, 15);
    assert.equal(coupon.discountType, "percentage");
    assert.equal(coupon.usageLimit, 1);
    assert.deepEqual(coupon.applicableItems, [{ type: "course", id: course.id }]);
    assert.ok(coupon.expiresOn && coupon.expiresOn > new Date().toISOString().slice(0, 10));
    const mail = (await remindersTo(buyer.email))[0]!;
    assert.match(mail.subject, /15% off Python/);
    assert.ok(mail.html.includes(coupon.code));
    assert.ok(mail.html.includes(`?coupon=${coupon.code}`));
  });

  it("limits the coupon of a bundle checkout to that bundle and to the buyer who left it", async () => {
    const pack: Bundle = { id: "bnd_pack", slug: "pack", title: "Pack", description: "", courseIds: [course.id, course2.id], price: 7000, currency: "USD", published: true, createdAt: ago(5 * DAY), updatedAt: ago(5 * DAY) };
    await setup({ bundles: [pack], sessions: [session({ itemType: "bundle", itemId: pack.id, lastStepAt: ago(73 * HOUR), reminderCount: 2 })] });
    const run = await processAbandonedCheckouts({ force: true });
    assert.equal(run.coupons, 1);
    const db = await getDb();
    const coupon = db.coupons.find((c) => c.code === db.checkoutSessions[0]!.couponSent)!;
    assert.deepEqual(coupon.applicableItems, [{ type: "bundle", id: pack.id }]);
    assert.equal(coupon.ownerUserId, buyer.id);
    assert.equal((await validateCoupon(coupon.code, { type: "course", id: course.id, currency: "USD" }, buyer.id)).ok, false, "not site-wide");
    assert.equal((await validateCoupon(coupon.code, { type: "bundle", id: pack.id, currency: "USD" }, optedOut.id)).ok, false, "not for someone else");
    assert.equal((await validateCoupon(coupon.code, { type: "bundle", id: pack.id, currency: "USD" }, buyer.id)).ok, true);
  });

  it("sends no coupon for memberships that renew, or when the discount is 0%", async () => {
    await setup({ sessions: [session({ itemType: "plan", itemId: monthly.id, lastStepAt: ago(73 * HOUR), reminderCount: 2 })] });
    assert.deepEqual(await processAbandonedCheckouts({ force: true }), { sent: 1, coupons: 0, closed: 0, skipped: false });
    assert.equal((await getDb()).coupons.length, 0);
    await setup({ couponPercent: 0, sessions: [session({ lastStepAt: ago(73 * HOUR), reminderCount: 2 })] });
    assert.equal((await processAbandonedCheckouts({ force: true })).coupons, 0);
  });

  it("skips buyers who own the item or have an order waiting", async () => {
    await setup({
      sessions: [session({ id: "owned" }), session({ id: "pending", itemId: course2.id })],
      enrollments: [makeEnrollment({ userId: buyer.id, courseId: course.id })],
      payments: [makePayment({ userId: buyer.id, itemId: course2.id, status: "pending", gateway: "manual" })],
    });
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    assert.equal((await getDb()).emails.length, 0);
    assert.ok((await getDb()).checkoutSessions.every((s) => s.reminderCount === 0));
  });

  it("counts but doesn't email buyers who opted out of payment emails", async () => {
    await setup({ sessions: [session({ userId: optedOut.id, email: optedOut.email, lastStepAt: ago(73 * HOUR), reminderCount: 2 })] });
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    const db = await getDb();
    assert.equal(db.checkoutSessions[0]!.reminderCount, 3);
    assert.equal(db.coupons.length, 0, "no coupon is minted for an email that is never sent");
    assert.equal(db.emails.length, 0);
  });

  it("sends nothing while reminders or email are off", async () => {
    await setup({ enabled: false, sessions: [session()] });
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    await setup({ emailEnabled: false, sessions: [session()] });
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    assert.equal((await getDb()).checkoutSessions[0]!.reminderCount, 0);
  });

  it("closes sessions whose purchase it missed", async () => {
    const started = ago(5 * HOUR);
    await setup({
      enabled: false,
      sessions: [session({ startedAt: started, reminderCount: 1 })],
      payments: [makePayment({ id: "pay_done", userId: buyer.id, itemId: course.id, status: "paid", paidAt: ago(HOUR), gateway: "manual" })],
    });
    const run = await processAbandonedCheckouts({ force: true });
    assert.equal(run.closed, 1);
    const s = (await getDb()).checkoutSessions[0]!;
    assert.equal(s.completedPaymentId, "pay_done");
    assert.ok(s.recoveredAt);
  });

  it("shares one run between concurrent callers and throttles page-view runs", async () => {
    await setup({ sessions: [session()] });
    const [a, b] = await Promise.all([processAbandonedCheckouts({ force: true }), processAbandonedCheckouts({ force: true })]);
    assert.equal(a, b);
    assert.equal((await remindersTo(buyer.email)).length, 1);
    assert.equal((await processAbandonedCheckouts()).skipped, true);
  });
});

describe("purchase closes the checkout (payment.paid)", () => {
  it("marks the session recovered when a reminder went out first", async () => {
    const order = makePayment({ id: "pay_new", userId: buyer.id, itemId: course.id, status: "pending", gateway: "manual", amount: 5000, originalAmount: 5000 });
    await setup({ sessions: [session({ reminderCount: 1 }), session({ id: "chk_other", itemId: course2.id })], payments: [order] });
    const res = await fulfillPayment(order.id, undefined, { source: "admin" });
    assert.ok(res.ok);
    await settleEvents();
    const db = await getDb();
    const s = db.checkoutSessions.find((x) => x.id === "chk_1")!;
    assert.equal(s.completedPaymentId, "pay_new");
    assert.ok(s.recoveredAt);
    assert.equal(db.checkoutSessions.find((x) => x.id === "chk_other")!.completedPaymentId, undefined, "other items stay open");
  });

  it("only closes sessions for paid orders", async () => {
    await setup({ sessions: [session()], payments: [makePayment({ id: "pay_p", userId: buyer.id, itemId: course.id, status: "pending" })] });
    assert.equal(await completeCheckoutSessions("pay_p"), 0);
    assert.equal(await completeCheckoutSessions("missing"), 0);
  });
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

describe("admin checkouts list", () => {
  const sessions = [
    session({ id: "s_open", lastStepAt: ago(10 * 60_000), startedAt: ago(20 * 60_000) }),
    session({ id: "s_ab", itemId: course2.id, lastStepAt: ago(5 * HOUR), startedAt: ago(6 * HOUR), reminderCount: 1, lastReminderAt: ago(4 * HOUR) }),
    session({ id: "s_rec", userId: optedOut.id, email: optedOut.email, completedPaymentId: "pay_rec", recoveredAt: ago(HOUR), reminderCount: 2, couponSent: "COMEBACK-XY12", startedAt: ago(3 * DAY), lastStepAt: ago(2 * DAY) }),
    session({ id: "s_old", lastStepAt: ago(50 * DAY), startedAt: ago(50 * DAY), reminderCount: 3 }),
  ];
  const payments = [makePayment({ id: "pay_rec", orderId: "ORD-REC", userId: optedOut.id, itemId: course.id, status: "paid", paidAt: ago(HOUR), amount: 4250, currency: "USD" })];

  it("filters by status, period and search, newest visit first", async () => {
    await setup({ sessions, payments });
    const all = await getAdminCheckouts(parseCheckoutFilter({}));
    assert.deepEqual(
      all.rows.map((r) => r.id),
      ["s_open", "s_ab", "s_rec"],
    );
    assert.equal(all.stats.started, 3);
    assert.equal(all.stats.recovered, 1);
    assert.deepEqual(all.stats.recoveredRevenue, [{ currency: "USD", amount: 4250 }]);
    const rec = all.rows.find((r) => r.id === "s_rec")!;
    assert.equal(rec.statusLabel, "Recovered");
    assert.equal(rec.orderId, "ORD-REC");
    assert.equal(rec.itemTitle, "Python");
    assert.equal(rec.itemHref, "/courses/python");

    assert.deepEqual(
      (await getAdminCheckouts(parseCheckoutFilter({ cstatus: "abandoned", cdays: "0" }))).rows.map((r) => r.id),
      ["s_ab", "s_old"],
    );
    assert.deepEqual(
      (await getAdminCheckouts(parseCheckoutFilter({ cq: "javascript" }))).rows.map((r) => r.id),
      ["s_ab"],
    );
    assert.deepEqual(
      (await getAdminCheckouts(parseCheckoutFilter({ cq: "comeback-xy" }))).rows.map((r) => r.id),
      ["s_rec"],
    );
    assert.deepEqual(parseCheckoutFilter({ cstatus: "nope", cdays: "12", cpage: "-3" }), { status: "all", days: 30, search: null, page: 1 });
  });

  it("exports the rows as CSV", async () => {
    await setup({ sessions, payments });
    const lines = checkoutsToCsv((await getAdminCheckouts(parseCheckoutFilter({ cdays: "0" }), { all: true })).rows).split("\n");
    assert.equal(lines[0], "Started at,Last visit,Member,Email,Item type,Item,Status,Reminders sent,Last reminder,Coupon sent,Order,Amount,Currency");
    assert.equal(lines.length, 5);
    assert.ok(lines.some((l) => l.includes("Otto Out,otto@example.com,Course,Python,Recovered,2,,COMEBACK-XY12,ORD-REC,42.50,USD")));
  });
});

describe("checkout recovery actions", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
  };

  it("are for administrators only", async () => {
    await setup({ sessions: [session()] });
    await createSession(buyer.id);
    assert.ok(!(await saveRecoverySettingsAction(null, form({ enabled: "on", delays: "2", couponPercent: "5" }))).ok);
    assert.ok(!(await sendDueCheckoutRemindersAction()).ok);
    assert.ok(!(await stopCheckoutRemindersAction(["chk_1"])).ok);
    assert.equal((await getDb()).emails.length, 0);
  });

  it("saves the reminder settings", async () => {
    await setup();
    await createSession(admin.id);
    const bad = await saveRecoverySettingsAction(null, form({ enabled: "on", delays: "0", couponPercent: "5" }));
    assert.ok(!bad.ok && bad.fieldErrors?.delays);
    assert.ok((await saveRecoverySettingsAction(null, form({ enabled: "on", delays: "48, 2", couponPercent: "20" }))).ok);
    const growth = (await getDb()).settings.growth;
    assert.deepEqual(growth.abandonedCheckoutDelaysHours, [2, 48]);
    assert.equal(growth.abandonedCheckoutCouponPercent, 20);
    assert.ok((await saveRecoverySettingsAction(null, form({ delays: "2, 48", couponPercent: "20" }))).ok);
    assert.equal((await getDb()).settings.growth.abandonedCheckoutEnabled, false);
  });

  it("sends due reminders on demand", async () => {
    await setup({ sessions: [session()] });
    await createSession(admin.id);
    const res = await sendDueCheckoutRemindersAction();
    assert.ok(res.ok && res.data.sent === 1);
    const again = await sendDueCheckoutRemindersAction();
    assert.ok(again.ok);
    assert.match(again.message ?? "", /No reminders are due/);
    await setup({ enabled: false, sessions: [session()] });
    await createSession(admin.id);
    assert.ok(!(await sendDueCheckoutRemindersAction()).ok);
  });

  it("stops further reminders for chosen checkouts", async () => {
    await setup({ sessions: [session(), session({ id: "chk_done", completedPaymentId: "pay_x" })] });
    await createSession(admin.id);
    const res = await stopCheckoutRemindersAction(["chk_1", "chk_done"]);
    assert.ok(res.ok && res.data.stopped === 1);
    const db = await getDb();
    assert.equal(db.checkoutSessions.find((s) => s.id === "chk_1")!.reminderCount, DELAYS.length);
    assert.equal(db.checkoutSessions.find((s) => s.id === "chk_done")!.reminderCount, 0);
    assert.equal((await processAbandonedCheckouts({ force: true })).sent, 0);
    assert.ok(!(await stopCheckoutRemindersAction(["chk_1"])).ok, "nothing left to stop");
    assert.ok(!(await stopCheckoutRemindersAction([])).ok);
  });
});
