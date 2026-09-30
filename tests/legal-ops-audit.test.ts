import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { AuditEvent, Database } from "@/lib/types";
import {
  audit,
  auditActionGroup,
  auditEventsToCsv,
  auditFacets,
  auditFilterToQuery,
  auditTargetHref,
  countAuditEventsSince,
  describeAuditAction,
  describeAuditGroup,
  describeAuditTarget,
  filterAuditEvents,
  isAuditFilterActive,
  parseAuditFilter,
  searchParam,
  type AuditFilter,
} from "@/lib/audit";
import { clampRetentionDays, purgeExpiredRecords, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, retentionCutoff } from "@/lib/legal/retention";
import { maybePurgeExpiredRecords, RETENTION_INTERVAL_MS } from "@/lib/legal/retention-run";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { GET as exportGET } from "@/app/(app)/admin/audit/export/route";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Round 3 legal-ops part 2: audit log querying, CSV export and the retention purge. */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-30T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const root = makeUser({ id: "usr_root", name: "Root Admin", email: "root@example.com", roles: ["admin"] });
const mira = makeUser({ id: "usr_mira", name: "Mira Patel", email: "mira@example.com", roles: ["admin"] });
const sam = makeUser({ id: "usr_sam", name: "Sam Student", email: "sam@example.com" });

const actors = new Map([root, mira, sam].map((u) => [u.id, { name: u.name, email: u.email }]));

const events: AuditEvent[] = [
  { id: "aud_1", actorId: root.id, action: "course.publish", targetType: "course", targetId: "crs_js", meta: { title: "Modern JavaScript" }, ip: "203.0.113.7", createdAt: "2026-06-01T09:00:00.000Z" },
  { id: "aud_2", actorId: mira.id, action: "user.roles", targetType: "user", targetId: sam.id, meta: { from: "student", to: "student,moderator" }, createdAt: "2026-06-02T23:59:59.000Z" },
  { id: "aud_3", action: "retention.purge", meta: { auditEvents: 4, errorEvents: 0, consents: 1 }, createdAt: "2026-06-03T00:00:00.000Z" },
  { id: "aud_4", actorId: root.id, action: "course.delete", targetType: "course", targetId: "crs_old", meta: { title: "Old course", slug: "old" }, createdAt: "2026-06-04T10:00:00.000Z" },
  { id: "aud_5", actorId: root.id, action: "payment.refund", targetType: "payment", targetId: "pay_9", meta: { amount: "remaining", viaGateway: true }, ip: "2001:db8::1", createdAt: "2026-06-05T08:30:00.000Z" },
  { id: "aud_6", actorId: mira.id, action: "course", targetType: "course", targetId: "crs_js", createdAt: "2026-06-06T08:30:00.000Z" },
];

const NONE: AuditFilter = { q: "", actor: "", action: "", targetType: "", from: "", to: "" };
const ids = (filter: Partial<AuditFilter>) => filterAuditEvents(events, { ...NONE, ...filter }, actors).map((e) => e.id);

describe("audit labels", () => {
  it("uses dedicated labels and humanizes everything else", () => {
    assert.equal(describeAuditAction("course.publish"), "Course published");
    assert.equal(describeAuditAction("privacy.export"), "Personal data downloaded");
    assert.equal(describeAuditAction("widget.frobnicate_all"), "Widget frobnicate all");
    assert.equal(describeAuditAction(""), "Unknown action");
    assert.equal(describeAuditTarget("legal_page"), "Legal page");
    assert.equal(describeAuditTarget("custom_thing"), "Custom thing");
    assert.equal(describeAuditGroup("user"), "Members");
    assert.equal(describeAuditGroup("something_new"), "Something new");
  });

  it("groups actions by their first segment", () => {
    assert.equal(auditActionGroup("course.publish"), "course");
    assert.equal(auditActionGroup("ai.review.approve"), "ai");
    assert.equal(auditActionGroup("standalone"), "standalone");
  });
});

