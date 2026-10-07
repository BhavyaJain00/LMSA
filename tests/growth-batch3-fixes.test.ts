import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Affiliate, AnalyticsEvent, Organization } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { generateRawToken, hashAuthToken } from "@/lib/auth/tokens";
import { REFERRAL_EVENT } from "@/lib/growth/affiliates";
import { REF_COOKIE, formatRefCookie } from "@/lib/growth/affiliates-shared";
import { referralAffiliateIdForCheckout } from "@/lib/growth/attribution";
import {
  JOIN_PROBLEM_MESSAGES,
  acceptInvite,
  adjustSeats,
  createTeam,
  inviteAccountProblem,
  inviteAccountProblemFor,
  requestTeamInvoice,
  resolveSeatsOrder,
  startTeamPurchase,
} from "@/lib/growth/teams";
import { acceptInviteAction } from "@/lib/actions/teams";
import { makeCourse, makeUser, resetDb, type Fixture } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Growth review fixes, batch 3: invitation links only work for the confirmed
 * account of the invited address, abandoned checkout drafts are the only
 * teams ever cleared, and checkout credits the latest click across the
 * browser cookie and the member's linked clicks.
 */

const DAY = 24 * 60 * 60 * 1000;
const VERIFIED = "2026-01-10T00:00:00.000Z";

const admin = makeUser({ id: "usr_b3admin", name: "Grace Admin", email: "grace@example.com", roles: ["admin"] });
const owner = makeUser({ id: "usr_b3owner", name: "Olive Owner", email: "olive@example.com", emailVerifiedAt: VERIFIED });
// Registered on the site (confirmation required) but has not confirmed the address yet.
const squatter = makeUser({ id: "usr_b3squat", name: "Sid Squatter", email: "invitee@example.com", emailVerificationRequired: true });
const confirmed = makeUser({ id: "usr_b3conf", name: "Cora Confirmed", email: "cora@example.com", emailVerificationRequired: true, emailVerifiedAt: VERIFIED });
const promoter = makeUser({ id: "usr_b3ada", name: "Ada Promoter", email: "ada@example.com" });
const rival = makeUser({ id: "usr_b3bob", name: "Bob Rival", email: "bob@example.com" });
const buyer = makeUser({ id: "usr_b3buyer", name: "Bea Buyer", email: "bea@example.com" });

const course = makeCourse({ id: "crs_b3", slug: "team-course", title: "Team Course", paidCourse: true, price: 4900 });
const acme: Organization = { id: "org_b3acme", name: "Acme Corp", slug: "acme-corp", ownerId: owner.id, managerIds: [], seatCount: 3, courseIds: [course.id], createdAt: "2026-02-01T00:00:00.000Z" };

