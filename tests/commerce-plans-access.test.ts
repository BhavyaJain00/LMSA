import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { BatchEnrollment, MembershipPlan, Payment, Subscription } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { currentSubscription, enrollmentGrantsAccess, hasCourseAccess, membershipOrderFor, resolveCourseAccess } from "@/lib/commerce/access";
import { joinCourseWithMembership } from "@/lib/commerce/membership-service";
import { GRACE_DAYS } from "@/lib/commerce/subscriptions";
import { checkBillingAccess, itemFromPlan, membershipTerms } from "@/lib/data/commerce";
import { getLessonAccess } from "@/lib/data/lessons";
import { makeBatch, makeChapter, makeCourse, makeEnrollment, makeLesson, makePayment, makeProgress, makeUser, resetDb } from "./helpers/db";

/**
 * Course access through memberships: a running membership replaces the
 * checkout, the enrollment it opens locks again when the membership lapses
 * (progress kept) and reopens on rejoining, buying the course or a batch seat.
 */

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const member = makeUser({ id: "usr_member", name: "Mia Member" });
const other = makeUser({ id: "usr_other" });
const paid = makeCourse({ id: "crs_paid", title: "Paid course", paidCourse: true, price: 5000 });
const second = makeCourse({ id: "crs_second", title: "Second paid course", paidCourse: true, price: 3000 });
const free = makeCourse({ id: "crs_free", title: "Free course" });
const chapter = makeChapter({ id: "chp_1", courseId: paid.id });
const preview = makeLesson({ id: "les_preview", courseId: paid.id, chapterId: chapter.id, order: 1, includeInPreview: true });
const locked = makeLesson({ id: "les_locked", courseId: paid.id, chapterId: chapter.id, order: 2 });

const plan = (overrides: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: "plan_all",
  slug: "all-access",
  name: "All access",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 7,
  access: { type: "all" },
  active: true,
  features: [],
  createdAt: at(-30),
  updatedAt: at(-30),
  ...overrides,
});
const allPlan = plan();
const selectedPlan = plan({ id: "plan_sel", slug: "selected", name: "Selected", access: { type: "courses", courseIds: [second.id] } });

const sub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: "sub_1",
  userId: member.id,
  planId: allPlan.id,
  status: "active",
  currentPeriodStart: at(-5),
  currentPeriodEnd: at(25),
  cancelAtPeriodEnd: false,
  gateway: "manual",
  createdAt: at(-5),
  updatedAt: at(-5),
  ...overrides,
});

const planOrder = (overrides: Partial<Payment> = {}): Payment =>
  makePayment({ id: "pay_plan", userId: member.id, itemType: "plan", itemId: allPlan.id, planId: allPlan.id, subscriptionId: "sub_1", itemTitle: allPlan.name, amount: 1900, originalAmount: 1900, gateway: "manual", status: "paid", paidAt: at(-5), ...overrides });

async function setup(fixture: { subscriptions?: Subscription[]; payments?: Payment[]; enrolled?: boolean; batchSeat?: boolean; subscriptionsEnabled?: boolean } = {}) {
  const batch = makeBatch({ id: "bat_1", courseIds: [paid.id] });
  const seat: BatchEnrollment = { id: "be_1", batchId: batch.id, userId: member.id, confirmationEmailSent: true, enrolledAt: at(-1) };
  await resetDb({
    users: [member, other],
    courses: [paid, second, free],
    chapters: [chapter],
    lessons: [preview, locked],
    plans: [allPlan, selectedPlan],
    batches: [batch],
    batchEnrollments: fixture.batchSeat ? [seat] : [],
    subscriptions: fixture.subscriptions ?? [sub()],
    payments: fixture.payments ?? [planOrder()],
    enrollments: fixture.enrolled ? [makeEnrollment({ id: "enr_m", userId: member.id, courseId: paid.id, paymentId: "pay_plan" })] : [],
    progress: fixture.enrolled ? [makeProgress(preview, member.id)] : [],
    settings: { email: { enabled: false }, gamification: { enabled: false }, growth: { subscriptionsEnabled: fixture.subscriptionsEnabled ?? true } },
  });
}

async function endMembership(status: Subscription["status"] = "expired", end = at(-1)) {
  await mutate((d) => {
    const row = d.subscriptions.find((s) => s.id === "sub_1")!;
    row.status = status;
    row.currentPeriodEnd = end;
  });
}

before(() => {
  mock.method(console, "info", () => undefined);
});
after(() => mock.restoreAll());

