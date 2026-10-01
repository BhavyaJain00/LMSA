import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { resolveCourseAccess } from "@/lib/commerce/access";
import {
  INSTALLMENT_GRACE_DAYS,
  buildInstallmentPlan,
  installmentOffer,
  installmentPlans,
  intervalPhrase,
  isInstallmentOrder,
  isValidInstallmentPlan,
  offeredInstallmentPlan,
  partOrderId,
  planForCourse,
  planGrantsAccess,
  planKeyOf,
  reminderDue,
  scheduleDates,
  splitOrder,
  validateInstallmentInput,
} from "@/lib/commerce/installments";
import { cancelInstallmentPlan, waiveInstallments } from "@/lib/commerce/installment-service";
import { getAdminInstallments, getInstallmentCourses, installmentStats, installmentsToCsv, parseInstallmentFilter } from "@/lib/commerce/installment-views";
import { installmentPlanAction, saveCourseInstallmentsAction, setInstallmentsEnabledAction } from "@/lib/actions/payments";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Paying a course in installments: terms and amounts, the plan rebuilt from
 * its orders (on track, overdue, paused after the grace period, completed,
 * cancelled), reminders, the schedule written when the first part is paid,
 * course access following the plan, the administrator operations and the
 * admin read models.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const iso = (offsetDays: number, from = NOW) => new Date(from + offsetDays * DAY).toISOString();

const terms = { count: 3, intervalDays: 30, surchargePercent: 0 };

describe("installment terms and amounts", () => {
  it("validates terms", () => {
    assert.equal(isValidInstallmentPlan(terms), true);
    assert.equal(isValidInstallmentPlan({ ...terms, count: 1 }), false);
    assert.equal(isValidInstallmentPlan({ ...terms, count: 25 }), false);
    assert.equal(isValidInstallmentPlan({ ...terms, intervalDays: 0 }), false);
    assert.equal(isValidInstallmentPlan({ ...terms, surchargePercent: -1 }), false);
    assert.equal(isValidInstallmentPlan(null), false);
  });

  it("offers installments only for paid courses, with the switch on and a gateway that collects", () => {
    const course = { paidCourse: true, price: 10000, installments: terms };
    assert.deepEqual(offeredInstallmentPlan(course, { enabled: true, gateway: "manual" }), terms);
    assert.equal(offeredInstallmentPlan(course, { enabled: false, gateway: "manual" }), null);
    assert.equal(offeredInstallmentPlan(course, { enabled: true, gateway: "none" }), null);
    assert.equal(offeredInstallmentPlan({ ...course, paidCourse: false }, { enabled: true, gateway: "stripe" }), null);
    assert.equal(offeredInstallmentPlan({ ...course, installments: undefined }, { enabled: true, gateway: "stripe" }), null);
  });

  it("rounds each payment up so the parts never collect less than the price", () => {
    const offer = installmentOffer(10000, "USD", terms);
    assert.deepEqual(offer, { count: 3, intervalDays: 30, surchargePercent: 0, partAmount: 3334, total: 10002, extra: 2 });
    const withSurcharge = installmentOffer(10000, "USD", { ...terms, surchargePercent: 10 });
    assert.equal(withSurcharge.partAmount, 3667);
    assert.equal(withSurcharge.extra, 1001);
  });

  it("rounds to whole units for zero-decimal currencies", () => {
    // ¥1,000 in app units (×100) split in 3: each part is a whole yen amount.
    const offer = installmentOffer(100000, "JPY", terms);
    assert.equal(offer.partAmount % 100, 0);
    assert.equal(offer.partAmount, 33400);
  });

  it("splits an order with tax on top or included", () => {
    const onTop = splitOrder({ originalAmount: 10000, discountAmount: 1000, taxAmount: 900, amount: 9900 }, 3, "USD");
    assert.equal(onTop.amount, 3300);
    assert.equal(onTop.taxAmount, 300);
    assert.equal(onTop.discountAmount, 333);
    assert.equal(onTop.originalAmount, onTop.amount + onTop.discountAmount - onTop.taxAmount);
    const included = splitOrder({ originalAmount: 11800, discountAmount: 0, taxAmount: 1800, amount: 11800 }, 2, "INR");
    assert.equal(included.amount, 5900);
    assert.equal(included.originalAmount, 5900);
    assert.equal(included.taxAmount, 900);
    assert.deepEqual(splitOrder({ originalAmount: 0, discountAmount: 0, taxAmount: 0, amount: 0 }, 3, "USD"), { originalAmount: 0, discountAmount: 0, taxAmount: 0, amount: 0 });
  });

  it("schedules parts one interval apart and describes the interval", () => {
    assert.deepEqual(scheduleDates("2026-01-01T00:00:00.000Z", 3, 14), ["2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z", "2026-01-29T00:00:00.000Z"]);
    assert.throws(() => scheduleDates("not a date", 2, 7));
    assert.equal(intervalPhrase(1), "every day");
    assert.equal(intervalPhrase(7), "every week");
    assert.equal(intervalPhrase(14), "every 2 weeks");
    assert.equal(intervalPhrase(30), "every 30 days");
  });

  it("derives part order ids from the first one", () => {
    assert.equal(partOrderId("ORD-AB12", 1), "ORD-AB12");
    assert.equal(partOrderId("ORD-AB12", 3), "ORD-AB12-3");
    assert.equal(planKeyOf({ orderId: "ORD-AB12-3", installmentNumber: 3 }), "ORD-AB12");
    assert.equal(planKeyOf({ orderId: "ORD-AB12", installmentNumber: 1 }), "ORD-AB12");
  });

  it("validates the admin form", () => {
    assert.deepEqual(validateInstallmentInput({ count: "4", intervalDays: "14", surchargePercent: "" }), { ok: true, plan: { count: 4, intervalDays: 14, surchargePercent: 0 } });
    const bad = validateInstallmentInput({ count: "1", intervalDays: "400", surchargePercent: "150" });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.errors).sort(), ["count", "intervalDays", "surchargePercent"]);
  });
});

