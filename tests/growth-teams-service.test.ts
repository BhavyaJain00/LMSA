import { after, afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { Certificate, Organization, OrgSeat } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { generateRawToken, hashAuthToken } from "@/lib/auth/tokens";
import { hasCourseAccess } from "@/lib/commerce/access";
import { emit, settleEvents } from "@/lib/events";
import "@/lib/growth/handlers";
import { seatsCheckoutPath, seatsCheckoutReady } from "@/lib/growth/team-checkout";
import { seatUsage } from "@/lib/growth/teams-shared";
import {
  acceptInvite,
  acceptInviteForSeat,
  addManager,
  adjustSeats,
  applySeatPurchase,
  claimSeat,
  createTeam,
  deleteTeam,
  getManagedTeams,
  getMemberships,
  getTeamHistory,
  getTeamOverview,
  getTeamProgress,
  getTeamsSummary,
  inviteMembers,
  listSeats,
  listTeams,
  lookupInvite,
  pendingInvitesFor,
  reassignSeat,
  removeManager,
  requestTeamInvoice,
  resendInvites,
  resolveSeatsOrder,
  reverseSeatPurchase,
  revokeSeats,
  seatsPurchaseProblem,
  seatsToCsv,
  setTeamCourses,
  startTeamPurchase,
  teamProgressToCsv,
  teamsToCsv,
  transferOwnership,
} from "@/lib/growth/teams";
import {
  acceptInviteAction,
  acceptSeatInviteAction,
  adjustSeatsAction,
  buyMoreSeatsAction,
  claimSeatAction,
  createTeamAction,
  deleteTeamAction,
  inviteMembersAction,
  removeManagerAction,
  renameTeamAction,
  resendInvitesAction,
  revokeSeatsAction,
  saveTeamSettingsAction,
  startTeamPurchaseAction,
  transferOwnershipAction,
} from "@/lib/actions/teams";
import { GET as teamExportGET } from "@/app/(app)/team/export/route";
import { GET as adminExportGET } from "@/app/(app)/admin/teams/export/route";
import { makeCourse, makeCourseTree, makeEnrollment, makePayment, makeProgress, makeUser, resetDb, type Fixture } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Growth, item 2 (teams / B2B seats) against the real store: the purchase
 * hand-off, seats added and removed by orders, invitations with hashed
 * single-use tokens, accepting, revoking and reassigning seats, managers,
 * administration, progress reports, CSV and the permission checks of the
 * server actions and export routes.
 */

const DAY = 24 * 60 * 60 * 1000;
const VERIFIED = "2026-01-10T00:00:00.000Z";

const admin = makeUser({ id: "usr_tadmin", name: "Grace Admin", email: "grace@example.com", roles: ["admin"] });
const owner = makeUser({ id: "usr_towner", name: "Olive Owner", email: "olive@example.com", emailVerifiedAt: VERIFIED });
const manager = makeUser({ id: "usr_tmgr", name: "Max Manager", email: "max@example.com", emailVerifiedAt: VERIFIED });
const ada = makeUser({ id: "usr_tada", name: "Ada Member", email: "ada@example.com", emailVerifiedAt: VERIFIED });
const bob = makeUser({ id: "usr_tbob", name: "Bob Member", email: "bob@example.com" });
const stranger = makeUser({ id: "usr_tout", name: "Sam Stranger", email: "sam@example.org" });

const jsTree = makeCourseTree([[{ id: "les_js1" }, { id: "les_js2" }]], { course: { id: "crs_js", slug: "javascript-basics", title: "JavaScript Basics", paidCourse: true, price: 4900 } });
const js = jsTree.course;
const py = makeCourse({ id: "crs_py", slug: "python", title: "Python", paidCourse: true, price: 2500 });
const free = makeCourse({ id: "crs_free", title: "Git basics" });
const eur = makeCourse({ id: "crs_eur", title: "Rust", paidCourse: true, price: 3000, currency: "EUR" });
const hidden = makeCourse({ id: "crs_hidden", title: "Unreleased", paidCourse: true, price: 1000, published: false });

const acme: Organization = { id: "org_acme", name: "Acme Corp", slug: "acme-corp", ownerId: owner.id, managerIds: [manager.id], seatCount: 3, courseIds: [js.id, py.id], createdAt: "2026-02-01T00:00:00.000Z" };

async function setup(fixture: Fixture = {}) {
  await resetDb({
    users: [admin, owner, manager, ada, bob, stranger],
    courses: [js, py, free, eur, hidden],
    chapters: jsTree.chapters,
    lessons: jsTree.lessons,
    organizations: [acme],
    ...fixture,
    settings: { email: { enabled: false }, gamification: { enabled: false }, ...(fixture.settings ?? {}) },
  });
  resetRequest();
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

function request(path: string): NextRequest {
  const url = `http://localhost:3000${path}`;
  return Object.assign(new Request(url), { nextUrl: new URL(url) }) as unknown as NextRequest;
}

const JOIN_LINK = /\/join\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/** The raw token of the latest invitation emailed to `email` (the store only keeps its hash). */
async function joinToken(email: string): Promise<string> {
  const mails = (await getDb()).emails.filter((m) => m.to === email);
  for (const mail of mails.reverse()) {
    const match = JOIN_LINK.exec(mail.text) ?? JOIN_LINK.exec(mail.html);
    if (match) return match[1];
  }
  throw new Error(`No invitation email was sent to ${email}.`);
}

async function seats(orgId: string = acme.id): Promise<OrgSeat[]> {
  return (await getDb()).orgSeats.filter((s) => s.orgId === orgId);
}

async function seatOf(email: string, orgId: string = acme.id): Promise<OrgSeat> {
  const seat = (await seats(orgId)).filter((s) => s.email === email).pop();
  assert.ok(seat, `seat of ${email}`);
  return seat;
}

async function team(orgId: string = acme.id): Promise<Organization> {
  const org = (await getDb()).organizations.find((o) => o.id === orgId);
  assert.ok(org, `team ${orgId}`);
  return org;
}

async function enrolledCourses(userId: string): Promise<string[]> {
  return (await getDb()).enrollments.filter((e) => e.userId === userId).map((e) => e.courseId).sort();
}

async function subjectsFor(userId: string): Promise<string[]> {
  return (await getDb()).notifications.filter((n) => n.userId === userId).map((n) => n.subject);
}

async function auditActions(): Promise<string[]> {
  return (await getDb()).auditEvents.map((e) => e.action);
}

/** Invite `member` by their account address and accept with the emailed link. */
async function join(member: { id: string; name: string; email: string }, orgId: string = acme.id): Promise<OrgSeat> {
  const invited = await inviteMembers(orgId, owner, [{ email: member.email }]);
  assert.ok(invited.ok && invited.sent === 1, `invite ${member.email}`);
  const accepted = await acceptInvite(await joinToken(member.email), member);
  assert.ok(accepted.ok, `accept ${member.email}`);
  return seatOf(member.email, orgId);
}

function seatsPayment(id: string, ref: string, overrides: Partial<Parameters<typeof makePayment>[0]> = {}) {
  return makePayment({ id, userId: owner.id, itemType: "seats", itemId: ref, itemTitle: "Team seats", status: "paid", paidAt: new Date().toISOString(), amount: 37000, originalAmount: 37000, ...overrides });
}

before(() => {
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());
afterEach(async () => {
  await settleEvents();
});

describe("buying seats", () => {
  it("stores the company and courses as a draft team and prices the order on the server", async () => {
    await setup({ organizations: [] });
    const first = await startTeamPurchase(stranger, { name: "Globex", courseIds: [js.id, py.id, js.id], seats: 4 });
    assert.ok(first.ok);
    assert.deepEqual([first.org.ownerId, first.org.seatCount, first.org.slug, first.org.courseIds], [stranger.id, 0, "globex", [js.id, py.id]]);
    assert.deepEqual([first.quote.unitAmount, first.quote.amount, first.quote.currency], [7400, 29600, "USD"]);
    assert.equal(first.ref, `${first.org.id}-4`);

    const resolved = resolveSeatsOrder(await getDb(), first.ref);
    assert.ok(resolved.ok, "the generated team id fits the checkout reference");
    assert.deepEqual([resolved.order.seats, resolved.order.quote.amount, resolved.order.firstPurchase], [4, 29600, true]);

    // Changing their mind before paying edits the same draft instead of piling up teams.
    const again = await startTeamPurchase(stranger, { name: "Globex Inc", courseIds: [js.id], seats: 2 });
    assert.ok(again.ok);
    assert.equal(again.org.id, first.org.id);
    const db = await getDb();
    assert.equal(db.organizations.length, 1);
    assert.deepEqual([db.organizations[0].name, db.organizations[0].courseIds], ["Globex Inc", [js.id]]);

    const managed = await getManagedTeams(stranger.id);
    assert.deepEqual(managed.map((t) => [t.role, t.draft, t.usage.total]), [["owner", true, 0]]);
    assert.equal((await listTeams({ status: "pending", q: "" })).length, 1);
    assert.equal((await listTeams({ status: "active", q: "" })).length, 0);
    assert.deepEqual([(await getTeamsSummary()).teams, (await getTeamsSummary()).pending], [0, 1]);
  });

  it("does not change a draft that already has an order and clears abandoned drafts", async () => {
    const stale: Organization = { id: "org_stale", name: "Old Draft", slug: "old-draft", ownerId: bob.id, managerIds: [], seatCount: 0, courseIds: [js.id], createdAt: new Date(Date.now() - 45 * DAY).toISOString() };
    await setup({ organizations: [stale] });
    const first = await startTeamPurchase(stranger, { name: "Globex", courseIds: [js.id], seats: 4 });
    assert.ok(first.ok);
    await mutate((d) => {
      d.payments.push(seatsPayment("pay_open", first.ref, { userId: stranger.id, status: "pending", paidAt: undefined }));
    });
    const second = await startTeamPurchase(stranger, { name: "Globex Labs", courseIds: [py.id], seats: 1 });
    assert.ok(second.ok);
    assert.notEqual(second.org.id, first.org.id);
    const db = await getDb();
    assert.deepEqual(db.organizations.map((o) => o.name).sort(), ["Globex", "Globex Labs"], "the 45-day-old unpaid draft is gone");
    assert.deepEqual(db.organizations.find((o) => o.id === first.org.id)?.courseIds, [js.id]);
    assert.equal(second.org.slug, "globex-labs");
  });

  it("refuses courses that cannot be sold as seats", async () => {
    await setup({ organizations: [] });
    const attempt = (courseIds: string[], seatsWanted = 3) => startTeamPurchase(stranger, { name: "Globex", courseIds, seats: seatsWanted });
    for (const [label, ids] of [["free", [free.id]], ["unpublished", [js.id, hidden.id]], ["unknown", ["crs_nope"]], ["none", []]] as const) {
      const result = await attempt([...ids]);
      assert.ok(!result.ok, label);
      assert.equal(result.field, "courseIds", label);
    }
    const mixed = await attempt([js.id, eur.id]);
    assert.ok(!mixed.ok);
    assert.match(mixed.error, /currenc/i);
    const tooMany = await attempt([js.id], 501);
    assert.ok(!tooMany.ok);
    assert.equal(tooMany.field, "seats");
    assert.equal((await getDb()).organizations.length, 0);
  });

  it("is closed while team purchases are off", async () => {
    await setup({ organizations: [acme], settings: { growth: { teamsEnabled: false } } });
    const result = await startTeamPurchase(stranger, { name: "Globex", courseIds: [js.id], seats: 2 });
    assert.equal(result.ok, false);
    const db = await getDb();
    const order = resolveSeatsOrder(db, "org_acme-2");
    assert.ok(order.ok);
    assert.match(seatsPurchaseProblem(db, owner, order.order) ?? "", /not available/);
  });

  it("resolves a checkout reference for the team's managers only", async () => {
    await setup({ organizations: [acme, { ...acme, id: "org_big", slug: "big", name: "Big Co", seatCount: 9990 }] });
    const db = await getDb();
    const resolved = resolveSeatsOrder(db, "org_acme-5");
    assert.ok(resolved.ok);
    const { order } = resolved;
    assert.deepEqual([order.ref, order.seats, order.quote.unitAmount, order.quote.amount, order.firstPurchase], ["org_acme-5", 5, 7400, 37000, false]);
    assert.equal(order.title, "5 team seats · Acme Corp");
    assert.match(order.description, /^\$74\.00 per seat · 2 courses$/);
    const single = resolveSeatsOrder(db, "org_acme-1");
    assert.ok(single.ok);
    assert.equal(single.order.title, "1 team seat · Acme Corp");

    assert.equal(seatsPurchaseProblem(db, owner, order), null);
    assert.equal(seatsPurchaseProblem(db, manager, order), null);
    assert.equal(seatsPurchaseProblem(db, admin, order), null);
    assert.match(seatsPurchaseProblem(db, stranger, order) ?? "", /Only the managers/);

    assert.equal(resolveSeatsOrder(db, "org_nope-5").ok, false);
    assert.equal(resolveSeatsOrder(db, "org_acme-0").ok, false);
    assert.equal(resolveSeatsOrder(db, "org_acme").ok, false);
    const overflow = resolveSeatsOrder(db, "org_big-20");
    assert.ok(!overflow.ok);
    assert.match(overflow.error, /at most/);
    assert.equal(seatsCheckoutPath("org_acme-5"), "/billing/seats/org_acme-5");
  });

  it("cannot price a team whose courses are gone or free", async () => {
    await setup({ organizations: [{ ...acme, courseIds: [free.id, "crs_deleted"] }] });
    assert.equal(resolveSeatsOrder(await getDb(), "org_acme-2").ok, false);
    assert.equal((await getTeamOverview(acme.id))?.seatPrice, null);
  });

  it("passes an invoice request to the administrators once a day", async () => {
    await setup();
    const resolved = resolveSeatsOrder(await getDb(), "org_acme-5");
    assert.ok(resolved.ok);
    await requestTeamInvoice(owner, resolved.order);
    await requestTeamInvoice(owner, resolved.order);
    const db = await getDb();
    const notes = db.notifications.filter((n) => n.userId === admin.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].subject, "Acme Corp asked for an invoice for 5 team seats");
    assert.equal(notes[0].link, "/admin/teams/org_acme");
    assert.match(notes[0].message, /olive@example\.com/);
    const entry = db.auditEvents.find((e) => e.action === "team.invoice_request");
    assert.deepEqual([entry?.targetId, entry?.meta?.seats, entry?.meta?.amount], [acme.id, 5, 37000]);
  });
});

describe("orders", () => {
  const paidEvent = (paymentId: string, itemId: string, userId: string) => ({
    paymentId,
    orderId: `ORD-${paymentId.toUpperCase()}`,
    userId,
    itemType: "seats" as const,
    itemId,
    itemTitle: "Team seats",
    amount: 37000,
    taxAmount: 0,
    discountAmount: 0,
    currency: "USD",
    gateway: "stripe",
  });

  it("add the seats when the order is paid and make the buyer a manager", async () => {
    await setup({ organizations: [{ ...acme, seatCount: 0, managerIds: [] }], payments: [seatsPayment("pay_first", "org_acme-5", { userId: stranger.id })] });
    assert.equal((await getTeamOverview(acme.id))?.draft, false, "a paid order already counts");
    emit("payment.paid", paidEvent("pay_first", "org_acme-5", stranger.id));
    await settleEvents();

    const org = await team();
    assert.equal(org.seatCount, 5);
    assert.deepEqual(org.managerIds, [stranger.id]);
    const payment = (await getDb()).payments.find((p) => p.id === "pay_first");
    assert.deepEqual([payment?.orgId, payment?.seats], [acme.id, 5]);
    assert.ok((await subjectsFor(owner.id)).includes("Your team Acme Corp is ready"));
    assert.ok((await subjectsFor(stranger.id)).includes("Your team Acme Corp is ready"));
    const ready = (await getDb()).notifications.find((n) => n.userId === owner.id && n.subject === "Your team Acme Corp is ready");
    assert.match(ready?.message ?? "", /^5 seats are waiting\./);
    assert.equal(ready?.link, "/team?org=acme-corp");
    const entry = (await getDb()).auditEvents.find((e) => e.action === "team.seats_purchase");
    assert.deepEqual([entry?.actorId, entry?.targetId, entry?.meta?.seats, entry?.meta?.seatCount], [stranger.id, acme.id, 5, 5]);
  });

  it("add more seats to a team that already has some", async () => {
    await setup({ payments: [seatsPayment("pay_more", "org_acme-2")] });
    const outcome = await applySeatPurchase("pay_more");
    assert.ok(outcome.applied);
    assert.deepEqual([outcome.seats, outcome.first, outcome.org.seatCount], [2, false, 5]);
    assert.deepEqual((await team()).managerIds, [manager.id], "the owner is not listed as a manager too");
    const note = (await getDb()).notifications.find((n) => n.userId === manager.id);
    assert.deepEqual([note?.subject, note?.message], ["2 seats added to Acme Corp", "The team now has 5 seats. Invite more members whenever you're ready."]);
  });

  it("read the team and seat count from the order's own fields when the checkout stamps them", async () => {
    await setup({ payments: [seatsPayment("pay_stamped", "org_acme", { orgId: acme.id, seats: 4 })] });
    const outcome = await applySeatPurchase("pay_stamped");
    assert.ok(outcome.applied);
    assert.equal((await team()).seatCount, 7);
  });

  it("ignore orders that are not paid seats orders, and flag a paid order whose team is gone", async () => {
    await setup({
      payments: [
        makePayment({ id: "pay_course", userId: owner.id, itemId: js.id, status: "paid" }),
        seatsPayment("pay_pending", "org_acme-2", { status: "pending", paidAt: undefined }),
        seatsPayment("pay_orphan", "org_gone-2"),
      ],
    });
    assert.deepEqual(await applySeatPurchase("pay_course"), { applied: false, reason: "not_seats" });
    assert.deepEqual(await applySeatPurchase("pay_missing"), { applied: false, reason: "not_seats" });
    assert.deepEqual(await applySeatPurchase("pay_pending"), { applied: false, reason: "not_paid" });
    assert.deepEqual(await applySeatPurchase("pay_orphan"), { applied: false, reason: "no_team" });
    await applySeatPurchase("pay_orphan");
    assert.equal((await team()).seatCount, 3);
    const notes = (await getDb()).notifications.filter((n) => n.userId === admin.id);
    assert.equal(notes.length, 1, "administrators are told once");
    assert.match(notes[0].subject, /ORD-PAY_ORPHAN paid for team seats, but the team no longer exists/);
  });

  it("take the seats back on a full refund: invitations first, then the newest members", async () => {
    const seat = (id: string, email: string, status: OrgSeat["status"], assignedAt: string, extra: Partial<OrgSeat> = {}): OrgSeat => ({ id, orgId: acme.id, email, status, assignedAt, ...extra });
    await setup({
      orgSeats: [
        seat("seat_ada", ada.email, "active", "2026-03-01T00:00:00.000Z", { userId: ada.id, activatedAt: "2026-03-02T00:00:00.000Z" }),
        seat("seat_bob", bob.email, "active", "2026-03-01T00:00:00.000Z", { userId: bob.id, activatedAt: "2026-04-02T00:00:00.000Z" }),
        seat("seat_carol", "carol@example.com", "invited", new Date().toISOString(), { inviteTokenHash: hashAuthToken(generateRawToken()) }),
      ],
      enrollments: [
        makeEnrollment({ userId: ada.id, courseId: js.id, enrolledAt: "2026-03-02T00:00:01.000Z" }),
        makeEnrollment({ userId: bob.id, courseId: js.id, enrolledAt: "2026-04-02T00:00:01.000Z" }),
        makeEnrollment({ userId: bob.id, courseId: py.id, enrolledAt: "2026-04-02T00:00:01.000Z", completedAt: "2026-05-01T00:00:00.000Z", progress: 100 }),
      ],
      payments: [seatsPayment("pay_refund", "org_acme-2", { status: "refunded", refundedAmount: 37000 })],
    });
    const refund = { paymentId: "pay_refund", orderId: "ORD-PAY_REFUND", userId: owner.id, itemType: "seats" as const, itemId: "org_acme-2", amount: 37000, refundedAmount: 37000, currency: "USD" };

    assert.deepEqual(await reverseSeatPurchase({ ...refund, refundedAmount: 1000, full: false }), { removed: 0, revoked: 0 }, "partial refunds keep the seats");
    assert.equal((await team()).seatCount, 3);

    emit("payment.refunded", { ...refund, full: true });
    await settleEvents();
    assert.equal((await team()).seatCount, 1);
    assert.deepEqual((await seats()).map((s) => [s.id, s.status]), [["seat_ada", "active"], ["seat_bob", "revoked"], ["seat_carol", "revoked"]]);
    assert.deepEqual(await enrolledCourses(ada.id), [js.id]);
    assert.deepEqual(await enrolledCourses(bob.id), [py.id], "the unfinished course goes, the finished one stays");
    assert.ok((await subjectsFor(bob.id)).includes("Your seat in the Acme Corp team was removed"));
    assert.ok((await subjectsFor(owner.id)).includes("2 seats removed from Acme Corp after a refund"));
    const entry = (await getDb()).auditEvents.find((e) => e.action === "team.seats_refund");
    assert.deepEqual([entry?.meta?.removed, entry?.meta?.revoked, entry?.meta?.seatCount], [2, 2, 1]);
  });

  it("leave the team alone when the order is not refunded", async () => {
    await setup({ payments: [seatsPayment("pay_kept", "org_acme-2")] });
    const result = await reverseSeatPurchase({ paymentId: "pay_kept", orderId: "ORD-PAY_KEPT", userId: owner.id, itemType: "seats", itemId: "org_acme-2", amount: 37000, refundedAmount: 37000, currency: "USD", full: true });
    assert.deepEqual(result, { removed: 0, revoked: 0 });
    assert.equal((await team()).seatCount, 3);
  });
});

describe("invitations", () => {
  it("assign a seat per address, keep only the token hash and email a personal link", async () => {
    await setup();
    const result = await inviteMembers(acme.id, owner, [{ email: ada.email, name: "Ada" }, { email: "new@example.com" }]);
    assert.deepEqual(result, { ok: true, sent: 2, skipped: [] });

    const db = await getDb();
    assert.equal(db.orgSeats.length, 2);
    for (const seat of db.orgSeats) {
      assert.equal(seat.status, "invited");
      assert.equal(seat.userId, undefined);
      assert.match(seat.inviteTokenHash ?? "", /^[0-9a-f]{64}$/);
    }
    const token = await joinToken(ada.email);
    const seat = await seatOf(ada.email);
    assert.equal(hashAuthToken(token), seat.inviteTokenHash);
    assert.ok(!JSON.stringify(db.orgSeats).includes(token), "the raw token is not stored with the seat");
    assert.notEqual(token, await joinToken("new@example.com"));

    const mail = db.emails.find((m) => m.to === ada.email && JOIN_LINK.test(m.text));
    assert.ok(mail);
    assert.match(mail.subject, /^Olive Owner invited you to join Acme Corp on /);
    assert.ok(mail.text.includes("JavaScript Basics") && mail.text.includes("Python"));
    assert.equal(mail.userId, ada.id, "linked to the confirmed account");

    assert.ok((await subjectsFor(ada.id)).includes("Olive Owner invited you to the Acme Corp team"));
    assert.deepEqual((await pendingInvitesFor(ada)).map((i) => [i.seatId, i.team.name, i.courses.length]), [[seat.id, "Acme Corp", 2]]);
    assert.deepEqual(seatUsage(await team(), await seats()), { total: 3, active: 0, invited: 2, used: 2, available: 1, over: 0 });
  });

  it("skip people who already hold a seat and stop when the seats run out", async () => {
    await setup();
    await join(ada);
    const result = await inviteMembers(acme.id, manager, [{ email: ada.email }, { email: "one@example.com" }, { email: "two@example.com" }, { email: "three@example.com" }]);
    assert.ok(result.ok);
    assert.equal(result.sent, 2);
    assert.deepEqual(result.skipped, [
      { email: ada.email, reason: "already_member" },
      { email: "three@example.com", reason: "no_seats" },
    ]);
    const again = await inviteMembers(acme.id, manager, [{ email: "one@example.com" }]);
    assert.deepEqual(again, { ok: true, sent: 0, skipped: [{ email: "one@example.com", reason: "already_invited" }] });
    assert.equal((await seats()).length, 3);
  });

  it("recognise a member by their account address when they were invited at another one", async () => {
    await setup();
    const invited = await inviteMembers(acme.id, owner, [{ email: "ada.work@example.com" }]);
    assert.ok(invited.ok);
    assert.ok((await acceptInvite(await joinToken("ada.work@example.com"), ada)).ok);
    const result = await inviteMembers(acme.id, owner, [{ email: ada.email }]);
    assert.deepEqual(result, { ok: true, sent: 0, skipped: [{ email: ada.email, reason: "already_member" }] });
  });

  it("cap how many invitations a team can send in a day", async () => {
    const recent = new Date().toISOString();
    const spent: OrgSeat[] = Array.from({ length: 50 }, (_, i) => ({ id: `seat_spent${i}`, orgId: acme.id, email: `spent${i}@example.com`, status: "revoked", assignedAt: recent }));
    await setup({ orgSeats: spent });
    const result = await inviteMembers(acme.id, owner, [{ email: "one@example.com" }]);
    assert.ok(!result.ok);
    assert.match(result.error, /a lot of invitations today/);
    assert.equal((await seats()).length, 50);
    assert.equal((await inviteMembers("org_gone", owner, [{ email: "one@example.com" }])).ok, false);
  });

  it("send an invitation again with a fresh link, not more often than once a minute", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: ada.email }]);
    const first = await joinToken(ada.email);
    const seat = await seatOf(ada.email);
    assert.deepEqual(await resendInvites(acme.id, [seat.id], owner), { sent: 0, tooSoon: 1 });

    // Forty days later the link has expired; sending again revives the invitation.
    await mutate((d) => {
      const row = d.orgSeats.find((s) => s.id === seat.id);
      if (row) row.assignedAt = new Date(Date.now() - 40 * DAY).toISOString();
    });
    assert.deepEqual((await lookupInvite(first)).ok ? "ok" : (await lookupInvite(first)), { ok: false, problem: "expired", teamName: "Acme Corp", memberId: undefined });
    assert.equal((await listSeats(acme.id, { status: "expired", q: "" })).length, 1);
    assert.deepEqual(await pendingInvitesFor(ada), []);

    assert.deepEqual(await resendInvites(acme.id, [seat.id, "seat_unknown"], owner), { sent: 1, tooSoon: 0 });
    const second = await joinToken(ada.email);
    assert.notEqual(second, first);
    assert.deepEqual(await acceptInvite(first, ada), { ok: false, problem: "invalid" }, "the earlier link stopped working");
    assert.ok((await acceptInvite(second, ada)).ok);
    assert.deepEqual(await resendInvites(acme.id, [seat.id], owner), { sent: 0, tooSoon: 0 }, "accepted invitations are not sent again");
  });
});

