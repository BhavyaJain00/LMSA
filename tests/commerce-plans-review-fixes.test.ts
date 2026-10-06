import { after, afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, Gift, MembershipPlan, Payment, Subscription } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { applyRefund, fulfillPayment, markPaymentFailed } from "@/lib/payments/fulfillment";
import { couponAppliesTo, couponProblem } from "@/lib/payments/coupon-rules";
import { checkBillingAccess, getBillingItem, insertPendingOrder, validateCoupon } from "@/lib/data/commerce";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { startManualTrial } from "@/lib/commerce/membership-store";
import { changeMembershipPlan, openRenewalOrder, runMembershipMaintenance } from "@/lib/commerce/membership-service";
import { getMemberMembership } from "@/lib/commerce/membership-views";
import { applySnapshot, GRACE_DAYS, pastDueGraceEnd, subscriptionGrantsAccess } from "@/lib/commerce/subscriptions";
import { redeemGift } from "@/lib/commerce/gift-service";
import { parseViesAnswer, reverseChargeCheck, setViesLookupForTests, checkVatRegistration } from "@/lib/commerce/vies";
import { cancelOrderAction } from "@/lib/actions/payments";
import { makeCoupon, makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Fixes from the round-3 commerce review: past-due grace of gateway
 * memberships, refunds that give back only the refunded period, plan
 * changes scheduled for the next renewal, unpaid manual trials, one
 * membership checkout at a time, personal recovery coupons, orphaned order
 * bumps, prerequisites for bundles and gifts, gift order amounts and the VIES
 * check before a reverse-charged sale.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-15T12:00:00Z");
const at = (offsetDays: number, from = Date.now()) => new Date(from + offsetDays * DAY).toISOString();

const member = makeUser({ id: "usr_member", name: "Mia Member" });
const other = makeUser({ id: "usr_other", name: "Oli Other" });
const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const basics = makeCourse({ id: "crs_basics", slug: "basics", title: "Basics", paidCourse: true, price: 3000 });
const advanced = makeCourse({ id: "crs_adv", slug: "advanced", title: "Advanced", paidCourse: true, price: 5000, prerequisiteCourseIds: ["crs_basics"] });

const plan = (overrides: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: "plan_month",
  slug: "monthly",
  name: "Monthly",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 0,
  access: { type: "courses", courseIds: [basics.id] },
  active: true,
  features: [],
  createdAt: at(-60),
  updatedAt: at(-60),
  ...overrides,
});
const monthly = plan();
const premium = plan({ id: "plan_premium", slug: "premium", name: "Premium", price: 9900, access: { type: "all" } });

const sub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: "sub_1",
  userId: member.id,
  planId: monthly.id,
  status: "active",
  currentPeriodStart: at(-10),
  currentPeriodEnd: at(20),
  cancelAtPeriodEnd: false,
  gateway: "manual",
  createdAt: at(-10),
  updatedAt: at(-10),
  ...overrides,
});

const planOrder = (overrides: Partial<Payment> = {}): Payment =>
  makePayment({ id: "pay_1", userId: member.id, itemType: "plan", itemId: monthly.id, planId: monthly.id, itemTitle: monthly.name, amount: 1900, originalAmount: 1900, gateway: "manual", ...overrides });

async function setup(fixture: { subscriptions?: Subscription[]; payments?: Payment[]; gifts?: Gift[]; bundles?: Bundle[]; enrollments?: ReturnType<typeof makeEnrollment>[] } = {}) {
  await resetDb({
    users: [member, other, admin],
    courses: [basics, advanced],
    plans: [monthly, premium],
    bundles: fixture.bundles ?? [],
    gifts: fixture.gifts ?? [],
    subscriptions: fixture.subscriptions ?? [],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrollments ?? [],
    settings: {
      email: { enabled: false },
      gamification: { enabled: false },
      commerce: { paymentGateway: "manual" },
      growth: { subscriptionsEnabled: true, bundlesEnabled: true, giftsEnabled: true },
    },
  });
  resetRequest();
}

const theSub = async (id = "sub_1"): Promise<Subscription> => ({ ...(await getDb()).subscriptions.find((s) => s.id === id)! });

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

/* ------------------------------------------------------------------ */
/* Past-due grace                                                      */
/* ------------------------------------------------------------------ */