/* ------------------------------------------------------------------ */
/* Plans rebuilt from orders                                           */
/* ------------------------------------------------------------------ */

const learner = makeUser({ id: "usr_learner", name: "Lee Learner", email: "lee@example.com" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_paid", slug: "paid", title: "Paid course", paidCourse: true, price: 9000, currency: "USD", published: true, installments: terms });

/** A 3-part plan whose first part was paid `startDays` ago (relative to `from`), parts 2..3 as given. */
function planRows(opts: { startDays: number; from?: number; part2?: Partial<Payment> | null; part3?: Partial<Payment> | null; anchor?: Partial<Payment> }): Payment[] {
  const from = opts.from ?? NOW;
  const paidAt = iso(-opts.startDays, from);
  const base = { userId: learner.id, itemId: course.id, itemType: "course" as const, amount: 3000, originalAmount: 3000, gateway: "manual", installmentsTotal: 3 };
  const rows: Payment[] = [makePayment({ ...base, id: "pay_p1", orderId: "ORD-PLAN", installmentNumber: 1, status: "paid", paidAt, createdAt: paidAt, ...opts.anchor })];
  if (opts.part2 !== null) rows.push(makePayment({ ...base, id: "pay_p2", orderId: "ORD-PLAN-2", installmentNumber: 2, status: "pending", createdAt: iso(30 - opts.startDays, from), ...opts.part2 }));
  if (opts.part3 !== null) rows.push(makePayment({ ...base, id: "pay_p3", orderId: "ORD-PLAN-3", installmentNumber: 3, status: "pending", createdAt: iso(60 - opts.startDays, from), ...opts.part3 }));
  return rows;
}

const planAt = (rows: Payment[], now = NOW) => buildInstallmentPlan(rows[0]!, rows, now);

describe("payment plan status", () => {
  it("is on track before the next part falls due", () => {
    const plan = planAt(planRows({ startDays: 10 }));
    assert.equal(plan.status, "on_track");
    assert.equal(plan.paidCount, 1);
    assert.equal(plan.outstandingAmount, 6000);
    assert.equal(plan.next?.number, 2);
    assert.equal(plan.overdueDays, 0);
    assert.equal(plan.intervalDays, 30);
    assert.ok(planGrantsAccess(plan));
  });

  it("is overdue within the grace period and keeps access", () => {
    const plan = planAt(planRows({ startDays: 33 }));
    assert.equal(plan.status, "overdue");
    assert.equal(plan.overdueDays, 3);
    assert.equal(plan.pausesAt, iso(-3 + INSTALLMENT_GRACE_DAYS));
    assert.ok(planGrantsAccess(plan));
  });

  it("pauses access once a part is more than the grace period late", () => {
    const plan = planAt(planRows({ startDays: 30 + INSTALLMENT_GRACE_DAYS + 1 }));
    assert.equal(plan.status, "paused");
    assert.equal(plan.overdueDays, INSTALLMENT_GRACE_DAYS + 1);
    assert.equal(planGrantsAccess(plan), false);
  });

  it("is completed when every part is paid or waived", () => {
    const rows = planRows({ startDays: 70, part2: { status: "paid", paidAt: iso(-40) }, part3: { status: "paid", amount: 0, paidAt: iso(-1) } });
    const plan = planAt(rows);
    assert.equal(plan.status, "completed");
    assert.deepEqual(
      plan.parts.map((p) => p.status),
      ["paid", "paid", "waived"],
    );
    assert.equal(plan.next, null);
    assert.ok(planGrantsAccess(plan));
  });

  it("is cancelled when a part was closed with the plan or refunded", () => {
    const closed = planAt(planRows({ startDays: 10, part2: { status: "failed", failureReason: "Payment plan cancelled: by admin" }, part3: { status: "failed", failureReason: "Payment plan cancelled: by admin" } }));
    assert.equal(closed.status, "cancelled");
    assert.equal(closed.outstandingAmount, 0);
    assert.equal(planGrantsAccess(closed), false);
    const refunded = planAt(planRows({ startDays: 10, anchor: { status: "refunded" } }));
    assert.equal(refunded.status, "cancelled");
  });

  it("treats a failed payment attempt as still owed", () => {
    const plan = planAt(planRows({ startDays: 32, part2: { status: "failed", failureReason: "Card declined" } }));
    assert.equal(plan.status, "overdue");
    assert.equal(plan.next?.number, 2);
  });

  it("waits for the first payment", () => {
    const plan = planAt(planRows({ startDays: 0, anchor: { status: "pending", paidAt: undefined }, part2: null, part3: null }));
    assert.equal(plan.status, "awaiting_first");
  });

  it("is put back together from a mixed list of orders", () => {
    const other = makePayment({ id: "pay_other", userId: learner.id, itemId: course.id, status: "paid" });
    const rows = [...planRows({ startDays: 10 }), other];
    assert.equal(isInstallmentOrder(other), false);
    const plans = installmentPlans(rows, NOW);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]!.parts.filter((p) => p.payment).length, 3);
    assert.equal(planForCourse(rows, learner.id, course.id, NOW)?.key, "ORD-PLAN");
  });
});

