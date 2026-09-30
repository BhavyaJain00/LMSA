import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Affiliate, AnalyticsEvent, Commission, LoginEvent } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { emit, settleEvents } from "@/lib/events";
import { ANON_COOKIE } from "@/lib/legal/consent-shared";
import { REF_CLICK_HEADER, REF_COOKIE, formatRefCookie } from "@/lib/growth/affiliates-shared";
import {
  REFERRAL_EVENT,
  affiliatesToCsv,
  applyForAffiliate,
  approveCommissions,
  attributedAffiliateId,
  commissionsToCsv,
  creditCommission,
  getAffiliateDashboard,
  getAffiliateOverview,
  linkMemberToReferral,
  listAffiliates,
  listCommissions,
  recordAffiliatePayout,
  recordReferralClick,
  reverseCommissionForRefund,
  statementToCsv,
  voidCommissions,
} from "@/lib/growth/affiliates";
import { referralAffiliateIdForCheckout, trackReferralVisit } from "@/lib/growth/attribution";
import {
  applyAffiliateAction,
  approveCommissionsAction,
  recordPayoutAction,
  saveAffiliateSettingsAction,
  setAffiliateStatusAction,
  updateAffiliateAction,
  updatePayoutEmailAction,
  voidCommissionsAction,
} from "@/lib/actions/affiliates";
import { makePayment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Growth, item 1 (affiliates) against the real store: applications, clicks,
 * member attribution, commissions on paid orders, refunds, approval, payouts,
 * fraud flags, CSV and the permission checks of the server actions.
 */

const DAY = 24 * 60 * 60 * 1000;
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const VISITOR = "visitor-0123456789abcdef";

const admin = makeUser({ id: "usr_gadmin", name: "Grace Admin", roles: ["admin"] });
const promoter = makeUser({ id: "usr_promo", username: "ada", name: "Ada Promoter", email: "ada@example.com" });
const rival = makeUser({ id: "usr_rival", username: "bob", name: "Bob Rival" });
const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });

