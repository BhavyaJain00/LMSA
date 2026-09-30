import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { MembershipPlan, Payment, Subscription } from "@/lib/types";
import { razorpayEnv } from "@/lib/server-env";
import { getDb, mutate } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { applyRefund, fulfillPayment } from "@/lib/payments/fulfillment";
import { parseRazorpayEvent } from "@/lib/payments/razorpay";
import { handleRazorpayEvent } from "@/lib/payments/webhooks";
import { startManualTrial } from "@/lib/commerce/membership-store";
import {
  cancelAtPeriodEnd,
  cancelMembershipNow,
  changeMembershipPlan,
  extendMembership,
  grantMembershipByAdmin,
  openRenewalOrder,
  resumeMembership,
  runMembershipMaintenance,
} from "@/lib/commerce/membership-service";
import { getAdminMembers, getMemberMembership, getPricingData, membersToCsv, parseMemberFilter } from "@/lib/commerce/membership-views";
import { GRACE_DAYS, isGatewayManaged } from "@/lib/commerce/subscriptions";
import { deletePlanAction, extendMembershipsAction, savePlanAction, setMembershipsEnabledAction, setPlanActiveAction } from "@/lib/actions/plans";
import { makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Memberships managed by this app (manual payment, free, lifetime): starting,
 * renewing with renewal orders, the periodic maintenance, member and admin
 * operations, the read models — plus the Razorpay subscription webhooks and
 * the permission checks of the plan actions.
 */

const DAY = 86_400_000;
const at = (offsetDays: number, from = Date.now()) => new Date(from + offsetDays * DAY).toISOString();

const member = makeUser({ id: "usr_member", name: "Mia Member" });
const second = makeUser({ id: "usr_second", name: "Sam Second" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_paid", title: "Paid course", paidCourse: true, price: 5000 });

const plan = (overrides: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: "plan_month",
  slug: "monthly",
  name: "Monthly",
  description: "",
  interval: "month",
  price: 1900,
  currency: "USD",
  trialDays: 0,
  access: { type: "all" },
  active: true,
  features: ["Every course"],
  createdAt: at(-60),
  updatedAt: at(-60),
  ...overrides,
});
const monthly = plan();
const yearly = plan({ id: "plan_year", slug: "yearly", name: "Yearly", interval: "year", price: 15900 });
const lifetime = plan({ id: "plan_life", slug: "lifetime", name: "Lifetime", interval: "one_time", price: 49900 });

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

async function setup(fixture: { subscriptions?: Subscription[]; payments?: Payment[]; gateway?: "manual" | "none" | "stripe" | "razorpay" } = {}) {
  await resetDb({
    users: [member, second, admin],
    courses: [course],
    plans: [monthly, yearly, lifetime],
    subscriptions: fixture.subscriptions ?? [],
    payments: fixture.payments ?? [],
    settings: { email: { enabled: false }, gamification: { enabled: false }, commerce: { paymentGateway: fixture.gateway ?? "manual" } },
  });
  resetRequest();
}

/** A copy of a membership row (the store hands out live rows, which later writes mutate in place). */
const theSub = async (id = "sub_1"): Promise<Subscription> => ({ ...(await getDb()).subscriptions.find((s) => s.id === id)! });

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

describe("starting a membership with a confirmed order", () => {
  it("starts one billing period and links the order", async () => {
    await setup({ payments: [planOrder()] });
    const res = await fulfillPayment("pay_1", undefined, { source: "admin" });
    assert.ok(res.ok);
    await settleEvents();
    const db = await getDb();
    const row = db.subscriptions[0]!;
    assert.deepEqual({ userId: row.userId, planId: row.planId, status: row.status, gateway: row.gateway, cancel: row.cancelAtPeriodEnd }, { userId: member.id, planId: monthly.id, status: "active", gateway: "manual", cancel: false });
    const days = (Date.parse(row.currentPeriodEnd) - Date.parse(row.currentPeriodStart)) / DAY;
    assert.ok(days >= 28 && days <= 31, `one month, got ${days} days`);
    assert.equal(db.payments[0]!.subscriptionId, row.id);
    assert.ok(db.notifications.some((n) => n.userId === member.id && n.subject === "Welcome to Monthly"));
    // Confirming the same order again does not extend the membership.
    await fulfillPayment("pay_1", undefined, { source: "admin" });
    assert.equal((await getDb()).subscriptions[0]!.currentPeriodEnd, row.currentPeriodEnd);
  });

  it("treats a lifetime plan paid through a gateway as a one-time payment managed here", async () => {
    await setup({ payments: [planOrder({ itemId: lifetime.id, planId: lifetime.id, itemTitle: lifetime.name, amount: 49900, originalAmount: 49900, gateway: "stripe" })] });
    await fulfillPayment("pay_1", "pi_lifetime00001", { source: "stripe_webhook" });
    const row = (await getDb()).subscriptions[0]!;
    assert.equal(isGatewayManaged(row), false);
    assert.ok(Date.parse(row.currentPeriodEnd) > Date.now() + 90 * 365 * DAY);
    const page = await getMemberMembership(member.id);
    assert.equal(page.current?.lifetime, true);
    assert.equal(page.current?.canCancel, false);
    assert.equal(page.current?.nextChargeAt, null);
  });

  it("runs a manual free trial right away and extends it from the trial's end when the payment is confirmed", async () => {
    await setup({ payments: [planOrder()] });
    const trial = await startManualTrial("pay_1", 7);
    assert.equal(trial?.status, "trialing");
    assert.equal(await startManualTrial("pay_1", 7), null, "one trial per order");
    const trialEnd = (await theSub(trial!.id)).currentPeriodEnd;
    await fulfillPayment("pay_1", undefined, { source: "admin" });
    const row = await theSub(trial!.id);
    assert.equal(row.status, "active");
    assert.equal(row.currentPeriodStart, trialEnd);
    assert.ok(Date.parse(row.currentPeriodEnd) > Date.parse(trialEnd) + 27 * DAY);
    assert.equal((await getDb()).subscriptions.length, 1);
  });

  it("ends a membership managed here when its only payment is refunded, but not when a newer payment exists", async () => {
    await setup({ payments: [planOrder()] });
    await fulfillPayment("pay_1", undefined, { source: "admin" });
    const refunded = await applyRefund("pay_1", { amount: 1900 });
    assert.ok(refunded.ok);
    const row = (await getDb()).subscriptions[0]!;
    assert.equal(row.status, "cancelled");
    assert.ok(Date.parse(row.currentPeriodEnd) <= Date.now());

    await setup({ payments: [planOrder()] });
    await fulfillPayment("pay_1", undefined, { source: "admin" });
    const renewal = await openRenewalOrder(await theSub((await getDb()).subscriptions[0]!.id), { notifyMember: false });
    await mutate((d) => {
      d.payments.find((p) => p.id === "pay_1")!.paidAt = at(-1);
    });
    await fulfillPayment(renewal!.id, undefined, { source: "admin" });
    await applyRefund("pay_1", { amount: 1900 });
    assert.equal((await getDb()).subscriptions[0]!.status, "active");
  });
});

describe("renewal orders", () => {
  beforeEach(() => setup({ subscriptions: [sub({ currentPeriodEnd: at(3) })], payments: [planOrder({ status: "paid", paidAt: at(-27), subscriptionId: "sub_1", billingName: "Mia M. Member", address: { line1: "1 Main St", city: "Pune", country: "India" } })] }));

  it("opens one renewal order with the member's billing details and tells them", async () => {
    const order = await openRenewalOrder(await theSub());
    assert.ok(order);
    assert.deepEqual(
      { type: order.itemType, title: order.itemTitle, amount: order.amount, status: order.status, sub: order.subscriptionId, source: order.source, name: order.billingName, city: order.address?.city, gateway: order.gateway },
      { type: "plan", title: "Monthly · renewal", amount: 1900, status: "pending", sub: "sub_1", source: "Renewal", name: "Mia M. Member", city: "Pune", gateway: "manual" },
    );
    const again = await openRenewalOrder(await theSub());
    assert.equal(again?.id, order.id);
    const db = await getDb();
    assert.equal(db.payments.length, 2);
    assert.equal(db.notifications.filter((n) => n.userId === member.id && /renews on/.test(n.subject)).length, 1);
  });

  it("extends the membership from its period end when the renewal is paid", async () => {
    const before = await theSub();
    const order = await openRenewalOrder(before, { notifyMember: false });
    await fulfillPayment(order!.id, undefined, { source: "admin" });
    const row = await theSub();
    assert.equal(row.currentPeriodStart, before.currentPeriodEnd);
    assert.ok(Date.parse(row.currentPeriodEnd) - Date.parse(before.currentPeriodEnd) >= 28 * DAY);
    assert.equal((await getDb()).subscriptions.length, 1);
  });

  it("renews for free at once when no payment gateway is active", async () => {
    await mutate((d) => {
      d.settings.commerce.paymentGateway = "none";
    });
    const before = await theSub();
    const order = await openRenewalOrder(before);
    assert.ok(order);
    const db = await getDb();
    assert.equal(db.payments.find((p) => p.id === order.id)?.status, "paid");
    assert.ok(Date.parse((await theSub()).currentPeriodEnd) > Date.parse(before.currentPeriodEnd));
  });

  it("never opens renewal orders for gateway or lifetime memberships", async () => {
    assert.equal(await openRenewalOrder(sub({ gateway: "stripe", gatewaySubscriptionId: "sub_stripe123456" })), null);
    await mutate((d) => {
      d.subscriptions[0]!.planId = lifetime.id;
    });
    assert.equal(await openRenewalOrder(await theSub()), null);
  });
});

describe("runMembershipMaintenance", () => {
  it("opens renewals, reminds about trials, and moves lapsed memberships on", async () => {
    await setup({
      subscriptions: [
        sub({ id: "sub_due", currentPeriodEnd: at(3) }),
        sub({ id: "sub_over", userId: second.id, currentPeriodEnd: at(-1) }),
        sub({ id: "sub_trial", userId: admin.id, status: "trialing", currentPeriodEnd: at(2) }),
        sub({ id: "sub_far", userId: "usr_gone", currentPeriodEnd: at(25) }),
      ],
    });
    const first = await runMembershipMaintenance({ force: true });
    await settleEvents();
    assert.deepEqual({ advanced: first.advanced, trialReminders: first.trialReminders, skipped: first.skipped }, { advanced: 1, trialReminders: 1, skipped: false });
    assert.equal(first.renewalOrders, 2, "the membership about to end and the one that just lapsed both get a renewal order");
    let db = await getDb();
    assert.equal(db.subscriptions.find((s) => s.id === "sub_over")?.status, "past_due");
    assert.equal(db.payments.filter((p) => p.source === "Renewal" && p.status === "pending").length, 2);
    assert.ok(db.notifications.some((n) => n.userId === second.id && /^Action needed/.test(n.subject)));
    assert.equal(db.notifications.filter((n) => n.userId === admin.id && /free trial of Monthly ends/.test(n.subject)).length, 1);

    // A second run changes nothing and repeats no message.
    const again = await runMembershipMaintenance({ force: true });
    await settleEvents();
    assert.deepEqual({ advanced: again.advanced, renewalOrders: again.renewalOrders }, { advanced: 0, renewalOrders: 0 });
    db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === admin.id && /free trial of Monthly ends/.test(n.subject)).length, 1);
    assert.equal(db.payments.length, 2);

    // Past the grace period the membership expires and its unpaid renewal is closed.
    const later = await runMembershipMaintenance({ force: true, now: new Date(Date.now() + (GRACE_DAYS + 1) * DAY) });
    await settleEvents();
    assert.ok(later.advanced >= 1);
    db = await getDb();
    assert.equal(db.subscriptions.find((s) => s.id === "sub_over")?.status, "expired");
    assert.equal(db.payments.find((p) => p.subscriptionId === "sub_over")?.status, "failed");
    assert.ok(db.notifications.some((n) => n.userId === second.id && /has expired/.test(n.subject)));
  });

  it("ends a cancelled-at-period-end membership without a grace period", async () => {
    await setup({ subscriptions: [sub({ currentPeriodEnd: at(-0.5), cancelAtPeriodEnd: true })] });
    await runMembershipMaintenance({ force: true });
    const row = await theSub();
    assert.deepEqual({ status: row.status, cancel: row.cancelAtPeriodEnd }, { status: "cancelled", cancel: false });
  });

  it("throttles lazy runs but always runs for one member's page", async () => {
    await setup({ subscriptions: [sub({ currentPeriodEnd: at(-1) })] });
    await runMembershipMaintenance({ force: true });
    await mutate((d) => {
      d.subscriptions[0]!.status = "active";
    });
    await runMembershipMaintenance();
    const lazy = await runMembershipMaintenance();
    assert.equal(lazy.skipped, true);
    const own = await runMembershipMaintenance({ userId: member.id });
    assert.equal(own.skipped, false);
    assert.equal((await theSub()).status, "past_due");
  });
});

