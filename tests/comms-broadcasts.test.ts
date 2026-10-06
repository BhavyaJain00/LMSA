import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { Broadcast, EmailPreferences, Lead, User } from "@/lib/types";
import {
  DEFAULT_RATE_PER_MINUTE,
  broadcastCsvRows,
  broadcastPhase,
  broadcastRates,
  estimateSendMinutes,
  filterBroadcasts,
  isEditable,
  normalizeRate,
  parseBroadcastFilters,
  parseScheduleTime,
  sendProgress,
  throttleAllowance,
} from "@/lib/comms/broadcast-core";
import { checkContent, countUnsubscribes, parseAddressList, parseRecipientRef, personalValues, recipientRef, unknownPlaceholders } from "@/lib/comms/campaign-core";
import {
  cancelBroadcast,
  deleteBroadcast,
  duplicateBroadcast,
  getBroadcastReport,
  listBroadcasts,
  pauseBroadcast,
  processBroadcasts,
  resumeBroadcast,
  saveBroadcast,
  scheduleBroadcast,
  startBroadcast,
  unscheduleBroadcast,
} from "@/lib/comms/broadcasts";
import { resetTestSendLimits, sendCampaignTest } from "@/lib/comms/preview";
import { refreshCampaignStats, runComms, setCommsAutoRun } from "@/lib/comms/runner";
import { recordEmailHit } from "@/lib/comms/tracking";
import { cronKey } from "@/lib/email";
import { deliverDueEmails } from "@/lib/email/outbox";
import { resetEmailQuotas } from "@/lib/email/quota";
import { getDb, mutate } from "@/lib/db/store";
import { GET as cronGET } from "@/app/api/cron/comms/route";
import { makeCourse, makeUser, resetDb } from "./helpers/db";