const ada: Affiliate = { id: "aff_ada", userId: promoter.id, code: "ADA", commissionPercent: 20, status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const bob: Affiliate = { id: "aff_bob", userId: rival.id, code: "BOB", commissionPercent: 10, status: "active", createdAt: "2026-01-02T00:00:00.000Z" };

function link(affiliateId: string, userId: string, atMs: number): AnalyticsEvent {
  return { id: `evt_${affiliateId}_${atMs}`, name: REFERRAL_EVENT, userId, itemType: "affiliate", itemId: affiliateId, createdAt: new Date(atMs).toISOString() };
}

function paidOrder(id: string, overrides: Partial<Parameters<typeof makePayment>[0]> = {}) {
  return makePayment({ id, userId: buyer.id, itemId: "crs_x", itemTitle: "JavaScript Basics", status: "paid", paidAt: new Date().toISOString(), amount: 11800, taxAmount: 1800, originalAmount: 10000, ...overrides });
}

async function setup(fixture: Fixture = {}) {
  await resetDb({
    users: [admin, promoter, rival, buyer],
    affiliates: [ada, bob],
    ...fixture,
    settings: { email: { enabled: false }, gamification: { enabled: false }, ...(fixture.settings ?? {}) },
  });
}

async function commissions(): Promise<Commission[]> {
  return (await getDb()).commissions;
}

async function signIn(userId: string, init: Parameters<typeof resetRequest>[0] = {}) {
  resetRequest(init);
  await createSession(userId);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Wait for `after()` tasks (the test stub runs them on the next tick). */
async function afterTasks() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

before(() => {
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

describe("joining the program", () => {
  it("activates at once with auto-approval and keeps one account per member", async () => {
    await setup({ affiliates: [bob] });
    const first = await applyForAffiliate(promoter, "payouts@example.com");
    assert.ok(first.ok && first.created);
    assert.equal(first.affiliate.status, "active");
    assert.equal(first.affiliate.code, "ADA");
    assert.equal(first.affiliate.commissionPercent, 20);
    assert.equal(first.affiliate.payoutEmail, "payouts@example.com");
    const again = await applyForAffiliate(promoter, undefined);
    assert.ok(again.ok && !again.created);
    assert.equal((await getDb()).affiliates.filter((a) => a.userId === promoter.id).length, 1);
  });

  it("waits for review without auto-approval and tells the administrators", async () => {
    await setup({ affiliates: [], settings: { growth: { affiliateAutoApprove: false, defaultCommissionPercent: 15 } } });
    const result = await applyForAffiliate(promoter, undefined);
    assert.ok(result.ok);
    assert.equal(result.affiliate.status, "pending");
    assert.equal(result.affiliate.commissionPercent, 15);
    const notes = (await getDb()).notifications.filter((n) => n.userId === admin.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].link, "/admin/affiliates?status=pending");
  });

  it("gives a second member with the same name a different code", async () => {
    await setup();
    const twin = makeUser({ id: "usr_twin", username: "ada", name: "Ada Twin" });
    const result = await applyForAffiliate(twin, undefined);
    assert.ok(result.ok);
    assert.match(result.affiliate.code, /^ADA\d+$/);
  });

  it("is closed while the program is off", async () => {
    await setup({ affiliates: [], settings: { growth: { affiliatesEnabled: false } } });
    const result = await applyForAffiliate(promoter, undefined);
    assert.equal(result.ok, false);
    assert.equal((await getDb()).affiliates.length, 0);
  });
});

describe("referral clicks", () => {
  beforeEach(() => setup());

  it("records a click once per visitor and half hour", async () => {
    const at = Date.now();
    assert.ok(await recordReferralClick({ code: "ada", at, visitorId: VISITOR, landingPath: "/courses/js" }));
    assert.equal(await recordReferralClick({ code: "ADA", at: at + 10 * 60 * 1000, visitorId: VISITOR, landingPath: "/courses/js" }), null, "repeat inside 30 minutes");
    assert.ok(await recordReferralClick({ code: "ADA", at: at + 45 * 60 * 1000, visitorId: VISITOR, landingPath: "//evil.test" }));
    assert.ok(await recordReferralClick({ code: "ADA", at, visitorId: "another-visitor-0123456789", landingPath: "/" }));
    const rows = (await getDb()).affiliateReferrals;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.landingPath), ["/courses/js", "/", "/"]);
  });

  it("ignores unknown codes, inactive affiliates, the affiliate's own visits and visitors without an id", async () => {
    await setup({ affiliates: [ada, { ...bob, status: "paused" }] });
    const at = Date.now();
    assert.equal(await recordReferralClick({ code: "NOPE", at, visitorId: VISITOR, landingPath: "/" }), null);
    assert.equal(await recordReferralClick({ code: "BOB", at, visitorId: VISITOR, landingPath: "/" }), null);
    assert.equal(await recordReferralClick({ code: "ADA", at, visitorId: VISITOR, landingPath: "/", userId: promoter.id }), null);
    assert.equal(await recordReferralClick({ code: "ADA", at, landingPath: "/" }), null);
    assert.equal((await getDb()).affiliateReferrals.length, 0);
  });

  it("links a member to a click once and never to their own code", async () => {
    const at = Date.now();
    assert.equal(await linkMemberToReferral({ userId: buyer.id, code: "ADA", at }), true);
    assert.equal(await linkMemberToReferral({ userId: buyer.id, code: "ADA", at }), false);
    assert.equal(await linkMemberToReferral({ userId: promoter.id, code: "ADA", at }), false);
    assert.equal((await getDb()).analyticsEvents.filter((e) => e.name === REFERRAL_EVENT).length, 1);
  });

  it("attributes to the last click inside the window", async () => {
    const now = Date.now();
    await setup({ analyticsEvents: [link(ada.id, buyer.id, now - 20 * DAY), link(bob.id, buyer.id, now - 3 * DAY), link(ada.id, buyer.id, now - 45 * DAY)] });
    const db = await getDb();
    assert.equal(attributedAffiliateId(db, buyer.id, now), bob.id);
    assert.equal(attributedAffiliateId(db, buyer.id, now - 10 * DAY), ada.id, "only clicks before the action count");
    assert.equal(attributedAffiliateId(db, rival.id, now), null);
    await setup({ analyticsEvents: [link(ada.id, buyer.id, now - 45 * DAY)] });
    assert.equal(attributedAffiliateId(await getDb(), buyer.id, now), null, "outside the 30-day window");
  });
});

describe("request attribution", () => {
  it("records the click of a referral landing and links the signed-in member", async () => {
    await setup();
    const at = Date.now() - 1000;
    await signIn(buyer.id, {
      cookies: { [REF_COOKIE]: formatRefCookie("ADA", at), [ANON_COOKIE]: VISITOR },
      headers: { [REF_CLICK_HEADER]: "/courses/js", "user-agent": BROWSER, "x-forwarded-for": "203.0.113.40" },
    });
    await trackReferralVisit();
    await afterTasks();
    const db = await getDb();
    assert.equal(db.affiliateReferrals.length, 1);
    assert.equal(db.affiliateReferrals[0].landingPath, "/courses/js");
    assert.equal(db.affiliateReferrals[0].visitorId, VISITOR);
    assert.equal(attributedAffiliateId(db, buyer.id, Date.now()), ada.id);

    // Later page views carry the cookie but not the click header: nothing new is written.
    await signIn(buyer.id, { cookies: { [REF_COOKIE]: formatRefCookie("ADA", at), [ANON_COOKIE]: VISITOR }, headers: { "user-agent": BROWSER } });
    await trackReferralVisit();
    await afterTasks();
    const later = await getDb();
    assert.equal(later.affiliateReferrals.length, 1);
    assert.equal(later.analyticsEvents.filter((e) => e.name === REFERRAL_EVENT).length, 1);
  });

  it("does not count crawlers as clicks", async () => {
    await setup();
    resetRequest({
      cookies: { [REF_COOKIE]: formatRefCookie("ADA", Date.now()), [ANON_COOKIE]: VISITOR },
      headers: { [REF_CLICK_HEADER]: "/", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    });
    await trackReferralVisit();
    await afterTasks();
    assert.equal((await getDb()).affiliateReferrals.length, 0);
  });

  it("ignores a cookie older than the window", async () => {
    await setup({ settings: { growth: { cookieDays: 7 } } });
    await signIn(buyer.id, {
      cookies: { [REF_COOKIE]: formatRefCookie("ADA", Date.now() - 8 * DAY), [ANON_COOKIE]: VISITOR },
      headers: { [REF_CLICK_HEADER]: "/", "user-agent": BROWSER },
    });
    await trackReferralVisit();
    await afterTasks();
    const db = await getDb();
    assert.equal(db.affiliateReferrals.length, 0);
    assert.equal(db.analyticsEvents.length, 0);
  });

  it("picks the affiliate for a checkout from the cookie, then from linked clicks", async () => {
    const now = Date.now();
    await setup({ analyticsEvents: [link(bob.id, buyer.id, now - 2 * DAY)] });
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie("ADA", now - DAY) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), ada.id);
    assert.equal(await referralAffiliateIdForCheckout(promoter.id), undefined, "own link, and no linked click");
    resetRequest();
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), bob.id, "no cookie: the linked click");
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie("ADA", now - 40 * DAY) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), bob.id, "expired cookie: the linked click");
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie("GHOST", now) } });
    assert.equal(await referralAffiliateIdForCheckout(rival.id), undefined);
  });
});