describe("audit filter parsing", () => {
  it("reads query strings and page search params alike", () => {
    const expected: AuditFilter = { q: "refund", actor: "usr_root", action: "payment.*", targetType: "payment", from: "2026-06-01", to: "2026-06-30" };
    const query = "q=+refund+&actor=usr_root&action=payment.*&target=payment&from=2026-06-01&to=2026-06-30";
    assert.deepEqual(parseAuditFilter(new URLSearchParams(query)), expected);
    assert.deepEqual(parseAuditFilter({ q: ["refund", "ignored"], actor: "usr_root", action: "payment.*", target: "payment", from: "2026-06-01", to: "2026-06-30" }), expected);
  });

  it("drops malformed dates and caps long values", () => {
    const parsed = parseAuditFilter({ from: "yesterday", to: "2026-6-1", q: "x".repeat(500) });
    assert.equal(parsed.from, "");
    assert.equal(parsed.to, "");
    assert.equal(parsed.q.length, 200);
    assert.equal(searchParam({ page: undefined }, "page"), "");
  });

  it("round-trips through the query string and knows when a filter is active", () => {
    const filter: AuditFilter = { ...NONE, actor: "system", from: "2026-06-01" };
    assert.deepEqual(auditFilterToQuery(filter), { q: undefined, actor: "system", action: undefined, target: undefined, from: "2026-06-01", to: undefined });
    const query = new URLSearchParams(Object.entries(auditFilterToQuery(filter)).filter((pair): pair is [string, string] => pair[1] !== undefined));
    assert.deepEqual(parseAuditFilter(query), filter);
    assert.equal(isAuditFilterActive(filter), true);
    assert.equal(isAuditFilterActive(NONE), false);
  });
});

describe("audit filtering", () => {
  it("returns everything newest first without filters", () => {
    assert.deepEqual(ids({}), ["aud_6", "aud_5", "aud_4", "aud_3", "aud_2", "aud_1"]);
  });

  it("filters by actor, including events recorded by the system", () => {
    assert.deepEqual(ids({ actor: mira.id }), ["aud_6", "aud_2"]);
    assert.deepEqual(ids({ actor: "system" }), ["aud_3"]);
    assert.deepEqual(ids({ actor: "usr_nobody" }), []);
  });

  it("filters by exact action or by a whole group", () => {
    assert.deepEqual(ids({ action: "course.publish" }), ["aud_1"]);
    assert.deepEqual(ids({ action: "course.*" }), ["aud_6", "aud_4", "aud_1"], "the bare group name counts as part of the group");
    assert.deepEqual(ids({ action: "cour.*" }), [], "a group is a whole segment, not a prefix");
  });

  it("filters by target type and an inclusive UTC day range", () => {
    assert.deepEqual(ids({ targetType: "user" }), ["aud_2"]);
    assert.deepEqual(ids({ from: "2026-06-02", to: "2026-06-03" }), ["aud_3", "aud_2"]);
    assert.deepEqual(ids({ from: "2026-06-05" }), ["aud_6", "aud_5"]);
    assert.deepEqual(ids({ to: "2026-06-01" }), ["aud_1"]);
  });

  it("searches actions, labels, targets, details, IPs and actor names", () => {
    assert.deepEqual(ids({ q: "MODERN javascript" }), ["aud_1"]);
    assert.deepEqual(ids({ q: "refunded" }), ["aud_5"], "the human label is searchable");
    assert.deepEqual(ids({ q: "2001:db8" }), ["aud_5"]);
    assert.deepEqual(ids({ q: "mira@example.com" }), ["aud_6", "aud_2"]);
    assert.deepEqual(ids({ q: "crs_js" }), ["aud_6", "aud_1"]);
    assert.deepEqual(ids({ q: "moderator" }), ["aud_2"]);
  });

  it("combines filters", () => {
    assert.deepEqual(ids({ actor: root.id, action: "course.*", q: "old" }), ["aud_4"]);
  });

  it("counts recent events", () => {
    assert.equal(countAuditEventsSince(events, new Date("2026-06-04T10:00:00.000Z")), 3);
    assert.equal(countAuditEventsSince(events, new Date("2027-01-01T00:00:00.000Z")), 0);
  });
});

