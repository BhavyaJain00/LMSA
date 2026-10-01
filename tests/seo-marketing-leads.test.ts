import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Lead } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { confirmLeadAction, deleteLeadsAction, resendLeadConfirmationsAction, submitLeadAction, unsubscribeLeadAction } from "@/lib/actions/leads";
import { getAdminLeads, getFreeResources } from "@/lib/seo/lead-capture";
import { CONFIRM_TTL_MS, checkConfirmLink, checkUnsubscribeLink, confirmToken, isLeadId, leadConfirmUrl, leadUnsubscribeUrl, unsubscribeLeadToken } from "@/lib/seo/lead-tokens";
import { MIN_FILL_MS, filterLeads, leadCsvRows, leadSourceLabel, leadStats, leadStatus, looksAutomated, normalizeLeadSource } from "@/lib/seo/leads";
import { buildRobots } from "@/lib/seo/robots";
import { buildSettings, makeCourseTree, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

function lead(overrides: Partial<Lead> = {}): Lead {
  return { id: "lead_1", email: "ana@example.com", source: "blog", consent: true, createdAt: "2026-01-10T10:00:00.000Z", ...overrides };
}

describe("lead rules", () => {
  it("normalizes sources and labels them", () => {
    assert.equal(normalizeLeadSource("  Course:CRS_js "), "course:crs_js");
    assert.equal(normalizeLeadSource("<script>"), "website");
    assert.equal(normalizeLeadSource(undefined), "website");
    assert.equal(leadSourceLabel("course:crs_js"), "Course page");
    assert.equal(leadSourceLabel("free"), "Free resources page");
    assert.equal(leadSourceLabel("webinar"), "Webinar");
  });

  it("derives the status from the dates", () => {
    assert.equal(leadStatus(lead()), "pending");
    assert.equal(leadStatus(lead({ confirmedAt: "2026-01-11T00:00:00Z" })), "confirmed");
    assert.equal(leadStatus(lead({ confirmedAt: "2026-01-11T00:00:00Z", unsubscribedAt: "2026-01-12T00:00:00Z" })), "unsubscribed");
  });

  it("filters by status, source kind, course, search and dates, newest first", () => {
    const leads = [
      lead({ id: "a", email: "a@x.io", source: "course:c1", courseId: "c1", createdAt: "2026-01-01T09:00:00Z", confirmedAt: "2026-01-01T10:00:00Z" }),
      lead({ id: "b", email: "b@x.io", name: "Bea Smith", source: "footer", createdAt: "2026-01-05T09:00:00Z" }),
      lead({ id: "c", email: "c@x.io", source: "course:c2", courseId: "c2", createdAt: "2026-01-09T09:00:00Z" }),
    ];
    assert.deepEqual(filterLeads(leads, {}).map((l) => l.id), ["c", "b", "a"]);
    assert.deepEqual(filterLeads(leads, { status: "confirmed" }).map((l) => l.id), ["a"]);
    assert.deepEqual(filterLeads(leads, { source: "course" }).map((l) => l.id), ["c", "a"]);
    assert.deepEqual(filterLeads(leads, { courseId: "c2" }).map((l) => l.id), ["c"]);
    assert.deepEqual(filterLeads(leads, { search: "smith" }).map((l) => l.id), ["b"]);
    assert.deepEqual(filterLeads(leads, { from: "2026-01-02", to: "2026-01-05" }).map((l) => l.id), ["b"]);
    assert.deepEqual(filterLeads(leads, { from: "bad" }).length, 3);
  });

  it("computes stats with confirmation rate, sources and a 30-day series", () => {
    const now = Date.parse("2026-01-15T12:00:00Z");
    const stats = leadStats(
      [
        lead({ id: "a", createdAt: "2026-01-15T08:00:00Z", confirmedAt: "2026-01-15T09:00:00Z" }),
        lead({ id: "b", createdAt: "2026-01-14T08:00:00Z", source: "course:c1" }),
        lead({ id: "c", createdAt: "2025-11-01T08:00:00Z", source: "footer", confirmedAt: "2025-11-01T09:00:00Z", unsubscribedAt: "2025-12-01T00:00:00Z" }),
      ],
      now,
    );
    assert.equal(stats.total, 3);
    assert.equal(stats.confirmed, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.unsubscribed, 1);
    assert.equal(stats.confirmationRate, 50);
    assert.equal(stats.last7Days, 2);
    assert.equal(stats.last30Days, 2);
    assert.equal(stats.daily.length, 30);
    assert.equal(stats.daily.at(-1)!.date, "2026-01-15");
    assert.equal(stats.daily.at(-1)!.count, 1);
    assert.deepEqual(
      stats.bySource.map((s) => s.source).sort(),
      ["blog", "course", "footer"],
    );
  });

  it("exports CSV rows with course titles", () => {
    const rows = leadCsvRows([lead({ courseId: "c1", name: "Ana" })], new Map([["c1", "SQL"]]));
    assert.equal(rows[0]![0], "Email");
    assert.deepEqual(rows[1]!.slice(0, 6), ["ana@example.com", "Ana", "pending", "blog", "SQL", "yes"]);
  });

  it("flags honeypots and inhuman fill times", () => {
    const now = 1_000_000;
    assert.equal(looksAutomated("", now - 5000, now), false);
    assert.equal(looksAutomated("http://spam", now - 5000, now), true);
    assert.equal(looksAutomated("", now - MIN_FILL_MS + 1, now), true);
    assert.equal(looksAutomated("", 0, now), true);
    assert.equal(looksAutomated("", NaN, now), true);
    assert.equal(looksAutomated("", now - 3 * 24 * 3600 * 1000, now), true);
  });
});

describe("lead links", () => {
  const who = { id: "lead_abc", email: "Ana@Example.com" };

  it("accepts a fresh confirmation link and rejects tampered, foreign or expired ones", () => {
    const now = Date.now();
    const url = new URL(leadConfirmUrl(who.id, who.email, now));
    assert.equal(url.pathname, "/free/confirm");
    const e = url.searchParams.get("e")!;
    const t = url.searchParams.get("t")!;
    assert.equal(checkConfirmLink(who, e, t, now), "ok");
    assert.equal(checkConfirmLink({ ...who, email: "ana@example.com" }, e, t, now), "ok", "case-insensitive email");
    assert.equal(checkConfirmLink({ ...who, email: "eve@example.com" }, e, t, now), "invalid");
    assert.equal(checkConfirmLink(who, String(Number(e) + 1000), t, now), "invalid");
    assert.equal(checkConfirmLink(who, e, `${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`, now), "invalid");
    assert.equal(checkConfirmLink(who, e, t, now + CONFIRM_TTL_MS + 1), "expired");
    assert.equal(checkConfirmLink(null, e, t, now), "invalid");
    assert.equal(checkConfirmLink(who, undefined, t, now), "invalid");
  });

  it("keeps confirmation and unsubscribe tokens apart", () => {
    const url = new URL(leadUnsubscribeUrl(who.id, who.email));
    const t = url.searchParams.get("t")!;
    assert.equal(checkUnsubscribeLink(who, t), true);
    assert.equal(checkUnsubscribeLink({ ...who, id: "lead_other" }, t), false);
    const expiresAt = Date.now() + 1000;
    assert.notEqual(confirmToken(who.id, who.email, expiresAt), unsubscribeLeadToken(who.id, who.email));
    assert.equal(checkUnsubscribeLink(who, confirmToken(who.id, who.email, expiresAt)), false);
  });

  it("keeps the signed-link pages out of search engines", () => {
    const robots = buildRobots(buildSettings(), "https://learn.example");
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
    const disallow = rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []));
    assert.ok(disallow.includes("/free/confirm"));
    assert.ok(disallow.includes("/free/unsubscribe"));
    assert.equal(disallow.includes("/free"), false);
  });

  it("validates lead ids", () => {
    assert.equal(isLeadId("lead_abc-1"), true);
    assert.equal(isLeadId("../etc"), false);
    assert.equal(isLeadId(""), false);
  });
});

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