describe("commissions on paid orders", () => {
  it("credits the percent of the net, tax-exclusive amount and marks the click converted", async () => {
    const clickAt = Date.now() - 2 * DAY;
    await setup({
      payments: [paidOrder("pay_1")],
      analyticsEvents: [link(ada.id, buyer.id, clickAt)],
      affiliateReferrals: [{ id: "ref_1", affiliateId: ada.id, visitorId: VISITOR, landingPath: "/courses/js", createdAt: new Date(clickAt).toISOString() }],
    });
    const result = await creditCommission("pay_1");
    assert.ok(result.credited);
    assert.equal(result.commission.amount, 2000, "20% of 118.00 − 18.00 tax");
    assert.equal(result.commission.status, "pending");
    const db = await getDb();
    assert.equal(db.payments[0].affiliateId, ada.id);
    assert.equal(db.affiliateReferrals[0].convertedPaymentId, "pay_1");
    const note = db.notifications.find((n) => n.userId === promoter.id);
    assert.ok(note?.subject.includes("$20.00"));
  });

  it("is idempotent per order", async () => {
    await setup({ payments: [paidOrder("pay_1", { affiliateId: ada.id })] });
    assert.ok((await creditCommission("pay_1")).credited);
    assert.deepEqual(await creditCommission("pay_1"), { credited: false, reason: "exists" });
    assert.equal((await commissions()).length, 1);
  });

  it("prefers the affiliate stamped on the order over linked clicks", async () => {
    await setup({ payments: [paidOrder("pay_1", { affiliateId: bob.id })], analyticsEvents: [link(ada.id, buyer.id, Date.now() - DAY)] });
    const result = await creditCommission("pay_1");
    assert.ok(result.credited);
    assert.equal(result.affiliate.id, bob.id);
    assert.equal(result.commission.amount, 1000, "Bob earns 10%");
  });

  it("never pays self-referrals, inactive affiliates, unpaid or unattributed orders", async () => {
    await setup({
      affiliates: [ada, { ...bob, status: "paused" }],
      payments: [
        paidOrder("pay_self", { userId: promoter.id, affiliateId: ada.id }),
        paidOrder("pay_paused", { affiliateId: bob.id }),
        paidOrder("pay_pending", { affiliateId: ada.id, status: "pending", paidAt: undefined }),
        paidOrder("pay_nobody"),
        paidOrder("pay_free", { affiliateId: ada.id, amount: 0, taxAmount: 0 }),
      ],
      analyticsEvents: [link(ada.id, buyer.id, Date.now() - 60 * DAY)],
    });
    assert.deepEqual(await creditCommission("pay_self"), { credited: false, reason: "self_referral" });
    assert.deepEqual(await creditCommission("pay_paused"), { credited: false, reason: "inactive" });
    assert.deepEqual(await creditCommission("pay_pending"), { credited: false, reason: "not_paid" });
    assert.deepEqual(await creditCommission("pay_nobody"), { credited: false, reason: "no_affiliate" });
    assert.deepEqual(await creditCommission("pay_free"), { credited: false, reason: "zero_amount" });
    assert.deepEqual(await creditCommission("pay_missing"), { credited: false, reason: "missing" });
    assert.equal((await commissions()).length, 0);
  });

  it("earns nothing while the program is off", async () => {
    await setup({ payments: [paidOrder("pay_1", { affiliateId: ada.id })], settings: { growth: { affiliatesEnabled: false } } });
    assert.deepEqual(await creditCommission("pay_1"), { credited: false, reason: "disabled" });
  });
});