describe("grace period of a past-due membership", () => {
  const stripe = (overrides: Partial<Subscription> = {}) =>
    sub({ gateway: "stripe", gatewaySubscriptionId: "sub_stripe12345", status: "past_due", currentPeriodStart: at(-1, NOW), currentPeriodEnd: at(29, NOW), ...overrides });

  it("runs from the failed charge for gateway subscriptions, not from the end of the unpaid period", () => {
    const due = stripe({ pastDueSince: at(-1, NOW) });
    assert.equal(pastDueGraceEnd(due), Date.parse(at(-1, NOW)) + GRACE_DAYS * DAY);
    assert.equal(subscriptionGrantsAccess(due, NOW + (GRACE_DAYS - 2) * DAY), true);
    assert.equal(subscriptionGrantsAccess(due, NOW + GRACE_DAYS * DAY), false);
    assert.equal(subscriptionGrantsAccess(due, NOW + 20 * DAY), false, "a whole unpaid month is never granted");
    // Rows recorded before `pastDueSince` existed: the start of the reported period.
    assert.equal(pastDueGraceEnd(stripe()), Date.parse(at(-1, NOW)) + GRACE_DAYS * DAY);
    // A gateway that kept the paid period: never later than its end plus the grace.
    const kept = stripe({ currentPeriodStart: at(-31, NOW), currentPeriodEnd: at(-1, NOW), pastDueSince: at(0, NOW) });
    assert.equal(pastDueGraceEnd(kept), Date.parse(at(-1, NOW)) + GRACE_DAYS * DAY);
  });

  it("still runs from the paid period's end for memberships managed here", () => {
    const manual = sub({ status: "past_due", currentPeriodStart: at(-33, NOW), currentPeriodEnd: at(-3, NOW) });
    assert.equal(pastDueGraceEnd(manual), Date.parse(at(-3, NOW)) + GRACE_DAYS * DAY);
  });

  it("records when the gateway first reported the failure and forgets it once paid", () => {
    const row = stripe({ status: "active", currentPeriodStart: at(-31, NOW), currentPeriodEnd: at(-1, NOW) });
    applySnapshot(row, { status: "past_due", currentPeriodStart: at(-1, NOW), currentPeriodEnd: at(29, NOW) }, at(0, NOW));
    assert.equal(row.pastDueSince, at(0, NOW));
    // A redelivered event keeps the first moment.
    applySnapshot(row, { status: "past_due", currentPeriodStart: at(-1, NOW), currentPeriodEnd: at(29, NOW) }, at(2, NOW));
    assert.equal(row.pastDueSince, at(0, NOW));
    applySnapshot(row, { status: "active", currentPeriodStart: at(-1, NOW), currentPeriodEnd: at(29, NOW) }, at(3, NOW));
    assert.equal(row.pastDueSince, undefined);
  });

  it("applies a plan change scheduled on the gateway once the new cycle is paid", () => {
    const row = sub({ gateway: "razorpay", gatewaySubscriptionId: "sub_Rzp12345678", pendingPlanId: premium.id, currentPeriodEnd: at(1, NOW) });
    applySnapshot(row, { status: "active", currentPeriodEnd: at(1, NOW) }, at(0, NOW));
    assert.equal(row.planId, monthly.id, "same cycle: nothing changes");
    applySnapshot(row, { status: "active", currentPeriodStart: at(1, NOW), currentPeriodEnd: at(31, NOW) }, at(1, NOW));
    assert.equal(row.planId, premium.id);
    assert.equal(row.pendingPlanId, undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

describe("refunding a membership order", () => {
  it("takes back only the period the refunded order bought", async () => {
    await setup({ payments: [planOrder()] });
    await fulfillPayment("pay_1", undefined, { source: "admin" });
    const started = (await getDb()).subscriptions[0]!;
    const firstEnd = started.currentPeriodEnd;
    // An early renewal adds a second month.
    const renewal = await openRenewalOrder({ ...started }, { notifyMember: false });
    assert.ok(renewal);
    await fulfillPayment(renewal.id, undefined, { source: "admin" });
    assert.ok(Date.parse((await theSub(started.id)).currentPeriodEnd) > Date.parse(firstEnd));

    const refunded = await applyRefund(renewal.id, { amount: renewal.amount });
    assert.ok(refunded.ok);
    let row = await theSub(started.id);
    assert.equal(row.status, "active", "the month paid by the first order is kept");
    assert.equal(row.currentPeriodEnd, firstEnd);

    // Refunding the order that paid the remaining time ends the membership now.
    await applyRefund("pay_1", { amount: 1900 });
    row = await theSub(started.id);
    assert.equal(row.status, "cancelled");
    assert.ok(Date.parse(row.currentPeriodEnd) <= Date.now());
  });
});

/* ------------------------------------------------------------------ */
/* Plan changes                                                        */
/* ------------------------------------------------------------------ */

describe("changing the plan of a membership managed here", () => {
  it("keeps the current plan's courses until the renewal on the new plan is paid", async () => {
    await setup({ subscriptions: [sub({ currentPeriodEnd: at(3) })], payments: [planOrder({ status: "paid", paidAt: at(-27), subscriptionId: "sub_1" })] });
    const res = await changeMembershipPlan(await theSub(), premium);
    assert.ok(res.ok);
    assert.match(res.message, /You'll move to Premium when your membership renews/);
    let row = await theSub();
    assert.equal(row.planId, monthly.id);
    assert.equal(row.pendingPlanId, premium.id);
    // Advanced is in Premium only: not unlocked before Premium is paid for.
    assert.equal(resolveCourseAccess(await getDb(), member.id, advanced.id).membership, null);
    const page = await getMemberMembership(member.id);
    assert.equal(page.current?.pendingPlan?.id, premium.id);
    assert.deepEqual(page.current?.changeTargets.map((t) => t.id), [monthly.id], "the current plan is offered to keep it");

    const renewal = await openRenewalOrder(row, { notifyMember: false });
    assert.equal(renewal?.planId, premium.id);
    assert.equal(renewal?.amount, 9900);
    await fulfillPayment(renewal!.id, undefined, { source: "admin" });
    row = await theSub();
    assert.equal(row.planId, premium.id);
    assert.equal(row.pendingPlanId, undefined);
    assert.ok(resolveCourseAccess(await getDb(), member.id, advanced.id).membership);
  });

  it("drops a scheduled change when the member keeps their plan", async () => {
    await setup({ subscriptions: [sub()], payments: [planOrder({ status: "paid", paidAt: at(-10), subscriptionId: "sub_1" })] });
    await changeMembershipPlan(await theSub(), premium);
    const res = await changeMembershipPlan(await theSub(), monthly);
    assert.ok(res.ok);
    const row = await theSub();
    assert.equal(row.planId, monthly.id);
    assert.equal(row.pendingPlanId, undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Manual trials                                                       */
/* ------------------------------------------------------------------ */

describe("a manual trial that ends", () => {
  it("expires without grace when its order was cancelled", async () => {
    await setup({ payments: [planOrder()] });
    const trial = await startManualTrial("pay_1", 7);
    assert.ok(trial);
    await markPaymentFailed("pay_1");
    await runMembershipMaintenance({ now: new Date(Date.now() + 8 * DAY), userId: member.id });
    const row = await theSub(trial.id);
    assert.equal(row.status, "expired");
    assert.equal(subscriptionGrantsAccess(row, Date.now() + 8 * DAY), false);
    assert.equal((await getDb()).payments.filter((p) => p.status === "pending").length, 0, "no renewal order for a trial that was never paid");
  });

  it("gets the grace period while its payment awaits confirmation", async () => {
    await setup({ payments: [planOrder()] });
    const trial = await startManualTrial("pay_1", 7);
    await runMembershipMaintenance({ now: new Date(Date.now() + 8 * DAY), userId: member.id });
    assert.equal((await theSub(trial!.id)).status, "past_due");
  });
});

/* ------------------------------------------------------------------ */
/* One membership checkout at a time                                   */
/* ------------------------------------------------------------------ */

describe("membership checkouts", () => {
  it("sends a second plan's checkout to the order that is already open", async () => {
    await setup({ payments: [planOrder()] });
    const user = (await getDb()).users.find((u) => u.id === member.id)!;
    const item = await getBillingItem("plan", premium.id);
    assert.ok(item);
    const access = await checkBillingAccess(user, item);
    assert.equal(access.status, "pending");
    assert.equal(access.status === "pending" ? access.payment.id : null, "pay_1");

    const inserted = await insertPendingOrder(planOrder({ id: "pay_2", itemId: premium.id, planId: premium.id, status: "pending" }));
    assert.ok(inserted.ok && inserted.existing && inserted.payment.id === "pay_1");
    assert.equal((await getDb()).payments.length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Coupons                                                             */
/* ------------------------------------------------------------------ */

describe("coupon targets and personal codes", () => {
  const ctx = (userId?: string) => ({ payments: [], userId, defaultCurrency: "USD", today: "2026-06-15" });

  it("limits a coupon to bundles and plans when it lists them", () => {
    const bundleCoupon = makeCoupon({ applicableItems: [{ type: "bundle", id: "bnd_1" }] });
    assert.equal(couponAppliesTo(bundleCoupon, { type: "bundle", id: "bnd_1" }), true);
    assert.equal(couponAppliesTo(bundleCoupon, { type: "bundle", id: "bnd_2" }), false);
    assert.equal(couponAppliesTo(bundleCoupon, { type: "course", id: "bnd_1" }), false);
    const planCoupon = makeCoupon({ applicableItems: [{ type: "plan", id: "plan_life" }] });
    assert.equal(couponAppliesTo(planCoupon, { type: "plan", id: "plan_life" }), true);
    assert.equal(couponAppliesTo(planCoupon, { type: "course", id: "crs_x" }), false);
    const courseCoupon = makeCoupon({ applicableItems: [{ type: "course", id: "crs_x" }] });
    assert.equal(couponAppliesTo(courseCoupon, { type: "certificate", id: "crs_x" }), true);
  });

  it("works only for the member a personal code was made for", () => {
    const mine = makeCoupon({ code: "COMEBACK-AB12", ownerUserId: member.id });
    const target = { type: "course" as const, id: "crs_x", currency: "USD" };
    assert.equal(couponProblem(mine, target, ctx(member.id)), null);
    assert.match(couponProblem(mine, target, ctx(other.id)) ?? "", /invalid/);
    assert.match(couponProblem(mine, target, ctx()) ?? "", /invalid/);
  });

  it("checks the owner when a code is entered at checkout", async () => {
    await setup();
    await mutate((d) => {
      d.coupons.push(makeCoupon({ id: "cpn_mine", code: "COMEBACK-ZZ99", ownerUserId: member.id, applicableItems: [{ type: "course", id: basics.id }] }));
    });
    const item = { type: "course" as const, id: basics.id, currency: "USD" };
    assert.equal((await validateCoupon("COMEBACK-ZZ99", item, member.id)).ok, true);
    assert.equal((await validateCoupon("COMEBACK-ZZ99", item, other.id)).ok, false);
  });
});

/* ------------------------------------------------------------------ */
/* Order bumps                                                         */
/* ------------------------------------------------------------------ */

describe("an add-on whose main order is gone", () => {
  it("can be cancelled on its own, so the item can be bought again", async () => {
    const bump = makePayment({ id: "pay_bump", orderId: "ORD-MAIN-B", userId: member.id, itemId: basics.id, itemTitle: "Basics", upsellOfPaymentId: "pay_missing", gateway: "stripe", status: "pending" });
    await setup({ payments: [bump] });
    await createSession(member.id);
    const form = new FormData();
    form.set("orderId", "ORD-MAIN-B");
    const res = await cancelOrderAction(null, form);
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal((await getDb()).payments[0]!.status, "failed");
  });
});

/* ------------------------------------------------------------------ */
/* Prerequisites of bundles and gifts                                  */
/* ------------------------------------------------------------------ */

const bundle = (courseIds: string[]): Bundle => ({ id: "bnd_1", slug: "pack", title: "Pack", description: "", courseIds, price: 6000, currency: "USD", published: true, createdAt: at(-5), updatedAt: at(-5) });

describe("course prerequisites", () => {
  it("block a bundle whose course needs a prerequisite outside the bundle", async () => {
    await setup({ bundles: [bundle([advanced.id])] });
    const user = (await getDb()).users.find((u) => u.id === member.id)!;
    const access = await checkBillingAccess(user, (await getBillingItem("bundle", "bnd_1"))!);
    assert.equal(access.status, "denied");
    assert.match(access.status === "denied" ? access.message : "", /“Advanced” requires “Basics”/);
  });

  it("are met by a prerequisite that comes with the same bundle", async () => {
    await setup({ bundles: [bundle([basics.id, advanced.id])] });
    const user = (await getDb()).users.find((u) => u.id === member.id)!;
    assert.equal((await checkBillingAccess(user, (await getBillingItem("bundle", "bnd_1"))!)).status, "ok");
  });

  it("are checked before a gifted course is redeemed, keeping the code", async () => {
    const code = "GIFT-AAAA-BBBB-CCCC";
    const gift: Gift = { id: "gft_1", code, purchaserId: other.id, recipientEmail: member.email, itemType: "course", itemId: advanced.id, paymentId: "pay_gift", sentAt: at(-1), createdAt: at(-1) };
    // Bought in euros (a fixed EUR price of the course).
    const order = makePayment({ id: "pay_gift", userId: other.id, itemType: "gift", itemId: gift.id, giftId: gift.id, itemTitle: "Gift: Advanced", amount: 4900, originalAmount: 4900, currency: "EUR", gateway: "manual", status: "paid", paidAt: at(-1) });
    await setup({ gifts: [gift], payments: [order] });
    const blocked = await redeemGift(member, code, null);
    assert.ok(!blocked.ok && /Complete “Basics”/.test(blocked.error) && /stays valid/.test(blocked.error));
    assert.equal((await getDb()).gifts[0]!.redeemedAt, undefined);

    await mutate((d) => {
      d.enrollments.push(makeEnrollment({ userId: member.id, courseId: basics.id, completedAt: at(-2) }));
    });
    const res = await redeemGift(member, code, null);
    assert.ok(res.ok, res.ok ? "" : res.error);
    await settleEvents();
    const mine = (await getDb()).payments.find((p) => p.userId === member.id && p.giftId === gift.id)!;
    // The recipient's order carries what was paid, in the currency it was paid in.
    assert.deepEqual({ original: mine.originalAmount, discount: mine.discountAmount, amount: mine.amount, currency: mine.currency }, { original: 4900, discount: 4900, amount: 0, currency: "EUR" });
  });
});

/* ------------------------------------------------------------------ */
/* VIES                                                                */
/* ------------------------------------------------------------------ */

describe("VIES check before a reverse charge", () => {
  afterEach(() => setViesLookupForTests(null));

  it("reads the registry's answer", () => {
    assert.equal(parseViesAnswer({ isValid: true, userError: "VALID" }), "valid");
    assert.equal(parseViesAnswer({ isValid: false, userError: "INVALID" }), "invalid");
    assert.equal(parseViesAnswer({ isValid: false, userError: "MS_UNAVAILABLE" }), "unavailable");
    assert.equal(parseViesAnswer({ isValid: false, userError: "TIMEOUT" }), "unavailable");
    assert.equal(parseViesAnswer(null), "unavailable");
  });

  it("refuses an unregistered number, records a confirmed one and flags one it could not check", async () => {
    const answers: Record<string, "valid" | "invalid" | "unavailable"> = { "123456789": "valid", "999999999": "invalid", "111111111": "unavailable" };
    let lookups = 0;
    setViesLookupForTests(async (_prefix, number) => {
      lookups++;
      return answers[number] ?? "unavailable";
    });
    const charged = { reverseCharge: true };
    assert.deepEqual(await reverseChargeCheck(charged, "DE123456789"), { ok: true, vatCheck: "valid" });
    const refused = await reverseChargeCheck(charged, "DE999999999");
    assert.ok(!refused.ok && /isn't registered/.test(refused.error));
    assert.deepEqual(await reverseChargeCheck(charged, "DE111111111"), { ok: true, vatCheck: "unverified" });
    // VAT is charged anyway: nothing to look up.
    assert.deepEqual(await reverseChargeCheck({ reverseCharge: false }, "DE999999999"), { ok: true });
    // Confirmed answers are cached; an unavailable registry is asked again.
    const before = lookups;
    await checkVatRegistration("DE 123 456 789");
    await checkVatRegistration("DE111111111");
    assert.equal(lookups, before + 1);
  });
});