describe("resolveCourseAccess", () => {
  beforeEach(() => setup());

  it("offers a covered course to a member without enrolling them", async () => {
    const access = resolveCourseAccess(await getDb(), member.id, paid.id);
    assert.equal(access.granted, false);
    assert.equal(access.blocked, "not_enrolled");
    assert.equal(access.membership?.plan.id, allPlan.id);
    assert.equal(await hasCourseAccess(member, paid.id), false);
    assert.equal(await hasCourseAccess(null, paid.id), false);
  });

  it("finds nothing for someone without a membership or for a course the plan leaves out", async () => {
    const db = await getDb();
    assert.equal(resolveCourseAccess(db, other.id, paid.id).membership, null);
    await mutate((d) => {
      d.subscriptions[0]!.planId = selectedPlan.id;
    });
    const fresh = await getDb();
    assert.equal(resolveCourseAccess(fresh, member.id, paid.id).membership, null);
    assert.equal(resolveCourseAccess(fresh, member.id, second.id).membership?.plan.id, selectedPlan.id);
    assert.equal(resolveCourseAccess(fresh, member.id, "crs_missing").granted, false);
  });

  it("treats free courses and ordinary enrollments as permanent", async () => {
    await mutate((d) => {
      d.enrollments.push(makeEnrollment({ userId: other.id, courseId: paid.id }), makeEnrollment({ userId: other.id, courseId: free.id }));
    });
    const db = await getDb();
    assert.deepEqual(
      [resolveCourseAccess(db, other.id, paid.id).via, resolveCourseAccess(db, other.id, free.id).via],
      ["enrollment", "free"],
    );
    assert.equal(await hasCourseAccess(other, paid.id), true);
  });
});