const T0 = Date.parse("2026-03-01T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

describe("send throttle", () => {
  it("opens a full window when there is none, or the last one is over", () => {
    assert.deepEqual(throttleAllowance({ ratePerMinute: 60 }, T0), { allowance: 60, windowStartedAt: T0, windowCount: 0, nextAt: T0 + 60_000 });
    const expired = throttleAllowance({ ratePerMinute: 60, windowStartedAt: iso(T0 - 60_000), windowCount: 60 }, T0);
    assert.equal(expired.allowance, 60);
    assert.equal(expired.windowStartedAt, T0);
  });

  it("only hands out what is left of the current minute", () => {
    const partly = throttleAllowance({ ratePerMinute: 60, windowStartedAt: iso(T0 - 20_000), windowCount: 45 }, T0);
    assert.deepEqual(partly, { allowance: 15, windowStartedAt: T0 - 20_000, windowCount: 45, nextAt: T0 + 40_000 });
    const used = throttleAllowance({ ratePerMinute: 60, windowStartedAt: iso(T0 - 59_999), windowCount: 60 }, T0);
    assert.equal(used.allowance, 0);
    assert.equal(used.nextAt, T0 + 1);
    assert.equal(throttleAllowance({ ratePerMinute: 60, windowStartedAt: iso(T0 - 1_000), windowCount: 999 }, T0).allowance, 0, "never negative");
  });

  it("treats a window from the future (clock change) as expired and unknown rates as the default", () => {
    assert.equal(throttleAllowance({ ratePerMinute: 30, windowStartedAt: iso(T0 + 3_600_000), windowCount: 30 }, T0).allowance, 30);
    assert.equal(throttleAllowance({ ratePerMinute: 7 }, T0).allowance, DEFAULT_RATE_PER_MINUTE);
    assert.equal(normalizeRate("300"), 300);
    assert.equal(normalizeRate(1_000_000), DEFAULT_RATE_PER_MINUTE);
    assert.equal(normalizeRate(undefined), DEFAULT_RATE_PER_MINUTE);
  });

  it("estimates how long a send takes", () => {
    assert.equal(estimateSendMinutes(0, 60), 1);
    assert.equal(estimateSendMinutes(60, 60), 1);
    assert.equal(estimateSendMinutes(61, 60), 2);
    assert.equal(estimateSendMinutes(5_000, 600), 9);
  });
});

describe("schedule time", () => {
  it("accepts a time at least a minute ahead and normalizes it to UTC", () => {
    assert.deepEqual(parseScheduleTime("2026-03-01T12:30:00+02:00", T0), { ok: true, at: "2026-03-01T10:30:00.000Z" });
  });

  it("refuses the past, the immediate future, the far future and junk", () => {
    assert.equal(parseScheduleTime(iso(T0 - 1), T0).ok, false);
    assert.equal(parseScheduleTime(iso(T0 + 30_000), T0).ok, false);
    assert.equal(parseScheduleTime(iso(T0 + 400 * 86_400_000), T0).ok, false);
    for (const junk of ["", "tomorrow", null, 42, undefined]) assert.equal(parseScheduleTime(junk, T0).ok, false, String(junk));
  });
});

describe("phases, progress and rates", () => {
  it("derives the phase from the status and the pause/stop marks", () => {
    assert.equal(broadcastPhase({ status: "draft" }), "draft");
    assert.equal(broadcastPhase({ status: "scheduled" }), "scheduled");
    assert.equal(broadcastPhase({ status: "sending" }), "sending");
    assert.equal(broadcastPhase({ status: "sending", pausedAt: iso(T0) }), "paused");
    assert.equal(broadcastPhase({ status: "sent" }), "sent");
    assert.equal(broadcastPhase({ status: "sent", canceledAt: iso(T0) }), "stopped");
    assert.equal(isEditable({ status: "scheduled" }), true);
    assert.equal(isEditable({ status: "sending" }), false);
  });

  it("reports progress from the queue while sending and from the counters afterwards", () => {
    assert.deepEqual(sendProgress({ status: "sending", recipients: 10, queued: 3, skipped: 1, pending: ["m:a", "m:b", "m:c", "m:d", "m:e", "m:f"] }), { total: 10, done: 4, remaining: 6, percent: 40 });
    assert.deepEqual(sendProgress({ status: "sent", recipients: 10, queued: 9, skipped: 1 }), { total: 10, done: 10, remaining: 0, percent: 100 });
    assert.equal(sendProgress({ status: "sent", recipients: 10, queued: 4, skipped: 0 }).percent, 40, "a stopped send keeps its real share");
    assert.equal(sendProgress({ status: "draft", recipients: 0 }).percent, 0);
  });

  it("computes rates against delivered emails, falling back to queued ones", () => {
    const rates = broadcastRates({ queued: 200, delivered: 100, failed: 2, opens: 40, clicks: 10, unsubscribes: 1 });
    assert.deepEqual(rates, { queued: 200, delivered: 100, failed: 2, openRate: 40, clickRate: 10, clickToOpenRate: 25, unsubscribeRate: 1 });
    assert.equal(broadcastRates({ queued: 50, opens: 10, clicks: 0 }).openRate, 20);
    assert.equal(broadcastRates({ opens: 0, clicks: 0 }).openRate, 0);
  });
});

describe("broadcast list filters", () => {
  const rows = [
    { id: "a", status: "draft" as const, subject: "Spring sale", body: "Hello", updatedAt: "2026-03-01T00:00:00.000Z" },
    { id: "b", status: "sent" as const, subject: "Welcome", body: "spring is here", sentAt: "2026-03-03T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
    { id: "c", status: "sending" as const, subject: "Now", body: "x", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "d", status: "scheduled" as const, subject: "Later", body: "y", scheduledAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-03-02T00:00:00.000Z" },
  ];

  it("puts the broadcast being sent first, then the most recent", () => {
    assert.deepEqual(filterBroadcasts(rows, { status: "all", q: "" }).map((r) => r.id), ["c", "b", "d", "a"]);
  });

  it("filters by status and searches subject and body", () => {
    assert.deepEqual(filterBroadcasts(rows, { status: "draft", q: "" }).map((r) => r.id), ["a"]);
    assert.deepEqual(filterBroadcasts(rows, { status: "all", q: "SPRING" }).map((r) => r.id), ["b", "a"]);
  });

  it("parses query parameters defensively", () => {
    assert.deepEqual(parseBroadcastFilters({ status: "sent", q: "  hi  ", page: "3" }), { status: "sent", q: "hi", page: 3 });
    assert.deepEqual(parseBroadcastFilters({ status: "constructor", page: "-2" }), { status: "all", q: "", page: 1 });
    assert.deepEqual(parseBroadcastFilters({ status: ["draft", "sent"], page: "abc" }), { status: "draft", q: "", page: 1 });
  });
});

describe("campaign content", () => {
  it("normalizes and accepts a valid message", () => {
    const { value, errors } = checkContent({ subject: "  Hello\n {{ first_name }}  ", preheader: "", body: "Hi {{first_name}},\r\nsee {{ site_url }}\n" }, "broadcast");
    assert.deepEqual(errors, {});
    assert.deepEqual(value, { subject: "Hello {{ first_name }}", body: "Hi {{first_name}},\nsee {{ site_url }}" });
  });

  it("requires a subject and a body and enforces the limits", () => {
    const { errors } = checkContent({ subject: "", body: "   " }, "broadcast");
    assert.deepEqual(Object.keys(errors).sort(), ["body", "subject"]);
    assert.ok(checkContent({ subject: "x".repeat(201), body: "ok" }, "broadcast").errors.subject);
    assert.ok(checkContent({ subject: "ok", preheader: "y".repeat(151), body: "ok" }, "broadcast").errors.preheader);
    assert.ok(checkContent({ subject: "ok", body: "z".repeat(50_001) }, "broadcast").errors.body);
  });

  it("flags placeholder typos, and course placeholders outside sequences", () => {
    assert.deepEqual(unknownPlaceholders("Hi {{ firstname }} {{ first_name }} {{ course_title }} {{firstname}}", "broadcast"), ["firstname", "course_title"]);
    assert.deepEqual(unknownPlaceholders("Hi {{ first_name }} on {{ course_title }}: {{ course_url }}", "sequence"), []);
    assert.match(checkContent({ subject: "Hi {{ nmae }}", body: "ok" }, "broadcast").errors.subject!, /\{\{ nmae \}\}/);
    assert.ok(checkContent({ subject: "ok", body: "{{ course_title }}" }, "broadcast").errors.body);
    assert.deepEqual(checkContent({ subject: "ok", body: "{{ course_title }}" }, "sequence", "steps.2.").errors, {});
    assert.ok(checkContent({ subject: "", body: "x" }, "sequence", "steps.2.").errors["steps.2.subject"]);
  });

  it("falls back to a friendly word when the name is unknown", () => {
    assert.deepEqual(personalValues({ name: "Ada Lovelace", firstName: "Ada", email: "ada@example.com" }), { first_name: "Ada", name: "Ada Lovelace", email: "ada@example.com" });
    assert.deepEqual(personalValues({ name: "", firstName: "", email: "x@example.com" }), { first_name: "there", name: "there", email: "x@example.com" });
  });

  it("encodes recipients compactly and parses address lists", () => {
    assert.equal(recipientRef({ kind: "member", id: "usr_1" }), "m:usr_1");
    assert.equal(recipientRef({ kind: "lead", id: "lead_9" }), "l:lead_9");
    assert.deepEqual(parseRecipientRef("l:lead_9"), { kind: "lead", id: "lead_9" });
    for (const bad of ["", "x:1", "m:", "m:a b", "m:../x"]) assert.equal(parseRecipientRef(bad), null, bad);
    assert.deepEqual(parseAddressList(" A@x.io, b@x.io;\n a@x.io  c@x.io "), ["a@x.io", "b@x.io", "c@x.io"]);
  });
});

describe("unsubscribe attribution", () => {
  const prefs = (announcements: boolean) => ({ announcements }) as EmailPreferences;

  it("credits the last marketing email each unsubscribed address received", () => {
    const counts = countUnsubscribes({
      emails: [
        { to: "a@x.io", userId: "u_a", trackingId: "broadcast:b1", createdAt: "2026-03-01T00:00:00.000Z" },
        { to: "a@x.io", userId: "u_a", trackingId: "broadcast:b2", createdAt: "2026-03-05T00:00:00.000Z" },
        { to: "b@x.io", userId: "u_b", trackingId: "broadcast:b1", createdAt: "2026-03-01T00:00:00.000Z" },
        { to: "c@x.io", userId: "u_c", trackingId: "broadcast:b1", createdAt: "2026-03-01T00:00:00.000Z" },
        { to: "c@x.io", userId: "u_c", trackingId: "sequence:s1:step_2", createdAt: "2026-03-02T00:00:00.000Z" },
        { to: "c@x.io", userId: "u_c", createdAt: "2026-03-09T00:00:00.000Z" },
        { to: "lead@x.io", trackingId: "sequence:s1:step_1", createdAt: "2026-03-01T00:00:00.000Z" },
        { to: "old@x.io", trackingId: "broadcast:b1", createdAt: "2026-03-01T00:00:00.000Z" },
      ],
      users: [
        { id: "u_a", emailPreferences: prefs(false) },
        { id: "u_b", emailPreferences: prefs(true) },
        { id: "u_c", emailPreferences: prefs(false) },
      ],
      leads: [
        { email: "lead@x.io", unsubscribedAt: "2026-03-02T00:00:00.000Z" },
        { email: "old@x.io", unsubscribedAt: "2026-02-01T00:00:00.000Z" },
      ],
    });
    assert.deepEqual(Object.fromEntries(counts), { "broadcast:b2": 1, "sequence:s1": 2 });
  });
});

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

const OPTED_OUT: EmailPreferences = { enrollment: true, announcements: false, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: true };

function members(count: number): User[] {
  return Array.from({ length: count }, (_, i) => makeUser({ id: `usr_m${String(i).padStart(3, "0")}`, name: `Member ${String(i).padStart(3, "0")}`, email: `m${i}@example.com` }));
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return { id: "lead_1", email: "lead@example.org", name: "Lee Lead", source: "footer", consent: true, confirmedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

const admin = makeUser({ id: "usr_admin", name: "Avery Admin", email: "admin@example.com", roles: ["admin"] });

async function draft(overrides: { subject?: string; body?: string; segment?: unknown; preheader?: string } = {}): Promise<Broadcast> {
  const result = await saveBroadcast(admin, {
    subject: overrides.subject ?? "News for {{ first_name }}",
    preheader: overrides.preheader,
    body: overrides.body ?? "Hi {{ first_name }},\n\nRead [the post](https://example.com/post) on {{ site_name }}.",
    segment: overrides.segment ?? { roles: ["student"] },
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.broadcast;
}

const row = async (id: string) => (await getDb()).broadcasts.find((b) => b.id === id)!;
const campaignEmails = async (id: string) => (await getDb()).emails.filter((e) => e.trackingId === `broadcast:${id}`);

describe("broadcast drafts", () => {
  before(() => setCommsAutoRun(false));
  beforeEach(async () => {
    await resetDb({ users: [admin, ...members(3)] });
  });

  it("creates a draft and reports field errors", async () => {
    const bad = await saveBroadcast(admin, { subject: "", body: "Hi {{ frist_name }}", segment: {} });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys((bad as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}).sort(), ["body", "subject"]);

    const created = await draft({ segment: { roles: ["student", "wizard"], inactiveDays: "30" } });
    assert.equal(created.status, "draft");
    assert.match(created.id, /^bc_/);
    assert.deepEqual(created.segment, { roles: ["student"], inactiveDays: 30 }, "the audience is validated against real roles");
    assert.equal(created.createdById, admin.id);
  });

  it("refuses an audience that can't be read or names deleted courses instead of saving \"All members\"", async () => {
    const before = (await getDb()).broadcasts.length;
    for (const segment of [null, undefined, "{bad json", [], 42, { courseIds: "crs_x" }]) {
      const result = await saveBroadcast(admin, { subject: "Hello", body: "Hi", segment });
      assert.equal(result.ok, false, `segment ${JSON.stringify(segment)} is rejected`);
      assert.match((result as { fieldErrors?: Record<string, string> }).fieldErrors?.segment ?? "", /couldn't be read/);
    }
    for (const segment of [{ courseIds: ["crs_missing"] }, { notEnrolledCourseIds: ["crs_missing"] }, { roles: ["student"], courseIds: ["crs_missing"] }]) {
      const result = await saveBroadcast(admin, { subject: "Hello", body: "Hi", segment });
      assert.equal(result.ok, false);
      assert.match((result as { error: string }).error, /no longer exists/);
    }
    assert.equal((await getDb()).broadcasts.length, before, "nothing was saved");
    const created = await draft({ segment: {} });
    assert.deepEqual(created.segment, {}, "an empty filter chosen on purpose still saves");
  });

  it("edits drafts and scheduled broadcasts only", async () => {
    const created = await draft();
    const edited = await saveBroadcast(admin, { id: created.id, subject: "Changed", body: "New body", segment: {} });
    assert.ok(edited.ok);
    assert.equal((await row(created.id)).subject, "Changed");

    assert.ok((await startBroadcast(created.id, { now: T0 })).ok);
    const late = await saveBroadcast(admin, { id: created.id, subject: "Too late", body: "x", segment: {} });
    assert.equal(late.ok, false);
    assert.equal((await row(created.id)).subject, "Changed");
    assert.equal((await saveBroadcast(admin, { id: "bc_missing", subject: "a", body: "b", segment: {} })).ok, false);
  });

  it("duplicates into a fresh draft and deletes, but not while sending", async () => {
    const created = await draft();
    assert.ok((await startBroadcast(created.id, { now: T0 })).ok);
    const dup = await duplicateBroadcast(admin, created.id);
    assert.ok(dup.ok);
    assert.equal(dup.broadcast.status, "draft");
    assert.equal(dup.broadcast.subject, created.subject);
    assert.notEqual(dup.broadcast.id, created.id);
    assert.equal(dup.broadcast.recipients, 0);

    assert.equal((await deleteBroadcast(created.id)).ok, false, "actively sending");
    assert.ok((await pauseBroadcast(created.id)).ok);
    assert.ok((await deleteBroadcast(created.id)).ok, "paused can be deleted");
    assert.deepEqual((await getDb()).broadcasts.map((b) => b.id), [dup.broadcast.id]);
  });

  it("lists with counts per status", async () => {
    const a = await draft({ subject: "Alpha" });
    await draft({ subject: "Beta" });
    assert.ok((await scheduleBroadcast(a.id, iso(Date.now() + 3_600_000), 60)).ok);
    const list = await listBroadcasts({ status: "all", q: "", page: 1 });
    assert.deepEqual(list.counts, { all: 2, draft: 1, scheduled: 1, sending: 0, sent: 0 });
    assert.deepEqual((await listBroadcasts({ status: "scheduled", q: "", page: 1 })).rows.map((r) => r.broadcast.subject), ["Alpha"]);
    assert.equal((await listBroadcasts({ status: "all", q: "beta", page: 9 })).page, 1);
    assert.equal(list.rows[0]!.authorName, "Avery Admin");
    assert.equal(broadcastCsvRows((await getDb()).broadcasts, () => "Avery Admin").length, 3);
  });
});

describe("sending a broadcast", () => {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());

  it("captures the audience and queues it in throttled batches", async () => {
    await resetDb({ users: [admin, ...members(70)] });
    const b = await draft();
    const started = await startBroadcast(b.id, { rate: 30, now: T0 });
    assert.ok(started.ok);
    assert.equal(started.broadcast.recipients, 70);
    assert.equal((await row(b.id)).pending!.length, 70);

    const first = await processBroadcasts(T0);
    assert.equal(first.queued, 30);
    assert.equal(first.nextAt, T0 + 60_000);
    assert.equal((await campaignEmails(b.id)).length, 30);

    const tooSoon = await processBroadcasts(T0 + 10_000);
    assert.equal(tooSoon.queued, 0, "the minute's allowance is used up");
    assert.equal(tooSoon.nextAt, T0 + 60_000);

    const second = await processBroadcasts(T0 + 60_000);
    assert.equal(second.queued, 30);
    assert.equal((await row(b.id)).status, "sending");

    const third = await processBroadcasts(T0 + 120_000);
    assert.equal(third.queued, 10);
    assert.equal(third.finished, 1);
    const done = await row(b.id);
    assert.equal(done.status, "sent");
    assert.equal(done.sentAt, iso(T0 + 120_000));
    assert.equal(done.queued, 70);
    assert.equal(done.pending, undefined);

    const emails = await campaignEmails(b.id);
    assert.equal(emails.length, 70);
    assert.equal(new Set(emails.map((e) => e.to)).size, 70, "one copy per address");
    const author = (await getDb()).notifications.filter((n) => n.userId === admin.id);
    assert.equal(author.length, 1, "the author is told once");
  });

  it("personalizes every copy, tracks it and gives each recipient their own unsubscribe link", async () => {
    await resetDb({
      users: [admin, makeUser({ id: "usr_ada", name: 'Ada <b>"Lovelace"</b>', email: "ada@example.com" })],
      leads: [lead()],
    });
    const forMembers = await draft({ preheader: "Just for {{ first_name }}" });
    assert.ok((await startBroadcast(forMembers.id, { now: T0 })).ok);
    await processBroadcasts(T0);
    const [memberMail] = await campaignEmails(forMembers.id);
    assert.ok(memberMail);
    assert.equal(memberMail.to, "ada@example.com");
    assert.equal(memberMail.userId, "usr_ada");
    assert.equal(memberMail.subject, "News for Ada");
    assert.equal(memberMail.category, "announcement");
    assert.ok(memberMail.html.includes("Hi Ada,"), "first name in the body");
    assert.ok(!memberMail.html.includes("<b>"), "names never add markup");
    assert.ok(memberMail.html.includes("Just for Ada"), "preheader personalized");
    assert.ok(memberMail.html.includes(`/api/email/o/${memberMail.id}.`), "open pixel");
    assert.ok(memberMail.html.includes(`/api/email/c/${memberMail.id}?u=https%3A%2F%2Fexample.com%2Fpost`), "tracked link");
    assert.match(memberMail.html, /settings\/notifications\?unsubscribe=announcements&amp;u=usr_ada&amp;t=/);
    assert.ok(memberMail.text.includes("https://example.com/post"), "plain text keeps direct links");

    const forLeads = await draft({ segment: { leadsOnly: true }, subject: "Hello {{ first_name }}" });
    assert.ok((await startBroadcast(forLeads.id, { now: T0 })).ok);
    await processBroadcasts(T0);
    const [leadMail] = await campaignEmails(forLeads.id);
    assert.ok(leadMail);
    assert.equal(leadMail.to, "lead@example.org");
    assert.equal(leadMail.userId, undefined);
    assert.equal(leadMail.subject, "Hello Lee");
    assert.match(leadMail.html, /\/free\/unsubscribe\?l=lead_1&amp;t=/);
    assert.ok(!leadMail.html.includes("settings/notifications?unsubscribe"));
  });

  it("re-checks every recipient right before queueing", async () => {
    await resetDb({ users: [admin, ...members(4)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { now: T0 })).ok);
    await mutate((db) => {
      db.users.find((u) => u.id === "usr_m000")!.emailPreferences = OPTED_OUT;
      db.users.find((u) => u.id === "usr_m001")!.enabled = false;
      db.users = db.users.filter((u) => u.id !== "usr_m002");
    });
    const run = await processBroadcasts(T0);
    assert.equal(run.queued, 1);
    assert.equal(run.skipped, 3);
    const done = await row(b.id);
    assert.equal(done.status, "sent");
    assert.equal(done.recipients, 4);
    assert.equal(done.queued, 1);
    assert.equal(done.skipped, 3);
    assert.deepEqual((await campaignEmails(b.id)).map((e) => e.to), ["m3@example.com"]);
  });

  it("never queues an address twice, even when the bookkeeping of a batch was lost", async () => {
    await resetDb({ users: [admin, ...members(3)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { now: T0 })).ok);
    await processBroadcasts(T0);
    assert.equal((await campaignEmails(b.id)).length, 3);
    // Simulate a crash after the emails were stored but before the queue was updated.
    await mutate((db) => {
      const live = db.broadcasts.find((x) => x.id === b.id)!;
      live.status = "sending";
      live.sentAt = undefined;
      live.pending = ["m:usr_m000", "m:usr_m001", "m:usr_m002"];
      live.queued = 0;
      live.windowStartedAt = undefined;
    });
    const again = await processBroadcasts(T0 + 5_000);
    assert.equal(again.queued, 0);
    assert.equal((await campaignEmails(b.id)).length, 3);
    assert.equal((await row(b.id)).queued, 3, "the earlier emails are counted");
    assert.equal((await row(b.id)).status, "sent");
  });

  it("pauses, resumes and stops", async () => {
    await resetDb({ users: [admin, ...members(50)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { rate: 30, now: T0 })).ok);
    await processBroadcasts(T0);
    assert.ok((await pauseBroadcast(b.id)).ok);
    assert.equal(broadcastPhase(await row(b.id)), "paused");
    assert.equal((await processBroadcasts(T0 + 61_000)).queued, 0, "nothing goes out while paused");

    assert.ok((await resumeBroadcast(b.id)).ok);
    assert.equal((await resumeBroadcast(b.id)).ok, false, "not paused any more");
    await mutate((db) => {
      db.broadcasts.find((x) => x.id === b.id)!.ratePerMinute = 30;
    });
    // 20 are left; stop before they go out.
    const stopped = await cancelBroadcast(b.id);
    assert.ok(stopped.ok);
    const done = await row(b.id);
    assert.equal(broadcastPhase(done), "stopped");
    assert.equal(done.queued, 30);
    assert.equal(done.pending, undefined);
    assert.equal((await processBroadcasts(T0 + 120_000)).queued, 0);
    assert.equal((await campaignEmails(b.id)).length, 30);
    assert.equal((await cancelBroadcast(b.id)).ok, false);
  });

  it("refuses to send to nobody, when email is off, or twice", async () => {
    await resetDb({ users: [admin] });
    const nobody = await draft({ segment: { roles: ["student"] } });
    const empty = await startBroadcast(nobody.id, { now: T0 });
    assert.equal(empty.ok, false);
    assert.match((empty as { error: string }).error, /Nobody matches/);
    assert.equal((await row(nobody.id)).status, "draft");

    await resetDb({ users: [admin, ...members(2)], settings: { email: { enabled: false } } });
    const off = await draft();
    assert.match(((await startBroadcast(off.id, { now: T0 })) as { error: string }).error, /Email is turned off/);
    assert.equal((await scheduleBroadcast(off.id, iso(Date.now() + 3_600_000), 60)).ok, false);

    await resetDb({ users: [admin, ...members(2)] });
    const once = await draft();
    assert.ok((await startBroadcast(once.id, { now: T0 })).ok);
    assert.equal((await startBroadcast(once.id, { now: T0 })).ok, false);
  });

  it("waits while email is switched off and continues afterwards", async () => {
    await resetDb({ users: [admin, ...members(2)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { now: T0 })).ok);
    await mutate((db) => {
      db.settings.email = { ...db.settings.email, enabled: false };
    });
    const waiting = await processBroadcasts(T0);
    assert.equal(waiting.emailDisabled, true);
    assert.equal(waiting.queued, 0);
    await mutate((db) => {
      db.settings.email = { ...db.settings.email, enabled: true };
    });
    assert.equal((await processBroadcasts(T0 + 1_000)).queued, 2);
  });
});

describe("scheduled broadcasts", () => {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());

  it("start at their time, not before", async () => {
    await resetDb({ users: [admin, ...members(3)] });
    const b = await draft();
    const at = T0 + 3_600_000;
    const scheduled = await scheduleBroadcast(b.id, iso(at), 300, T0);
    assert.ok(scheduled.ok);
    assert.equal(scheduled.broadcast.status, "scheduled");
    assert.equal(scheduled.broadcast.ratePerMinute, 300);

    const early = await processBroadcasts(at - 1);
    assert.equal(early.started, 0);
    assert.equal(early.nextAt, at);
    assert.equal((await campaignEmails(b.id)).length, 0);

    const due = await processBroadcasts(at);
    assert.equal(due.started, 1);
    assert.equal(due.queued, 3);
    assert.equal((await row(b.id)).status, "sent");
    assert.equal((await getDb()).auditEvents.filter((e) => e.action === "broadcast.send" && e.meta?.scheduled === true).length, 1);
  });

  it("can be cancelled back to a draft", async () => {
    await resetDb({ users: [admin, ...members(1)] });
    const b = await draft();
    assert.ok((await scheduleBroadcast(b.id, iso(T0 + 3_600_000), 60, T0)).ok);
    assert.ok((await unscheduleBroadcast(b.id)).ok);
    const back = await row(b.id);
    assert.equal(back.status, "draft");
    assert.equal(back.scheduledAt, undefined);
    assert.equal((await unscheduleBroadcast(b.id)).ok, false);
    assert.equal((await processBroadcasts(T0 + 7_200_000)).started, 0);
  });

  it("go back to a draft and tell the author when nobody matches at send time", async () => {
    await resetDb({ users: [admin, ...members(1)] });
    const b = await draft();
    assert.ok((await scheduleBroadcast(b.id, iso(T0 + 3_600_000), 60, T0)).ok);
    await mutate((db) => {
      db.users.find((u) => u.id === "usr_m000")!.emailPreferences = OPTED_OUT;
    });
    const run = await processBroadcasts(T0 + 3_600_000);
    assert.equal(run.started, 0);
    assert.equal((await row(b.id)).status, "draft");
    const note = (await getDb()).notifications.find((n) => n.userId === admin.id);
    assert.match(note?.subject ?? "", /was not sent/);
    assert.equal(note?.link, `/admin/broadcasts/${b.id}`);
  });

  it("refuse to start when a course of the audience was deleted after saving, instead of widening it", async () => {
    await resetDb({ users: [admin, ...members(3)], courses: [makeCourse({ id: "crs_gone" })] });
    const now = await draft({ segment: { notEnrolledCourseIds: ["crs_gone"] } });
    const later = await draft({ segment: { notEnrolledCourseIds: ["crs_gone"] } });
    assert.ok((await scheduleBroadcast(later.id, iso(T0 + 3_600_000), 60, T0)).ok);
    await mutate((db) => {
      db.courses = db.courses.filter((c) => c.id !== "crs_gone");
    });
    const started = await startBroadcast(now.id, { now: T0 });
    assert.equal(started.ok, false);
    assert.match((started as { error: string }).error, /no longer exists/);
    assert.equal((await row(now.id)).status, "draft");

    const run = await processBroadcasts(T0 + 3_600_000);
    assert.equal(run.started, 0);
    assert.equal((await row(later.id)).status, "draft", "the scheduled one goes back to a draft");
    assert.equal((await campaignEmails(now.id)).length + (await campaignEmails(later.id)).length, 0, "nobody was emailed");
  });
});

describe("broadcast statistics", () => {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());

  it("copies delivery results and unsubscribes onto the broadcast, and keeps them when the outbox is cleaned", async () => {
    await resetDb({ users: [admin, ...members(4)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { now: Date.now() })).ok);
    await runComms({ wait: true });
    await deliverDueEmails(500, { wait: true, force: true });
    const emails = await campaignEmails(b.id);
    assert.equal(emails.length, 4);

    // One recipient opens and clicks, another unsubscribes, one email fails.
    const opened = emails[0]!;
    await recordEmailHit(opened.id, { type: "click", url: "https://example.com/post" });
    await mutate((db) => {
      db.users.find((u) => u.id === emails[1]!.userId)!.emailPreferences = OPTED_OUT;
      const failed = db.emails.find((e) => e.id === emails[2]!.id)!;
      failed.status = "failed";
    });
    assert.ok((await refreshCampaignStats()) >= 1);
    let stats = await row(b.id);
    assert.equal(stats.delivered, 3);
    assert.equal(stats.failed, 1);
    assert.equal(stats.unsubscribes, 1);
    assert.equal(stats.opens, 1);
    assert.equal(stats.clicks, 1);

    const report = await getBroadcastReport(b.id);
    assert.ok(report);
    assert.equal(report.events.uniqueClicks, 1);
    assert.deepEqual(report.events.links.map((l) => l.url), ["https://example.com/post"]);
    assert.deepEqual(report.conditions, ["Students"]);
    assert.equal(report.waiting, 0);

    await mutate((db) => {
      db.emails = [];
    });
    assert.equal(await refreshCampaignStats(), 0, "nothing to update");
    stats = await row(b.id);
    assert.equal(stats.delivered, 3, "kept after the outbox clean-up");
    assert.equal(stats.unsubscribes, 1);
  });
});

describe("test sends", () => {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    resetEmailQuotas();
    resetTestSendLimits();
    await resetDb({ users: [admin] });
  });

  const content = { subject: "Hello {{ first_name }}", body: "Hi {{ first_name }}, visit [us](https://example.com)." };

  it("go to the sender by default, marked as a test and untracked", async () => {
    const result = await sendCampaignTest(admin, content, "");
    assert.deepEqual(result, { ok: true, sent: ["admin@example.com"], pending: [] });
    const [mail] = (await getDb()).emails;
    assert.ok(mail);
    assert.equal(mail.subject, "[Test] Hello Avery");
    assert.equal(mail.category, "test");
    assert.equal(mail.trackingId, undefined);
    assert.ok(!mail.html.includes("/api/email/"), "no pixel, no redirects");
    assert.ok(mail.html.includes("Test email sent by Avery Admin"));
    assert.ok(!mail.html.includes("unsubscribe="), "no working unsubscribe link in a test");
  });

  it("accept a few other addresses and refuse invalid or too many", async () => {
    const result = await sendCampaignTest(admin, content, "qa@example.org, Admin@Example.com");
    assert.ok(result.ok);
    assert.deepEqual(result.sent.sort(), ["admin@example.com", "qa@example.org"]);
    const other = (await getDb()).emails.find((e) => e.to === "qa@example.org")!;
    assert.equal(other.subject, "[Test] Hello there");
    assert.equal(other.userId, undefined);

    assert.equal((await sendCampaignTest(admin, content, "not-an-address")).ok, false);
    assert.equal((await sendCampaignTest(admin, content, "a@x.io b@x.io c@x.io d@x.io e@x.io f@x.io")).ok, false);
  });

  it("are rate limited per staff member and need email to be on", async () => {
    for (let i = 0; i < 10; i++) assert.ok((await sendCampaignTest(admin, content, "")).ok, `test ${i}`);
    const blocked = await sendCampaignTest(admin, content, "");
    assert.equal(blocked.ok, false);
    assert.match((blocked as { error: string }).error, /Try again/);

    resetTestSendLimits();
    await resetDb({ users: [admin], settings: { email: { enabled: false } } });
    assert.match(((await sendCampaignTest(admin, content, "")) as { error: string }).error, /Email is turned off/);
  });
});

describe("/api/cron/comms", () => {
  before(() => {
    setCommsAutoRun(false);
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());

  const request = (url: string, headers: Record<string, string> = {}): NextRequest =>
    Object.assign(new Request(url, { headers }), { nextUrl: new URL(url) }) as unknown as NextRequest;

  it("needs the cron key", async () => {
    await resetDb({ users: [admin] });
    assert.equal((await cronGET(request("http://localhost:3000/api/cron/comms"))).status, 401);
    assert.equal((await cronGET(request("http://localhost:3000/api/cron/comms?key=nope"))).status, 401);
    assert.equal((await cronGET(request("http://localhost:3000/api/cron/comms", { authorization: "Bearer wrong" }))).status, 401);
  });

  it("runs the due work and reports it", async () => {
    await resetDb({ users: [admin, ...members(2)] });
    const b = await draft();
    assert.ok((await startBroadcast(b.id, { now: Date.now() })).ok);
    const response = await cronGET(request(`http://localhost:3000/api/cron/comms?key=${cronKey()}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as { ok: boolean; broadcasts: { queued: number; finished: number } };
    assert.equal(body.ok, true);
    assert.deepEqual([body.broadcasts.queued, body.broadcasts.finished], [2, 1]);

    const bearer = await cronGET(request("http://localhost:3000/api/cron/comms", { authorization: `Bearer ${cronKey()}` }));
    assert.equal(bearer.status, 200);
    assert.equal(((await bearer.json()) as { broadcasts: { queued: number } }).broadcasts.queued, 0, "nothing left to do");
  });
});
