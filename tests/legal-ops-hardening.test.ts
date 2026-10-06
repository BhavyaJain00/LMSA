import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { Conversation, Database, DirectMessage, ErrorEvent } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { countPersonalData, exportableConversation, exportableDirectMessage, personalDataSections, summarizeSections } from "@/lib/legal/export";
import { agreementArticle, agreementListParts, type AgreementPart } from "@/lib/legal/agreement";
import {
  addErrorOccurrence,
  BROWSER_METHOD,
  capErrorGroups,
  errorGroupKey,
  MAX_NEW_BROWSER_GROUPS_PER_HOUR,
  recentBrowserGroupCount,
} from "@/lib/errors/shared";
import { recordError } from "@/lib/errors/record";
import { checkEnvironment, isInsideBuildOutput } from "@/lib/env-check";
import { publicHealthReport, type HealthReport } from "@/app/api/health/report";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as reportPOST } from "@/app/api/errors/route";
import { GET as runnerWorkerGET } from "@/app/api/exercise-runner/worker/route";
import { GET as runnerFrameGET } from "@/app/api/exercise-runner/frame/route";
import { RUNNER_FRAME_URL, RUNNER_WORKER_URL } from "@/components/assessments/js-runner-source";
import nextConfig, { imageRemotePatterns } from "../next.config";
import { FIXED_NOW, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Round 3 legal-ops review fixes: reporter identities stay out of the
 * reported member's export, the privacy page counts without copying,
 * browser error reports cannot touch server error groups, /api/health hides
 * operator details from the public, standalone servers refuse to keep data
 * in the build output, the page CSP forbids eval in production, the image
 * optimizer only fetches from configured hosts, and the agreement sentence
 * joins documents in the reader's language.
 */

const plainCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const reporter = makeUser({ id: "usr_reporter", name: "Rita Reporter", email: "rita@example.com" });
const reported = makeUser({ id: "usr_reported", name: "Ray Reported", email: "ray@example.com" });
const moderator = makeUser({ id: "usr_mod", name: "Mo Derator", email: "mo@example.com", roles: ["admin", "moderator"] });

const conversation: Conversation = {
  id: "cnv_1",
  participantIds: [reporter.id, reported.id],
  subject: "Course question",
  lastMessageAt: FIXED_NOW,
  createdAt: FIXED_NOW,
  reported: true,
  reportedBy: reporter.id,
  reportedAt: FIXED_NOW,
  reportReason: "He keeps sending abusive messages",
  reportedMessageId: "dm_2",
  reportResolvedAt: FIXED_NOW,
  reportResolvedBy: moderator.id,
  reportCount: 2,
};

const messages: DirectMessage[] = [
  { id: "dm_1", conversationId: "cnv_1", senderId: reporter.id, body: "Hi", readBy: [reporter.id], createdAt: FIXED_NOW, removedAt: FIXED_NOW, removedBy: reporter.id },
  { id: "dm_2", conversationId: "cnv_1", senderId: reported.id, body: "", readBy: [reported.id], createdAt: FIXED_NOW, removedAt: FIXED_NOW, removedBy: moderator.id },
];

const REPORT_FIELDS = ["reported", "reportedBy", "reportedAt", "reportReason", "reportedMessageId", "reportResolvedAt", "reportResolvedBy", "reportCount", "reportedByYou"];

describe("personal data export: conversations and moderation data", () => {
  let db: Database;
  beforeEach(async () => {
    db = plainCopy(await resetDb({ users: [reporter, reported, moderator], conversations: [conversation], directMessages: messages }));
  });

  function rows(userId: string, key: string) {
    const found = personalDataSections(db, userId)!.find((s) => s.key === key);
    assert.ok(found, key);
    return found.rows;
  }

  it("never tells the reported member who reported them, why, or which moderator acted", () => {
    const [row] = rows(reported.id, "conversations");
    assert.ok(row);
    for (const field of REPORT_FIELDS) assert.equal(field in row, false, field);
    assert.deepEqual(row, { id: "cnv_1", participantIds: [reporter.id, reported.id], subject: "Course question", createdAt: FIXED_NOW, lastMessageAt: FIXED_NOW });
    const json = JSON.stringify(personalDataSections(db, reported.id));
    assert.ok(!json.includes("abusive"));
    assert.ok(!json.includes(moderator.id));
  });

  it("gives the reporter their own report, without the moderator's identity", () => {
    const [row] = rows(reporter.id, "conversations");
    assert.ok(row);
    assert.equal(row.reportedByYou, true);
    assert.equal(row.reportReason, "He keeps sending abusive messages");
    assert.equal(row.reportedMessageId, "dm_2");
    assert.equal(row.reportResolvedAt, FIXED_NOW);
    assert.equal("reportResolvedBy" in row, false);
    assert.equal("reportedBy" in row, false);
  });

  it("drops the id of a moderator who removed a message, keeping the member's own removals", () => {
    const dms = rows(reported.id, "directMessages");
    assert.equal(dms.find((m) => m.id === "dm_2")!.removedBy, undefined);
    assert.equal(dms.find((m) => m.id === "dm_2")!.removedAt, FIXED_NOW);
    assert.equal(rows(reporter.id, "directMessages").find((m) => m.id === "dm_1")!.removedBy, reporter.id);
    assert.equal(exportableDirectMessage(messages[1]!, moderator.id).removedBy, moderator.id);
  });

  it("exportableConversation does not mutate the stored row", () => {
    const copy = { ...conversation, participantIds: [...conversation.participantIds] };
    const row = exportableConversation(copy, reported.id);
    (row.participantIds as string[]).push("x");
    assert.deepEqual(copy.participantIds, conversation.participantIds);
    assert.equal(copy.reportedBy, reporter.id);
  });

  it("countPersonalData matches the export's per-section counts", () => {
    for (const user of [reporter, reported, moderator]) {
      assert.deepEqual(countPersonalData(db, user.id), summarizeSections(personalDataSections(db, user.id)!));
    }
    assert.equal(countPersonalData(db, "usr_missing"), null);
  });
});

/* ------------------------------------------------------------------ */

const newId = (() => {
  let n = 0;
  return () => `err_t${String(++n).padStart(6, "0")}`;
})();

function group(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { id: newId(), message: "Boom", createdAt: FIXED_NOW, lastSeenAt: FIXED_NOW, count: 1, resolved: false, ...overrides };
}

describe("error log: browser reports are kept apart from server errors", () => {
  it("uses separate group keys for browser and server occurrences", () => {
    assert.notEqual(errorGroupKey("Boom", "/courses/[slug]", BROWSER_METHOD), errorGroupKey("Boom", "/courses/[slug]", "GET"));
    assert.equal(errorGroupKey("Boom", "/a", "GET"), errorGroupKey("Boom", "/a", "ACTION"));
  });

  it("a browser report never overwrites, recounts or reopens a server group", () => {
    const server = group({ message: "TypeError: x is undefined", path: "/courses/[slug]", stack: "real stack", method: "GET", resolved: true });
    const events = [server];
    const outcome = addErrorOccurrence(
      events,
      { message: "TypeError: x is undefined", path: "/courses/[slug]", stack: "fake stack", method: BROWSER_METHOD },
      new Date(Date.parse(FIXED_NOW) + 1000),
      newId,
    );
    assert.ok(outcome);
    assert.equal(outcome.isNew, true);
    assert.equal(events.length, 2);
    assert.equal(server.stack, "real stack");
    assert.equal(server.method, "GET");
    assert.equal(server.count, 1);
    assert.equal(server.resolved, true);
  });

  it("server occurrences still group and reopen as before", () => {
    const server = group({ message: "Boom 1", path: "/a", method: "GET", resolved: true });
    const events = [server];
    const outcome = addErrorOccurrence(events, { message: "Boom 2", path: "/a", method: "POST", stack: "new" }, new Date(), newId);
    assert.equal(outcome!.reopened, true);
    assert.equal(events.length, 1);
    assert.equal(server.stack, "new");
  });

  it("caps how many new groups browser reports may open per hour, but still counts known ones", () => {
    const now = new Date(Date.parse(FIXED_NOW) + 30 * 60 * 1000);
    const events: ErrorEvent[] = [];
    for (let i = 0; i < MAX_NEW_BROWSER_GROUPS_PER_HOUR; i++) {
      assert.ok(addErrorOccurrence(events, { message: `Spam ${"x".repeat(i + 1)}`, path: `/p${String.fromCharCode(97 + (i % 26))}${i}`, method: BROWSER_METHOD }, now, newId));
    }
    assert.equal(recentBrowserGroupCount(events, now), MAX_NEW_BROWSER_GROUPS_PER_HOUR);
    assert.equal(addErrorOccurrence(events, { message: "One more", path: "/new", method: BROWSER_METHOD }, now, newId), null);
    assert.equal(events.length, MAX_NEW_BROWSER_GROUPS_PER_HOUR);
    // An existing browser group still counts, and server errors are never capped.
    const again = addErrorOccurrence(events, { message: events[0]!.message, path: events[0]!.path, method: BROWSER_METHOD }, now, newId);
    assert.equal(again!.isNew, false);
    assert.ok(addErrorOccurrence(events, { message: "Server failure", path: "/x", method: "GET" }, now, newId));
    // An hour later browser reports may open groups again.
    const later = new Date(now.getTime() + 61 * 60 * 1000);
    assert.ok(addErrorOccurrence(events, { message: "Fresh", path: "/fresh", method: BROWSER_METHOD }, later, newId));
  });

  it("drops browser groups before any server group when the log is full", () => {
    const events = [
      group({ id: "err_server_old", method: "GET", lastSeenAt: "2026-01-01T00:00:00.000Z" }),
      group({ id: "err_server_resolved", method: "GET", lastSeenAt: "2026-01-02T00:00:00.000Z", resolved: true }),
      group({ id: "err_browser_new", method: BROWSER_METHOD, lastSeenAt: "2026-01-20T00:00:00.000Z" }),
      group({ id: "err_browser_old", method: BROWSER_METHOD, lastSeenAt: "2026-01-03T00:00:00.000Z" }),
    ];
    assert.deepEqual(capErrorGroups(events, 2).map((e) => e.id), ["err_server_old", "err_server_resolved"]);
    assert.deepEqual(capErrorGroups(events, 3).map((e) => e.id), ["err_server_old", "err_server_resolved", "err_browser_new"]);
  });
});

const ORIGIN = "http://localhost:3000";

function reportRequest(body: unknown): NextRequest {
  const url = `${ORIGIN}/api/errors`;
  const headers = new Headers({ "content-type": "application/json", origin: ORIGIN });
  return Object.assign(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }), { nextUrl: new URL(url) }) as unknown as NextRequest;
}