describe("accepting an invitation", () => {
  it("binds the seat to the account and enrolls it in the team's courses", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: ada.email }]);
    const token = await joinToken(ada.email);

    const lookup = await lookupInvite(token);
    assert.ok(lookup.ok);
    assert.deepEqual([lookup.invite.email, lookup.invite.team.name, lookup.invite.courses.map((c) => c.slug)], [ada.email, "Acme Corp", ["javascript-basics", "python"]]);

    const accepted = await acceptInvite(token, ada);
    assert.ok(accepted.ok);
    assert.deepEqual([accepted.team.id, accepted.courses.map((c) => c.id)], [acme.id, [js.id, py.id]]);
    const seat = await seatOf(ada.email);
    assert.deepEqual([seat.status, seat.userId, !!seat.activatedAt], ["active", ada.id, true]);
    assert.deepEqual(await enrolledCourses(ada.id), [js.id, py.id]);
    assert.equal(await hasCourseAccess(ada, js.id), true);
    assert.equal(await hasCourseAccess(bob, js.id), false);
    for (const id of [owner.id, manager.id]) assert.ok((await subjectsFor(id)).includes("Ada Member joined the Acme Corp team"));
    assert.deepEqual((await getMemberships(ada.id)).map((m) => [m.team.name, m.courses.map((c) => c.id)]), [["Acme Corp", [js.id, py.id]]]);

    // Single use.
    assert.deepEqual(await acceptInvite(token, bob), { ok: false, problem: "used" });
    assert.deepEqual(await lookupInvite(token), { ok: false, problem: "used", teamName: "Acme Corp", memberId: ada.id });
    assert.deepEqual(await enrolledCourses(bob.id), []);
  });

  it("gives the seat to whoever holds the emailed link, even under another address", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: "someone@example.com" }]);
    assert.ok((await acceptInvite(await joinToken("someone@example.com"), stranger)).ok);
    const seat = await seatOf("someone@example.com");
    assert.deepEqual([seat.userId, seat.email], [stranger.id, "someone@example.com"]);
    const [row] = await listSeats(acme.id, { status: "active", q: "sam" });
    assert.deepEqual([row.user?.email, row.email, row.state, row.role], [stranger.email, "someone@example.com", "active", null]);
  });

  it("refuses malformed, unknown, expired and cancelled links", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: ada.email }, { email: bob.email }]);
    const adaToken = await joinToken(ada.email);
    assert.deepEqual(await acceptInvite("short", ada), { ok: false, problem: "invalid" });
    assert.deepEqual(await acceptInvite(generateRawToken(), ada), { ok: false, problem: "invalid" });
    assert.deepEqual(await lookupInvite(`${adaToken}x`), { ok: false, problem: "invalid", teamName: undefined, memberId: undefined });

    const later = new Date(Date.now() + 31 * DAY);
    assert.deepEqual(await acceptInvite(adaToken, ada, later), { ok: false, problem: "expired" });
    assert.equal((await lookupInvite(adaToken, later)).ok, false);

    const bobToken = await joinToken(bob.email);
    assert.deepEqual(await revokeSeats(acme.id, [(await seatOf(bob.email)).id]), { revoked: 1, members: 0 });
    assert.deepEqual(await acceptInvite(bobToken, bob), { ok: false, problem: "revoked" });
    assert.deepEqual(await subjectsFor(bob.id), [], "cancelling an invitation notifies nobody");

    await mutate((d) => {
      const account = d.users.find((u) => u.id === ada.id);
      if (account) account.enabled = false;
    });
    assert.deepEqual(await acceptInvite(adaToken, ada), { ok: false, problem: "disabled" });
    assert.deepEqual(await enrolledCourses(ada.id), []);
    assert.deepEqual((await seats()).map((s) => s.status).sort(), ["invited", "revoked"]);
  });

  it("never gives one person two seats or more members than seats", async () => {
    const spare = generateRawToken();
    await setup({
      organizations: [{ ...acme, seatCount: 1 }],
      orgSeats: [
        { id: "seat_bob", orgId: acme.id, email: bob.email, userId: bob.id, status: "active", assignedAt: VERIFIED, activatedAt: VERIFIED },
        { id: "seat_spare", orgId: acme.id, email: "spare@example.com", status: "invited", assignedAt: new Date().toISOString(), inviteTokenHash: hashAuthToken(spare) },
      ],
    });
    assert.deepEqual(await acceptInvite(spare, bob), { ok: false, problem: "already_member" });
    assert.deepEqual(await acceptInvite(spare, ada), { ok: false, problem: "full" }, "seats were removed after the invitation went out");
    assert.equal((await seatOf("spare@example.com")).status, "invited");
  });

  it("can be done in the app by the account whose confirmed address was invited", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: ada.email }, { email: bob.email }]);
    const adaSeat = await seatOf(ada.email);
    const bobSeat = await seatOf(bob.email);
    assert.deepEqual(await acceptInviteForSeat(adaSeat.id, stranger), { ok: false, problem: "invalid" });
    assert.deepEqual(await acceptInviteForSeat(bobSeat.id, bob), { ok: false, problem: "invalid" }, "an unconfirmed address proves nothing");
    assert.deepEqual(await pendingInvitesFor(bob), []);
    assert.deepEqual(await acceptInviteForSeat(bobSeat.id, { ...ada, email: bob.email }), { ok: false, problem: "invalid" }, "the address is read from the stored account, not from the caller");
    const accepted = await acceptInviteForSeat(adaSeat.id, ada);
    assert.ok(accepted.ok);
    assert.equal((await seatOf(ada.email)).userId, ada.id);
  });
});

