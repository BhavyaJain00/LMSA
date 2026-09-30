import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INVITE_TTL_DAYS,
  MAX_SEATS_PER_ORDER,
  MAX_TEAM_SEATS,
  averageProgress,
  inviteExpiresAt,
  inviteSummary,
  isDraftTeam,
  isSeatCourse,
  normalizeTeamName,
  orgRole,
  parseInviteList,
  parseProgressFilter,
  parseSeatCount,
  parseSeatFilter,
  parseSeatsOrderRef,
  parseTeamFilter,
  planInvites,
  planSeatReduction,
  progressState,
  quoteSeats,
  seatEnrollmentRevocable,
  seatMatchesFilter,
  seatState,
  seatUsage,
  seatsOrderOf,
  seatsOrderRef,
} from "@/lib/growth/teams-shared";

/**
 * Growth, item 2 (teams / B2B seats): the pure rules shared by the server,
 * the client forms and the checkout hand-off.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("team names", () => {
  it("collapses whitespace and strips control characters", () => {
    assert.equal(normalizeTeamName("  Acme \t Corp\u0007 "), "Acme Corp");
    assert.equal(normalizeTeamName("Line\nbreak"), "Line break");
  });

  it("rejects names that are too short, too long or not text", () => {
    assert.equal(normalizeTeamName("A"), null);
    assert.equal(normalizeTeamName("   "), null);
    assert.equal(normalizeTeamName("x".repeat(81)), null);
    assert.equal(normalizeTeamName(undefined), null);
    assert.equal(normalizeTeamName(42), null);
    assert.equal(normalizeTeamName("x".repeat(80))?.length, 80);
  });
});

describe("checkout order reference", () => {
  it("round-trips a team id and a seat count", () => {
    const ref = seatsOrderRef("org_k2J9abcDEF012345", 25);
    assert.equal(ref, "org_k2J9abcDEF012345-25");
    assert.deepEqual(parseSeatsOrderRef(ref), { orgId: "org_k2J9abcDEF012345", seats: 25 });
  });

  it("rejects malformed references and seat counts outside one order", () => {
    for (const bad of ["", "org_a", "org_a-", "org_a-0", "org_a-05", "org_a--5", "org_a-5x", "../org-5", "org a-5", `org_a-${MAX_SEATS_PER_ORDER + 1}`, "org_a-99999", null, undefined]) {
      assert.equal(parseSeatsOrderRef(bad), null, String(bad));
    }
    assert.deepEqual(parseSeatsOrderRef(`org_a-${MAX_SEATS_PER_ORDER}`), { orgId: "org_a", seats: MAX_SEATS_PER_ORDER });
  });

  it("reads the team and seats of an order from its own fields first, then from the reference", () => {
    assert.deepEqual(seatsOrderOf({ itemType: "seats", itemId: "org_a-5" }), { orgId: "org_a", seats: 5 });
    assert.deepEqual(seatsOrderOf({ itemType: "seats", itemId: "org_a-5", orgId: "org_b", seats: 7 }), { orgId: "org_b", seats: 7 });
    // A checkout that stores the team id as the item and the count on the order.
    assert.deepEqual(seatsOrderOf({ itemType: "seats", itemId: "org_a", seats: 3 }), { orgId: "org_a", seats: 3 });
  });

  it("ignores other item types and orders without a usable seat count", () => {
    assert.equal(seatsOrderOf({ itemType: "course", itemId: "org_a-5" }), null);
    assert.equal(seatsOrderOf({ itemType: "seats", itemId: "org_a" }), null);
    assert.equal(seatsOrderOf({ itemType: "seats", itemId: "org_a", seats: 0 }), null);
    assert.equal(seatsOrderOf({ itemType: "seats", itemId: "org_a", seats: 2.5 }), null);
    assert.equal(seatsOrderOf({ itemType: "seats", itemId: "org_a", seats: MAX_TEAM_SEATS + 1 }), null);
  });
});

describe("seat pricing", () => {
  const js = { id: "c1", title: "JavaScript", price: 4900, currency: "USD", paidCourse: true };
  const py = { id: "c2", title: "Python", price: 2500, currency: "usd", paidCourse: true };
  const free = { id: "c3", title: "Git basics", price: 0, currency: "USD", paidCourse: false };
  const eur = { id: "c4", title: "Rust", price: 3000, currency: "EUR", paidCourse: true };

  it("prices one seat as the sum of the paid courses and multiplies by the seats", () => {
    const result = quoteSeats([js, py, free], 10);
    assert.ok(result.ok);
    assert.deepEqual(
      { unit: result.quote.unitAmount, amount: result.quote.amount, currency: result.quote.currency, seats: result.quote.seats },
      { unit: 7400, amount: 74000, currency: "USD", seats: 10 },
    );
    assert.deepEqual(result.quote.lines.map((l) => l.courseId), ["c1", "c2"], "free courses add no line");
  });

  it("ignores a price left on a course that is not sold", () => {
    const result = quoteSeats([js, { ...py, paidCourse: false }], 1);
    assert.ok(result.ok);
    assert.equal(result.quote.amount, 4900);
  });

  it("needs at least one paid course and one currency", () => {
    assert.equal(quoteSeats([free], 3).ok, false);
    assert.equal(quoteSeats([], 3).ok, false);
    const mixed = quoteSeats([js, eur], 3);
    assert.ok(!mixed.ok);
    assert.match(mixed.error, /currenc/i);
  });

  it("limits the seats of one order", () => {
    for (const seats of [0, -1, 1.5, Number.NaN, MAX_SEATS_PER_ORDER + 1]) assert.equal(quoteSeats([js], seats).ok, false, String(seats));
    assert.equal(quoteSeats([js], MAX_SEATS_PER_ORDER).ok, true);
  });

  it("parses seat counts typed into a form", () => {
    assert.equal(parseSeatCount(" 12 "), 12);
    assert.equal(parseSeatCount(7), 7);
    assert.equal(parseSeatCount(String(MAX_SEATS_PER_ORDER)), MAX_SEATS_PER_ORDER);
    assert.equal(parseSeatCount("2500", MAX_TEAM_SEATS), 2500);
    for (const bad of ["", "0", "-3", "1.5", "1e3", "12 seats", String(MAX_SEATS_PER_ORDER + 1), null, undefined, {}]) assert.equal(parseSeatCount(bad), null, String(bad));
  });

  it("only sells seats for published, open, paid courses", () => {
    const base = { price: 4900, paidCourse: true, published: true, upcoming: false };
    assert.equal(isSeatCourse(base), true);
    assert.equal(isSeatCourse({ ...base, published: false }), false);
    assert.equal(isSeatCourse({ ...base, upcoming: true }), false);
    assert.equal(isSeatCourse({ ...base, paidCourse: false }), false);
    assert.equal(isSeatCourse({ ...base, price: 0 }), false);
  });
});

describe("seat usage", () => {
  const seats = (active: number, invited: number, revoked: number) => [
    ...Array.from({ length: active }, () => ({ status: "active" as const })),
    ...Array.from({ length: invited }, () => ({ status: "invited" as const })),
    ...Array.from({ length: revoked }, () => ({ status: "revoked" as const })),
  ];

  it("counts members and open invitations against the seat count; revoked seats are free", () => {
    assert.deepEqual(seatUsage({ seatCount: 10 }, seats(3, 2, 4)), { total: 10, active: 3, invited: 2, used: 5, available: 5, over: 0 });
  });

  it("reports seats in use beyond the count after seats were removed", () => {
    assert.deepEqual(seatUsage({ seatCount: 2 }, seats(3, 1, 0)), { total: 2, active: 3, invited: 1, used: 4, available: 0, over: 2 });
    assert.equal(seatUsage({ seatCount: -5 }, []).total, 0);
  });

  it("expires an invitation 30 days after it was last sent", () => {
    const sent = "2026-03-01T00:00:00.000Z";
    const seat = { status: "invited" as const, assignedAt: sent };
    assert.equal(inviteExpiresAt(seat), Date.parse(sent) + INVITE_TTL_DAYS * DAY);
    assert.equal(seatState(seat, Date.parse(sent) + INVITE_TTL_DAYS * DAY - 1), "invited");
    assert.equal(seatState(seat, Date.parse(sent) + INVITE_TTL_DAYS * DAY), "expired");
    assert.equal(seatState({ status: "invited", assignedAt: "not a date" }, Date.parse(sent)), "expired", "unreadable dates fail closed");
  });

  it("never expires members or revoked seats", () => {
    const old = "2020-01-01T00:00:00.000Z";
    assert.equal(seatState({ status: "active", assignedAt: old }), "active");
    assert.equal(seatState({ status: "revoked", assignedAt: old }), "revoked");
  });

  it("filters seats by state; \"current\" is everything in use", () => {
    assert.deepEqual((["active", "invited", "expired", "revoked"] as const).map((s) => seatMatchesFilter(s, "current")), [true, true, true, false]);
    assert.equal(seatMatchesFilter("expired", "invited"), false);
    assert.equal(seatMatchesFilter("expired", "expired"), true);
    assert.equal(seatMatchesFilter("revoked", "revoked"), true);
  });
});

describe("team roles and drafts", () => {
  const org = { ownerId: "u_owner", managerIds: ["u_mgr"] };

  it("tells owner, manager and everyone else apart", () => {
    assert.equal(orgRole(org, "u_owner"), "owner");
    assert.equal(orgRole(org, "u_mgr"), "manager");
    assert.equal(orgRole(org, "u_member"), null);
    assert.equal(orgRole(org, null), null);
    assert.equal(orgRole(org, ""), null);
    assert.equal(orgRole({ ownerId: "u_owner", managerIds: ["u_owner"] }, "u_owner"), "owner");
  });

  it("treats a team as a draft until it has seats, assignments or a settled order", () => {
    assert.equal(isDraftTeam({ seatCount: 0 }, 0, 0), true);
    assert.equal(isDraftTeam({ seatCount: 5 }, 0, 0), false);
    assert.equal(isDraftTeam({ seatCount: 0 }, 1, 0), false, "seats were assigned once");
    assert.equal(isDraftTeam({ seatCount: 0 }, 0, 1), false, "a refunded team is not a draft");
  });
});

describe("invite list parsing", () => {
  it("reads one address per line, lower-cased", () => {
    const parsed = parseInviteList("Ada@Example.com\n\n  grace@example.com  \r\nlinus@example.com");
    assert.deepEqual(parsed.entries, [{ email: "ada@example.com" }, { email: "grace@example.com" }, { email: "linus@example.com" }]);
    assert.deepEqual([parsed.invalid, parsed.duplicates, parsed.truncated], [[], 0, false]);
  });

  it("reads names from \"Name <email>\", \"email, name\" and \"name, email\" rows", () => {
    const parsed = parseInviteList(["Grace Hopper <grace@example.com>", "linus@example.com, Linus Torvalds", "Ada Lovelace;ada@example.com", "Alan Turing\talan@example.com"].join("\n"));
    assert.deepEqual(parsed.entries, [
      { email: "grace@example.com", name: "Grace Hopper" },
      { email: "linus@example.com", name: "Linus Torvalds" },
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Alan Turing" },
    ]);
  });

  it("skips a CSV header row and keeps quoted cells together", () => {
    const parsed = parseInviteList('﻿Name,Email\r\n"Hopper, Grace",grace@example.com\r\n"Ada ""The Countess"" Lovelace",ada@example.com\r\n');
    assert.deepEqual(parsed.invalid, []);
    assert.deepEqual(parsed.entries.map((e) => e.email), ["grace@example.com", "ada@example.com"]);
    assert.equal(parsed.entries[0].name, "Hopper, Grace");
    assert.equal(parsed.entries[1].name, "Ada The Countess Lovelace", "quotes are dropped from names");
  });

  it("accepts several addresses on one row", () => {
    assert.deepEqual(parseInviteList("a@x.com, b@x.com; c@x.com").entries.map((e) => e.email), ["a@x.com", "b@x.com", "c@x.com"]);
    assert.deepEqual(parseInviteList("a@x.com b@x.com   c@x.com").entries.map((e) => e.email), ["a@x.com", "b@x.com", "c@x.com"]);
    assert.deepEqual(
      parseInviteList("Ada <ada@x.com>, Bob Builder <bob@x.com>").entries,
      [
        { email: "ada@x.com", name: "Ada" },
        { email: "bob@x.com", name: "Bob Builder" },
      ],
    );
    assert.deepEqual(parseInviteList("mailto:a@x.com").entries, [{ email: "a@x.com" }]);
  });

  it("counts duplicates once and keeps the first name seen", () => {
    const parsed = parseInviteList("ada@x.com\nADA@X.COM, Ada Lovelace\nada@x.com, Someone Else");
    assert.deepEqual(parsed.entries, [{ email: "ada@x.com", name: "Ada Lovelace" }]);
    assert.equal(parsed.duplicates, 2);
  });

  it("reports rows without a usable address", () => {
    const parsed = parseInviteList("not an email\nada@x.com\nbob@\n@x.com\n" + "y".repeat(80));
    assert.deepEqual(parsed.entries, [{ email: "ada@x.com" }]);
    assert.equal(parsed.invalid.length, 4);
    assert.equal(parsed.invalid[0], "not an email");
    assert.equal(parsed.invalid[3].length, 60, "long rows are shortened for display");
    // A first row that is not a header is an error like any other.
    assert.deepEqual(parseInviteList("Team roster\nada@x.com").invalid, ["Team roster"]);
  });

  it("strips markup from names and stops at the request limit", () => {
    assert.deepEqual(parseInviteList('ada@x.com, "<b>Ada</b>"').entries, [{ email: "ada@x.com", name: "b Ada /b" }]);
    const many = Array.from({ length: 12 }, (_, i) => `user${i}@x.com`).join("\n");
    const parsed = parseInviteList(many, 10);
    assert.equal(parsed.entries.length, 10);
    assert.equal(parsed.truncated, true);
    assert.equal(parseInviteList(many).truncated, false);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseInviteList("  \n \r\n"), { entries: [], invalid: [], duplicates: 0, truncated: false });
  });
});

describe("invitation planning", () => {
  const taken = [
    { status: "active" as const, emails: ["member@x.com", "Member.Account@x.com"] },
    { status: "invited" as const, emails: ["pending@x.com", undefined] },
    { status: "revoked" as const, emails: ["gone@x.com", undefined] },
  ];

  it("skips members and open invitations, by invited or account address", () => {
    const plan = planInvites([{ email: "member@x.com" }, { email: "member.account@x.com" }, { email: "pending@x.com" }, { email: "new@x.com", name: "New Person" }], taken, 5);
    assert.deepEqual(plan.invite, [{ email: "new@x.com", name: "New Person" }]);
    assert.deepEqual(plan.skipped, [
      { email: "member@x.com", reason: "already_member" },
      { email: "member.account@x.com", reason: "already_member" },
      { email: "pending@x.com", reason: "already_invited" },
    ]);
  });

  it("invites someone whose earlier seat was revoked", () => {
    assert.deepEqual(planInvites([{ email: "gone@x.com" }], taken, 1).invite, [{ email: "gone@x.com" }]);
  });

  it("stops when the free seats run out, in list order", () => {
    const plan = planInvites([{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }], [], 2);
    assert.deepEqual(plan.invite.map((i) => i.email), ["a@x.com", "b@x.com"]);
    assert.deepEqual(plan.skipped, [{ email: "c@x.com", reason: "no_seats" }]);
    assert.equal(planInvites([{ email: "a@x.com" }], [], -3).invite.length, 0);
  });

  it("does not invite the same address twice in one request", () => {
    const plan = planInvites([{ email: "A@x.com" }, { email: "a@x.com" }], [], 5);
    assert.deepEqual(plan.invite, [{ email: "a@x.com" }]);
    assert.deepEqual(plan.skipped, [{ email: "a@x.com", reason: "already_invited" }]);
  });

  it("summarises what happened", () => {
    assert.equal(inviteSummary(1, []), "1 invitation sent.");
    assert.equal(inviteSummary(3, []), "3 invitations sent.");
    assert.equal(inviteSummary(0, [{ email: "a@x.com", reason: "no_seats" }]), "No invitations sent. 1 skipped: a@x.com (no seat left).");
    const skipped = Array.from({ length: 7 }, (_, i) => ({ email: `u${i}@x.com`, reason: "already_invited" as const }));
    const text = inviteSummary(2, skipped);
    assert.match(text, /^2 invitations sent\. 7 skipped: u0@x\.com \(already invited\)/);
    assert.match(text, /u4@x\.com \(already invited\) and 2 more\.$/);
    assert.doesNotMatch(text, /u5@x\.com/);
  });
});

describe("removing seats", () => {
  const joined = "2026-03-10T00:00:00.000Z";
  const base = {
    enrollment: { memberType: "student" as const, enrolledAt: "2026-03-10T00:00:01.000Z" },
    activatedAt: joined,
    coursePaid: true,
    ownAccess: false,
    otherTeamSeat: false,
  };

  it("removes the enrollment the seat created", () => {
    assert.equal(seatEnrollmentRevocable(base), true);
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, enrolledAt: joined } }), true);
  });

  it("keeps courses the member had before, finished, bought or gets elsewhere", () => {
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, enrolledAt: "2026-01-01T00:00:00.000Z" } }), false, "enrolled before the seat");
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, completedAt: "2026-04-01T00:00:00.000Z" } }), false, "finished");
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, paymentId: "pay_1" } }), false, "own order");
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, batchId: "bat_1" } }), false, "batch seat");
    assert.equal(seatEnrollmentRevocable({ ...base, enrollment: { ...base.enrollment, memberType: "mentor" } }), false, "staff");
    assert.equal(seatEnrollmentRevocable({ ...base, coursePaid: false }), false, "free course");
    assert.equal(seatEnrollmentRevocable({ ...base, ownAccess: true }), false, "membership or purchase");
    assert.equal(seatEnrollmentRevocable({ ...base, otherTeamSeat: true }), false, "seat in another team");
    assert.equal(seatEnrollmentRevocable({ ...base, activatedAt: undefined }), false, "never activated");
  });

  it("revokes open invitations before members, newest first, when seats are taken back", () => {
    const seats = [
      { id: "m_old", status: "active" as const, assignedAt: "2026-01-01T00:00:00.000Z", activatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "m_new", status: "active" as const, assignedAt: "2026-01-01T00:00:00.000Z", activatedAt: "2026-02-02T00:00:00.000Z" },
      { id: "i_old", status: "invited" as const, assignedAt: "2026-02-01T00:00:00.000Z" },
      { id: "i_new", status: "invited" as const, assignedAt: "2026-03-01T00:00:00.000Z" },
      { id: "gone", status: "revoked" as const, assignedAt: "2026-03-05T00:00:00.000Z" },
    ];
    assert.deepEqual(planSeatReduction(seats, 4), []);
    assert.deepEqual(planSeatReduction(seats, 9), []);
    assert.deepEqual(planSeatReduction(seats, 3), ["i_new"]);
    assert.deepEqual(planSeatReduction(seats, 1), ["i_new", "i_old", "m_new"]);
    assert.deepEqual(planSeatReduction(seats, 0), ["i_new", "i_old", "m_new", "m_old"]);
    assert.deepEqual(planSeatReduction(seats, -2), ["i_new", "i_old", "m_new", "m_old"]);
  });
});

describe("progress", () => {
  it("classifies a member's standing in a course", () => {
    assert.equal(progressState(0), "not_started");
    assert.equal(progressState(1), "in_progress");
    assert.equal(progressState(99), "in_progress");
    assert.equal(progressState(100), "completed");
    assert.equal(progressState(40, "2026-02-01T00:00:00.000Z"), "completed", "a completion date wins");
  });

  it("averages progress over courses, clamped to 0-100", () => {
    assert.equal(averageProgress([]), 0);
    assert.equal(averageProgress([{ progress: 0 }, { progress: 50 }, { progress: 100 }]), 50);
    assert.equal(averageProgress([{ progress: 33 }, { progress: 34 }]), 34);
    assert.equal(averageProgress([{ progress: 250 }, { progress: -40 }]), 50);
  });
});

describe("list filters", () => {
  it("reads seat filters from the address, with safe defaults", () => {
    assert.deepEqual(parseSeatFilter({}), { status: "current", q: "", page: 1 });
    assert.deepEqual(parseSeatFilter({ status: "expired", q: "  ada ", page: "3" }), { status: "expired", q: "ada", page: 3 });
    assert.deepEqual(parseSeatFilter(new URLSearchParams("status=bogus&page=-2&q=x")), { status: "current", q: "x", page: 1 });
    assert.equal(parseSeatFilter({ q: "y".repeat(500) }).q.length, 120);
    assert.equal(parseSeatFilter({ status: ["revoked", "active"] }).status, "revoked");
  });

  it("reads progress filters and rejects unsafe course ids", () => {
    assert.deepEqual(parseProgressFilter({}), { courseId: "", state: "all", q: "", page: 1 });
    assert.deepEqual(parseProgressFilter({ course: "crs_1", state: "completed", q: "bo", page: "2" }), { courseId: "crs_1", state: "completed", q: "bo", page: 2 });
    assert.equal(parseProgressFilter({ course: "../etc", state: "done" }).courseId, "");
    assert.equal(parseProgressFilter({ course: "crs_1", state: "done" }).state, "all");
  });

  it("reads the administrators' team filters", () => {
    assert.deepEqual(parseTeamFilter({}), { status: "all", q: "", page: 1 });
    assert.deepEqual(parseTeamFilter(new URLSearchParams("status=full&q=acme&page=4")), { status: "full", q: "acme", page: 4 });
    assert.equal(parseTeamFilter({ status: "draft" }).status, "all");
  });
});