describe("refunds", () => {
  const refund = (paymentId: string, refundedAmount: number, full: boolean) =>
    reverseCommissionForRefund({ paymentId, orderId: "ORD", userId: buyer.id, itemType: "course", itemId: "crs_x", amount: 11800, refundedAmount, currency: "USD", full });

  beforeEach(async () => {
    await setup({ payments: [paidOrder("pay_1", { affiliateId: ada.id })] });
    await creditCommission("pay_1");
  });

  it("voids an unpaid commission on a full refund", async () => {
    assert.deepEqual(await refund("pay_1", 11800, true), { voided: 1, adjustment: null });
    assert.deepEqual((await commissions()).map((c) => c.status), ["void"]);
    assert.deepEqual(await refund("pay_1", 11800, true), { voided: 0, adjustment: null }, "a redelivered refund changes nothing");
  });

  it("reduces the commission pro rata on a partial refund, once", async () => {
    const first = await refund("pay_1", 2950, false);
    assert.equal(first.adjustment?.amount, -500);
    assert.equal(first.adjustment?.status, "pending");
    assert.equal((await refund("pay_1", 2950, false)).adjustment, null);
    const dashboard = await getAffiliateDashboard(promoter.id);
    assert.equal(dashboard?.stats.totals[0].pending, 1500);
    assert.equal(dashboard?.stats.conversions, 1);
  });

  it("claws a paid commission back from the next payout", async () => {
    const [original] = await commissions();
    await approveCommissions([original.id]);
    const payout = await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "paypal", reference: "TX-1" });
    assert.ok(payout.ok);
    const outcome = await refund("pay_1", 11800, true);
    assert.equal(outcome.voided, 0);
    assert.equal(outcome.adjustment?.amount, -2000);
    assert.equal(outcome.adjustment?.status, "approved");
    const next = await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "paypal" });
    assert.equal(next.ok, false, "a negative balance is never paid out");
  });

  it("ignores refunds of orders without a commission", async () => {
    assert.deepEqual(await refund("pay_other", 100, false), { voided: 0, adjustment: null });
  });
});

