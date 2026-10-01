import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { ErrorEvent } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { siteConfig } from "@/lib/config";
import { getDb } from "@/lib/db/store";
import {
  addErrorOccurrence,
  BROWSER_METHOD,
  capErrorGroups,
  cleanErrorPath,
  describeErrorSource,
  errorFilterToQuery,
  errorGroupKey,
  errorLogStats,
  filterErrorEvents,
  groupingMessage,
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  normalizeErrorIds,
  normalizeRoutePath,
  parseBrowserReport,
  parseErrorFilter,
  parseStackLines,
  redactSecrets,
  sanitizeErrorInput,
} from "@/lib/errors/shared";
import { recordError, recordRequestError } from "@/lib/errors/record";
import { deleteErrorsAction, deleteResolvedErrorsAction, setErrorsResolvedAction } from "@/lib/errors/actions";
import { POST as reportPOST } from "@/app/api/errors/route";
import { FIXED_NOW, makeUser, resetDb } from "./helpers/db";
import { requestCookie, resetRequest } from "./helpers/request";

/**
 * Round 3 legal-ops part 3: the admin error log — grouping and redaction
 * rules, the recorder behind `onRequestError`, the browser report endpoint
 * and the resolve/delete actions.
 */

const ORIGIN = "http://localhost:3000";
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", email: "admin@example.com", roles: ["admin"] });
const learner = makeUser({ id: "usr_learner", name: "Lee Learner", email: "lee@example.com" });

let counter = 0;
const newId = () => `err_test${String(++counter).padStart(4, "0")}`;