describe("revoking and reassigning seats", () => {
  it("frees the seat and removes only the access the seat gave", async () => {
    await setup({
      payments: [makePayment({ id: "pay_own", userId: ada.id, itemId: py.id, itemTitle: "Python", status: "paid", amount: 2500, originalAmount: 2500 })],
      enrollments: [makeEnrollment({ userId: ada.id, courseId: py.id, paymentId: "pay_own", enrolledAt: "2020-01-01T00:00:00.000Z" })],
    });
    const seat = await join(ada);
    await mutate((d) => {
      d.progress.push(makeProgress(jsTree.lessons[0], ada.id));
    });
    assert.deepEqual(await enrolledCourses(ada.id), [js.id, py.id]);

    assert.deepEqual(await revokeSeats(acme.id, [seat.id, "seat_unknown"]), { revoked: 1, members: 1 });
    const db = await getDb();
    assert.equal(db.orgSeats.find((s) => s.id === seat.id)?.status, "revoked");
    assert.deepEqual(await enrolledCourses(ada.id), [py.id], "the course she bought herself stays");
    assert.equal(db.progress.filter((p) => p.userId === ada.id).length, 0);
    assert.equal(await hasCourseAccess(ada, js.id), false);
    assert.ok((await subjectsFor(ada.id)).includes("Your seat in the Acme Corp team was removed"));
    assert.equal(seatUsage(await team(), await seats()).available, 3);
    assert.deepEqual(await getMemberships(ada.id), []);
    assert.deepEqual(await revokeSeats(acme.id, [seat.id]), { revoked: 0, members: 0 });
    assert.deepEqual(await revokeSeats("org_gone", [seat.id]), { revoked: 0, members: 0 });
  });

  it("keeps finished courses and courses covered by a seat in another team", async () => {
    const other: Organization = { id: "org_other", name: "Other Team", slug: "other-team", ownerId: owner.id, managerIds: [], seatCount: 2, courseIds: [js.id], createdAt: VERIFIED };
    await setup({ organizations: [acme, other] });
    const seat = await join(ada);
    await join(ada, other.id);
    await join({ ...bob }, acme.id);
    await mutate((d) => {
      const done = d.enrollments.find((e) => e.userId === bob.id && e.courseId === py.id);
      if (done) Object.assign(done, { progress: 100, completedAt: new Date().toISOString() });
    });

    await revokeSeats(acme.id, [seat.id, (await seatOf(bob.email)).id]);
    assert.deepEqual(await enrolledCourses(ada.id), [js.id], "JavaScript is still covered by the other team");
    assert.deepEqual(await enrolledCourses(bob.id), [py.id], "the finished course stays");
    // A team cannot take away a seat of another team.
    assert.deepEqual(await revokeSeats(acme.id, [(await seatOf(ada.email, other.id)).id]), { revoked: 0, members: 0 });
  });

  it("moves a seat to someone else in one step", async () => {
    await setup({ organizations: [{ ...acme, seatCount: 1 }] });
    const seat = await join(ada);
    const result = await reassignSeat(acme.id, seat.id, { email: "new@example.com", name: "New Hire" }, manager);
    assert.deepEqual(result, { ok: true, from: ada.email, to: "new@example.com" });
    assert.deepEqual((await seats()).map((s) => [s.email, s.status]), [[ada.email, "revoked"], ["new@example.com", "invited"]]);
    assert.deepEqual(await enrolledCourses(ada.id), []);
    assert.ok((await subjectsFor(ada.id)).includes("Your seat in the Acme Corp team was removed"));
    assert.ok((await acceptInvite(await joinToken("new@example.com"), stranger)).ok, "the team was full, the seat moved anyway");
    assert.deepEqual(seatUsage(await team(), await seats()), { total: 1, active: 1, invited: 0, used: 1, available: 0, over: 0 });
  });

  it("refuses to move a seat to its own holder, to a member or from a revoked seat", async () => {
    await setup();
    const adaSeat = await join(ada);
    await inviteMembers(acme.id, owner, [{ email: bob.email }]);
    const bobSeat = await seatOf(bob.email);
    const same = await reassignSeat(acme.id, bobSeat.id, { email: bob.email }, owner);
    assert.ok(!same.ok);
    assert.match(same.error, /already assigned to that address/);
    const member = await reassignSeat(acme.id, bobSeat.id, { email: ada.email }, owner);
    assert.ok(!member.ok);
    assert.match(member.error, /already on the team/);
    const invited = await reassignSeat(acme.id, adaSeat.id, { email: bob.email }, owner);
    assert.ok(!invited.ok);
    assert.match(invited.error, /already has an invitation/);
    await revokeSeats(acme.id, [bobSeat.id]);
    assert.equal((await reassignSeat(acme.id, bobSeat.id, { email: "x@example.com" }, owner)).ok, false);
    assert.equal((await reassignSeat("org_gone", adaSeat.id, { email: "x@example.com" }, owner)).ok, false);
    assert.deepEqual((await seats()).map((s) => s.status), ["active", "revoked"]);
  });

  it("lets a manager take a free seat, or the invitation sent to their own address", async () => {
    await setup({ organizations: [{ ...acme, seatCount: 2 }] });
    const claimed = await claimSeat(acme.id, owner);
    assert.deepEqual(claimed, { ok: true, team: { id: acme.id, name: "Acme Corp" } });
    assert.deepEqual(await enrolledCourses(owner.id), [js.id, py.id]);
    const again = await claimSeat(acme.id, owner);
    assert.ok(!again.ok);
    assert.match(again.error, /already have a seat/);

    await inviteMembers(acme.id, owner, [{ email: manager.email }]);
    assert.ok((await claimSeat(acme.id, manager)).ok, "the open invitation becomes the seat although no other seat is free");
    assert.deepEqual((await seats()).map((s) => [s.email, s.status, s.userId]), [[owner.email, "active", owner.id], [manager.email, "active", manager.id]]);
    const full = await claimSeat(acme.id, ada);
    assert.ok(!full.ok);
    assert.match(full.error, /Every seat is assigned/);
    const [first] = await listSeats(acme.id, { status: "current", q: "" });
    assert.deepEqual([first.user?.name, first.role], ["Max Manager", "manager"], "members sort by name");
  });
});