describe("installment reminders", () => {
  it("announces a manual payment a few days ahead, then due, last warning and pause", () => {
    assert.equal(reminderDue(planAt(planRows({ startDays: 10 })), NOW), null);
    assert.equal(reminderDue(planAt(planRows({ startDays: 28 })), NOW), "upcoming");
    assert.equal(reminderDue(planAt(planRows({ startDays: 31 })), NOW), "due");
    assert.equal(reminderDue(planAt(planRows({ startDays: 35 })), NOW), "last_warning");
    assert.equal(reminderDue(planAt(planRows({ startDays: 40 })), NOW), "paused");
  });

  it("does not announce parts Stripe charges by itself, and gives the charge a day", () => {
    const auto = { gatewayOrderId: "sub_ABCDEFGH12345", gateway: "stripe" };
    assert.equal(reminderDue(planAt(planRows({ startDays: 28, part2: auto })), NOW), null);
    const dueToday = planAt(planRows({ startDays: 30, part2: auto }), NOW + 3_600_000);
    assert.equal(dueToday.autoCharge, true);
    assert.equal(reminderDue(dueToday, NOW + 3_600_000), null);
    assert.equal(reminderDue(planAt(planRows({ startDays: 32, part2: auto })), NOW), "due");
  });
});

describe("admin installment stats and CSV", () => {
  it("counts open plans and what is still owed per currency", () => {
    const stats = installmentStats([
      { status: "on_track", outstandingAmount: 6000, currency: "USD" },
      { status: "paused", outstandingAmount: 3000, currency: "USD" },
      { status: "overdue", outstandingAmount: 50000, currency: "INR" },
      { status: "completed", outstandingAmount: 0, currency: "USD" },
      { status: "cancelled", outstandingAmount: 0, currency: "USD" },
    ]);
    assert.deepEqual(stats, {
      total: 5,
      open: 3,
      overdue: 1,
      paused: 1,
      completed: 1,
      outstanding: [
        { currency: "INR", amount: 50000 },
        { currency: "USD", amount: 9000 },
      ],
    });
  });

  it("reads tab-scoped filters", () => {
    assert.deepEqual(parseInstallmentFilter(new URLSearchParams("istatus=paused&icourse=crs_paid&iq=%20lee%20&ipage=2&status=cancelled")), { status: "paused", courseId: "crs_paid", search: "lee", page: 2 });
    assert.deepEqual(parseInstallmentFilter({ istatus: "bogus" }), { status: "open", courseId: undefined, search: undefined, page: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Store-backed                                                        */
/* ------------------------------------------------------------------ */

const now = Date.now();

async function setup(fixture: { payments?: Payment[]; enrolled?: boolean; enabled?: boolean } = {}) {
  await resetDb({
    users: [learner, admin],
    courses: [course, makeCourse({ id: "crs_other", title: "Other course", paidCourse: true, price: 5000 })],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrolled === false ? [] : [makeEnrollment({ userId: learner.id, courseId: course.id, paymentId: "pay_p1", enrolledAt: iso(-90, now) })],
    settings: { email: { enabled: false }, gamification: { enabled: false }, commerce: { paymentGateway: "manual" }, growth: { installmentsEnabled: fixture.enabled ?? true } },
  });
  resetRequest();
}

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

describe("paying the first installment", () => {
  it("enrolls the learner and schedules the remaining parts one interval apart", async () => {
    const anchor = makePayment({
      id: "pay_p1",
      orderId: "ORD-NEW",
      userId: learner.id,
      itemId: course.id,
      itemTitle: "Paid course · payment 1 of 3",
      amount: 3000,
      originalAmount: 3000,
      gateway: "manual",
      installmentNumber: 1,
      installmentsTotal: 3,
    });
    await setup({ payments: [anchor], enrolled: false });
    const res = await fulfillPayment("pay_p1", undefined, { source: "admin" });
    assert.ok(res.ok);
    await settleEvents();
    const db = await getDb();
    const parts = db.payments.filter((p) => p.orderId.startsWith("ORD-NEW")).sort((a, b) => a.installmentNumber! - b.installmentNumber!);
    assert.deepEqual(
      parts.map((p) => [p.orderId, p.status, p.amount]),
      [
        ["ORD-NEW", "paid", 3000],
        ["ORD-NEW-2", "pending", 3000],
        ["ORD-NEW-3", "pending", 3000],
      ],
    );
    const gap = (Date.parse(parts[2]!.createdAt) - Date.parse(parts[1]!.createdAt)) / DAY;
    assert.equal(Math.round(gap), 30);
    assert.equal(parts[1]!.itemTitle, "Paid course · payment 2 of 3");
    const enrollment = db.enrollments.find((e) => e.userId === learner.id && e.courseId === course.id);
    assert.equal(enrollment?.paymentId, "pay_p1");
    const access = resolveCourseAccess(db, learner.id, course.id);
    assert.ok(access.granted && access.via === "installments");
    // Confirming again does not schedule the parts twice.
    await fulfillPayment("pay_p1", undefined, { source: "admin" });
    assert.equal((await getDb()).payments.filter((p) => p.orderId.startsWith("ORD-NEW")).length, 3);
  });
});

describe("course access follows the plan", () => {
  it("pauses when a part is more than a week late and reopens once it is paid", async () => {
    await setup({ payments: planRows({ startDays: 40, from: now }) });
    let db = await getDb();
    const paused = resolveCourseAccess(db, learner.id, course.id);
    assert.ok(!paused.granted && paused.blocked === "installment_overdue");
    assert.equal(paused.installments?.status, "paused");

    await fulfillPayment("pay_p2", undefined, { source: "admin" });
    await settleEvents();
    db = await getDb();
    const back = resolveCourseAccess(db, learner.id, course.id);
    assert.ok(back.granted && back.via === "installments");
  });

  it("becomes permanent once the plan is paid in full", async () => {
    await setup({ payments: planRows({ startDays: 70, from: now, part2: { status: "paid", paidAt: iso(-40, now) }, part3: { status: "paid", paidAt: iso(-10, now) } }) });
    const access = resolveCourseAccess(await getDb(), learner.id, course.id);
    assert.ok(access.granted && access.via === "purchase");
  });

  it("waiving the rest keeps the course; cancelling locks it", async () => {
    await setup({ payments: planRows({ startDays: 40, from: now }) });
    const waived = await waiveInstallments("ORD-PLAN", admin);
    assert.ok(waived.ok, waived.ok ? "" : waived.error);
    await settleEvents();
    let db = await getDb();
    assert.ok(resolveCourseAccess(db, learner.id, course.id).granted);
    assert.equal(planForCourse(db.payments, learner.id, course.id)?.status, "completed");
    assert.ok(db.auditEvents.some((a) => a.action === "installments.waive"));

    await setup({ payments: planRows({ startDays: 10, from: now }) });
    const cancelled = await cancelInstallmentPlan("ORD-PLAN", admin);
    assert.ok(cancelled.ok, cancelled.ok ? "" : cancelled.error);
    db = await getDb();
    const access = resolveCourseAccess(db, learner.id, course.id);
    assert.ok(!access.granted && access.blocked === "installment_cancelled");
    // Progress is kept: the enrollment stays.
    assert.ok(db.enrollments.some((e) => e.userId === learner.id && e.courseId === course.id));
    assert.ok(!(await cancelInstallmentPlan("ORD-PLAN", admin)).ok);
  });
});

describe("admin installments tab", () => {
  it("lists plans the most urgent first and exports them", async () => {
    await setup({ payments: planRows({ startDays: 40, from: now }) });
    const { rows, stats, courses } = await getAdminInstallments(parseInstallmentFilter({}));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "paused");
    assert.equal(rows[0]!.userEmail, "lee@example.com");
    assert.equal(rows[0]!.outstandingAmount, 6000);
    assert.equal(stats.paused, 1);
    assert.deepEqual(courses, [{ id: course.id, title: course.title }]);
    assert.equal((await getAdminInstallments(parseInstallmentFilter({ istatus: "completed" }))).rows.length, 0);
    assert.equal((await getAdminInstallments(parseInstallmentFilter({ iq: "nobody" }))).rows.length, 0);

    const csv = installmentsToCsv(rows);
    const [header, line] = csv.trim().split(/\r?\n/);
    assert.match(header!, /^Order,Learner,Email,Course,Status/);
    assert.match(line!, /^ORD-PLAN,Lee Learner,lee@example.com,Paid course,Access paused,1,3,30\.00,30\.00,60\.00,USD,2 of 3/);
  });

  it("lists paid courses with their terms, the ones sold in installments first", async () => {
    await setup({ payments: planRows({ startDays: 10, from: now }) });
    const rows = await getInstallmentCourses();
    assert.deepEqual(
      rows.map((r) => [r.id, !!r.plan, r.openPlans]),
      [
        [course.id, true, 1],
        ["crs_other", false, 0],
      ],
    );
    assert.equal(rows[0]!.offer?.partAmount, 3000);
  });

  it("actions are for administrators and change the course terms", async () => {
    await setup({ payments: planRows({ startDays: 10, from: now }) });
    const form = new FormData();
    form.set("courseId", "crs_other");
    form.set("offered", "on");
    form.set("count", "4");
    form.set("intervalDays", "14");
    form.set("surchargePercent", "5");
    assert.ok(!(await saveCourseInstallmentsAction(null, form)).ok);
    await createSession(learner.id);
    assert.ok(!(await installmentPlanAction("ORD-PLAN", "cancel")).ok);
    assert.ok(!(await setInstallmentsEnabledAction(false)).ok);

    await createSession(admin.id);
    const saved = await saveCourseInstallmentsAction(null, form);
    assert.ok(saved.ok, saved.ok ? "" : saved.error);
    assert.deepEqual((await getDb()).courses.find((c) => c.id === "crs_other")?.installments, { count: 4, intervalDays: 14, surchargePercent: 5 });

    form.set("count", "99");
    const invalid = await saveCourseInstallmentsAction(null, form);
    assert.ok(!invalid.ok && invalid.fieldErrors?.count);

    form.delete("offered");
    assert.ok((await saveCourseInstallmentsAction(null, form)).ok);
    assert.equal((await getDb()).courses.find((c) => c.id === "crs_other")?.installments, undefined);

    assert.ok((await setInstallmentsEnabledAction(false)).ok);
    assert.equal((await getDb()).settings.growth.installmentsEnabled, false);
    assert.ok(!(await installmentPlanAction("ORD-PLAN", "bogus" as never)).ok);
  });
});