function group(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return { id: newId(), message: "Boom", createdAt: FIXED_NOW, lastSeenAt: FIXED_NOW, count: 1, resolved: false, ...overrides };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

function clearAlertBudget() {
  (globalThis as unknown as { __llErrorAlerts?: number[] }).__llErrorAlerts = [];
}

describe("error log: redaction and normalization", () => {
  it("redacts credentials in free text", () => {
    const text = redactSecrets("GET /cb?token=abc123&x=1 Bearer eyJhbGciOi.payload sk_live_ABCDEFGH1234 rzp_test_ABCDEFGH12 postgres://user:hunter2@db:5432 sk-ant-api03-abcdefgh");
    assert.ok(!text.includes("abc123"));
    assert.ok(!text.includes("eyJhbGciOi"));
    assert.ok(!text.includes("ABCDEFGH1234"));
    assert.ok(!text.includes("hunter2"));
    assert.ok(!text.includes("api03-abcdefgh"));
    assert.match(text, /token=\[redacted\]/);
    assert.match(text, /x=1/);
  });

  it("strips query strings, fragments and origins from paths", () => {
    assert.equal(cleanErrorPath("/reset?token=secret#x"), "/reset");
    assert.equal(cleanErrorPath("https://learn.example.com/courses/a?ref=1"), "/courses/a");
    assert.equal(cleanErrorPath("courses"), "/courses");
    assert.equal(cleanErrorPath(""), undefined);
    assert.equal(cleanErrorPath("/a\u0000b"), "/ab");
    assert.ok(cleanErrorPath(`/${"x".repeat(500)}`)!.length <= 300);
  });

  it("turns Next route files into URL patterns", () => {
    assert.equal(normalizeRoutePath("/(app)/courses/[slug]/page"), "/courses/[slug]");
    assert.equal(normalizeRoutePath("/api/errors/route"), "/api/errors");
    assert.equal(normalizeRoutePath("/(public)/@modal/page"), "/");
    assert.equal(normalizeRoutePath(undefined), undefined);
  });

  it("groups messages that differ only by ids and numbers", () => {
    assert.equal(groupingMessage("Course crs_abc123 not found (42)"), groupingMessage("Course crs_zzz999 not found (7)"));
    assert.equal(groupingMessage("Row 0x1f at 6f9619ff-8b86-d011-b42d-00cf4fc964ff"), "row <n> at <id>");
    assert.notEqual(errorGroupKey("Boom", "/a"), errorGroupKey("Boom", "/b"));
  });

  it("sanitizes an occurrence: caps text, cleans digest, method and user id", () => {
    const input = sanitizeErrorInput({
      message: "x".repeat(MAX_MESSAGE_LENGTH + 50),
      stack: "y".repeat(MAX_STACK_LENGTH + 50),
      digest: "12345<script>",
      path: "/a?b=c",
      method: "post!",
      userId: "bad id with spaces",
    });
    assert.equal(input.message.length, MAX_MESSAGE_LENGTH);
    assert.equal(input.stack!.length, MAX_STACK_LENGTH);
    assert.equal(input.digest, "12345script");
    assert.equal(input.path, "/a");
    assert.equal(input.method, "POST");
    assert.equal(input.userId, undefined);
    assert.equal(sanitizeErrorInput({ message: "   " }).message, "Unknown error");
  });
});

describe("error log: grouping", () => {
  it("adds a new group, then counts repeats of the same message and path", () => {
    const events: ErrorEvent[] = [];
    const first = addErrorOccurrence(events, { message: "Item 1 missing", path: "/x", digest: "d1" }, new Date(FIXED_NOW), newId);
    assert.equal(first.isNew, true);
    const later = new Date(Date.parse(FIXED_NOW) + 60_000);
    const second = addErrorOccurrence(events, { message: "Item 2 missing", path: "/x", digest: "d2", userId: "usr_1" }, later, newId);
    assert.equal(second.isNew, false);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.count, 2);
    assert.equal(events[0]!.lastSeenAt, later.toISOString());
    assert.equal(events[0]!.createdAt, FIXED_NOW);
    assert.equal(events[0]!.digest, "d2");
    assert.equal(events[0]!.userId, "usr_1");
    addErrorOccurrence(events, { message: "Item 3 missing", path: "/y" }, later, newId);
    assert.equal(events.length, 2);
  });

  it("reopens a resolved group when it happens again", () => {
    const events = [group({ message: "Boom", path: "/a", resolved: true })];
    const result = addErrorOccurrence(events, { message: "Boom", path: "/a" }, new Date(), newId);
    assert.equal(result.reopened, true);
    assert.equal(events[0]!.resolved, false);
    assert.equal(events[0]!.count, 2);
  });

  it("caps the log, dropping resolved groups first, then the oldest", () => {
    const events = [
      group({ id: "err_old_open", lastSeenAt: "2026-01-01T00:00:00.000Z" }),
      group({ id: "err_new_resolved", lastSeenAt: "2026-01-10T00:00:00.000Z", resolved: true }),
      group({ id: "err_mid_open", lastSeenAt: "2026-01-05T00:00:00.000Z" }),
      group({ id: "err_new_open", lastSeenAt: "2026-01-12T00:00:00.000Z" }),
    ];
    assert.equal(capErrorGroups(events, 10), events);
    assert.deepEqual(capErrorGroups(events, 2).map((e) => e.id), ["err_mid_open", "err_new_open"]);
  });
});