describe("owner and managers", () => {
  it("adds and removes managers by account email", async () => {
    await setup();
    const added = await addManager(acme.id, ada.email, owner);
    assert.ok(added.ok);
    assert.deepEqual((await team()).managerIds, [manager.id, ada.id]);
    assert.ok((await subjectsFor(ada.id)).includes("You can now manage the Acme Corp team"));
    assert.deepEqual((await getManagedTeams(ada.id)).map((t) => [t.org.id, t.role, t.draft]), [[acme.id, "manager", false]]);

    for (const email of [ada.email, owner.email, "nobody@example.com"]) assert.equal((await addManager(acme.id, email, owner)).ok, false, email);
    assert.ok((await removeManager(acme.id, ada.id)).ok);
    assert.equal((await removeManager(acme.id, ada.id)).ok, false);
    assert.equal((await removeManager(acme.id, owner.id)).ok, false, "the owner is not a removable manager");
    assert.deepEqual((await team()).managerIds, [manager.id]);
  });

  it("hands the team to another account and keeps the previous owner as a manager", async () => {
    await setup();
    const result = await transferOwnership(acme.id, manager.email, owner);
    assert.ok(result.ok);
    const org = await team();
    assert.deepEqual([org.ownerId, org.managerIds], [manager.id, [owner.id]]);
    assert.ok((await subjectsFor(manager.id)).includes("You now own the Acme Corp team"));
    assert.equal((await transferOwnership(acme.id, manager.email, owner)).ok, false, "already the owner");
    assert.equal((await transferOwnership(acme.id, "nobody@example.com", owner)).ok, false);
  });
});