describe("error log: POST /api/errors cannot tamper with server groups", () => {
  beforeEach(async () => {
    (globalThis as unknown as { __llErrorAlertSlots?: Record<string, number[]> }).__llErrorAlertSlots = {};
    resetRequest();
    await resetDb({ users: [moderator, reporter] });
  });

  it("a forged report naming a server route pattern lands in its own browser group", async () => {
    const server = await recordError({ message: "Render failed", path: "/courses/[slug]", stack: "at real (src/app/page.tsx:1:1)", method: "GET" });
    assert.ok(server);
    await createSession(reporter.id);
    const res = await reportPOST(reportRequest({ message: "Render failed", path: "/courses/[slug]", stack: "at evil (attacker.js:1:1)" }));
    assert.equal(res.status, 202);
    const db = await getDb();
    assert.equal(db.errorEvents.length, 2);
    const stored = db.errorEvents.find((e) => e.id === server.id)!;
    assert.equal(stored.stack, "at real (src/app/page.tsx:1:1)");
    assert.equal(stored.method, "GET");
    assert.equal(stored.count, 1);
  });
});

/* ------------------------------------------------------------------ */

describe("/api/health: public answer hides operator details", () => {
  const full: HealthReport = {
    status: "degraded",
    version: "1.2.3",
    uptimeSeconds: 4242,
    checkedAt: FIXED_NOW,
    checks: {
      database: { ok: true, ms: 3 },
      storage: { ok: true, ms: 5 },
      ffmpeg: { ok: false, ms: 9, detail: "6.1.1-3ubuntu5" },
    },
  };

  it("publicHealthReport keeps only status, version and pass/fail per check", () => {
    assert.deepEqual(publicHealthReport(full), {
      status: "degraded",
      version: "1.2.3",
      checks: { database: { ok: true }, storage: { ok: true }, ffmpeg: { ok: false } },
    });
  });

  it("GET shows details to administrators only", async () => {
    resetRequest();
    await resetDb({ users: [moderator, reporter] });
    const anonymous = (await (await healthGET()).json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(anonymous).sort(), ["checks", "status", "version"]);
    assert.ok(!JSON.stringify(anonymous).includes("\"ms\""));
    assert.ok(!JSON.stringify(anonymous).includes("detail"));

    await createSession(reporter.id);
    const member = (await (await healthGET()).json()) as Record<string, unknown>;
    assert.equal("uptimeSeconds" in member, false);

    resetRequest();
    await createSession(moderator.id);
    const admin = (await (await healthGET()).json()) as Record<string, unknown>;
    assert.equal(typeof admin.uptimeSeconds, "number");
    assert.equal(typeof (admin.checks as { database: { ms: unknown } }).database.ms, "number");
  });
});