describe("error log: list helpers", () => {
  const events = [
    group({ id: "err_a", message: "Database locked", path: "/admin", lastSeenAt: "2026-01-03T00:00:00.000Z", method: "GET" }),
    group({ id: "err_b", message: "ChunkLoadError", path: "/learn", lastSeenAt: "2026-01-05T00:00:00.000Z", method: BROWSER_METHOD, count: 4 }),
    group({ id: "err_c", message: "Old failure", lastSeenAt: "2026-01-04T00:00:00.000Z", resolved: true, method: "ACTION" }),
  ];

  it("filters by status, source and search, most recent first", () => {
    const all = (status: "open" | "resolved" | "all", source: "all" | "server" | "browser" = "all", q = "") => filterErrorEvents(events, { status, source, q }).map((e) => e.id);
    assert.deepEqual(all("open"), ["err_b", "err_a"]);
    assert.deepEqual(all("resolved"), ["err_c"]);
    assert.deepEqual(all("all"), ["err_b", "err_c", "err_a"]);
    assert.deepEqual(all("all", "browser"), ["err_b"]);
    assert.deepEqual(all("all", "server"), ["err_c", "err_a"]);
    assert.deepEqual(all("all", "all", "LOCKED"), ["err_a"]);
    assert.deepEqual(all("all", "all", "/learn"), ["err_b"]);
  });

  it("parses filters from the query string with safe defaults", () => {
    const params = new URLSearchParams("status=bogus&source=browser&q=%20chunk%20");
    const filter = parseErrorFilter((k) => params.get(k) ?? "");
    assert.deepEqual(filter, { status: "open", source: "browser", q: "chunk" });
    assert.deepEqual(errorFilterToQuery(filter), { status: undefined, source: "browser", q: "chunk" });
    assert.deepEqual(errorFilterToQuery({ status: "all", source: "all", q: "" }), { status: "all", source: undefined, q: undefined });
  });

  it("computes stats", () => {
    const stats = errorLogStats(events, new Date("2026-01-20T12:00:00.000Z"));
    assert.equal(stats.open, 2);
    assert.equal(stats.resolved, 1);
    assert.equal(stats.openOccurrences, 5);
    assert.equal(stats.openBrowser, 1);
    assert.equal(stats.lastSeenAt, "2026-01-05T00:00:00.000Z");
    assert.equal(stats.newToday, 0);
    assert.equal(errorLogStats(events, new Date("2026-01-15T20:00:00.000Z")).newToday, 3);
    assert.equal(errorLogStats([], new Date()).lastSeenAt, null);
  });

  it("describes sources", () => {
    assert.equal(describeErrorSource({ method: BROWSER_METHOD }), "Browser");
    assert.equal(describeErrorSource({ method: "ACTION" }), "Server action");
    assert.equal(describeErrorSource({ method: "POST" }), "Server · POST");
    assert.equal(describeErrorSource({}), "Server");
  });

  it("splits stack traces into message, app and framework lines", () => {
    const lines = parseStackLines(
      [
        "TypeError: Cannot read properties of undefined",
        "    at CoursePage (/app/.next/server/chunks/ssr/src_app_course.js:10:5)",
        "    at renderWithHooks (/app/node_modules/next/dist/compiled/react-dom/server.js:1:1)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
        "",
      ].join("\n"),
    );
    assert.deepEqual(lines.map((l) => l.kind), ["message", "app", "framework", "framework"]);
    assert.deepEqual(parseStackLines(undefined), []);
  });

  it("accepts only well-formed ids for bulk actions", () => {
    assert.deepEqual(normalizeErrorIds(["err_abc123", "err_abc123", "usr_abc123", 5, "err_<x>"]), ["err_abc123"]);
    assert.deepEqual(normalizeErrorIds("err_single1"), ["err_single1"]);
    assert.deepEqual(normalizeErrorIds(["err_aaaaaa", "err_bbbbbb", "err_cccccc"], 2), ["err_aaaaaa", "err_bbbbbb"]);
    assert.deepEqual(normalizeErrorIds(null), []);
  });

  it("parses browser reports", () => {
    assert.equal(parseBrowserReport(null), null);
    assert.equal(parseBrowserReport([]), null);
    assert.equal(parseBrowserReport({ message: "  " }), null);
    assert.deepEqual(parseBrowserReport({ message: "", digest: "123" }), { message: "Server error 123", stack: undefined, digest: "123", path: undefined, method: BROWSER_METHOD });
    const report = parseBrowserReport({ message: "x", stack: 1, path: "/p", method: "GET" });
    assert.equal(report!.method, BROWSER_METHOD);
    assert.equal(report!.stack, undefined);
  });
});