describe("approval and payouts", () => {
  beforeEach(async () => {
    await setup({
      payments: [paidOrder("pay_1", { affiliateId: ada.id }), paidOrder("pay_2", { affiliateId: ada.id, amount: 5000, taxAmount: 0 }), paidOrder("pay_eur", { affiliateId: ada.id, currency: "EUR", amount: 3000, taxAmount: 0 })],
    });
    for (const id of ["pay_1", "pay_2", "pay_eur"]) await creditCommission(id);
  });

  it("pays the approved balance of one currency and records a payout", async () => {
    const rows = await commissions();
    const usd = rows.filter((c) => c.currency === "USD");
    assert.deepEqual(await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "wise" }), { ok: false, error: "There is no approved USD balance to pay." });
    const approved = await approveCommissions(usd.map((c) => c.id));
    assert.equal(approved.approved, 2);
    assert.deepEqual(approved.affiliateUserIds, [promoter.id]);
    const result = await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "wise", reference: "W-77" });
    assert.ok(result.ok);
    assert.equal(result.payout.amount, 3000);
    assert.equal(result.count, 2);
    const db = await getDb();
    assert.deepEqual(db.commissions.map((c) => c.status), ["paid", "paid", "pending"]);
    assert.ok(db.commissions[0].paidAt);
    assert.deepEqual(db.payouts.map((p) => [p.affiliateId, p.amount, p.currency, p.method, p.reference]), [[ada.id, 3000, "USD", "wise", "W-77"]]);
    const overview = await getAffiliateOverview();
    assert.deepEqual(overview.paidTotals, [{ currency: "USD", amount: 3000 }]);
    assert.deepEqual(overview.pendingTotals, [{ currency: "EUR", amount: 600 }]);
  });

  it("approves the pending refund correction together with its sale", async () => {
    await reverseCommissionForRefund({ paymentId: "pay_1", orderId: "ORD", userId: buyer.id, itemType: "course", itemId: "crs_x", amount: 11800, refundedAmount: 5900, currency: "USD", full: false });
    const original = (await commissions()).find((c) => c.paymentId === "pay_1" && c.amount > 0);
    assert.ok(original);
    assert.equal((await approveCommissions([original.id])).approved, 2);
    const result = await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "bank_transfer" });
    assert.ok(result.ok);
    assert.equal(result.payout.amount, 1000);
  });

  it("voids unpaid commissions only", async () => {
    const rows = await commissions();
    await approveCommissions([rows[0].id]);
    await recordAffiliatePayout({ affiliateId: ada.id, currency: "USD", method: "paypal" });
    assert.deepEqual(await voidCommissions(rows.map((c) => c.id)), { voided: 2, skippedPaid: 1 });
    assert.deepEqual((await commissions()).map((c) => c.status), ["paid", "void", "void"]);
  });
});

describe("event handlers", () => {
  it("credit on payment.paid and void on payment.refunded", async () => {
    await setup({ payments: [paidOrder("pay_evt", { affiliateId: ada.id })] });
    const base = { paymentId: "pay_evt", orderId: "ORD-PAY_EVT", userId: buyer.id, itemType: "course" as const, itemId: "crs_x", amount: 11800, currency: "USD" };
    emit("payment.paid", { ...base, itemTitle: "JavaScript Basics", taxAmount: 1800, discountAmount: 0, gateway: "stripe", affiliateId: ada.id });
    await settleEvents();
    assert.deepEqual((await commissions()).map((c) => [c.affiliateId, c.amount, c.status]), [[ada.id, 2000, "pending"]]);
    emit("payment.refunded", { ...base, refundedAmount: 11800, full: true });
    await settleEvents();
    assert.deepEqual((await commissions()).map((c) => c.status), ["void"]);
  });
});