/* ------------------------------------------------------------------ */

describe("env-check: standalone servers must keep data outside the build output", () => {
  const base = { APP_SECRET: "x".repeat(40), APP_URL: "https://learn.example.com", SEED_DEMO_DATA: "false", TRUST_PROXY_HOPS: "1", MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example.com", MAIL_FROM: "a@b.c" };
  const standalone = "/opt/learnloop/app/.next/standalone";

  it("recognizes the standalone folder on Linux and Windows", () => {
    assert.equal(isInsideBuildOutput(standalone), true);
    assert.equal(isInsideBuildOutput("C:\\learnloop\\app\\.next\\standalone"), true);
    assert.equal(isInsideBuildOutput("/app"), false);
    assert.equal(isInsideBuildOutput("/opt/learnloop/app"), false);
    assert.equal(isInsideBuildOutput("/opt/standalone"), false);
  });

  it("refuses relative (and default) data paths when running from .next/standalone", () => {
    const result = checkEnvironment(base, { production: true, cwd: standalone });
    assert.deepEqual(result.errors.map((e) => e.key).sort(), ["DATA_FILE", "SQLITE_PATH", "UPLOAD_DIR"]);
    const partial = checkEnvironment({ ...base, SQLITE_PATH: "/var/lib/ll/lms.sqlite", DATA_FILE: "storage/db.json", UPLOAD_DIR: "D:\\data\\uploads" }, { production: true, cwd: standalone });
    assert.deepEqual(partial.errors.map((e) => e.key), ["DATA_FILE"]);
  });

  it("accepts absolute paths, ignores SQLITE_PATH for the JSON driver, and leaves Docker and development alone", () => {
    const absolute = { ...base, SQLITE_PATH: "/var/lib/ll/lms.sqlite", DATA_FILE: "/var/lib/ll/db.json", UPLOAD_DIR: "/var/lib/ll/uploads" };
    assert.deepEqual(checkEnvironment(absolute, { production: true, cwd: standalone }).errors, []);
    const json = checkEnvironment({ ...absolute, DB_DRIVER: "json", SQLITE_PATH: "" }, { production: true, cwd: standalone });
    assert.ok(!json.errors.some((e) => e.key === "SQLITE_PATH"));
    assert.deepEqual(checkEnvironment(base, { production: true, cwd: "/app" }).errors, []);
    assert.deepEqual(checkEnvironment(base, { production: true }).errors, []);
    assert.ok(!checkEnvironment(base, { production: false, cwd: standalone }).errors.some((e) => e.key === "SQLITE_PATH"));
  });
});

/* ------------------------------------------------------------------ */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

describe("next.config: security headers and image hosts", () => {
  async function rules(): Promise<HeaderRule[]> {
    return (await nextConfig.headers!()) as HeaderRule[];
  }
  /** The value a path gets for `key`: the last matching rule wins, as in Next. */
  function headerFor(all: HeaderRule[], source: string, key: string): string | undefined {
    let value: string | undefined;
    for (const rule of all) {
      if (rule.source !== "/:path*" && rule.source !== source) continue;
      const h = rule.headers.find((x) => x.key === key);
      if (h) value = h.value;
    }
    return value;
  }

  it("the site-wide CSP never allows eval outside development", async () => {
    assert.notEqual(process.env.NODE_ENV, "development");
    const csp = headerFor(await rules(), "/courses/x", "Content-Security-Policy")!;
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.ok(!csp.includes("'unsafe-eval'"));
  });

  it("only the exercise runner's own documents may evaluate code", async () => {
    const all = await rules();
    const worker = headerFor(all, RUNNER_WORKER_URL, "Content-Security-Policy")!;
    const frame = headerFor(all, RUNNER_FRAME_URL, "Content-Security-Policy")!;
    assert.match(worker, /script-src 'self' 'unsafe-eval'/);
    assert.match(worker, /default-src 'none'/);
    assert.match(frame, /'unsafe-eval'/);
    assert.match(frame, /worker-src blob: data:/);
    assert.match(frame, /frame-ancestors 'self'/);
  });

  it("serves the runner sources with the right types", async () => {
    const worker = runnerWorkerGET();
    assert.match(worker.headers.get("content-type")!, /^text\/javascript/);
    assert.match(await worker.text(), /new Function\("console"/);
    const frame = runnerFrameGET();
    assert.match(frame.headers.get("content-type")!, /^text\/html/);
    assert.match(await frame.text(), /parent\.postMessage/);
  });

  it("keeps local data, secrets and tests out of the standalone trace", () => {
    const excludes = nextConfig.outputFileTracingExcludes?.["*"] ?? [];
    for (const pattern of ["storage/**", ".env", ".env.*", "tests/**"]) assert.ok(excludes.includes(pattern), pattern);
  });

  it("the image optimizer only fetches from configured hosts", () => {
    assert.deepEqual(imageRemotePatterns({}), []);
    const patterns = imageRemotePatterns({
      APP_URL: "https://learn.example.com",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/media",
      S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      S3_BUCKET: "lms",
      IMAGE_HOSTS: " images.partner.org, *.static.example.net, not a host, https://bad.example/x ",
    });
    assert.deepEqual(
      patterns.map((p) => `${p.protocol}://${p.hostname}${p.port ? `:${p.port}` : ""}`),
      ["https://learn.example.com", "https://cdn.example.com", "https://acc.r2.cloudflarestorage.com", "https://lms.acc.r2.cloudflarestorage.com", "https://images.partner.org", "https://*.static.example.net"],
    );
    assert.ok(!patterns.some((p) => p.hostname === "**"));
    const aws = imageRemotePatterns({ STORAGE_DRIVER: "s3", S3_BUCKET: "media", APP_URL: "http://localhost:3000" });
    assert.deepEqual(aws.map((p) => `${p.protocol}://${p.hostname}${p.port ? `:${p.port}` : ""}`), ["http://localhost:3000", "https://media.s3.amazonaws.com", "https://media.s3.*.amazonaws.com"]);
    assert.ok(!(nextConfig.images?.remotePatterns ?? []).some((p) => typeof p === "object" && "hostname" in p && p.hostname === "**"));
  });
});

/* ------------------------------------------------------------------ */

describe("agreement sentence: documents joined in the reader's language", () => {
  const render = (titles: string[], locale: string) =>
    agreementArticle(locale) + agreementListParts(titles.length, locale).map((p: AgreementPart) => (p.type === "document" ? titles[p.index] : p.value)).join("");

  it("reads naturally in English", () => {
    assert.equal(render(["Terms"], "en-US"), "the Terms");
    assert.equal(render(["Terms", "Privacy Policy"], "en-US"), "the Terms and Privacy Policy");
    assert.equal(render(["Terms", "Refunds", "Privacy"], "en-US"), "the Terms, Refunds, and Privacy");
  });

  it("uses the local conjunction and no English article elsewhere", () => {
    assert.equal(render(["Términos", "Privacidad"], "es"), "Términos y Privacidad");
    assert.equal(render(["Conditions", "Remboursements", "Confidentialité"], "fr"), "Conditions, Remboursements et Confidentialité");
    assert.ok(!render(["A", "B"], "hi-IN").includes(" and "));
    assert.equal(agreementArticle("ar"), "");
  });

  it("lists every document exactly once, in order", () => {
    for (const locale of ["en", "es", "fr", "hi", "ar"]) {
      const docs = agreementListParts(3, locale).filter((p): p is Extract<AgreementPart, { type: "document" }> => p.type === "document");
      assert.deepEqual(docs.map((d) => d.index), [0, 1, 2], locale);
    }
    assert.deepEqual(agreementListParts(0, "en"), []);
  });
});