describe("audit facets and links", () => {
  it("counts actions per group, targets and actors", () => {
    const facets = auditFacets(events);
    const course = facets.groups.find((g) => g.value === "course.*")!;
    assert.equal(course.label, "Courses");
    assert.equal(course.count, 3);
    assert.deepEqual(course.actions.map((a) => a.value).sort(), ["course", "course.delete", "course.publish"]);
    assert.deepEqual(facets.groups.map((g) => g.label), [...facets.groups.map((g) => g.label)].sort((a, b) => a.localeCompare(b)), "groups are sorted by label");
    assert.deepEqual(facets.targetTypes.find((t) => t.value === "course"), { value: "course", label: "Course", count: 3 });
    assert.equal(facets.actors.get(root.id), 3);
    assert.equal(facets.actors.get(mira.id), 2);
    assert.equal(facets.system, 1);
  });

  it("links to the target's admin page when it still exists", () => {
    const byId = (id: string) => events.find((e) => e.id === id)!;
    assert.equal(auditTargetHref(byId("aud_1")), "/admin/courses/crs_js");
    assert.equal(auditTargetHref(byId("aud_4")), null, "a deleted course has no page");
    assert.equal(auditTargetHref(byId("aud_2")), "/admin/members/usr_sam");
    assert.equal(auditTargetHref(byId("aud_3")), null, "no target");
    assert.equal(auditTargetHref({ id: "a", action: "user.delete", targetType: "user", targetId: "usr_x", createdAt: daysAgo(1) }), null);
    assert.equal(auditTargetHref({ id: "a", action: "settings.update", targetType: "settings", targetId: "seo", createdAt: daysAgo(1) }), "/admin/settings/seo");
    assert.equal(auditTargetHref({ id: "a", action: "settings.update", targetType: "settings", targetId: "unknown-section", createdAt: daysAgo(1) }), "/admin/settings");
    assert.equal(auditTargetHref({ id: "a", action: "legal.publish", targetType: "legal_page", targetId: "legal_1", meta: { slug: "privacy" }, createdAt: daysAgo(1) }), "/admin/settings/legal/privacy");
    assert.equal(auditTargetHref({ id: "a", action: "certificate.issue", targetType: "certificate", targetId: "cert_1", meta: { code: "LL-1234" }, createdAt: daysAgo(1) }), "/certificates/LL-1234");
    assert.equal(auditTargetHref({ id: "a", action: "certificate.revoke", targetType: "certificate", targetId: "cert_1", meta: { code: "LL-1234" }, createdAt: daysAgo(1) }), null);
    assert.equal(auditTargetHref({ id: "a", action: "x.y", targetType: "spaceship", targetId: "1", createdAt: daysAgo(1) }), null);
  });

  it("links growth, API and teaching targets to the page that manages them", () => {
    const href = (action: string, targetType: string, targetId: string) => auditTargetHref({ id: "a", action, targetType, targetId, createdAt: daysAgo(1) });
    assert.equal(href("settings.api", "settings", "api"), "/admin/settings/api");
    assert.equal(href("settings.update", "settings", "growth"), "/admin/settings/plans");
    assert.equal(href("plan.update", "plan", "pln_1"), "/admin/settings/plans");
    assert.equal(href("membership.extend", "subscription", "sub_1"), "/admin/settings/plans");
    assert.equal(href("api_key.revoke", "api_key", "key_1"), "/admin/settings/api");
    assert.equal(href("rubric.update", "rubric", "rub 1"), "/admin/rubrics/rub%201");
    assert.equal(href("rubric.delete", "rubric", "rub_1"), null);
    assert.equal(href("peer_review.allocate", "assignment", "asg_1"), "/admin/assignments/asg_1");
    assert.equal(href("seo.redirect_add", "redirect", "/old"), "/admin/settings/seo/redirects");
    assert.equal(href("category.landing_update", "category", "cat_1"), "/admin/settings/categories");
  });

  it("finds a payment's order through the recorded id or the resolver", () => {
    const refund = events.find((e) => e.id === "aud_5")!;
    assert.equal(auditTargetHref(refund), null, "no order id recorded and no resolver");
    assert.equal(auditTargetHref(refund, (id) => (id === "pay_9" ? "ORD 9/A" : undefined)), "/admin/settings/transactions?search=ORD%209%2FA");
    assert.equal(auditTargetHref({ ...refund, meta: { orderId: "ORD-1" } }), "/admin/settings/transactions?search=ORD-1");
    assert.equal(auditTargetHref({ ...refund, action: "payment.delete", meta: { orderId: "ORD-1" } }), null);
  });
});