describe("joining a course with a membership", () => {
  beforeEach(() => setup());

  it("enrolls without a checkout and ties the enrollment to the membership order", async () => {
    const res = await joinCourseWithMembership(member, paid);
    assert.deepEqual(res, { ok: true, alreadyEnrolled: false });
    const db = await getDb();
    const enrollment = db.enrollments.find((e) => e.userId === member.id && e.courseId === paid.id);
    assert.equal(enrollment?.paymentId, "pay_plan");
    assert.equal(enrollment?.memberType, "student");
    const access = resolveCourseAccess(db, member.id, paid.id);
    assert.equal(access.granted, true);
    assert.equal(access.via, "membership");
    assert.deepEqual(await joinCourseWithMembership(member, paid), { ok: true, alreadyEnrolled: true });
    assert.equal((await getDb()).enrollments.filter((e) => e.userId === member.id).length, 1);
  });

  it("uses the first paid order of the membership, not a later renewal", async () => {
    await mutate((d) => {
      d.payments.push(planOrder({ id: "pay_renewal", orderId: "ORD-RENEW", createdAt: at(-1), paidAt: at(-1), source: "Renewal" }));
    });
    assert.equal(membershipOrderFor(await getDb(), { id: "sub_1" })?.id, "pay_plan");
  });

  it("refuses courses outside the plan, unpublished courses and non-members", async () => {
    const stranger = await joinCourseWithMembership(other, paid);
    assert.ok(!stranger.ok && /doesn't include/.test(stranger.error));
    const draft = makeCourse({ id: "crs_draft", paidCourse: true, price: 100, published: false });
    await mutate((d) => {
      d.courses.push(draft);
    });
    const unpublished = await joinCourseWithMembership(member, draft);
    assert.ok(!unpublished.ok && /not open for enrollment/.test(unpublished.error));
    await mutate((d) => {
      d.subscriptions[0]!.planId = selectedPlan.id;
    });
    const outside = await joinCourseWithMembership(member, paid);
    assert.ok(!outside.ok);
    assert.equal((await getDb()).enrollments.length, 0);
  });
});

describe("a lapsed membership", () => {
  beforeEach(() => setup({ enrolled: true }));

  it("unlocks lessons while the membership runs", async () => {
    const access = await getLessonAccess(member, locked.id);
    assert.equal(access?.canView, true);
    assert.equal(access?.enrolled, true);
  });

  it("locks the lessons again, keeps the progress and leaves free previews open", async () => {
    await endMembership();
    const db = await getDb();
    const resolved = resolveCourseAccess(db, member.id, paid.id);
    assert.equal(resolved.granted, false);
    assert.equal(resolved.blocked, "membership_lapsed");
    assert.ok(resolved.enrollment, "the enrollment is kept");
    assert.equal(enrollmentGrantsAccess(db, resolved.enrollment!), false);

    const lesson = await getLessonAccess(member, locked.id);
    assert.equal(lesson?.canView, false);
    assert.equal(lesson?.enrolled, false);
    assert.equal(lesson?.lock?.reason, "enroll");
    const open = await getLessonAccess(member, preview.id);
    assert.equal(open?.canView, true);
    assert.equal(open?.status, "complete");
    assert.equal(db.progress.filter((p) => p.userId === member.id).length, 1);
    assert.equal(db.enrollments.length, 1);
  });

  it("keeps access through the grace period of an unpaid renewal, then locks", async () => {
    await endMembership("past_due", at(-2));
    assert.equal((await getLessonAccess(member, locked.id))?.canView, true);
    await endMembership("past_due", at(-(GRACE_DAYS + 1)));
    assert.equal((await getLessonAccess(member, locked.id))?.canView, false);
  });

  it("runs a cancelled membership to its period end", async () => {
    await endMembership("cancelled", at(3));
    assert.equal(resolveCourseAccess(await getDb(), member.id, paid.id).via, "membership");
    await endMembership("cancelled", at(-0.01));
    assert.equal(resolveCourseAccess(await getDb(), member.id, paid.id).blocked, "membership_lapsed");
  });

  it("reopens when the member rejoins with a new membership", async () => {
    await endMembership();
    await mutate((d) => {
      d.subscriptions.push(sub({ id: "sub_2", createdAt: at(0) }));
      d.payments.push(planOrder({ id: "pay_plan2", orderId: "ORD-REJOIN", subscriptionId: "sub_2" }));
    });
    const db = await getDb();
    assert.equal(resolveCourseAccess(db, member.id, paid.id).via, "membership");
    assert.equal(currentSubscription(db, member.id)?.id, "sub_2");
    assert.equal((await getLessonAccess(member, locked.id))?.canView, true);
  });

  it("stays open when the member bought the course or holds a batch seat that includes it", async () => {
    await endMembership();
    await mutate((d) => {
      d.payments.push(makePayment({ id: "pay_course", userId: member.id, itemId: paid.id, status: "paid", amount: 5000 }));
    });
    assert.equal(resolveCourseAccess(await getDb(), member.id, paid.id).via, "purchase");
    assert.equal((await getLessonAccess(member, locked.id))?.canView, true);

    await setup({ enrolled: true, batchSeat: true });
    await endMembership();
    assert.equal(resolveCourseAccess(await getDb(), member.id, paid.id).via, "batch");
  });

  it("does not count a refunded or pending course order as a purchase", async () => {
    await endMembership();
    await mutate((d) => {
      d.payments.push(makePayment({ id: "pay_refunded", userId: member.id, itemId: paid.id, status: "refunded" }), makePayment({ id: "pay_open", userId: member.id, itemId: paid.id, status: "pending" }));
    });
    assert.equal(resolveCourseAccess(await getDb(), member.id, paid.id).granted, false);
  });
});

describe("membership checkout rules", () => {
  it("sends a member with a running membership to their membership page", async () => {
    await setup();
    assert.deepEqual(await checkBillingAccess(member, itemFromPlan(allPlan)), { status: "owned", redirectTo: "/settings/subscription" });
    assert.deepEqual(await checkBillingAccess(other, itemFromPlan(allPlan)), { status: "ok" });
  });

  it("lets a member whose membership ended check out again", async () => {
    await setup({ subscriptions: [sub({ status: "expired", currentPeriodEnd: at(-10) })] });
    assert.deepEqual(await checkBillingAccess(member, itemFromPlan(allPlan)), { status: "ok" });
  });

  it("closes the checkout for retired plans and when membership sales are off", async () => {
    await setup({ subscriptions: [], payments: [] });
    const retired = await checkBillingAccess(member, itemFromPlan({ ...allPlan, active: false }));
    assert.equal(retired.status, "denied");
    await setup({ subscriptions: [], payments: [], subscriptionsEnabled: false });
    const off = await checkBillingAccess(member, itemFromPlan(allPlan));
    assert.equal(off.status, "denied");
  });

  it("gives the free trial to first-time members of a recurring plan only", async () => {
    await setup({ subscriptions: [sub({ status: "expired", currentPeriodEnd: at(-10) })] });
    const db = await getDb();
    const firstTimer = membershipTerms(db, other.id, allPlan);
    assert.equal(firstTimer.trialDays, 7);
    assert.equal(firstTimer.recurring, true);
    assert.ok(firstTimer.trialEndsAt && Date.parse(firstTimer.trialEndsAt) > Date.now() + 6 * DAY);
    assert.deepEqual({ ...membershipTerms(db, member.id, allPlan) }, { trialDays: 0, recurring: true, interval: "month", trialEndsAt: null });
    const lifetime = membershipTerms(db, other.id, { ...allPlan, interval: "one_time", trialDays: 7 });
    assert.equal(lifetime.trialDays, 0);
    assert.equal(lifetime.recurring, false);
  });
});