describe("member self-service (memberships managed here)", () => {
  beforeEach(() => setup({ subscriptions: [sub()], payments: [planOrder({ status: "paid", paidAt: at(-10), subscriptionId: "sub_1" })] }));

  it("cancels at the period end, closes the open renewal and can be resumed", async () => {
    const renewal = await openRenewalOrder(await theSub(), { notifyMember: false });
    const cancelled = await cancelAtPeriodEnd(await theSub());
    assert.ok(cancelled.ok);
    let row = await theSub();
    assert.deepEqual({ status: row.status, cancel: row.cancelAtPeriodEnd }, { status: "active", cancel: true });
    assert.equal((await getDb()).payments.find((p) => p.id === renewal!.id)?.status, "failed");
    const twice = await cancelAtPeriodEnd(row);
    assert.ok(!twice.ok);

    const page = await getMemberMembership(member.id);
    assert.deepEqual({ canCancel: page.current?.canCancel, canResume: page.current?.canResume, next: page.current?.nextChargeAt, label: page.current?.statusLabel }, { canCancel: false, canResume: true, next: null, label: "Ends soon" });

    const resumed = await resumeMembership(row);
    assert.ok(resumed.ok);
    row = await theSub();
    assert.equal(row.cancelAtPeriodEnd, false);
    assert.ok(!(await resumeMembership(row)).ok);
  });

  it("refuses to cancel lifetime and ended memberships", async () => {
    await mutate((d) => {
      d.subscriptions[0]!.planId = lifetime.id;
    });
    const life = await cancelAtPeriodEnd(await theSub());
    assert.ok(!life.ok && /never renew/.test(life.error));
    const ended = await cancelAtPeriodEnd(sub({ status: "expired" }));
    assert.ok(!ended.ok);
  });

  it("switches between recurring plans and keeps the period", async () => {
    const before = await theSub();
    const res = await changeMembershipPlan(before, yearly);
    assert.ok(res.ok);
    const row = await theSub();
    assert.equal(row.planId, yearly.id);
    assert.equal(row.currentPeriodEnd, before.currentPeriodEnd);
    assert.ok(!(await changeMembershipPlan(row, yearly)).ok, "already on this plan");
    assert.ok(!(await changeMembershipPlan(row, lifetime)).ok, "lifetime plans are bought, not switched to");
    assert.ok(!(await changeMembershipPlan(row, { ...monthly, active: false })).ok, "retired plans cannot be joined");
    assert.ok(!(await changeMembershipPlan(sub({ status: "cancelled" }), yearly)).ok);
  });

  it("describes the membership for the member's page", async () => {
    const page = await getMemberMembership(member.id);
    assert.ok(page.current);
    assert.deepEqual(
      { plan: page.current.plan?.id, label: page.current.statusLabel, managed: page.current.gatewayManaged, canCancel: page.current.canCancel, canRenew: page.current.canRenew, courses: page.current.courses, targets: page.current.changeTargets.map((t) => t.id) },
      { plan: monthly.id, label: "Active", managed: false, canCancel: true, canRenew: true, courses: "all", targets: [yearly.id] },
    );
    assert.equal(page.current.nextChargeAt, (await theSub()).currentPeriodEnd);
    assert.equal(page.invoices.length, 1);
    assert.equal(page.invoices[0]!.orderHref, "/billing/success/ORD-PAY_1");
    assert.deepEqual((await getMemberMembership(second.id)).current, null);
  });
});