describe("audit CSV", () => {
  it("writes a header, resolves actors and keeps details as JSON", () => {
    const lines = auditEventsToCsv(filterAuditEvents(events, NONE, actors), actors).split("\r\n");
    assert.equal(lines[0], "Time (UTC),Action,Description,Actor,Actor email,Target type,Target id,IP address,Details");
    assert.equal(lines.length, events.length + 1);
    const publish = lines.find((l) => l.includes("course.publish"))!;
    assert.ok(publish.startsWith("2026-06-01T09:00:00.000Z,course.publish,Course published,Root Admin,root@example.com,course,crs_js,203.0.113.7,"));
    assert.ok(publish.includes('""title"":""Modern JavaScript""'), "JSON details are quoted for CSV");
    const system = lines.find((l) => l.includes("retention.purge"))!;
    assert.ok(system.includes(",System,,"), "events without an actor are attributed to the system");
  });

  it("falls back to the id of an unknown actor and neutralizes formulas", () => {
    const csv = auditEventsToCsv(
      [{ id: "aud_x", actorId: "usr_gone", action: "=cmd|' /C calc'!A0", targetType: "user", targetId: "+1+1", createdAt: daysAgo(1) }],
      actors,
    );
    const row = csv.split("\r\n")[1]!;
    assert.ok(row.includes("usr_gone"));
    assert.ok(!/(^|,)[=+]/.test(row), "no cell starts with a formula character");
  });
});