const ada: Affiliate = { id: "aff_b3ada", userId: promoter.id, code: "ADAB3", commissionPercent: 20, status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const bob: Affiliate = { id: "aff_b3bob", userId: rival.id, code: "BOBB3", commissionPercent: 10, status: "active", createdAt: "2026-01-02T00:00:00.000Z" };

async function setup(fixture: Fixture = {}) {
  await resetDb({
    users: [admin, owner, squatter, confirmed, promoter, rival, buyer],
    courses: [course],
    organizations: [acme],
    affiliates: [ada, bob],
    ...fixture,
    settings: { email: { enabled: false }, gamification: { enabled: false }, ...(fixture.settings ?? {}) },
  });
  resetRequest();
}

/** An open invitation to `email` on Acme; returns the raw link token. */
async function invite(email: string): Promise<string> {
  const token = generateRawToken();
  await mutate((d) => {
    d.orgSeats.push({ id: `seat_${d.orgSeats.length + 1}`, orgId: acme.id, email, status: "invited", assignedAt: new Date().toISOString(), inviteTokenHash: hashAuthToken(token) });
  });
  return token;
}

/** The member followed `affiliateId`'s referral link at `atMs` on another device (linked to their account). */
function linkedClick(affiliateId: string, userId: string, atMs: number): AnalyticsEvent {
  return { id: `evt_${affiliateId}_${atMs}`, name: REFERRAL_EVENT, userId, itemType: "affiliate", itemId: affiliateId, createdAt: new Date(atMs).toISOString() };
}

before(() => {
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

describe("invitation links are bound to the confirmed invited address", () => {
  it("refuses an unconfirmed account that registered the invited address, then accepts once it is confirmed", async () => {
    await setup();
    const token = await invite(squatter.email);
    // Whoever holds a forwarded link could register the invitee's address first: the seat waits for confirmation.
    assert.deepEqual(await acceptInvite(token, squatter), { ok: false, problem: "unconfirmed" });
    const db = await getDb();
    assert.equal(db.orgSeats[0].status, "invited");
    assert.equal(db.orgSeats[0].userId, undefined);
    assert.equal(db.enrollments.some((e) => e.userId === squatter.id), false);
    assert.equal(await inviteAccountProblemFor({ email: squatter.email }, squatter.id), "unconfirmed");

    await mutate((d) => {
      const row = d.users.find((u) => u.id === squatter.id);
      if (row) row.emailVerifiedAt = new Date().toISOString();
    });
    assert.equal(await inviteAccountProblemFor({ email: squatter.email }, squatter.id), null);
    const accepted = await acceptInvite(token, squatter);
    assert.ok(accepted.ok);
    assert.equal((await getDb()).orgSeats[0].userId, squatter.id);
  });

  it("explains the refusal from the accept action", async () => {
    await setup();
    const token = await invite(squatter.email);
    resetRequest();
    await createSession(squatter.id);
    const data = new FormData();
    data.append("token", token);
    assert.deepEqual(await acceptInviteAction(null, data), { ok: false, error: JOIN_PROBLEM_MESSAGES.unconfirmed });
  });

  it("checks enabled, address and confirmation in that order", () => {
    const seat = { email: "Cora@Example.com " };
    assert.equal(inviteAccountProblem(seat, undefined), "disabled");
    assert.equal(inviteAccountProblem(seat, { ...confirmed, enabled: false }), "disabled");
    assert.equal(inviteAccountProblem(seat, { ...squatter }), "wrong_account", "a different address never qualifies, confirmed or not");
    assert.equal(inviteAccountProblem(seat, confirmed), null, "same address in another case, confirmed");
    assert.equal(inviteAccountProblem(seat, { ...confirmed, emailVerifiedAt: undefined }), "unconfirmed");
    // Seed and administrator-created accounts never needed confirming.
    assert.equal(inviteAccountProblem(seat, { ...confirmed, emailVerificationRequired: undefined, emailVerifiedAt: undefined }), null);
  });
});

describe("unpaid team cleanup only clears abandoned checkout drafts", () => {
  it("keeps a team waiting for its invoice and a zero-seat team set up by an administrator", async () => {
    await setup({ organizations: [] });
    const started = await startTeamPurchase(owner, { name: "Invoice Co", courseIds: [course.id], seats: 5 });
    assert.ok(started.ok);
    assert.equal(started.org.checkoutDraft, true);
    const resolved = resolveSeatsOrder(await getDb(), started.ref);
    assert.ok(resolved.ok);
    await requestTeamInvoice(owner, resolved.order);
    assert.equal((await getDb()).organizations.find((o) => o.id === started.org.id)?.checkoutDraft, undefined, "an invoice request is not an abandoned checkout");

    const made = await createTeam({ name: "Sponsored Co", ownerEmail: confirmed.email, seatCount: 0, courseIds: [course.id] });
    assert.ok(made.ok);
    assert.equal(made.org.checkoutDraft, undefined);

    const abandoned = await startTeamPurchase(buyer, { name: "Abandoned Co", courseIds: [course.id], seats: 2 });
    assert.ok(abandoned.ok);
    // Two months pass (net-60 terms) for every team.
    const longAgo = new Date(Date.now() - 60 * DAY).toISOString();
    await mutate((d) => {
      for (const org of d.organizations) org.createdAt = longAgo;
    });

    const next = await startTeamPurchase(rival, { name: "Next Co", courseIds: [course.id], seats: 1 });
    assert.ok(next.ok);
    const names = (await getDb()).organizations.map((o) => o.name).sort();
    assert.deepEqual(names, ["Invoice Co", "Next Co", "Sponsored Co"]);
  });

  it("stops treating a checkout draft as abandoned once an administrator adds its seats", async () => {
    await setup({ organizations: [] });
    const started = await startTeamPurchase(owner, { name: "Manual Co", courseIds: [course.id], seats: 3 });
    assert.ok(started.ok);
    const changed = await adjustSeats(started.org.id, 3);
    assert.ok(changed.ok);
    assert.equal(changed.org.checkoutDraft, undefined);
  });
});

describe("checkout credits the latest click across the cookie and linked clicks", () => {
  it("prefers a newer click linked on another device over this browser's older cookie", async () => {
    const now = Date.now();
    await setup({ analyticsEvents: [linkedClick(ada.id, buyer.id, now - DAY)] });
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie(bob.code, now - 20 * DAY) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), ada.id);
  });

  it("prefers this browser's cookie when its click is the newest", async () => {
    const now = Date.now();
    await setup({ analyticsEvents: [linkedClick(ada.id, buyer.id, now - 20 * DAY)] });
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie(bob.code, now - DAY) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), bob.id);
  });

  it("skips a newer linked click whose affiliate is paused or is the buyer", async () => {
    const now = Date.now();
    await setup({
      affiliates: [ada, { ...bob, status: "paused" }],
      analyticsEvents: [linkedClick(bob.id, buyer.id, now - DAY), linkedClick(ada.id, promoter.id, now - DAY)],
    });
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie(ada.code, now - 10 * DAY) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), ada.id, "the paused affiliate's newer click is ignored");
    assert.equal(await referralAffiliateIdForCheckout(promoter.id), undefined, "no self-referral from either source");
  });
});