describe("error log: recording", () => {
  beforeEach(async () => {
    clearAlertBudget();
    resetRequest();
    await resetDb({ users: [admin, learner] });
  });

  it("stores a grouped occurrence and notifies administrators once per new group", async () => {
    const first = await recordError({ message: "Payment 12 failed", path: "/checkout?token=abc" });
    assert.ok(first);
    await tick();
    const second = await recordError({ message: "Payment 13 failed", path: "/checkout" });
    assert.equal(second!.id, first.id);
    await tick();
    const db = await getDb();
    assert.equal(db.errorEvents.length, 1);
    assert.equal(db.errorEvents[0]!.count, 2);
    assert.equal(db.errorEvents[0]!.path, "/checkout");
    const alerts = db.notifications.filter((n) => n.link === `/admin/errors/${first.id}`);
    assert.deepEqual(alerts.map((n) => n.userId), [admin.id]);
  });

  it("ignores Next control-flow errors", async () => {
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404", "DYNAMIC_SERVER_USAGE"]) {
      await recordRequestError(Object.assign(new Error("control"), { digest }), { path: "/x", method: "GET", headers: {} }, {});
    }
    assert.equal((await getDb()).errorEvents.length, 0);
  });

  it("records request errors with the route pattern, method and signed-in member only", async () => {
    await createSession(learner.id);
    const token = requestCookie(siteConfig.sessionCookie)!;
    const err = Object.assign(new TypeError("Cannot read x"), { digest: "998877" });
    await recordRequestError(
      err,
      { path: "/courses/intro?secret=1", method: "POST", headers: { cookie: `other=1; ${siteConfig.sessionCookie}=${token}`, authorization: "Bearer hidden" } },
      { routePath: "/(app)/courses/[slug]/page", routeType: "action" },
    );
    const [event] = (await getDb()).errorEvents;
    assert.ok(event);
    assert.equal(event.message, "TypeError: Cannot read x");
    assert.equal(event.path, "/courses/[slug]");
    assert.equal(event.method, "ACTION");
    assert.equal(event.digest, "998877");
    assert.equal(event.userId, learner.id);
    assert.ok(!JSON.stringify(event).includes("hidden"));
  });

  it("does not link a member for an unknown session cookie", async () => {
    await recordRequestError(new Error("x"), { path: "/a", method: "GET", headers: { cookie: `${siteConfig.sessionCookie}=forged` } }, {});
    assert.equal((await getDb()).errorEvents[0]!.userId, undefined);
  });
});

function reportRequest(body: string, init: { origin?: string | null; contentType?: string; ip?: string } = {}): NextRequest {
  const url = `${ORIGIN}/api/errors`;
  const headers = new Headers({ "content-type": init.contentType ?? "application/json" });
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin) headers.set("origin", origin);
  return Object.assign(new Request(url, { method: "POST", headers, body }), { nextUrl: new URL(url) }) as unknown as NextRequest;
}