describe("retention", () => {
  it("clamps the retention period", () => {
    assert.equal(clampRetentionDays(1), RETENTION_MIN_DAYS);
    assert.equal(clampRetentionDays(100_000), RETENTION_MAX_DAYS);
    assert.equal(clampRetentionDays(90.4), 90);
    assert.equal(clampRetentionDays(Number.NaN), 365);
    assert.equal(retentionCutoff(90, NOW).toISOString(), daysAgo(90));
  });

  function logs(): Pick<Database, "auditEvents" | "errorEvents" | "consents"> {
    return {
      auditEvents: [
        { id: "aud_old", action: "course.publish", createdAt: daysAgo(91) },
        { id: "aud_edge", action: "course.publish", createdAt: daysAgo(90) },
        { id: "aud_new", action: "course.publish", createdAt: daysAgo(1) },
        { id: "aud_bad_date", action: "course.publish", createdAt: "not a date" },
      ],
      errorEvents: [
        { id: "err_old", message: "boom", createdAt: daysAgo(400), lastSeenAt: daysAgo(200), count: 3 },
        { id: "err_recurring", message: "boom again", createdAt: daysAgo(400), lastSeenAt: daysAgo(2), count: 40 },
      ],
      consents: [
        { id: "cns_old", anonId: "anon-old-0123456789", analytics: true, marketing: false, createdAt: daysAgo(366) },
        { id: "cns_recent", anonId: "anon-new-0123456789", analytics: false, marketing: false, createdAt: daysAgo(200) },
      ],
    };
  }

  it("purges audit and error events past the period and keeps consent evidence for at least a year", () => {
    const db = logs();
    const result = purgeExpiredRecords(db, 90, NOW);
    assert.deepEqual(result, { auditEvents: 1, errorEvents: 1, consents: 1 });
    assert.deepEqual(db.auditEvents.map((e) => e.id), ["aud_edge", "aud_new", "aud_bad_date"], "the cutoff itself and unreadable dates are kept");
    assert.deepEqual(db.errorEvents.map((e) => e.id), ["err_recurring"], "errors age from the last time they were seen");
    assert.deepEqual(db.consents.map((c) => c.id), ["cns_recent"], "a 90-day period does not shorten consent evidence");
  });

  it("uses the longer period for consents when it exceeds a year", () => {
    const db = logs();
    assert.deepEqual(purgeExpiredRecords(db, 730, NOW), { auditEvents: 0, errorEvents: 0, consents: 0 });
    assert.equal(db.consents.length, 2);
  });

  it("leaves the arrays untouched when nothing expired", () => {
    const db = logs();
    const before = db.auditEvents;
    purgeExpiredRecords({ ...db, auditEvents: before }, 3650, NOW);
    assert.equal(db.auditEvents, before);
  });
});

describe("lazy retention purge", () => {
  const state = (globalThis as unknown as { __llRetention: { lastRunAt: number; running: Promise<unknown> | null } }).__llRetention;
  const old = (id: string): AuditEvent => ({ id, action: "course.publish", createdAt: new Date(Date.now() - 100 * DAY_MS).toISOString() });
  const fresh: AuditEvent = { id: "aud_fresh", action: "course.publish", createdAt: new Date().toISOString() };

  beforeEach(async () => {
    await state.running;
    await resetDb({ users: [root], auditEvents: [old("aud_old_1"), old("aud_old_2"), fresh], settings: { legal: { dataRetentionDays: 90 } } });
    resetRequest();
    state.lastRunAt = 0;
  });

  it("purges once, records what it removed and then waits for the interval", async () => {
    const now = new Date();
    assert.deepEqual(await maybePurgeExpiredRecords(now), { auditEvents: 2, errorEvents: 0, consents: 0 });
    const db = await getDb();
    assert.deepEqual(db.auditEvents.map((e) => e.action), ["course.publish", "retention.purge"]);
    const purge = db.auditEvents.find((e) => e.action === "retention.purge")!;
    assert.equal(purge.actorId, undefined, "recorded as a system event");
    assert.deepEqual(purge.meta, { auditEvents: 2, errorEvents: 0, consents: 0, retentionDays: 90 });

    db.auditEvents.push(old("aud_old_3"));
    assert.equal(await maybePurgeExpiredRecords(new Date(now.getTime() + RETENTION_INTERVAL_MS - 1)), null, "skipped inside the interval");
    assert.ok(db.auditEvents.some((e) => e.id === "aud_old_3"));
    assert.deepEqual(await maybePurgeExpiredRecords(new Date(now.getTime() + RETENTION_INTERVAL_MS)), { auditEvents: 1, errorEvents: 0, consents: 0 });
  });

  it("can be forced inside the interval", async () => {
    const now = new Date();
    await maybePurgeExpiredRecords(now);
    const db = await getDb();
    db.auditEvents.push(old("aud_old_3"));
    assert.deepEqual(await maybePurgeExpiredRecords(now, { force: true }), { auditEvents: 1, errorEvents: 0, consents: 0 });
  });

  it("runs when a new audit entry is recorded", async () => {
    await audit(root, "course.publish", { type: "course", id: "crs_1" });
    await state.running;
    const db = await getDb();
    assert.ok(!db.auditEvents.some((e) => e.id.startsWith("aud_old")), "expired events were purged");
    assert.ok(db.auditEvents.some((e) => e.id === "aud_fresh"));
    assert.equal(db.auditEvents.filter((e) => e.action === "retention.purge").length, 1);
  });

  it("records nothing when there was nothing to purge", async () => {
    await resetDb({ users: [root], auditEvents: [fresh] });
    assert.deepEqual(await maybePurgeExpiredRecords(new Date()), { auditEvents: 0, errorEvents: 0, consents: 0 });
    assert.deepEqual((await getDb()).auditEvents.map((e) => e.id), ["aud_fresh"]);
  });
});

