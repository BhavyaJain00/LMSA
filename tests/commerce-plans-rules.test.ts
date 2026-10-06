import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MembershipPlan, Subscription } from "@/lib/types";
import {
  addInterval,
  defaultCycle,
  monthlyCounterpart,
  monthlyEquivalent,
  planCoversCourse,
  planMatchesCycle,
  planSavingsPercent,
  validatePlanInput,
  yearlySavingsPercent,
  type PlanFormInput,
} from "@/lib/commerce/plans";
import {
  GATEWAY_LEEWAY_HOURS,
  GRACE_DAYS,
  advanceSubscription,
  applySnapshot,
  extendedPeriod,
  isGatewayManaged,
  mapRazorpayStatus,
  mapStripeStatus,
  monthlyRecurringRevenue,
  nextChargeDate,
  renewalDue,
  subscriptionGrantsAccess,
  trialEligible,
} from "@/lib/commerce/subscriptions";
import { razorpaySnapshot, stripeSnapshot } from "@/lib/commerce/snapshots";
import { messageForTransition } from "@/lib/commerce/handlers";

/**
 * Membership rules (pure): plan math and form validation, the subscription
 * lifecycle, gateway status mapping and which message a transition deserves.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const plan = (overrides: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: "plan_m",
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
  createdAt: iso(NOW),
  updatedAt: iso(NOW),
  ...overrides,
});

const sub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: "sub_1",
  userId: "usr_1",
  planId: "plan_m",
  status: "active",
  currentPeriodStart: iso(NOW - 10 * DAY),
  currentPeriodEnd: iso(NOW + 20 * DAY),
  cancelAtPeriodEnd: false,
  gateway: "manual",
  createdAt: iso(NOW - 10 * DAY),
  updatedAt: iso(NOW - 10 * DAY),
  ...overrides,
});

describe("plan math", () => {
  it("adds calendar months and clamps the day to short months", () => {
    assert.equal(addInterval("2026-01-31T10:00:00.000Z", "month"), "2026-02-28T10:00:00.000Z");
    assert.equal(addInterval("2028-01-31T10:00:00.000Z", "month"), "2028-02-29T10:00:00.000Z");
    assert.equal(addInterval("2026-12-15T00:00:00.000Z", "month"), "2027-01-15T00:00:00.000Z");
    assert.equal(addInterval("2028-02-29T00:00:00.000Z", "year"), "2029-02-28T00:00:00.000Z");
    assert.equal(addInterval("2026-03-10T00:00:00.000Z", "month", 3), "2026-06-10T00:00:00.000Z");
    assert.equal(new Date(addInterval("2026-03-10T00:00:00.000Z", "one_time")).getUTCFullYear(), 2126);
    assert.throws(() => addInterval("not a date", "month"), RangeError);
  });

  it("never overstates the yearly saving", () => {
    assert.equal(yearlySavingsPercent(1900, 15900), 30); // 30.26% rounds down
    assert.equal(yearlySavingsPercent(1000, 12000), 0);
    assert.equal(yearlySavingsPercent(1000, 13000), 0);
    assert.equal(yearlySavingsPercent(0, 5000), 0);
    assert.equal(yearlySavingsPercent(1000, 11999), 0); // under one percent
  });

  it("compares a yearly plan with the cheapest monthly plan of the same currency and access", () => {
    const monthly = plan();
    const cheaperMonthly = plan({ id: "plan_m2", price: 1500 });
    const euros = plan({ id: "plan_eur", currency: "EUR", price: 500 });
    const selected = plan({ id: "plan_sel", price: 900, access: { type: "courses", courseIds: ["c1"] } });
    const yearly = plan({ id: "plan_y", interval: "year", price: 15000 });
    const all = [monthly, cheaperMonthly, euros, selected, yearly];
    assert.equal(monthlyCounterpart(yearly, all)?.id, "plan_m2");
    assert.equal(planSavingsPercent(yearly, all), 16); // 18000 → 15000
    assert.equal(planSavingsPercent(monthly, all), 0);
    const yearlySelected = plan({ id: "plan_ys", interval: "year", price: 9000, access: { type: "courses", courseIds: ["c1"] } });
    assert.equal(monthlyCounterpart(yearlySelected, [...all, yearlySelected])?.id, "plan_sel");
    assert.equal(monthlyCounterpart(plan({ id: "y_gbp", interval: "year", currency: "GBP" }), all), null);
  });

  it("knows what a plan covers and where it shows on the pricing page", () => {
    assert.equal(planCoversCourse(plan(), "anything"), true);
    const selected = plan({ access: { type: "courses", courseIds: ["c1", "c2"] } });
    assert.equal(planCoversCourse(selected, "c2"), true);
    assert.equal(planCoversCourse(selected, "c3"), false);
    assert.equal(planMatchesCycle(plan({ interval: "one_time" }), "month"), true);
    assert.equal(planMatchesCycle(plan({ interval: "year" }), "month"), false);
    assert.equal(defaultCycle([plan({ interval: "year" }), plan({ interval: "one_time" })]), "year");
    assert.equal(defaultCycle([plan({ interval: "year" }), plan()]), "month");
    assert.equal(monthlyEquivalent(plan({ interval: "year", price: 12000 })), 1000);
    assert.equal(monthlyEquivalent(plan({ interval: "one_time", price: 50000 })), 0);
  });
});

describe("validatePlanInput", () => {
  const ctx = { knownCourseIds: new Set(["c1", "c2"]), currencies: ["USD", "EUR"] };
  const input = (overrides: Partial<PlanFormInput> = {}): PlanFormInput => ({
    name: " All access ",
    slug: "All-Access",
    description: "",
    interval: "month",
    price: "19.5",
    currency: "usd",
    trialDays: "7",
    accessType: "all",
    courseIds: [],
    features: "Every course\n\n  Certificates  \n",
    active: true,
    stripePriceId: "",
    razorpayPlanId: "",
    ...overrides,
  });

  it("normalizes a valid form into a draft", () => {
    const res = validatePlanInput(input(), ctx);
    assert.ok(res.ok);
    assert.deepEqual(res.draft, {
      name: "All access",
      slug: "all-access",
      description: "",
      interval: "month",
      price: 1950,
      currency: "USD",
      trialDays: 7,
      access: { type: "all" },
      features: ["Every course", "Certificates"],
      active: true,
      gatewayPriceIds: {},
    });
  });

  it("keeps a unique, known course list for selected-course plans", () => {
    const res = validatePlanInput(input({ accessType: "courses", courseIds: ["c1", "c1", " c2 "] }), ctx);
    assert.ok(res.ok);
    assert.deepEqual(res.draft.access, { type: "courses", courseIds: ["c1", "c2"] });
    const none = validatePlanInput(input({ accessType: "courses", courseIds: [] }), ctx);
    assert.ok(!none.ok);
    assert.match(none.errors.courseIds!, /at least one course/);
    const unknown = validatePlanInput(input({ accessType: "courses", courseIds: ["c1", "gone"] }), ctx);
    assert.ok(!unknown.ok && unknown.errors.courseIds);
  });

  it("rejects bad prices, currencies, slugs, intervals and trials", () => {
    const res = validatePlanInput(input({ name: "x", slug: "Bad slug!", interval: "weekly", price: "19.999", currency: "BTC", trialDays: "400" }), ctx);
    assert.ok(!res.ok);
    assert.deepEqual(Object.keys(res.errors).sort(), ["currency", "interval", "name", "price", "slug", "trialDays"]);
    const zero = validatePlanInput(input({ price: "0" }), ctx);
    assert.ok(!zero.ok && /above zero/.test(zero.errors.price!));
    const negative = validatePlanInput(input({ price: "-5" }), ctx);
    assert.ok(!negative.ok && negative.errors.price);
  });

  it("refuses trials and recurring gateway prices on lifetime plans", () => {
    const trial = validatePlanInput(input({ interval: "one_time", trialDays: "7" }), ctx);
    assert.ok(!trial.ok && /can't have a trial/.test(trial.errors.trialDays!));
    const priced = validatePlanInput(input({ interval: "one_time", trialDays: "0", stripePriceId: "price_1Abcdef" }), ctx);
    assert.ok(!priced.ok && priced.errors.stripePriceId);
    const ok = validatePlanInput(input({ stripePriceId: "price_1AbcdefGH", razorpayPlanId: "plan_AbCdEf123" }), ctx);
    assert.ok(ok.ok);
    assert.deepEqual(ok.draft.gatewayPriceIds, { stripe: "price_1AbcdefGH", razorpay: "plan_AbCdEf123" });
    const malformed = validatePlanInput(input({ stripePriceId: "prod_123456", razorpayPlanId: "sub_123456" }), ctx);
    assert.ok(!malformed.ok && malformed.errors.stripePriceId && malformed.errors.razorpayPlanId);
  });

  it("limits the feature list", () => {
    const many = validatePlanInput(input({ features: Array.from({ length: 16 }, (_, i) => `Feature ${i}`).join("\n") }), ctx);
    assert.ok(!many.ok && many.errors.features);
    const long = validatePlanInput(input({ features: "x".repeat(141) }), ctx);
    assert.ok(!long.ok && long.errors.features);
  });
});

describe("subscription lifecycle", () => {
  it("grants access while trialing or active, through the grace period when past due, and until the end when cancelled", () => {
    assert.equal(subscriptionGrantsAccess(sub(), NOW), true);
    assert.equal(subscriptionGrantsAccess(sub({ status: "trialing", currentPeriodEnd: iso(NOW + DAY) }), NOW), true);
    assert.equal(subscriptionGrantsAccess(sub({ currentPeriodEnd: iso(NOW - 1) }), NOW), false);
    // Past due: the grace period runs from the unpaid period end.
    const due = sub({ status: "past_due", currentPeriodEnd: iso(NOW - 3 * DAY) });
    assert.equal(subscriptionGrantsAccess(due, NOW), true);
    assert.equal(subscriptionGrantsAccess(due, NOW + (GRACE_DAYS - 3) * DAY), false);
    // Cancelled: until the period end, no grace.
    assert.equal(subscriptionGrantsAccess(sub({ status: "cancelled", currentPeriodEnd: iso(NOW + DAY) }), NOW), true);
    assert.equal(subscriptionGrantsAccess(sub({ status: "cancelled", currentPeriodEnd: iso(NOW) }), NOW), false);
    assert.equal(subscriptionGrantsAccess(sub({ status: "expired", currentPeriodEnd: iso(NOW + 30 * DAY) }), NOW), false);
  });

  it("gives gateway subscriptions leeway for a late renewal webhook, and only them", () => {
    const ended = { currentPeriodEnd: iso(NOW - HOUR) };
    const stripe = sub({ ...ended, gateway: "stripe", gatewaySubscriptionId: "sub_abc12345" });
    assert.equal(isGatewayManaged(stripe), true);
    assert.equal(subscriptionGrantsAccess(stripe, NOW), true);
    assert.equal(subscriptionGrantsAccess(stripe, NOW + GATEWAY_LEEWAY_HOURS * HOUR), false);
    // A one-time Stripe payment (lifetime plan, renewal order) has no gateway subscription.
    const oneTime = sub({ ...ended, gateway: "stripe" });
    assert.equal(isGatewayManaged(oneTime), false);
    assert.equal(subscriptionGrantsAccess(oneTime, NOW), false);
  });

  it("advances memberships managed here and leaves gateway ones alone", () => {
    assert.equal(advanceSubscription(sub(), NOW), null);
    const over = sub({ currentPeriodEnd: iso(NOW - DAY) });
    assert.equal(advanceSubscription(over, NOW), "past_due");
    assert.equal(advanceSubscription({ ...over, cancelAtPeriodEnd: true }, NOW), "cancelled");
    assert.equal(advanceSubscription(sub({ currentPeriodEnd: iso(NOW - (GRACE_DAYS + 1) * DAY) }), NOW), "expired");
    // A trial that was never paid ends with it; one whose order awaits confirmation gets the grace period.
    assert.equal(advanceSubscription(sub({ status: "trialing", currentPeriodEnd: iso(NOW - HOUR) }), NOW), "expired");
    assert.equal(advanceSubscription(sub({ status: "trialing", currentPeriodEnd: iso(NOW - HOUR) }), NOW, { awaitingPayment: true }), "past_due");
    assert.equal(advanceSubscription(sub({ status: "trialing", currentPeriodEnd: iso(NOW + HOUR) }), NOW), null);
    assert.equal(advanceSubscription(sub({ status: "past_due", currentPeriodEnd: iso(NOW - DAY) }), NOW), null);
    assert.equal(advanceSubscription(sub({ status: "past_due", currentPeriodEnd: iso(NOW - GRACE_DAYS * DAY) }), NOW), "expired");
    assert.equal(advanceSubscription(sub({ status: "cancelled", currentPeriodEnd: iso(NOW - 99 * DAY) }), NOW), null);
    assert.equal(advanceSubscription(sub({ currentPeriodEnd: iso(NOW - 99 * DAY), gateway: "razorpay", gatewaySubscriptionId: "sub_Rzp12345678" }), NOW), null);
  });

  it("opens renewal orders inside the notice window only", () => {
    const monthly = plan();
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + 6 * DAY) }), monthly, NOW), false);
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + 4 * DAY) }), monthly, NOW), true);
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + 13 * DAY) }), plan({ interval: "year" }), NOW), true);
    assert.equal(renewalDue(sub({ status: "past_due", currentPeriodEnd: iso(NOW - DAY) }), monthly, NOW), true);
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + DAY), cancelAtPeriodEnd: true }), monthly, NOW), false);
    assert.equal(renewalDue(sub({ status: "trialing", currentPeriodEnd: iso(NOW + DAY) }), monthly, NOW), false);
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + DAY) }), plan({ interval: "one_time" }), NOW), false);
    assert.equal(renewalDue(sub({ currentPeriodEnd: iso(NOW + DAY), gateway: "stripe", gatewaySubscriptionId: "sub_abc12345" }), monthly, NOW), false);
  });

  it("extends from the current period end, or from now when the membership lapsed", () => {
    const running = sub({ currentPeriodEnd: "2026-03-31T00:00:00.000Z" });
    assert.deepEqual(extendedPeriod(running, "month", NOW), { start: "2026-03-31T00:00:00.000Z", end: "2026-04-30T00:00:00.000Z" });
    const trial = sub({ status: "trialing", currentPeriodEnd: "2026-03-14T00:00:00.000Z" });
    assert.equal(extendedPeriod(trial, "year", NOW).end, "2027-03-14T00:00:00.000Z");
    const lapsed = sub({ status: "past_due", currentPeriodEnd: iso(NOW - 2 * DAY) });
    assert.deepEqual(extendedPeriod(lapsed, "month", NOW), { start: iso(NOW), end: "2026-04-10T12:00:00.000Z" });
    const expired = sub({ status: "expired", currentPeriodEnd: iso(NOW + 5 * DAY) });
    assert.equal(extendedPeriod(expired, "month", NOW).start, iso(NOW));
    assert.equal(extendedPeriod(null, "month", NOW).start, iso(NOW));
  });

  it("reports the next charge only for memberships that renew", () => {
    assert.equal(nextChargeDate(sub(), plan()), sub().currentPeriodEnd);
    assert.equal(nextChargeDate(sub({ cancelAtPeriodEnd: true }), plan()), null);
    assert.equal(nextChargeDate(sub(), plan({ interval: "one_time" })), null);
    assert.equal(nextChargeDate(sub({ status: "cancelled" }), plan()), null);
    assert.equal(nextChargeDate(sub(), null), null);
  });

  it("offers the free trial once per member", () => {
    assert.equal(trialEligible([]), true);
    assert.equal(trialEligible([{ id: "sub_old" }]), false);
  });

  it("counts monthly recurring revenue per currency for paying members", () => {
    const plans = [plan(), plan({ id: "plan_y", interval: "year", price: 12000 }), plan({ id: "plan_life", interval: "one_time", price: 50000 }), plan({ id: "plan_eur", currency: "eur", price: 1000 })];
    const mrr = monthlyRecurringRevenue(
      [
        sub(),
        sub({ id: "s2", status: "past_due" }),
        sub({ id: "s3", planId: "plan_y" }),
        sub({ id: "s4", planId: "plan_life" }),
        sub({ id: "s5", status: "trialing" }),
        sub({ id: "s6", status: "cancelled" }),
        sub({ id: "s7", planId: "plan_eur" }),
        sub({ id: "s8", planId: "plan_gone" }),
      ],
      plans,
    );
    assert.deepEqual(mrr, { USD: 1900 + 1900 + 1000, EUR: 1000 });
  });
});

describe("gateway status mapping", () => {
  it("maps Stripe statuses", () => {
    assert.equal(mapStripeStatus("trialing"), "trialing");
    assert.equal(mapStripeStatus("active"), "active");
    assert.equal(mapStripeStatus("past_due"), "past_due");
    assert.equal(mapStripeStatus("canceled"), "cancelled");
    assert.equal(mapStripeStatus("unpaid"), "expired");
    assert.equal(mapStripeStatus("incomplete_expired"), "expired");
    assert.equal(mapStripeStatus("paused"), "expired");
    assert.equal(mapStripeStatus("incomplete"), null);
    assert.equal(mapStripeStatus("something_new"), null);
  });

  it("maps Razorpay statuses", () => {
    assert.equal(mapRazorpayStatus("created", { chargeInFuture: false }), null);
    assert.equal(mapRazorpayStatus("authenticated", { chargeInFuture: true }), "trialing");
    assert.equal(mapRazorpayStatus("authenticated", { chargeInFuture: false }), "active");
    assert.equal(mapRazorpayStatus("pending", { chargeInFuture: false }), "past_due");
    assert.equal(mapRazorpayStatus("halted", { chargeInFuture: false }), "past_due");
    assert.equal(mapRazorpayStatus("cancelled", { chargeInFuture: false }), "cancelled");
    assert.equal(mapRazorpayStatus("completed", { chargeInFuture: false }), "expired");
  });

  it("normalizes a Stripe subscription into a snapshot", () => {
    const secs = (ms: number) => Math.floor(ms / 1000);
    const base = { currentPeriodStart: secs(NOW), currentPeriodEnd: secs(NOW + 30 * DAY), trialEnd: undefined, cancelAtPeriodEnd: false, endedAt: undefined, canceledAt: undefined };
    assert.equal(stripeSnapshot({ ...base, status: "incomplete" }, NOW), null);
    assert.deepEqual(stripeSnapshot({ ...base, status: "active", cancelAtPeriodEnd: true }, NOW), {
      status: "active",
      currentPeriodStart: iso(NOW),
      currentPeriodEnd: iso(NOW + 30 * DAY),
      cancelAtPeriodEnd: true,
    });
    const trial = stripeSnapshot({ ...base, status: "trialing", trialEnd: secs(NOW + 7 * DAY) }, NOW);
    assert.equal(trial?.status, "trialing");
    assert.equal(trial?.currentPeriodEnd, iso(NOW + 7 * DAY));
    // A canceled subscription keeps its old period end on Stripe: access must stop when it ended.
    const ended = stripeSnapshot({ ...base, status: "canceled", cancelAtPeriodEnd: true, endedAt: secs(NOW - DAY) }, NOW);
    assert.deepEqual(ended, { status: "cancelled", currentPeriodStart: iso(NOW), currentPeriodEnd: iso(NOW - DAY), cancelAtPeriodEnd: false });
    assert.equal(stripeSnapshot({ ...base, status: "canceled" }, NOW)?.currentPeriodEnd, iso(NOW));
  });

  it("tells a Razorpay trial from a first charge that is still processing", () => {
    const secs = (ms: number) => Math.floor(ms / 1000);
    const base = { currentStart: undefined, currentEnd: undefined, chargeAt: secs(NOW + 7 * DAY), startAt: secs(NOW + 7 * DAY), endedAt: undefined };
    assert.equal(razorpaySnapshot({ ...base, status: "created", notes: {} }, NOW), null);
    assert.deepEqual(razorpaySnapshot({ ...base, status: "authenticated", notes: { trialDays: "7" } }, NOW), { status: "trialing", currentPeriodEnd: iso(NOW + 7 * DAY) });
    // No trial was requested: an authenticated mandate is an active membership whose charge is on its way.
    assert.equal(razorpaySnapshot({ ...base, status: "authenticated", notes: { trialDays: "0" } }, NOW)?.status, "active");
    const active = razorpaySnapshot({ ...base, status: "active", currentStart: secs(NOW), currentEnd: secs(NOW + 30 * DAY), notes: { trialDays: "7" } }, NOW);
    assert.deepEqual(active, { status: "active", currentPeriodStart: iso(NOW), currentPeriodEnd: iso(NOW + 30 * DAY) });
    const cancelled = razorpaySnapshot({ ...base, status: "cancelled", currentStart: secs(NOW - 10 * DAY), currentEnd: secs(NOW + 20 * DAY), notes: {} }, NOW);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.currentPeriodEnd, iso(NOW)); // cancelled immediately: access stops now, not at the cycle end
    assert.equal(razorpaySnapshot({ ...base, status: "halted", currentStart: secs(NOW - 31 * DAY), currentEnd: secs(NOW - DAY), notes: {} }, NOW)?.status, "past_due");
  });
});

describe("applySnapshot", () => {
  it("applies a renewal and reports the previous status", () => {
    const row = sub({ status: "past_due", gateway: "stripe", gatewaySubscriptionId: "sub_abc12345" });
    const nextEnd = iso(NOW + 50 * DAY);
    const res = applySnapshot(row, { status: "active", currentPeriodStart: row.currentPeriodEnd, currentPeriodEnd: nextEnd, cancelAtPeriodEnd: false }, iso(NOW));
    assert.deepEqual(res, { previousStatus: "past_due" });
    assert.equal(row.status, "active");
    assert.equal(row.currentPeriodEnd, nextEnd);
    assert.equal(row.updatedAt, iso(NOW));
  });

  it("returns undefined when nothing changed (redelivered event)", () => {
    const row = sub();
    const before = { ...row };
    assert.equal(applySnapshot(row, { status: "active", currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd, cancelAtPeriodEnd: false }, iso(NOW)), undefined);
    assert.deepEqual(row, before);
  });

  it("never moves a running period backwards (stale event), but takes the end moment of an ended subscription", () => {
    const row = sub({ currentPeriodEnd: iso(NOW + 20 * DAY) });
    applySnapshot(row, { status: "active", currentPeriodStart: iso(NOW - 40 * DAY), currentPeriodEnd: iso(NOW - 10 * DAY) }, iso(NOW));
    assert.equal(row.currentPeriodEnd, iso(NOW + 20 * DAY));
    const res = applySnapshot(row, { status: "cancelled", currentPeriodEnd: iso(NOW - HOUR), cancelAtPeriodEnd: true }, iso(NOW));
    assert.deepEqual(res, { previousStatus: "active" });
    assert.equal(row.currentPeriodEnd, iso(NOW - HOUR));
    assert.equal(row.cancelAtPeriodEnd, false);
  });

  it("records a scheduled cancellation and its undo", () => {
    const row = sub();
    assert.ok(applySnapshot(row, { status: "active", cancelAtPeriodEnd: true }, iso(NOW)));
    assert.equal(row.cancelAtPeriodEnd, true);
    assert.ok(applySnapshot(row, { status: "active", cancelAtPeriodEnd: false }, iso(NOW)));
    assert.equal(row.cancelAtPeriodEnd, false);
    // A snapshot that does not report the flag (Razorpay) leaves it as it is.
    row.cancelAtPeriodEnd = true;
    assert.equal(applySnapshot(row, { status: "active" }, iso(NOW)), undefined);
    assert.equal(row.cancelAtPeriodEnd, true);
  });
});

describe("messageForTransition", () => {
  it("announces starts, payment problems and endings once", () => {
    assert.equal(messageForTransition(null, "trialing"), "trial_started");
    assert.equal(messageForTransition(null, "active"), "started");
    assert.equal(messageForTransition("expired", "active"), "started");
    assert.equal(messageForTransition("cancelled", "trialing"), "trial_started");
    assert.equal(messageForTransition("active", "past_due"), "payment_due");
    assert.equal(messageForTransition("trialing", "past_due"), "payment_due");
    assert.equal(messageForTransition("active", "cancelled"), "ended");
    assert.equal(messageForTransition("past_due", "expired"), "expired");
  });

  it("stays quiet for renewals, recovered payments and a trial turning into a paid membership", () => {
    assert.equal(messageForTransition("active", "active"), null);
    assert.equal(messageForTransition("past_due", "active"), null);
    assert.equal(messageForTransition("trialing", "active"), null);
    assert.equal(messageForTransition(null, "past_due"), null);
    assert.equal(messageForTransition(null, "cancelled"), null);
  });
});