describe("error log: POST /api/errors", () => {
  beforeEach(async () => {
    clearAlertBudget();
    resetRequest();
    await resetDb({ users: [admin, learner, makeUser({ id: "usr_spammer" })] });
  });

  it("rejects cross-site and non-JSON reports", async () => {
    assert.equal((await reportPOST(reportRequest("{}", { origin: "https://evil.example" }))).status, 403);
    assert.equal((await reportPOST(reportRequest("{}", { origin: null }))).status, 403);
    assert.equal((await reportPOST(reportRequest("message=x", { contentType: "text/plain" }))).status, 415);
  });

  it("rejects oversized, malformed and empty reports", async () => {
    assert.equal((await reportPOST(reportRequest(JSON.stringify({ message: "x".repeat(20_000) })))).status, 413);
    assert.equal((await reportPOST(reportRequest("{not json"))).status, 400);
    assert.equal((await reportPOST(reportRequest(JSON.stringify({ message: "" })))).status, 400);
    assert.equal((await getDb()).errorEvents.length, 0);
  });

  it("records a browser error for the signed-in member", async () => {
    await createSession(learner.id);
    const res = await reportPOST(reportRequest(JSON.stringify({ message: "ChunkLoadError", stack: "at x", path: "/learn/a?token=t" })));
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, recorded: true });
    const [event] = (await getDb()).errorEvents;
    assert.equal(event!.method, BROWSER_METHOD);
    assert.equal(event!.path, "/learn/a");
    assert.equal(event!.userId, learner.id);
  });

  it("does not double-count a server error the browser reports by digest", async () => {
    await recordError({ message: "Render failed", digest: "4242", path: "/x", method: "GET" });
    const res = await reportPOST(reportRequest(JSON.stringify({ message: "", digest: "4242", path: "/x" })));
    assert.deepEqual(await res.json(), { ok: true, recorded: false });
    const db = await getDb();
    assert.equal(db.errorEvents.length, 1);
    assert.equal(db.errorEvents[0]!.count, 1);
  });

  it("rate-limits reports per member", async () => {
    await createSession("usr_spammer");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await reportPOST(reportRequest(JSON.stringify({ message: `spam ${i}` })))).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(202));
    assert.equal(statuses[10], 429);
  });
});

describe("error log: admin actions", () => {
  beforeEach(async () => {
    resetRequest();
    await resetDb({
      users: [admin, learner],
      errorEvents: [group({ id: "err_open01", path: "/a" }), group({ id: "err_open02", message: "Other", path: "/b" }), group({ id: "err_done01", message: "Fixed", resolved: true })],
    });
  });

  it("is admin only", async () => {
    await createSession(learner.id);
    assert.equal((await setErrorsResolvedAction(["err_open01"], true)).ok, false);
    assert.equal((await deleteErrorsAction(["err_open01"])).ok, false);
    assert.equal((await deleteResolvedErrorsAction()).ok, false);
    assert.equal((await getDb()).errorEvents.length, 3);
  });

  it("resolves and reopens groups, auditing each change", async () => {
    await createSession(admin.id);
    const resolved = await setErrorsResolvedAction(["err_open01", "err_open02", "err_done01"], true);
    assert.ok(resolved.ok);
    assert.equal(resolved.data!.count, 2);
    const again = await setErrorsResolvedAction(["err_open01"], true);
    assert.ok(again.ok && again.data!.count === 0);
    const reopened = await setErrorsResolvedAction(["err_done01"], false);
    assert.ok(reopened.ok && reopened.data!.count === 1);
    const db = await getDb();
    assert.deepEqual(db.errorEvents.map((e) => !!e.resolved), [true, true, false]);
    const actions = db.auditEvents.map((a) => a.action);
    assert.deepEqual(actions, ["error.resolve", "error.reopen"]);
    assert.equal(db.auditEvents[1]!.targetId, "err_done01");
    assert.equal(db.auditEvents[0]!.meta?.count, 2);
    assert.equal((await setErrorsResolvedAction(["nope"], true)).ok, false);
  });

  it("deletes selected and resolved groups", async () => {
    await createSession(admin.id);
    const deleted = await deleteErrorsAction(["err_open02"]);
    assert.ok(deleted.ok && deleted.data!.count === 1);
    assert.equal((await deleteErrorsAction(["err_open02"])).ok, false);
    const cleared = await deleteResolvedErrorsAction();
    assert.ok(cleared.ok && cleared.data!.count === 1);
    const db = await getDb();
    assert.deepEqual(db.errorEvents.map((e) => e.id), ["err_open01"]);
    assert.deepEqual(db.auditEvents.map((a) => a.action), ["error.delete", "error.delete"]);
    const empty = await deleteResolvedErrorsAction();
    assert.ok(empty.ok && empty.data!.count === 0);
  });
});