describe("audit export route", () => {
  function request(query = ""): NextRequest {
    const url = `http://localhost:3000/admin/audit/export${query}`;
    return Object.assign(new Request(url), { nextUrl: new URL(url) }) as unknown as NextRequest;
  }

  /** Rows of a CSV response body, without the byte-order mark (`Response.text()` would strip it silently). */
  function csvLines(bytes: Uint8Array): string[] {
    return new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes).split("\r\n");
  }

  beforeEach(async () => {
    await resetDb({
      users: [root, mira, sam],
      auditEvents: events.map((e) => ({ ...e, createdAt: new Date(Date.now() - DAY_MS).toISOString() })),
      dataRequests: [
        { id: "dreq_1", userId: sam.id, type: "export", status: "completed", createdAt: daysAgo(3), completedAt: daysAgo(3) },
        { id: "dreq_2", userId: "usr_gone", type: "delete", status: "completed", createdAt: daysAgo(2), completedAt: daysAgo(2) },
      ],
    });
    resetRequest();
  });

  it("sends visitors to sign in and refuses members who are not administrators", async () => {
    const anonymous = await exportGET(request());
    assert.ok(anonymous.status >= 300 && anonymous.status < 400);
    assert.ok(anonymous.headers.get("location")!.includes("/login?next=%2Fadmin%2Faudit"));

    await createSession(sam.id);
    const denied = await exportGET(request());
    assert.equal(denied.status, 403);
    assert.equal((await getDb()).auditEvents.filter((e) => e.action === "audit.export").length, 0);
  });

  it("exports the filtered activity as CSV and audits the export", async () => {
    await createSession(root.id);
    const res = await exportGET(request("?action=course.*"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /^text\/csv/);
    assert.match(res.headers.get("content-disposition")!, /^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "starts with a UTF-8 BOM for spreadsheet apps");
    const lines = csvLines(bytes);
    assert.equal(lines.length, 4, "header plus the three course events");
    assert.ok(lines.slice(1).every((l) => l.includes(",course")));

    const logged = (await getDb()).auditEvents.find((e) => e.action === "audit.export")!;
    assert.equal(logged.actorId, root.id);
    assert.deepEqual(logged.meta, { tab: "activity", rows: 3, filtered: true });
  });

  it("exports data requests without the identity of erased members", async () => {
    await createSession(root.id);
    const res = await exportGET(request("?tab=requests"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition")!, /data-requests-/);
    const lines = csvLines(new Uint8Array(await res.arrayBuffer()));
    assert.equal(lines.length, 3);
    assert.ok(lines[1]!.includes("Account deletion") && lines[1]!.includes("Deleted user"));
    assert.ok(lines[2]!.includes("Data download") && lines[2]!.includes("sam@example.com"));
    const typed = await exportGET(request("?tab=requests&type=delete"));
    assert.equal(csvLines(new Uint8Array(await typed.arrayBuffer())).length, 2);
    const logged = (await getDb()).auditEvents.filter((e) => e.action === "audit.export");
    assert.deepEqual(logged.map((e) => e.meta), [
      { tab: "requests", rows: 2, type: "all" },
      { tab: "requests", rows: 1, type: "delete" },
    ]);
  });
});