describe("administration", () => {
  it("sets the seat count, never below the seats in use, and tells the managers", async () => {
    await setup();
    await join(ada);
    const raised = await adjustSeats(acme.id, 10);
    assert.ok(raised.ok);
    assert.deepEqual([raised.data.previous, raised.org.seatCount], [3, 10]);
    const note = (await getDb()).notifications.find((n) => n.userId === manager.id && n.subject.includes("added"));
    assert.deepEqual([note?.subject, note?.message], ["7 seats added to Acme Corp", "The team now has 10 seats."]);

    const lowered = await adjustSeats(acme.id, 1);
    assert.ok(lowered.ok);
    assert.ok((await subjectsFor(owner.id)).includes("9 seats removed from Acme Corp"));
    const tooLow = await adjustSeats(acme.id, 0);
    assert.ok(!tooLow.ok);
    assert.match(tooLow.error, /^1 seat is in use\./);
    assert.equal((await team()).seatCount, 1);
    const before = (await getDb()).notifications.length;
    assert.ok((await adjustSeats(acme.id, 1)).ok);
    assert.equal((await getDb()).notifications.length, before, "no notice when nothing changed");
  });

  it("changes a team's courses: members join the new ones and keep the old", async () => {
    await setup();
    await join(ada);
    const result = await setTeamCourses(acme.id, [py.id, free.id, free.id, "crs_nope"]);
    assert.ok(result.ok);
    assert.deepEqual(result.data, { added: [free.id], removed: [js.id] });
    assert.deepEqual((await team()).courseIds, [py.id, free.id]);
    assert.deepEqual(await enrolledCourses(ada.id), [free.id, js.id, py.id]);
    assert.equal((await setTeamCourses(acme.id, ["crs_nope"])).ok, false, "a team needs a course");
    assert.equal((await setTeamCourses(acme.id, Array.from({ length: 26 }, (_, i) => `crs_${i}`))).ok, false);
  });

  it("creates a team without an order and deletes one with its seats", async () => {
    await setup();
    const created = await createTeam({ name: "Initech", ownerEmail: stranger.email, seatCount: 4, courseIds: [js.id, "crs_nope"] });
    assert.ok(created.ok);
    assert.deepEqual([created.org.slug, created.org.ownerId, created.org.seatCount, created.org.courseIds], ["initech", stranger.id, 4, [js.id]]);
    const welcome = (await getDb()).notifications.find((n) => n.userId === stranger.id);
    assert.deepEqual([welcome?.subject, welcome?.message.slice(0, 20)], ["Your team Initech is ready", "4 seats are waiting."]);
    assert.equal((await createTeam({ name: "Initech", ownerEmail: "nobody@example.com", seatCount: 4, courseIds: [js.id] })).ok, false);
    assert.equal((await createTeam({ name: "Initech", ownerEmail: stranger.email, seatCount: 4, courseIds: [] })).ok, false);
    const twin = await createTeam({ name: "Initech", ownerEmail: stranger.email, seatCount: 0, courseIds: [js.id] });
    assert.ok(twin.ok);
    assert.equal(twin.org.slug, "initech-2");

    await join(ada);
    await inviteMembers(acme.id, owner, [{ email: bob.email }]);
    const deleted = await deleteTeam(acme.id);
    assert.deepEqual(deleted, { ok: true, name: "Acme Corp", revoked: 2 });
    const db = await getDb();
    assert.equal(db.organizations.some((o) => o.id === acme.id), false);
    assert.equal(db.orgSeats.length, 0);
    assert.deepEqual(await enrolledCourses(ada.id), []);
    assert.ok((await subjectsFor(ada.id)).includes("Your seat in the Acme Corp team was removed"));
    assert.equal((await deleteTeam(acme.id)).ok, false);
    assert.deepEqual(await acceptInvite(await joinToken(bob.email), bob), { ok: false, problem: "invalid" });
  });

  it("lists teams with usage, revenue and status filters", async () => {
    const globex: Organization = { id: "org_globex", name: "Globex", slug: "globex", ownerId: stranger.id, managerIds: [], seatCount: 1, courseIds: [js.id], createdAt: "2026-03-01T00:00:00.000Z" };
    const draft: Organization = { id: "org_draft", name: "Hooli", slug: "hooli", ownerId: bob.id, managerIds: [], seatCount: 0, courseIds: [js.id], createdAt: "2026-04-01T00:00:00.000Z" };
    await setup({
      organizations: [acme, globex, draft],
      orgSeats: [{ id: "seat_g", orgId: globex.id, email: ada.email, userId: ada.id, status: "active", assignedAt: VERIFIED, activatedAt: VERIFIED }],
      payments: [
        seatsPayment("pay_a1", "org_acme-3", { amount: 22200 }),
        seatsPayment("pay_a2", "org_acme-1", { amount: 7400, refundedAmount: 1400 }),
        seatsPayment("pay_g", "org_globex-1", { amount: 4900, userId: stranger.id }),
        seatsPayment("pay_d", "org_draft-2", { status: "pending", paidAt: undefined, userId: bob.id }),
      ],
    });
    const all = await listTeams({ status: "all", q: "" });
    assert.deepEqual(all.map((r) => [r.org.name, r.draft, r.openOrders]), [["Globex", false, 0], ["Acme Corp", false, 0], ["Hooli", true, 1]]);
    assert.deepEqual(all[1].paid, [{ currency: "USD", amount: 28200 }]);
    assert.deepEqual((await listTeams({ status: "full", q: "" })).map((r) => r.org.name), ["Globex"]);
    assert.deepEqual((await listTeams({ status: "pending", q: "" })).map((r) => r.org.name), ["Hooli"]);
    assert.deepEqual((await listTeams({ status: "active", q: "OLIVE" })).map((r) => r.org.name), ["Acme Corp"]);
    assert.deepEqual(await getTeamsSummary(), { teams: 2, pending: 1, seats: 4, active: 1, invited: 0, revenue: [{ currency: "USD", amount: 33100 }] });

    const lines = teamsToCsv(all).split("\r\n");
    assert.equal(lines[0], "Team,Owner,Owner email,Status,Seats,Active members,Open invitations,Free seats,Courses,Currency,Paid,Created");
    assert.equal(lines[1], "Globex,Sam Stranger,sam@example.org,Active,1,1,0,0,1,USD,49.00,2026-03-01");
    assert.equal(lines[3], "Hooli,Bob Member,bob@example.com,Awaiting payment,0,0,0,0,1,,0.00,2026-04-01");
  });
});