describe("administrator operations", () => {
  beforeEach(() => setup({ subscriptions: [sub()] }));

  it("extends a running membership from its end and reactivates an ended one from today", async () => {
    const before = await theSub();
    const res = await extendMembership(before, 10, admin);
    assert.ok(res.ok);
    assert.equal(Date.parse((await theSub()).currentPeriodEnd) - Date.parse(before.currentPeriodEnd), 10 * DAY);

    await mutate((d) => {
      Object.assign(d.subscriptions[0]!, { status: "expired", currentPeriodEnd: at(-40) });
    });
    await extendMembership(await theSub(), 5, admin);
    const row = await theSub();
    assert.equal(row.status, "active");
    const left = (Date.parse(row.currentPeriodEnd) - Date.now()) / DAY;
    assert.ok(left > 4.9 && left <= 5, `about five days from now, got ${left}`);

    assert.ok(!(await extendMembership(row, 0, admin)).ok);
    assert.ok(!(await extendMembership(row, 1.5, admin)).ok);
    const gateway = await extendMembership(sub({ gateway: "stripe", gatewaySubscriptionId: "sub_stripe123456" }), 5, admin);
    assert.ok(!gateway.ok && /billed by Stripe/.test(gateway.error));
    const db = await getDb();
    assert.equal(db.auditEvents.filter((e) => e.action === "membership.extend").length, 2);
  });

  it("cancels immediately and records who did it", async () => {
    const res = await cancelMembershipNow(await theSub(), admin);
    assert.ok(res.ok);
    const row = await theSub();
    assert.equal(row.status, "cancelled");
    assert.ok(Date.parse(row.currentPeriodEnd) <= Date.now());
    assert.ok(!(await cancelMembershipNow(row, admin)).ok);
    assert.ok((await getDb()).auditEvents.some((e) => e.action === "membership.cancel" && e.actorId === admin.id));
  });

  it("grants a complimentary membership with a zero-amount order, once", async () => {
    const res = await grantMembershipByAdmin({ userId: second.id, planId: yearly.id, days: 14 }, admin);
    assert.ok(res.ok);
    const db = await getDb();
    const row = db.subscriptions.find((s) => s.userId === second.id)!;
    assert.equal(row.status, "active");
    assert.equal(Date.parse(row.currentPeriodEnd) - Date.parse(row.currentPeriodStart), 14 * DAY);
    const order = db.payments.find((p) => p.subscriptionId === row.id)!;
    assert.deepEqual({ amount: order.amount, status: order.status, gateway: order.gateway, invoice: order.invoiceNumber }, { amount: 0, status: "paid", gateway: "free", invoice: undefined });
    const again = await grantMembershipByAdmin({ userId: second.id, planId: monthly.id }, admin);
    assert.ok(!again.ok && /already has a running membership/.test(again.error));
    assert.ok(!(await grantMembershipByAdmin({ userId: "usr_nobody", planId: monthly.id }, admin)).ok);
    assert.ok(!(await grantMembershipByAdmin({ userId: admin.id, planId: "plan_nope" }, admin)).ok);
  });

  it("lists, filters, pages and exports members", async () => {
    await mutate((d) => {
      d.subscriptions.push(sub({ id: "sub_2", userId: second.id, planId: yearly.id, status: "expired", createdAt: at(-400) }), sub({ id: "sub_3", userId: admin.id, cancelAtPeriodEnd: true, gateway: "stripe", gatewaySubscriptionId: "sub_stripe123456", createdAt: at(-1) }));
      d.payments.push(planOrder({ status: "paid", paidAt: at(-10), subscriptionId: "sub_1" }), planOrder({ id: "pay_2", status: "paid", paidAt: at(-5), subscriptionId: "sub_1", refundedAmount: 400 }));
    });
    const ongoing = await getAdminMembers(parseMemberFilter({}));
    assert.deepEqual(ongoing.rows.map((r) => r.id), ["sub_3", "sub_1"]);
    assert.equal(ongoing.rows[0]!.statusLabel, "Ends at period end");
    assert.match(ongoing.rows[0]!.dashboardUrl!, /^https:\/\/dashboard\.stripe\.com\//);
    const mine = ongoing.rows[1]!;
    assert.deepEqual({ paidOrders: mine.paidOrders, value: mine.lifetimeValue, managed: mine.gatewayManaged, dashboard: mine.dashboardUrl }, { paidOrders: 2, value: 3400, managed: false, dashboard: null });

    assert.deepEqual((await getAdminMembers(parseMemberFilter({ status: "all" }))).total, 3);
    assert.deepEqual((await getAdminMembers(parseMemberFilter({ status: "ending" }))).rows.map((r) => r.id), ["sub_3"]);
    assert.deepEqual((await getAdminMembers(parseMemberFilter({ status: "expired", plan: yearly.id }))).rows.map((r) => r.id), ["sub_2"]);
    assert.deepEqual((await getAdminMembers(parseMemberFilter({ status: "all", gateway: "stripe" }))).rows.map((r) => r.id), ["sub_3"]);
    assert.deepEqual((await getAdminMembers(parseMemberFilter({ status: "all", q: "sam second" }))).rows.map((r) => r.id), ["sub_2"]);
    assert.deepEqual(parseMemberFilter({ status: "bogus", page: "-3", q: `  ${"x".repeat(200)} ` }).status, "ongoing");
    assert.equal(parseMemberFilter({ page: "abc" }).page, 1);
    assert.equal((await getAdminMembers(parseMemberFilter({ page: "99" }))).page, 1, "out-of-range pages clamp to the last page");

    const csv = membersToCsv((await getAdminMembers(parseMemberFilter({ status: "all" }), { all: true })).rows).split("\r\n");
    assert.equal(csv.length, 4);
    assert.match(csv[0]!, /^Member,Email,Plan,Status/);
    assert.ok(csv.some((line) => line.startsWith("Mia Member,usr_member@example.com,Monthly,Active,No,Manual payment,") && line.endsWith(",2,34.00,USD")));
  });

  it("shows plans with savings and the viewer's state on the pricing page", async () => {
    const guest = await getPricingData(null);
    assert.deepEqual(guest.plans.map((p) => [p.id, p.savingsPercent]), [
      [monthly.id, 0],
      [yearly.id, 30],
      [lifetime.id, 0],
    ]);
    assert.deepEqual(guest.viewer, { loggedIn: false, currentPlanId: null, currentStatus: null, trialEligible: true });
    const mine = await getPricingData(member);
    assert.deepEqual(mine.viewer, { loggedIn: true, currentPlanId: monthly.id, currentStatus: "active", trialEligible: false });
    await mutate((d) => {
      d.plans.find((p) => p.id === yearly.id)!.active = false;
      d.settings.growth.subscriptionsEnabled = false;
    });
    const off = await getPricingData(null);
    assert.equal(off.enabled, false);
    assert.deepEqual(off.plans.map((p) => p.id), [monthly.id, lifetime.id]);
  });
});

describe("plan actions", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
    return data;
  };
  const planForm = (overrides: Record<string, string | string[]> = {}) =>
    form({ name: "Team plan", slug: "team-plan", description: "", interval: "month", price: "29", currency: "USD", trialDays: "0", accessType: "courses", courseIds: [course.id], features: "One\nTwo", active: "on", ...overrides });

  beforeEach(() => setup({ subscriptions: [sub()], payments: [planOrder({ status: "paid", subscriptionId: "sub_1" })] }));

  it("are for administrators only", async () => {
    const guest = await savePlanAction(null, planForm());
    assert.ok(!guest.ok && /Only administrators/.test(guest.error));
    await createSession(member.id);
    assert.ok(!(await savePlanAction(null, planForm())).ok);
    assert.ok(!(await setPlanActiveAction(monthly.id, false)).ok);
    assert.ok(!(await deletePlanAction(lifetime.id)).ok);
    assert.ok(!(await setMembershipsEnabledAction(false)).ok);
    assert.ok(!(await extendMembershipsAction(["sub_1"], 5)).ok);
    const db = await getDb();
    assert.equal(db.plans.length, 3);
    assert.equal(db.plans.find((p) => p.id === monthly.id)?.active, true);
    assert.equal(db.settings.growth.subscriptionsEnabled, true);
  });

  it("create, edit, retire and delete plans", async () => {
    await createSession(admin.id);
    const created = await savePlanAction(null, planForm());
    assert.ok(created.ok);
    let db = await getDb();
    const row = db.plans.find((p) => p.id === created.data.id)!;
    assert.deepEqual({ slug: row.slug, price: row.price, access: row.access, features: row.features, active: row.active }, { slug: "team-plan", price: 2900, access: { type: "courses", courseIds: [course.id] }, features: ["One", "Two"], active: true });

    const duplicate = await savePlanAction(null, planForm({ name: "Other" }));
    assert.ok(!duplicate.ok && duplicate.fieldErrors?.slug);
    const invalid = await savePlanAction(null, planForm({ slug: "other", price: "0", courseIds: ["crs_missing"] }));
    assert.ok(!invalid.ok && invalid.fieldErrors?.price && invalid.fieldErrors?.courseIds);

    const edited = await savePlanAction(null, planForm({ id: row.id, price: "39", active: "" }));
    assert.ok(edited.ok && /new price/.test(edited.message ?? ""));
    db = await getDb();
    assert.deepEqual({ price: db.plans.find((p) => p.id === row.id)?.price, active: db.plans.find((p) => p.id === row.id)?.active, count: db.plans.length }, { price: 3900, active: false, count: 4 });
    assert.ok(!(await savePlanAction(null, planForm({ id: "plan_gone" }))).ok);

    assert.ok((await setPlanActiveAction(monthly.id, false)).ok);
    const inUse = await deletePlanAction(monthly.id);
    assert.ok(!inUse.ok && /Retire it instead/.test(inUse.error));
    assert.ok((await deletePlanAction(row.id)).ok);
    db = await getDb();
    assert.equal(db.plans.some((p) => p.id === row.id), false);
    assert.equal(db.plans.find((p) => p.id === monthly.id)?.active, false);
    assert.deepEqual(
      db.auditEvents.map((e) => e.action).filter((a) => a.startsWith("plan.")),
      ["plan.create", "plan.update", "plan.retire", "plan.delete"],
    );
  });

  it("pause membership sales and extend several memberships, skipping gateway-billed ones", async () => {
    await createSession(admin.id);
    assert.ok((await setMembershipsEnabledAction(false)).ok);
    assert.equal((await getDb()).settings.growth.subscriptionsEnabled, false);

    await mutate((d) => {
      d.subscriptions.push(sub({ id: "sub_g", userId: second.id, gateway: "stripe", gatewaySubscriptionId: "sub_stripe123456" }));
    });
    const before = await theSub();
    const gatewayBefore = await theSub("sub_g");
    const res = await extendMembershipsAction(["sub_1", "sub_1", "sub_g", "sub_missing"], 7);
    assert.ok(res.ok);
    assert.deepEqual(res.data, { extended: 1, skipped: 2 });
    assert.equal(Date.parse((await theSub()).currentPeriodEnd) - Date.parse(before.currentPeriodEnd), 7 * DAY);
    assert.equal((await theSub("sub_g")).currentPeriodEnd, gatewayBefore.currentPeriodEnd);
    assert.ok(!(await extendMembershipsAction(["sub_g"], 7)).ok);
    assert.ok(!(await extendMembershipsAction([], 7)).ok);
    assert.ok(!(await extendMembershipsAction(["sub_1"], 0)).ok);
  });
});

