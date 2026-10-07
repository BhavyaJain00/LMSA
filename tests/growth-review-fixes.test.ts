import { after, afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Affiliate, AnalyticsEvent, Organization, Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { settleEvents } from "@/lib/events";
import { REFERRAL_EVENT, creditCommission } from "@/lib/growth/affiliates";
import { couponPerformance, netRevenueOf, refundedNetOf, revenueByItem, revenueSeries, summarizeRevenue } from "@/lib/growth/analytics-metrics";
import { DRAFT_TEAM_PEOPLE_ERROR, addManager, removeManager, transferOwnership } from "@/lib/growth/teams";
import { addManagerAction, transferOwnershipAction } from "@/lib/actions/teams";
import { makePayment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Growth review fixes: follow-on charges (renewals, installment parts) keep
 * the affiliate of their original order, net revenue removes the tax from
 * refunds, and an unpaid draft team cannot add managers or change owner.
 */

const DAY = 24 * 60 * 60 * 1000;

const admin = makeUser({ id: "usr_fxadmin", name: "Grace Admin", roles: ["admin"] });
const promoter = makeUser({ id: "usr_fxada", name: "Ada Promoter", email: "ada@example.com" });
const rival = makeUser({ id: "usr_fxbob", name: "Bob Rival", email: "bob@example.com" });
const buyer = makeUser({ id: "usr_fxbuyer", name: "Bea Buyer", email: "bea@example.com" });
const victim = makeUser({ id: "usr_fxvic", name: "Vic Target", email: "vic@example.com" });

const ada: Affiliate = { id: "aff_fxada", userId: promoter.id, code: "ADAFX", commissionPercent: 20, status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const bob: Affiliate = { id: "aff_fxbob", userId: rival.id, code: "BOBFX", commissionPercent: 10, status: "active", createdAt: "2026-01-02T00:00:00.000Z" };

const paidTeam: Organization = { id: "org_fxpaid", name: "Paid Co", slug: "paid-co", ownerId: buyer.id, managerIds: [], seatCount: 5, courseIds: [], createdAt: "2026-02-01T00:00:00.000Z" };
const draftTeam: Organization = { id: "org_fxdraft", name: "Draft Co", slug: "draft-co", ownerId: buyer.id, managerIds: [], seatCount: 0, courseIds: [], createdAt: new Date().toISOString(), checkoutDraft: true };

async function setup(fixture: Fixture = {}) {
  await resetDb({
    users: [admin, promoter, rival, buyer, victim],
    affiliates: [ada, bob],
    organizations: [paidTeam, draftTeam],
    ...fixture,
    settings: { email: { enabled: false }, gamification: { enabled: false }, ...(fixture.settings ?? {}) },
  });
  resetRequest();
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** The member followed `affiliateId`'s referral link at `atMs`. */
function click(affiliateId: string, userId: string, atMs: number): AnalyticsEvent {
  return { id: `evt_${affiliateId}_${atMs}`, name: REFERRAL_EVENT, userId, itemType: "affiliate", itemId: affiliateId, createdAt: new Date(atMs).toISOString() };
}

function paid(id: string, overrides: Partial<Payment> = {}): Payment {
  return makePayment({ id, userId: buyer.id, itemId: "crs_fx", itemTitle: "JavaScript Basics", status: "paid", paidAt: new Date().toISOString(), amount: 10000, taxAmount: 0, originalAmount: 10000, ...overrides });
}

before(() => {
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());
afterEach(async () => {
  await settleEvents();
});

describe("commissions on follow-on charges", () => {
  const now = Date.now();

  it("never pays a renewal to an affiliate the subscriber clicked after joining without a referral", async () => {
    const original = paid("pay_fxsub1", { itemType: "plan", subscriptionId: "sub_fx", paidAt: new Date(now - 60 * DAY).toISOString(), createdAt: new Date(now - 60 * DAY).toISOString() });
    const renewal = paid("pay_fxsub2", { itemType: "plan", subscriptionId: "sub_fx", source: "Renewal", createdAt: new Date(now).toISOString() });
    await setup({ payments: [original, renewal], analyticsEvents: [click(bob.id, buyer.id, now - DAY)] });
    const result = await creditCommission(renewal.id);
    assert.equal(result.credited, false);
    assert.equal((await getDb()).commissions.length, 0);
  });

  it("pays a renewal to the affiliate of the original checkout, not to a later click or a stamped referral", async () => {
    const original = paid("pay_fxsub1", { itemType: "plan", subscriptionId: "sub_fx", affiliateId: ada.id, paidAt: new Date(now - 60 * DAY).toISOString(), createdAt: new Date(now - 60 * DAY).toISOString() });
    const renewal = paid("pay_fxsub2", { itemType: "plan", subscriptionId: "sub_fx", source: "Renewal", createdAt: new Date(now).toISOString() });
    await setup({ payments: [original, renewal], analyticsEvents: [click(bob.id, buyer.id, now - DAY)] });
    const result = await creditCommission(renewal.id, bob.id);
    assert.ok(result.credited);
    assert.equal(result.commission.affiliateId, ada.id);
    assert.equal(result.commission.amount, 2000);
    assert.equal((await getDb()).payments.find((p) => p.id === renewal.id)?.affiliateId, ada.id);
  });

  it("pays later installment parts to the affiliate of the first part, outside the cookie window", async () => {
    const first = paid("pay_fxi1", { orderId: "ORD-FXI", installmentNumber: 1, installmentsTotal: 3, affiliateId: ada.id, paidAt: new Date(now - 60 * DAY).toISOString(), createdAt: new Date(now - 60 * DAY).toISOString() });
    const third = paid("pay_fxi3", { orderId: "ORD-FXI-3", installmentNumber: 3, installmentsTotal: 3 });
    await setup({ payments: [first, third], analyticsEvents: [click(bob.id, buyer.id, now - DAY)] });
    const result = await creditCommission(third.id);
    assert.ok(result.credited);
    assert.equal(result.commission.affiliateId, ada.id);
  });

  it("pays nobody for a part whose first part had no referral, or is gone", async () => {
    const first = paid("pay_fxi1", { orderId: "ORD-FXI", installmentNumber: 1, installmentsTotal: 3, paidAt: new Date(now - 10 * DAY).toISOString() });
    const second = paid("pay_fxi2", { orderId: "ORD-FXI-2", installmentNumber: 2, installmentsTotal: 3 });
    const orphan = paid("pay_fxo2", { orderId: "ORD-GONE-2", installmentNumber: 2, installmentsTotal: 3 });
    await setup({ payments: [first, second, orphan], analyticsEvents: [click(bob.id, buyer.id, now - DAY)] });
    assert.equal((await creditCommission(second.id)).credited, false);
    assert.equal((await creditCommission(orphan.id)).credited, false);
    assert.equal((await getDb()).commissions.length, 0);
  });

  it("still credits a first order to the member's last click", async () => {
    const order = paid("pay_fxone");
    await setup({ payments: [order], analyticsEvents: [click(ada.id, buyer.id, now - 3 * DAY), click(bob.id, buyer.id, now - DAY)] });
    const result = await creditCommission(order.id);
    assert.ok(result.credited);
    assert.equal(result.commission.affiliateId, bob.id);
  });
});

describe("net revenue with tax and refunds", () => {
  const NOW = Date.parse("2026-03-19T12:00:00.000Z");
  const bounds = { startMs: NOW - 7 * DAY, endMs: NOW + DAY };
  const iso = (ms: number) => new Date(ms).toISOString();
  const full = makePayment({ userId: "u", itemId: "crs_t", itemTitle: "Taxed", status: "refunded", amount: 12000, taxAmount: 2000, refundedAmount: 12000, couponCode: "TAX", paidAt: iso(NOW - DAY), refundedAt: iso(NOW), createdAt: iso(NOW - DAY) });
  const part = makePayment({ userId: "u", itemId: "crs_t", itemTitle: "Taxed", status: "paid", amount: 12000, taxAmount: 2000, refundedAmount: 6000, paidAt: iso(NOW - DAY), refundedAt: iso(NOW), createdAt: iso(NOW - DAY) });

  it("takes the tax out of the refunded money pro rata", () => {
    assert.equal(refundedNetOf(full), 10000);
    assert.equal(refundedNetOf(part), 5000);
    assert.equal(netRevenueOf(full), 0);
    assert.equal(netRevenueOf(part), 5000);
  });

  it("never reports a fully refunded taxed order as negative revenue", () => {
    const [summary] = summarizeRevenue([full], bounds);
    assert.deepEqual([summary.gross, summary.refunds, summary.net], [10000, 10000, 0]);
    assert.equal(revenueByItem([full], bounds)[0].net, 0);
    assert.equal(couponPerformance([full], bounds)[0].revenue, 0);
    const series = revenueSeries([full], ["2026-03-18", "2026-03-19"], "USD");
    assert.equal(series.reduce((sum, d) => sum + d.value, 0), 0);
  });

  it("keeps half the net of a half-refunded taxed order", () => {
    const [summary] = summarizeRevenue([part], bounds);
    assert.deepEqual([summary.gross, summary.refunds, summary.net], [10000, 5000, 5000]);
  });
});

describe("managers and owners of draft teams", () => {
  it("refuses to add a manager or hand over an unpaid draft, with one reply for any address", async () => {
    await setup();
    for (const email of [victim.email, "nobody@example.com"]) {
      const added = await addManager(draftTeam.id, email, buyer);
      assert.deepEqual(added, { ok: false, error: DRAFT_TEAM_PEOPLE_ERROR }, email);
      const handed = await transferOwnership(draftTeam.id, email, buyer);
      assert.deepEqual(handed, { ok: false, error: DRAFT_TEAM_PEOPLE_ERROR }, email);
    }
    const db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === victim.id).length, 0);
    const org = db.organizations.find((o) => o.id === draftTeam.id)!;
    assert.deepEqual([org.ownerId, org.managerIds], [buyer.id, []]);
  });

  it("refuses the same through the owner's actions, but lets an administrator set the team up", async () => {
    await setup();
    await signIn(buyer.id);
    const added = await addManagerAction(null, form({ orgId: draftTeam.id, email: victim.email }));
    assert.deepEqual([added.ok, !added.ok && added.error], [false, DRAFT_TEAM_PEOPLE_ERROR]);
    const handed = await transferOwnershipAction(null, form({ orgId: draftTeam.id, email: victim.email }));
    assert.deepEqual([handed.ok, !handed.ok && handed.error], [false, DRAFT_TEAM_PEOPLE_ERROR]);

    await signIn(admin.id);
    assert.ok((await addManagerAction(null, form({ orgId: draftTeam.id, email: victim.email }))).ok);
  });

  it("notifies a person once a day however often they are added and removed", async () => {
    await setup();
    for (let i = 0; i < 3; i++) {
      assert.ok((await addManager(paidTeam.id, victim.email, buyer)).ok);
      assert.ok((await removeManager(paidTeam.id, victim.id)).ok);
    }
    const notes = (await getDb()).notifications.filter((n) => n.userId === victim.id);
    assert.equal(notes.length, 1);
  });

  it("limits how often an owner can try to add managers", async () => {
    // A fresh owner: the action limiter counts every attempt of the earlier tests' owner.
    const busy = makeUser({ id: "usr_fxbusy", name: "Busy Owner", email: "busy@example.com" });
    const busyTeam: Organization = { ...paidTeam, id: "org_fxbusy", slug: "busy-co", ownerId: busy.id };
    await setup({ users: [admin, buyer, victim, busy], organizations: [busyTeam] });
    await signIn(busy.id);
    for (let i = 0; i < 20; i++) {
      const result = await addManagerAction(null, form({ orgId: busyTeam.id, email: `nobody${i}@example.com` }));
      assert.equal(result.ok, false);
      assert.doesNotMatch(!result.ok ? result.error : "", /many times/);
    }
    const limited = await addManagerAction(null, form({ orgId: busyTeam.id, email: victim.email }));
    assert.equal(limited.ok, false);
    assert.match(!limited.ok ? limited.error : "", /many times this hour/);
    assert.equal((await getDb()).organizations.find((o) => o.id === busyTeam.id)!.managerIds.length, 0);
  });
});