describe("dashboard read models", () => {
  it("summarise a team for its managers", async () => {
    await setup({ payments: [seatsPayment("pay_o1", "org_acme-3", { invoiceNumber: "INV-7" }), seatsPayment("pay_o2", "org_acme-2", { status: "failed", paidAt: undefined, createdAt: "2026-01-10T00:00:00.000Z" })] });
    await join(ada);
    await inviteMembers(acme.id, owner, [{ email: bob.email }]);
    const overview = await getTeamOverview("acme-corp");
    assert.ok(overview, "found by slug");
    assert.deepEqual(overview.usage, { total: 3, active: 1, invited: 1, used: 2, available: 1, over: 0 });
    assert.deepEqual([overview.draft, overview.owner?.name, overview.managers.map((m) => m.name), overview.seatPrice], [false, "Olive Owner", ["Max Manager"], { amount: 7400, currency: "USD" }]);
    assert.deepEqual(overview.orders.map((o) => [o.id, o.seats, o.status, o.buyerName, o.invoiceNumber]), [["pay_o1", 3, "paid", "Olive Owner", "INV-7"], ["pay_o2", 2, "failed", "Olive Owner", undefined]]);
    assert.equal(await getTeamOverview("org_nope"), null);

    const current = await listSeats(acme.id, { status: "current", q: "" });
    assert.deepEqual(current.map((s) => [s.email, s.state]), [[ada.email, "active"], [bob.email, "invited"]]);
    assert.ok(current[1].expiresAt);
    assert.deepEqual((await listSeats(acme.id, { status: "current", q: "BOB@" })).map((s) => s.email), [bob.email]);
    assert.deepEqual(await listSeats(acme.id, { status: "revoked", q: "" }), []);
    assert.deepEqual(await listSeats("org_nope", { status: "current", q: "" }), []);

    const csv = seatsToCsv(current).split("\r\n");
    assert.equal(csv[0], "Name,Account email,Invited address,Status,Role,Assigned on,Joined on,Invitation expires");
    assert.match(csv[1], /^Ada Member,ada@example\.com,ada@example\.com,Active,Member,\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2},$/);
    assert.match(csv[2], /^,,bob@example\.com,Invited,Member,\d{4}-\d{2}-\d{2},,\d{4}-\d{2}-\d{2}$/);
  });

  it("report every member's progress per course, with filters and a CSV export", async () => {
    await setup();
    await join(ada);
    await join({ ...bob });
    const recent = new Date(Date.now() - DAY).toISOString();
    const certificate: Certificate = { id: "cert_1", code: "LL-TEAM-0001", userId: ada.id, courseId: py.id, issueDate: "2026-06-01", published: true };
    await mutate((d) => {
      for (const e of d.enrollments) {
        if (e.userId !== ada.id) continue;
        if (e.courseId === js.id) e.progress = 50;
        if (e.courseId === py.id) Object.assign(e, { progress: 100, completedAt: "2026-06-01T00:00:00.000Z" });
      }
      d.progress.push(makeProgress(jsTree.lessons[0], ada.id, { dwellSeconds: 600, updatedAt: recent }));
      d.progress.push(makeProgress(jsTree.lessons[1], ada.id, { status: "partially_complete", completedAt: undefined, dwellSeconds: 300, updatedAt: "2026-02-01T00:00:00.000Z" }));
      d.certificates.push(certificate);
    });

    const progress = await getTeamProgress(acme.id);
    assert.ok(progress);
    assert.deepEqual(progress.courses.map((c) => c.id), [js.id, py.id]);
    assert.deepEqual(progress.summary, { members: 2, average: 38, completions: 1, notStarted: 1, activeThisWeek: 1 });
    assert.deepEqual(progress.perCourse, [
      { courseId: js.id, average: 25, completed: 0, started: 1 },
      { courseId: py.id, average: 50, completed: 1, started: 1 },
    ]);
    const [adaRow, bobRow] = progress.rows;
    assert.deepEqual([adaRow.user.name, adaRow.average, adaRow.completed, adaRow.lastActivityAt], ["Ada Member", 75, 1, recent]);
    assert.deepEqual(
      adaRow.courses.map((c) => [c.state, c.progress, c.lessonsDone, c.lessonsTotal, c.timeSpentSeconds, c.certificateCode]),
      [
        ["in_progress", 50, 1, 2, 900, undefined],
        ["completed", 100, 0, 0, 0, "LL-TEAM-0001"],
      ],
    );
    assert.deepEqual([bobRow.user.name, bobRow.average, bobRow.courses.every((c) => c.enrolled && c.state === "not_started")], ["Bob Member", 0, true]);

    const onlyJs = await getTeamProgress(acme.id, { courseId: js.id, state: "in_progress", q: "" });
    assert.deepEqual([onlyJs?.courses.map((c) => c.id), onlyJs?.rows.map((r) => [r.user.name, r.average])], [[js.id], [["Ada Member", 50]]]);
    assert.equal(onlyJs?.summary.members, 2, "the summary always covers the whole team");
    assert.deepEqual((await getTeamProgress(acme.id, { courseId: "", state: "not_started", q: "" }))?.rows.map((r) => r.user.name), ["Bob Member"]);
    assert.deepEqual((await getTeamProgress(acme.id, { courseId: "", state: "all", q: "ada@" }))?.rows.map((r) => r.user.name), ["Ada Member"]);
    assert.deepEqual((await getTeamProgress(acme.id, { courseId: "crs_other", state: "all", q: "" }))?.courses.length, 2, "an unknown course shows every course");
    assert.equal(await getTeamProgress("org_nope"), null);

    const lines = teamProgressToCsv(progress).split("\r\n");
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "Member,Email,Joined team,Course,Status,Progress %,Lessons completed,Lessons total,Time spent (minutes),Last activity,Completed on,Certificate");
    assert.match(lines[1], new RegExp(`^Ada Member,ada@example\\.com,\\d{4}-\\d{2}-\\d{2},JavaScript Basics,In progress,50,1,2,15,${recent.slice(0, 10)},,$`));
    assert.match(lines[2], /^Ada Member,ada@example\.com,\d{4}-\d{2}-\d{2},Python,Completed,100,0,0,0,,2026-06-01,LL-TEAM-0001$/);
    assert.match(lines[3], /,JavaScript Basics,Not started,0,0,2,0,,,$/);

    const memberships = await getMemberships(ada.id);
    assert.deepEqual(memberships[0].courses.map((c) => [c.id, c.progress, c.completed]), [[js.id, 50, false], [py.id, 100, true]]);
  });

  it("shows a member who lost a course as not enrolled", async () => {
    await setup();
    await join(ada);
    await mutate((d) => {
      d.enrollments = d.enrollments.filter((e) => !(e.userId === ada.id && e.courseId === py.id));
    });
    const progress = await getTeamProgress(acme.id);
    assert.deepEqual(progress?.rows[0].courses.map((c) => c.enrolled), [true, false]);
    assert.match(teamProgressToCsv(progress!).split("\r\n")[2], /,Python,Not enrolled,0,/);
  });
});