describe("Razorpay subscription webhooks", () => {
  const RZP_SUB = "sub_RzpFixture001";
  const now = Math.floor(Date.now() / 1000);
  let remote: { subscription: Record<string, unknown>; payments: Record<string, Record<string, unknown>> };

  const rzpSub = (overrides: Record<string, unknown> = {}) => ({
    id: RZP_SUB,
    entity: "subscription",
    plan_id: "plan_RzpFixture01",
    status: "active",
    current_start: now - 3600,
    current_end: now + 30 * 86_400,
    charge_at: now + 30 * 86_400,
    start_at: now - 3600,
    ended_at: null,
    paid_count: 1,
    total_count: 120,
    notes: { paymentId: "pay_1", orderId: "ORD-PAY_1", planId: monthly.id, userId: member.id, trialDays: "0" },
    ...overrides,
  });
  const rzpPayment = (id: string, overrides: Record<string, unknown> = {}) => ({ id, entity: "payment", amount: 190000, currency: "INR", status: "captured", captured: true, invoice_id: `inv_${id.slice(4)}`, amount_refunded: 0, notes: {}, ...overrides });
  const rzpEvent = (name: string, payment?: Record<string, unknown>) => {
    const parsed = parseRazorpayEvent({ entity: "event", event: name, payload: { subscription: { entity: remote.subscription }, ...(payment ? { payment: { entity: payment } } : {}) } });
    assert.ok(parsed);
    return parsed;
  };

  before(() => {
    razorpayEnv.keyId = "rzp_test_fixture";
    razorpayEnv.keySecret = "rzp_secret_fixture";
    mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname === `/v1/subscriptions/${RZP_SUB}`) return reply(remote.subscription);
      const payment = /^\/v1\/payments\/(pay_\w+)$/.exec(url.pathname)?.[1];
      if (payment && remote.payments[payment]) return reply(remote.payments[payment]);
      if (url.pathname === "/v1/invoices") return reply({ items: [] });
      throw new TypeError(`unexpected request ${init.method ?? "GET"} ${url.pathname}`);
    });
  });

  beforeEach(async () => {
    const inrPlan = { ...monthly, price: 190000, currency: "INR" };
    await setup({ gateway: "razorpay", payments: [planOrder({ gateway: "razorpay", gatewayOrderId: RZP_SUB, amount: 190000, originalAmount: 190000, currency: "INR" })] });
    await mutate((d) => {
      d.plans = [inrPlan];
    });
    remote = { subscription: rzpSub(), payments: { pay_RzpFirst00001: rzpPayment("pay_RzpFirst00001"), pay_RzpSecond0001: rzpPayment("pay_RzpSecond0001") } };
  });

  it("settles the checkout order on the first charge and records later charges as renewals", async () => {
    const first = await handleRazorpayEvent(rzpEvent("subscription.charged", remote.payments.pay_RzpFirst00001));
    assert.equal(first.handled, true);
    let db = await getDb();
    const order = db.payments.find((p) => p.id === "pay_1")!;
    assert.deepEqual({ status: order.status, payment: order.gatewayPaymentId }, { status: "paid", payment: "pay_RzpFirst00001" });
    const row = db.subscriptions[0]!;
    assert.deepEqual({ status: row.status, gateway: row.gateway, id: row.gatewaySubscriptionId, linked: order.subscriptionId === row.id }, { status: "active", gateway: "razorpay", id: RZP_SUB, linked: true });

    remote.subscription = rzpSub({ paid_count: 2, current_start: now + 30 * 86_400, current_end: now + 60 * 86_400 });
    const renewal = await handleRazorpayEvent(rzpEvent("subscription.charged", remote.payments.pay_RzpSecond0001));
    assert.match(renewal.message, /renewal pay_RzpSecond0001: order ORD-\S+ paid/);
    await handleRazorpayEvent(rzpEvent("subscription.charged", remote.payments.pay_RzpSecond0001));
    db = await getDb();
    assert.equal(db.payments.length, 2);
    const renewed = db.payments.find((p) => p.gatewayPaymentId === "pay_RzpSecond0001")!;
    assert.deepEqual({ status: renewed.status, amount: renewed.amount, currency: renewed.currency, source: renewed.source, sub: renewed.subscriptionId }, { status: "paid", amount: 190000, currency: "INR", source: "Renewal", sub: row.id });
    assert.equal(db.subscriptions[0]!.currentPeriodEnd, new Date((now + 60 * 86_400) * 1000).toISOString());
  });

  it("does not settle the order with a first payment that was refunded", async () => {
    const refunded = rzpPayment("pay_RzpFirst00001", { amount_refunded: 190000, refund_status: "full" });
    await handleRazorpayEvent(rzpEvent("subscription.charged", refunded));
    assert.equal((await getDb()).payments[0]!.status, "failed");
  });

  it("follows halted and cancelled subscriptions", async () => {
    await handleRazorpayEvent(rzpEvent("subscription.charged", remote.payments.pay_RzpFirst00001));
    remote.subscription = rzpSub({ status: "halted" });
    await handleRazorpayEvent(rzpEvent("subscription.halted"));
    assert.equal((await getDb()).subscriptions[0]!.status, "past_due");
    remote.subscription = rzpSub({ status: "cancelled", ended_at: now });
    const outcome = await handleRazorpayEvent(rzpEvent("subscription.cancelled"));
    assert.equal(outcome.handled, true);
    const row = (await getDb()).subscriptions[0]!;
    assert.deepEqual({ status: row.status, end: row.currentPeriodEnd }, { status: "cancelled", end: new Date(now * 1000).toISOString() });
  });

  it("starts a trial when the mandate is authorized with a deferred first charge", async () => {
    remote.subscription = rzpSub({ status: "authenticated", paid_count: 0, current_start: null, current_end: null, start_at: now + 7 * 86_400, charge_at: now + 7 * 86_400, notes: { paymentId: "pay_1", planId: monthly.id, userId: member.id, trialDays: "7" } });
    await handleRazorpayEvent(rzpEvent("subscription.authenticated"));
    const db = await getDb();
    assert.deepEqual({ status: db.subscriptions[0]?.status, end: db.subscriptions[0]?.currentPeriodEnd }, { status: "trialing", end: new Date((now + 7 * 86_400) * 1000).toISOString() });
    assert.deepEqual({ status: db.payments[0]!.status, amount: db.payments[0]!.amount }, { status: "paid", amount: 0 });
  });
});