describe("admin views", () => {
  const login = (userId: string, ip: string): LoginEvent => ({ id: `lge_${userId}_${ip}`, userId, email: "x@example.com", success: true, ip, createdAt: "2026-02-01T00:00:00.000Z" });

  beforeEach(async () => {
    const sock = makeUser({ id: "usr_sock", name: "Sock Puppet", email: "a.da+alt@example.com" });
    await setup({
      users: [admin, promoter, rival, buyer, sock],
      payments: [paidOrder("pay_clean", { affiliateId: ada.id }), paidOrder("pay_ip", { userId: sock.id, affiliateId: ada.id }), paidOrder("pay_bob", { affiliateId: bob.id })],
      loginEvents: [login(promoter.id, "203.0.113.9"), login(sock.id, "203.0.113.9"), login(buyer.id, "198.51.100.1")],
    });
    for (const id of ["pay_clean", "pay_ip", "pay_bob"]) await creditCommission(id);
  });

  it("flags commissions whose buyer shares an IP with the affiliate", async () => {
    const all = await listCommissions({ status: "all", affiliateId: "", q: "", flagged: false, from: "", to: "" });
    assert.equal(all.length, 3);
    const flagged = await listCommissions({ status: "all", affiliateId: "", q: "", flagged: true, from: "", to: "" });
    assert.deepEqual(flagged.map((r) => [r.buyerName, r.flags]), [["Sock Puppet", ["shared_ip"]]]);
    assert.equal((await getAffiliateOverview()).flaggedUnpaid, 1);
    const affiliates = await listAffiliates({ status: "all", q: "", flagged: true });
    assert.deepEqual(affiliates.map((a) => [a.affiliate.code, a.flagged]), [["ADA", 1]]);
  });

  it("filters commissions by affiliate, status, search and date", async () => {
    const none = { status: "all" as const, affiliateId: "", q: "", flagged: false, from: "", to: "" };
    assert.equal((await listCommissions({ ...none, affiliateId: bob.id })).length, 1);
    assert.equal((await listCommissions({ ...none, status: "paid" })).length, 0);
    assert.equal((await listCommissions({ ...none, q: "sock" })).length, 1);
    assert.equal((await listCommissions({ ...none, q: "ord-pay_bob" })).length, 1);
    assert.equal((await listCommissions({ ...none, from: "2999-01-01" })).length, 0);
    assert.equal((await listAffiliates({ status: "paused", q: "", flagged: false })).length, 0);
    assert.deepEqual((await listAffiliates({ status: "all", q: "bob", flagged: false })).map((a) => a.affiliate.code), ["BOB"]);
  });

  it("exports CSV with numeric amounts and neutralized text", async () => {
    await reverseCommissionForRefund({ paymentId: "pay_bob", orderId: "ORD", userId: buyer.id, itemType: "course", itemId: "crs_x", amount: 11800, refundedAmount: 5900, currency: "USD", full: false });
    const csv = commissionsToCsv(await listCommissions({ status: "all", affiliateId: bob.id, q: "", flagged: false, from: "", to: "" }));
    const lines = csv.split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith("Commission ID,Date,Status,Affiliate code"));
    assert.ok(lines.some((l) => l.includes(",118.00,-5.00,USD,")), "the refund adjustment stays a negative number");
    const affiliatesCsv = affiliatesToCsv(await listAffiliates({ status: "all", q: "", flagged: false }));
    assert.ok(affiliatesCsv.includes("ADA,Ada Promoter,ada@example.com,,active,20,0,0,2,0,USD,40.00,0.00,0.00,1,2026-01-01"));
    const dashboard = await getAffiliateDashboard(rival.id);
    assert.ok(dashboard);
    const statement = statementToCsv({ ...dashboard, commissions: [{ ...dashboard.commissions[0], itemTitle: "=HYPERLINK(1)" }, ...dashboard.commissions.slice(1)] });
    assert.ok(statement.includes("'=HYPERLINK(1)"));
    assert.ok(statement.includes("Refund adjustment") || statement.includes("Commission,"));
  });
});