describe("server actions", () => {
  it("let managers invite, resend and revoke, and nobody else", async () => {
    await setup();
    await signIn(stranger.id);
    const denied = await inviteMembersAction(null, form({ orgId: acme.id, emails: ada.email }));
    assert.deepEqual([denied.ok, !denied.ok && denied.error], [false, "This team does not exist, or you don't manage it."]);
    assert.equal((await revokeSeatsAction(acme.id, ["seat_x"])).ok, false);
    assert.equal((await claimSeatAction(acme.id)).ok, false);
    resetRequest();
    assert.equal((await inviteMembersAction(null, form({ orgId: acme.id, emails: ada.email }))).ok, false, "signed out");
    assert.equal((await seats()).length, 0);

    await signIn(manager.id);
    const empty = await inviteMembersAction(null, form({ orgId: acme.id, emails: "  " }));
    assert.ok(!empty.ok && empty.fieldErrors?.emails);
    const junk = await inviteMembersAction(null, form({ orgId: acme.id, emails: "not-an-email" }));
    assert.ok(!junk.ok);
    assert.match(junk.error, /None of these look like email addresses/);
    const invited = await inviteMembersAction(null, form({ orgId: acme.id, emails: `Ada <${ada.email}>\nnot-an-email\n${bob.email}` }));
    assert.ok(invited.ok);
    assert.equal(invited.data.sent, 2);
    assert.equal(invited.message, "2 invitations sent. 1 row had no valid email address.");
    const repeat = await inviteMembersAction(null, form({ orgId: acme.id, emails: ada.email }));
    assert.ok(!repeat.ok);
    assert.match(repeat.error, /^No invitations sent\. 1 skipped: ada@example\.com \(already invited\)\.$/);

    const ids = (await seats()).map((s) => s.id);
    const soon = await resendInvitesAction(acme.id, ids);
    assert.ok(!soon.ok);
    assert.match(soon.error, /sent a moment ago/);
    assert.equal((await resendInvitesAction(acme.id, [])).ok, false);
    assert.equal((await revokeSeatsAction(acme.id, ["../x"])).ok, false);
    assert.equal((await revokeSeatsAction(acme.id, "seat_1" as unknown as string[])).ok, false);
    const revoked = await revokeSeatsAction(acme.id, ids);
    assert.ok(revoked.ok);
    assert.equal(revoked.message, "2 seats freed up");
    assert.equal((await revokeSeatsAction(acme.id, ids)).ok, false);

    const claimed = await claimSeatAction(acme.id);
    assert.ok(claimed.ok);
    assert.deepEqual(await enrolledCourses(manager.id), [js.id, py.id]);
    for (const action of ["team.invite", "team.seat_revoke"]) assert.ok((await auditActions()).includes(action), action);
    const history = await getTeamHistory(acme.id);
    assert.deepEqual(history.map((h) => [h.label, h.detail, h.actorName]).sort(), [["Members invited", "2 sent", "Max Manager"], ["Seats revoked", "2 seats", "Max Manager"]]);
  });

  it("accept an invitation: sign-in first, then on to the courses", async () => {
    await setup();
    await inviteMembers(acme.id, owner, [{ email: ada.email }]);
    const token = await joinToken(ada.email);
    resetRequest();
    assert.equal(await captureRedirect(() => acceptInviteAction(null, form({ token }))), `/login?next=${encodeURIComponent(`/join/${token}`)}`);
    assert.equal(await captureRedirect(() => acceptInviteAction(null, form({ token: "../../admin" }))), `/login?next=${encodeURIComponent("/team")}`);
    assert.equal((await acceptSeatInviteAction((await seatOf(ada.email)).id)).ok, false, "signed out");

    await signIn(ada.id);
    const bad = await acceptInviteAction(null, form({ token: generateRawToken() }));
    assert.ok(!bad.ok);
    assert.match(bad.error, /not valid/);
    assert.equal(await captureRedirect(() => acceptInviteAction(null, form({ token }))), "/team");
    assert.equal((await seatOf(ada.email)).userId, ada.id);
    const used = await acceptInviteAction(null, form({ token }));
    assert.ok(!used.ok);
    assert.match(used.error, /already accepted/);
  });

  it("send a new member of a one-course team straight to the course", async () => {
    await setup({ organizations: [{ ...acme, courseIds: [js.id] }] });
    await inviteMembers(acme.id, owner, [{ email: ada.email }]);
    await signIn(ada.id);
    assert.equal((await acceptSeatInviteAction("../x")).ok, false);
    const seatId = (await seatOf(ada.email)).id;
    assert.equal(await captureRedirect(() => acceptSeatInviteAction(seatId)), "/courses/javascript-basics");
    assert.deepEqual(await enrolledCourses(ada.id), [js.id]);
  });

  it("start a purchase from the form and hand it off", async () => {
    await setup({ organizations: [] });
    resetRequest();
    assert.equal(await captureRedirect(() => startTeamPurchaseAction(null, form({ name: "Globex", seats: "4", courseIds: [js.id] }))), `/login?next=${encodeURIComponent("/team/buy")}`);

    await signIn(stranger.id);
    const invalid = await startTeamPurchaseAction(null, form({ name: " ", seats: "0", courseIds: ["../x"] }));
    assert.ok(!invalid.ok);
    assert.deepEqual(Object.keys(invalid.fieldErrors ?? {}).sort(), ["courseIds", "name", "seats"]);
    const unavailable = await startTeamPurchaseAction(null, form({ name: "Globex", seats: "4", courseIds: [hidden.id] }));
    assert.ok(!unavailable.ok && unavailable.fieldErrors?.courseIds);
    assert.equal((await getDb()).organizations.length, 0);

    // Pay by invoice: the administrators are asked, the buyer lands on the team page.
    assert.equal(await captureRedirect(() => startTeamPurchaseAction(null, form({ name: "Globex", seats: "4", courseIds: [js.id, py.id], mode: "invoice" }))), "/team?org=globex");
    const org = (await getDb()).organizations[0];
    assert.deepEqual([org.name, org.ownerId, org.seatCount, org.courseIds], ["Globex", stranger.id, 0, [js.id, py.id]]);
    assert.ok((await subjectsFor(admin.id)).includes("Globex asked for an invoice for 4 team seats"));

    // Pay online: on to the checkout once it sells seats, the invoice route until then.
    const target = await captureRedirect(() => buyMoreSeatsAction(null, form({ orgId: org.id, seats: "2", mode: "checkout" })));
    assert.equal(target, seatsCheckoutReady() ? `/billing/seats/${org.id}-2` : "/team?org=globex");
    assert.equal((await buyMoreSeatsAction(null, form({ orgId: org.id, seats: "9999" }))).ok, false);

    await signIn(bob.id);
    const foreign = await buyMoreSeatsAction(null, form({ orgId: org.id, seats: "2", mode: "invoice" }));
    assert.deepEqual([foreign.ok, !foreign.ok && foreign.error], [false, "This team does not exist, or you don't manage it."]);
  });

  it("keep owner-only and administrator-only changes apart", async () => {
    await setup();
    await signIn(manager.id);
    for (const result of [
      await renameTeamAction(null, form({ orgId: acme.id, name: "Acme Global" })),
      await transferOwnershipAction(null, form({ orgId: acme.id, email: manager.email })),
    ]) {
      assert.deepEqual([result.ok, !result.ok && result.error], [false, "Only the team owner can do that."]);
    }
    for (const result of [
      await adjustSeatsAction(null, form({ orgId: acme.id, seatCount: "50" })),
      await deleteTeamAction(acme.id),
      await createTeamAction(null, form({ name: "Initech", ownerEmail: manager.email, seatCount: "5", courseIds: [js.id] })),
      await saveTeamSettingsAction(null, form({ section: "teams" })),
    ]) {
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.error : "", /Only administrators/);
    }
    const org = await team();
    assert.deepEqual([org.name, org.ownerId, org.seatCount], ["Acme Corp", owner.id, 3]);
    assert.equal((await getDb()).settings.growth.teamsEnabled, true);

    await addManager(acme.id, ada.email, owner);
    const other = await removeManagerAction(acme.id, ada.id);
    assert.deepEqual([other.ok, !other.ok && other.error], [false, "Only the team owner can remove other managers."]);
    const self = await removeManagerAction(acme.id, manager.id);
    assert.ok(self.ok);
    assert.equal(self.message, "You no longer manage this team");
    assert.equal((await removeManagerAction(acme.id, ada.id)).ok, false, "no longer a manager themselves");

    await signIn(owner.id);
    assert.ok((await renameTeamAction(null, form({ orgId: acme.id, name: "  Acme   Global " }))).ok);
    assert.equal((await renameTeamAction(null, form({ orgId: acme.id, name: "A" }))).ok, false);
    assert.ok((await removeManagerAction(acme.id, ada.id)).ok);
    assert.ok((await transferOwnershipAction(null, form({ orgId: acme.id, email: "ADA@example.com" }))).ok);
    const after = await team();
    assert.deepEqual([after.name, after.ownerId, after.managerIds], ["Acme Global", ada.id, [owner.id]]);
    const rename = (await getDb()).auditEvents.find((e) => e.action === "team.rename");
    assert.deepEqual([rename?.meta?.previous, rename?.meta?.name], ["Acme Corp", "Acme Global"]);
  });

  it("let administrators adjust seats, create and delete teams and switch the program off", async () => {
    await setup();
    await signIn(admin.id);
    const bad = await adjustSeatsAction(null, form({ orgId: acme.id, seatCount: "12.5" }));
    assert.ok(!bad.ok && bad.fieldErrors?.seatCount);
    const adjusted = await adjustSeatsAction(null, form({ orgId: acme.id, seatCount: "12", note: "Invoice 2026-014" }));
    assert.ok(adjusted.ok);
    assert.equal((await team()).seatCount, 12);
    const entry = (await getDb()).auditEvents.find((e) => e.action === "team.seats_adjust");
    assert.deepEqual([entry?.actorId, entry?.meta?.previous, entry?.meta?.seatCount, entry?.meta?.note], [admin.id, 3, 12, "Invoice 2026-014"]);
    assert.deepEqual((await getTeamHistory(acme.id)).map((h) => [h.label, h.detail, h.actorName]), [["Seat count changed", "3 → 12 seats · Invoice 2026-014", "Grace Admin"]]);
    assert.ok((await adjustSeatsAction(null, form({ orgId: acme.id, seatCount: "0" }))).ok, "an administrator can empty an unused team");

    // Administrators manage any team without being its manager.
    const invited = await inviteMembersAction(null, form({ orgId: acme.id, emails: ada.email }));
    assert.equal(invited.ok, false, "no seats left to assign");

    const invalid = await createTeamAction(null, form({ name: "I", ownerEmail: "nope", seatCount: "-1" }));
    assert.ok(!invalid.ok);
    assert.deepEqual(Object.keys(invalid.fieldErrors ?? {}).sort(), ["courseIds", "name", "ownerEmail", "seatCount"]);
    const unknownOwner = await createTeamAction(null, form({ name: "Initech", ownerEmail: "nobody@example.com", seatCount: "5", courseIds: [js.id] }));
    assert.ok(!unknownOwner.ok && unknownOwner.fieldErrors?.ownerEmail);
    const created = await createTeamAction(null, form({ name: "Initech", ownerEmail: "SAM@example.org", seatCount: "5", courseIds: [js.id, free.id] }));
    assert.ok(created.ok);
    const initech = await team(created.data.id);
    assert.deepEqual([initech.ownerId, initech.seatCount, initech.courseIds], [stranger.id, 5, [js.id, free.id]]);

    assert.equal(await captureRedirect(() => deleteTeamAction(created.data.id)), "/admin/teams");
    assert.equal((await getDb()).organizations.length, 1);
    assert.equal((await deleteTeamAction("org_gone")).ok, false);

    assert.equal((await saveTeamSettingsAction(null, form({ section: "affiliates", teamsEnabled: "on" }))).ok, false, "a form for another section");
    const off = await saveTeamSettingsAction(null, form({ section: "teams" }));
    assert.ok(off.ok);
    assert.equal((await getDb()).settings.growth.teamsEnabled, false);
    assert.equal((await getDb()).settings.growth.affiliatesEnabled, true, "other growth settings are kept");
    for (const action of ["team.create", "team.delete", "settings.update"]) assert.ok((await auditActions()).includes(action), action);
  });
});