let n = 0;
/** A unique address per call (the per-address limit is process-wide). */
const address = () => `visitor${++n}-${Date.now()}@example.com`;
const human = () => String(Date.now() - 5000);

function linkFields(url: string): FormData {
  const u = new URL(url);
  return form(Object.fromEntries(u.searchParams));
}

describe("lead actions", () => {
  const tree = makeCourseTree([[{ title: "Welcome", includeInPreview: true }, {}], [{}]], { course: { id: "crs_sql", slug: "sql", title: "SQL basics" } });

  beforeEach(async () => {
    resetRequest();
    await resetDb({
      users: [makeUser({ id: "usr_admin", roles: ["admin"] }), makeUser({ id: "usr_mod", roles: ["moderator"] })],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
    });
  });

  it("stores a sign-up and sends the confirmation email", async () => {
    const email = address();
    const result = await submitLeadAction(null, form({ email: email.toUpperCase(), name: "Ana", consent: "on", source: "course", courseId: "crs_sql", website: "", renderedAt: human() }));
    assert.deepEqual(result, { ok: true, data: { status: "confirmation_sent" } });
    const db = await getDb();
    const stored = db.leads.find((l) => l.email === email)!;
    assert.equal(stored.source, "course:crs_sql");
    assert.equal(stored.courseId, "crs_sql");
    assert.equal(stored.consent, true);
    assert.equal(stored.confirmedAt, undefined);
    const mail = db.emails.find((m) => m.to === email)!;
    assert.match(mail.subject, /Confirm/);
    assert.ok(mail.html.includes("/free/confirm?"));
  });

  it("answers bots like humans but stores nothing", async () => {
    const email = address();
    assert.equal((await submitLeadAction(null, form({ email, consent: "on", source: "blog", website: "spam", renderedAt: human() }))).ok, true);
    assert.equal((await submitLeadAction(null, form({ email, consent: "on", source: "blog", website: "", renderedAt: String(Date.now()) }))).ok, true);
    const db = await getDb();
    assert.equal(db.leads.length, 0);
    assert.equal(db.emails.length, 0);
  });

  it("requires consent and a valid address", async () => {
    const noConsent = await submitLeadAction(null, form({ email: address(), source: "blog", renderedAt: human() }));
    assert.equal(noConsent.ok, false);
    if (!noConsent.ok) assert.ok(noConsent.fieldErrors?.consent);
    const badEmail = await submitLeadAction(null, form({ email: "nope", consent: "on", source: "blog", renderedAt: human() }));
    assert.equal(badEmail.ok, false);
    if (!badEmail.ok) assert.ok(badEmail.fieldErrors?.email);
    assert.equal((await getDb()).leads.length, 0);
  });

  it("limits confirmation emails per address", async () => {
    const email = address();
    for (let i = 0; i < 5; i++) await submitLeadAction(null, form({ email, consent: "on", source: "footer", renderedAt: human() }));
    const db = await getDb();
    assert.equal(db.leads.filter((l) => l.email === email).length, 1);
    assert.equal(db.emails.filter((m) => m.to === email).length, 3);
  });

  it("ignores a course that is not public", async () => {
    const email = address();
    const db = await getDb();
    db.courses[0]!.published = false;
    await submitLeadAction(null, form({ email, consent: "on", source: "course", courseId: "crs_sql", renderedAt: human() }));
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(stored.courseId, undefined);
    assert.equal(stored.source, "course");
  });

  it("confirms through the signed link once and sends the syllabus", async () => {
    const email = address();
    await submitLeadAction(null, form({ email, consent: "on", source: "course", courseId: "crs_sql", renderedAt: human() }));
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    const first = await confirmLeadAction(linkFields(leadConfirmUrl(stored.id, stored.email)));
    assert.equal(first.ok, true);
    if (first.ok) assert.deepEqual(first.data, { courseSlug: "sql", courseTitle: "SQL basics" });
    const db = await getDb();
    assert.ok(db.leads.find((l) => l.id === stored.id)!.confirmedAt);
    const syllabus = db.emails.find((m) => m.to === email && m.subject.startsWith("Syllabus"))!;
    assert.ok(syllabus.html.includes("Welcome (free preview)"));
    assert.ok(syllabus.html.includes("/free/unsubscribe?"));
    const again = await confirmLeadAction(linkFields(leadConfirmUrl(stored.id, stored.email)));
    assert.equal(again.ok, true);
    assert.equal((await getDb()).emails.filter((m) => m.to === email && m.subject.startsWith("Syllabus")).length, 1);
  });

  it("refuses expired and forged confirmation links", async () => {
    const email = address();
    await submitLeadAction(null, form({ email, consent: "on", source: "blog", renderedAt: human() }));
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    const expired = await confirmLeadAction(linkFields(leadConfirmUrl(stored.id, stored.email, Date.now() - CONFIRM_TTL_MS - 1000)));
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.match(expired.error, /expired/);
    const forged = await confirmLeadAction(form({ l: stored.id, e: String(Date.now() + 10_000), t: "x".repeat(43) }));
    assert.equal(forged.ok, false);
    assert.equal((await getDb()).leads.find((l) => l.id === stored.id)!.confirmedAt, undefined);
  });

  it("unsubscribes through the signed link", async () => {
    const email = address();
    await submitLeadAction(null, form({ email, consent: "on", source: "blog", renderedAt: human() }));
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal((await unsubscribeLeadAction(form({ l: stored.id, t: "bad" }))).ok, false);
    assert.equal((await unsubscribeLeadAction(linkFields(leadUnsubscribeUrl(stored.id, stored.email)))).ok, true);
    assert.ok((await getDb()).leads.find((l) => l.id === stored.id)!.unsubscribedAt);
  });

  it("lets only admins delete leads and resend confirmations", async () => {
    const email = address();
    await submitLeadAction(null, form({ email, consent: "on", source: "free", renderedAt: human() }));
    const id = (await getDb()).leads[0]!.id;

    await createSession("usr_mod");
    assert.equal((await deleteLeadsAction([id])).ok, false);
    assert.equal((await resendLeadConfirmationsAction([id])).ok, false);

    resetRequest();
    await createSession("usr_admin");
    const resent = await resendLeadConfirmationsAction([id]);
    assert.equal(resent.ok, true);
    const deleted = await deleteLeadsAction([id, "lead_missing"]);
    assert.equal(deleted.ok, true);
    if (deleted.ok) assert.equal(deleted.data.deleted, 1);
    assert.equal((await getDb()).leads.length, 0);
  });

  it("lists leads for the admin with paging, stats and filter options", async () => {
    const db = await getDb();
    db.leads.push(
      lead({ id: "l1", email: "a@x.io", source: "course:crs_sql", courseId: "crs_sql", createdAt: new Date().toISOString() }),
      lead({ id: "l2", email: "b@x.io", source: "footer", createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString() }),
    );
    const list = await getAdminLeads({ pageSize: 1 });
    assert.equal(list.total, 2);
    assert.equal(list.pages, 2);
    assert.equal(list.rows.length, 1);
    assert.equal(list.stats.confirmed, 1);
    assert.deepEqual(list.sources, ["course", "footer"]);
    assert.deepEqual(list.courses, [{ id: "crs_sql", title: "SQL basics" }]);
    const course = await getAdminLeads({ courseId: "crs_sql" });
    assert.equal(course.rows[0]!.courseTitle, "SQL basics");
  });

  it("collects free courses and preview lessons for /free", async () => {
    const resources = await getFreeResources();
    assert.equal(resources.catalogOpen, true);
    assert.deepEqual(resources.freeCourses.map((c) => c.id), ["crs_sql"]);
    assert.deepEqual(resources.previews.map((p) => [p.title, p.href]), [["Welcome", "/courses/sql/learn/1-1"]]);

    const db = await getDb();
    db.settings.learning.allowGuestAccess = false;
    const closed = await getFreeResources();
    assert.equal(closed.catalogOpen, false);
    assert.equal(closed.previews.length, 0);
  });
});