describe("server actions", () => {
  beforeEach(async () => {
    await setup({ payments: [paidOrder("pay_1", { affiliateId: ada.id })] });
    await creditCommission("pay_1");
  });

  it("are closed to members who are not administrators", async () => {
    await signIn(promoter.id);
    const [commission] = await commissions();
    assert.equal((await approveCommissionsAction([commission.id])).ok, false);
    assert.equal((await voidCommissionsAction([commission.id])).ok, false);
    assert.equal((await setAffiliateStatusAction(bob.id, "paused")).ok, false);
    assert.equal((await updateAffiliateAction(null, form({ id: ada.id, code: "ADA", commissionPercent: "90", payoutEmail: "", status: "active" }))).ok, false);
    assert.equal((await recordPayoutAction(null, form({ affiliateId: ada.id, currency: "USD", method: "paypal", reference: "" }))).ok, false);
    assert.equal((await saveAffiliateSettingsAction(null, form({ section: "affiliates", defaultCommissionPercent: "90", cookieDays: "30" }))).ok, false);
    const db = await getDb();
    assert.equal(db.commissions[0].status, "pending");
    assert.equal(db.affiliates.find((a) => a.id === ada.id)?.commissionPercent, 20);
    assert.equal(db.settings.growth.defaultCommissionPercent, 20);
  });

  it("let an administrator approve, pay, edit and pause, with an audit trail", async () => {
    await signIn(admin.id);
    const [commission] = await commissions();
    const approved = await approveCommissionsAction([commission.id]);
    assert.ok(approved.ok);
    const paid = await recordPayoutAction(null, form({ affiliateId: ada.id, currency: "usd", method: "paypal", reference: "PP-1" }));
    assert.ok(paid.ok);
    assert.equal((await recordPayoutAction(null, form({ affiliateId: ada.id, currency: "USD", method: "cheque", reference: "" }))).ok, false, "unknown method");
    const clash = await updateAffiliateAction(null, form({ id: ada.id, code: "bob", commissionPercent: "25", payoutEmail: "", status: "active" }));
    assert.equal(clash.ok, false);
    const edited = await updateAffiliateAction(null, form({ id: ada.id, code: "ada-vip", commissionPercent: "25", payoutEmail: "Pay@Example.com", status: "active" }));
    assert.ok(edited.ok);
    assert.ok((await setAffiliateStatusAction(ada.id, "paused")).ok);
    const db = await getDb();
    const affiliate = db.affiliates.find((a) => a.id === ada.id);
    assert.deepEqual([affiliate?.code, affiliate?.commissionPercent, affiliate?.payoutEmail, affiliate?.status], ["ADA-VIP", 25, "pay@example.com", "paused"]);
    assert.equal(db.payouts.length, 1);
    const actions = db.auditEvents.map((e) => e.action);
    for (const action of ["affiliate.commissions_approve", "affiliate.payout", "affiliate.update", "affiliate.status"]) assert.ok(actions.includes(action), action);
    assert.ok(db.notifications.some((n) => n.userId === promoter.id && n.subject.startsWith("Payout sent")));
  });

  it("validate bulk selections and program settings", async () => {
    await signIn(admin.id);
    assert.equal((await approveCommissionsAction([])).ok, false);
    assert.equal((await approveCommissionsAction(["../x"])).ok, false);
    assert.equal((await approveCommissionsAction("com_1" as unknown as string[])).ok, false);
    const bad = await saveAffiliateSettingsAction(null, form({ section: "affiliates", defaultCommissionPercent: "120", cookieDays: "0" }));
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys((!bad.ok && bad.fieldErrors) || {}).sort(), ["cookieDays", "defaultCommissionPercent"]);
    const saved = await saveAffiliateSettingsAction(null, form({ section: "affiliates", affiliatesEnabled: "on", defaultCommissionPercent: "12.5", cookieDays: "45" }));
    assert.ok(saved.ok);
    const g = (await getDb()).settings.growth;
    assert.deepEqual([g.affiliatesEnabled, g.affiliateAutoApprove, g.defaultCommissionPercent, g.cookieDays], [true, false, 12.5, 45]);
  });

  it("let members join and change their payout email", async () => {
    await signIn(buyer.id);
    const missing = await applyAffiliateAction(null, form({ payoutEmail: "not-an-email" }));
    assert.equal(missing.ok, false);
    assert.equal((await updatePayoutEmailAction(null, form({ payoutEmail: "me@example.com" }))).ok, false, "not an affiliate yet");
    const joined = await applyAffiliateAction(null, form({ payoutEmail: "", agree: "on" }));
    assert.ok(joined.ok);
    assert.ok((await updatePayoutEmailAction(null, form({ payoutEmail: "Me@Example.com" }))).ok);
    const mine = (await getDb()).affiliates.find((a) => a.userId === buyer.id);
    assert.equal(mine?.status, "active");
    assert.equal(mine?.payoutEmail, "me@example.com");
    resetRequest();
    assert.equal((await applyAffiliateAction(null, form({ agree: "on" }))).ok, false, "signed out");
  });
});