describe("CSV export routes", () => {
  it("serve a team's seats and progress to its managers only", async () => {
    await setup();
    await join(ada);
    resetRequest();
    const anonymous = await teamExportGET(request("/team/export?org=acme-corp&type=progress"));
    assert.ok(anonymous.status >= 300 && anonymous.status < 400);
    assert.ok(anonymous.headers.get("location")?.includes("/login?next=%2Fteam"));

    for (const outsider of [stranger, ada]) {
      await signIn(outsider.id);
      assert.equal((await teamExportGET(request("/team/export?org=acme-corp&type=progress"))).status, 404, outsider.name);
    }
    await signIn(manager.id);
    assert.equal((await teamExportGET(request("/team/export?org=org_nope&type=seats"))).status, 404);
    assert.equal((await teamExportGET(request("/team/export?org=acme-corp&type=everything"))).status, 400);

    const res = await teamExportGET(request("/team/export?org=acme-corp&type=progress&course=crs_js"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="team-acme-corp-progress-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "starts with a UTF-8 BOM for spreadsheet apps");
    const lines = new TextDecoder().decode(bytes).split("\r\n");
    assert.equal(lines.length, 2, "one member, one selected course");
    assert.match(lines[1], /^Ada Member,ada@example\.com,.*JavaScript Basics,Not started,0,0,2,0,,,$/);

    const seatsRes = await teamExportGET(request(`/team/export?org=${acme.id}&type=seats&status=active`));
    assert.equal(seatsRes.status, 200);
    assert.equal((await seatsRes.text()).split("\r\n").length, 2);
    const exports = (await getDb()).auditEvents.filter((e) => e.action === "team.export");
    assert.deepEqual(exports.map((e) => [e.actorId, e.targetId, e.meta?.export, e.meta?.rows]), [[manager.id, acme.id, "progress", 1], [manager.id, acme.id, "seats", 1]]);
  });

  it("serve the list of teams to administrators only", async () => {
    await setup();
    resetRequest();
    const anonymous = await adminExportGET(request("/admin/teams/export"));
    assert.ok(anonymous.status >= 300 && anonymous.status < 400);
    await signIn(owner.id);
    assert.equal((await adminExportGET(request("/admin/teams/export"))).status, 403);
    await signIn(admin.id);
    const res = await adminExportGET(request("/admin/teams/export?q=acme"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="teams-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await res.text()).split("\r\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^Acme Corp,Olive Owner,olive@example\.com,Active,3,0,0,3,2,,0\.00,2026-02-01$/);
    assert.equal((await adminExportGET(request("/admin/teams/export?q=nothing-matches"))).status, 200);
  });
});
