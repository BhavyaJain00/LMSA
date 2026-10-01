import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { Database } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { authRateLimiter } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db/store";
import { EXPORT_FORMAT, EXPORT_VERSION, personalDataSections, serializePersonalData } from "@/lib/legal/export";
import { DELETED_USER_NAME, deletedEmailFor, eraseAccountInDb, isDeletedAccount } from "@/lib/legal/erase";
import { erasureEmailCopy } from "@/lib/legal/erasure-email";
import { adminEraseAccountAction, deleteAccountAction } from "@/lib/actions/privacy";
import { GET as exportGET, POST as exportPOST } from "@/app/api/privacy/export/route";
import { FIXED_NOW, makePayment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Round 3 legal-ops part 2: the "Download my data" endpoint, export and
 * erasure rules for the growth-era collections, and what an erasure leaves in
 * the audit log.
 */

const ORIGIN = "http://localhost:3000";
const root = makeUser({ id: "usr_root", name: "Root Admin", email: "root@example.com", roles: ["admin"] });
const ada = makeUser({ id: "usr_ada", name: "Ada Lovelace", email: "ada@example.com", username: "ada" });
const bob = makeUser({ id: "usr_bob", name: "Bob Other", email: "bob@example.com", username: "bob" });

/** Field names that must never appear anywhere in an export. */
const FORBIDDEN_KEYS = ["passwordHash", "tokenHash", "keyHash", "inviteTokenHash", "twoFactorSecretEnc", "recoveryCodeHashes", "calendarToken", "secretEnc", "checkoutUrl", "storageKey"];

function exportRequest(init: { userId?: string; origin?: string | null; fetchSite?: string } = {}): NextRequest {
  const url = `${ORIGIN}/api/privacy/export`;
  const headers = new Headers();
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin) headers.set("origin", origin);
  if (init.fetchSite) headers.set("sec-fetch-site", init.fetchSite);
  const body = new FormData();
  if (init.userId) body.set("userId", init.userId);
  return Object.assign(new Request(url, { method: "POST", headers, body }), { nextUrl: new URL(url) }) as unknown as NextRequest;
}

function redirectedTo(res: Response): string {
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get("location")!);
  return `${location.pathname}${location.search}`;
}

interface ExportFile {
  format: string;
  version: number;
  exportedAt: string;
  site: { name: string; url: string };
  contents: { key: string; description: string; count: number }[];
  data: Record<string, Record<string, unknown>[]>;
}

/** Every object key used anywhere in a JSON value. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysIn(item, found);
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysIn(inner, found);
    }
  }
  return found;
}

/** Records of the growth-era collections, for Ada and for Bob. */
function growthFixture(): Fixture {
  const base = { planId: "pln_1", currentPeriodStart: FIXED_NOW, currentPeriodEnd: FIXED_NOW, createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
  return {
    users: [root, { ...ada, avatarUrl: "/uploads/ada.png", bio: "Mathematician", emailPreferences: { enrollment: true, announcements: false, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: true } }, bob],
    payments: [makePayment({ id: "pay_ada", userId: ada.id, itemId: "crs_1", status: "paid", invoiceNumber: "INV-0007", source: "friend", pan: "ABCDE1234F" })],
    subscriptions: [
      { ...base, id: "sub_manual", userId: ada.id, status: "active", cancelAtPeriodEnd: false, gateway: "manual" },
      { ...base, id: "sub_bob", userId: bob.id, status: "active", cancelAtPeriodEnd: false, gateway: "manual" },
    ],
    apiKeys: [
      { id: "key_ada", name: "Zapier", prefix: "ll_live_ab12", keyHash: "key-hash-ada", scopes: ["courses:read"], createdById: ada.id, createdAt: FIXED_NOW },
      { id: "key_bob", name: "CRM", prefix: "ll_live_cd34", keyHash: "key-hash-bob", scopes: ["courses:read"], createdById: bob.id, createdAt: FIXED_NOW },
    ],
    organizations: [{ id: "org_1", name: "Analytical Engines", slug: "analytical", ownerId: bob.id, managerIds: [ada.id], seatCount: 5, courseIds: [], createdAt: FIXED_NOW }],
    orgSeats: [
      { id: "seat_ada", orgId: "org_1", userId: ada.id, email: "ada@example.com", status: "active", assignedAt: FIXED_NOW },
      { id: "seat_invite", orgId: "org_1", email: "ADA@example.com", inviteTokenHash: "invite-hash", status: "invited", assignedAt: FIXED_NOW },
      { id: "seat_bob", orgId: "org_1", userId: bob.id, email: "bob@example.com", status: "active", assignedAt: FIXED_NOW },
    ],
    gifts: [
      { id: "gift_to_ada", code: "GIFT-AAAA", purchaserId: bob.id, recipientEmail: "ada@example.com", recipientName: "Ada", itemType: "course", itemId: "crs_1", paymentId: "pay_x", createdAt: FIXED_NOW },
      { id: "gift_by_ada", code: "GIFT-BBBB", purchaserId: ada.id, recipientEmail: "friend@example.com", itemType: "course", itemId: "crs_1", paymentId: "pay_ada", createdAt: FIXED_NOW },
      { id: "gift_other", code: "GIFT-CCCC", purchaserId: bob.id, recipientEmail: "carol@example.com", itemType: "course", itemId: "crs_1", paymentId: "pay_y", createdAt: FIXED_NOW },
    ],
    affiliates: [{ id: "aff_ada", userId: ada.id, code: "ADA10", commissionPercent: 20, status: "active", payoutEmail: "ada-paypal@example.com", createdAt: FIXED_NOW }],
    affiliateReferrals: [{ id: "ref_1", affiliateId: "aff_ada", visitorId: "anon-visitor-0123456789", landingPath: "/courses", createdAt: FIXED_NOW }],
    commissions: [{ id: "com_1", affiliateId: "aff_ada", paymentId: "pay_x", amount: 500, currency: "USD", status: "pending", createdAt: FIXED_NOW }],
    instructorProfiles: [{ id: "ins_ada", userId: ada.id, revenueSharePercent: 70, status: "approved", application: "I taught Babbage.", payoutEmail: "ada-bank@example.com", createdAt: FIXED_NOW }],
    liveClasses: [
      { id: "lc_1", batchId: "bat_1", title: "Kickoff", date: "2026-02-01", time: "10:00", durationMinutes: 60, timezone: "UTC", hostId: bob.id, provider: "custom", joinUrl: "https://meet.example/secret", autoRecording: "none", attendeeIds: [ada.id, bob.id], createdAt: FIXED_NOW },
    ],
    aiConversations: [
      { id: "aic_ada", userId: ada.id, courseId: "crs_1", title: "Closures", createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
      { id: "aic_bob", userId: bob.id, courseId: "crs_1", title: "Loops", createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
    ],
    aiMessages: [
      { id: "aim_1", conversationId: "aic_ada", role: "user", content: "What is a closure?", createdAt: FIXED_NOW },
      { id: "aim_2", conversationId: "aic_ada", role: "assistant", content: "A function with its scope.", createdAt: FIXED_NOW },
      { id: "aim_3", conversationId: "aic_bob", role: "user", content: "What is a loop?", createdAt: FIXED_NOW },
    ],
    conversations: [
      { id: "cnv_1", participantIds: [ada.id, bob.id], lastMessageAt: FIXED_NOW, createdAt: FIXED_NOW },
      { id: "cnv_2", participantIds: [bob.id, root.id], lastMessageAt: FIXED_NOW, createdAt: FIXED_NOW },
    ],
    directMessages: [
      { id: "dm_1", conversationId: "cnv_1", senderId: ada.id, body: "Hello Bob", readBy: [ada.id], createdAt: FIXED_NOW },
      { id: "dm_2", conversationId: "cnv_1", senderId: bob.id, body: "Hello Ada", readBy: [bob.id], createdAt: FIXED_NOW },
      { id: "dm_3", conversationId: "cnv_2", senderId: bob.id, body: "Private", readBy: [bob.id], createdAt: FIXED_NOW },
    ],
    checkoutSessions: [
      { id: "chk_ada", userId: ada.id, itemType: "course", itemId: "crs_1", startedAt: FIXED_NOW, lastStepAt: FIXED_NOW, reminderCount: 1 },
      { id: "chk_guest", email: "Ada@Example.com", itemType: "course", itemId: "crs_2", startedAt: FIXED_NOW, lastStepAt: FIXED_NOW, reminderCount: 0 },
      { id: "chk_bob", userId: bob.id, itemType: "course", itemId: "crs_1", startedAt: FIXED_NOW, lastStepAt: FIXED_NOW, reminderCount: 0 },
    ],
    sequenceEnrollments: [{ id: "seq_ada", sequenceId: "sq_1", email: "ada@example.com", nextStepIndex: 0, nextRunAt: FIXED_NOW, status: "active", createdAt: FIXED_NOW }],
    uploadSessions: [
      { id: "up_done", userId: ada.id, kind: "video", fileName: "talk.mp4", mimeType: "video/mp4", size: 10, received: 10, storageKey: "videos/secret-key.mp4", status: "complete", createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
      { id: "up_open", userId: ada.id, kind: "video", fileName: "half.mp4", mimeType: "video/mp4", size: 10, received: 4, storageKey: "videos/half.mp4", status: "uploading", createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
    ] as Database["uploadSessions"],
    exercises: [
      {
        id: "exr_1",
        title: "Sum",
        problemStatement: "Add two numbers",
        language: "javascript",
        testCases: [
          { id: "t_open", input: "1 2", expectedOutput: "3" },
          { id: "t_hidden", input: "40 2", expectedOutput: "42", hidden: true },
        ],
        authorId: bob.id,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      },
    ],
    exerciseSubmissions: [
      {
        id: "exs_1",
        exerciseId: "exr_1",
        exerciseTitle: "Sum",
        userId: ada.id,
        code: "print(a+b)",
        status: "passed",
        testResults: [
          { testCaseId: "t_open", input: "1 2", expectedOutput: "3", actualOutput: "3", passed: true },
          { testCaseId: "t_hidden", input: "40 2", expectedOutput: "42", actualOutput: "42", passed: true },
        ],
        submittedAt: FIXED_NOW,
      },
    ],
    assignmentSubmissions: [
      { id: "asub_ada", assignmentId: "asg_1", assignmentTitle: "Essay", userId: ada.id, type: "text", answer: "My essay", status: "pass", evaluatorId: bob.id, submittedAt: FIXED_NOW, updatedAt: FIXED_NOW },
    ] as Database["assignmentSubmissions"],
    peerReviews: [
      { id: "pr_done", submissionId: "asub_ada", reviewerId: bob.id, assignmentId: "asg_1", comment: "Nice", status: "submitted", assignedAt: FIXED_NOW, submittedAt: FIXED_NOW },
      { id: "pr_open", submissionId: "asub_ada", reviewerId: root.id, assignmentId: "asg_1", comment: "", status: "assigned", assignedAt: FIXED_NOW },
      { id: "pr_by_ada", submissionId: "asub_other", reviewerId: ada.id, assignmentId: "asg_1", comment: "Good work", status: "submitted", assignedAt: FIXED_NOW, submittedAt: FIXED_NOW },
    ],
    blogPosts: [{ id: "post_1", slug: "engines", title: "On engines", excerpt: "", content: "Long text", authorId: ada.id, categoryIds: [], tags: [], status: "published", relatedCourseIds: [], readingTimeSeconds: 60, views: 3, createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
    webhookDeliveries: [
      { id: "whd_done", endpointId: "whe_1", event: "user.created", payload: '{"email":"Ada@Example.com","name":"Ada"}', status: "success", attempts: 1, createdAt: FIXED_NOW },
      { id: "whd_pending", endpointId: "whe_1", event: "user.updated", payload: '{"email":"ada@example.com"}', status: "pending", attempts: 0, createdAt: FIXED_NOW },
      { id: "whd_bob", endpointId: "whe_1", event: "user.created", payload: '{"email":"bob@example.com"}', status: "success", attempts: 1, createdAt: FIXED_NOW },
      { id: "whd_similar", endpointId: "whe_1", event: "user.created", payload: '{"email":"nada@example.com"}', status: "failed", attempts: 3, createdAt: FIXED_NOW },
    ],
    auditEvents: [
      { id: "aud_own", actorId: ada.id, action: "affiliate.apply", targetType: "affiliate", targetId: "aff_ada", ip: "203.0.113.9", createdAt: FIXED_NOW },
      { id: "aud_about", actorId: root.id, action: "api.user.create", targetType: "user", targetId: ada.id, meta: { email: "ada@example.com", roles: "student" }, ip: "198.51.100.1", createdAt: FIXED_NOW },
      { id: "aud_only_identity", actorId: root.id, action: "user.delete", targetType: "user", targetId: ada.id, meta: { username: "ada" }, createdAt: FIXED_NOW },
      { id: "aud_other", actorId: root.id, action: "user.roles", targetType: "user", targetId: bob.id, meta: { email: "bob@example.com" }, ip: "198.51.100.1", createdAt: FIXED_NOW },
    ],
    errorEvents: [{ id: "err_1", message: "boom", stack: "at secret/path.ts", path: "/courses", userId: ada.id, createdAt: FIXED_NOW, lastSeenAt: FIXED_NOW, count: 2 }],
    analyticsEvents: [{ id: "evt_1", name: "page_view", path: "/courses", userId: ada.id, anonId: "anon-ada-0123456789", createdAt: FIXED_NOW }],
  };
}

describe("export rules for growth-era records", () => {
  let db: Database;
  const rows = (key: string) => {
    const found = personalDataSections(db, ada.id)!.find((s) => s.key === key);
    assert.ok(found, `section ${key}`);
    return found.rows;
  };

  beforeEach(async () => {
    db = structuredClone(await resetDb(growthFixture()));
  });

  it("uses each section key once and never exports a secret field", () => {
    const sections = personalDataSections(db, ada.id)!;
    const keys = sections.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, "section keys are unique");
    const used = keysIn(sections.map((s) => s.rows));
    for (const key of FORBIDDEN_KEYS) assert.ok(!used.has(key), `${key} is never exported`);
    const text = [...serializePersonalData(sections, { exportedAt: FIXED_NOW, siteName: "LearnLoop", siteUrl: ORIGIN })].join("");
    for (const secret of ["key-hash-ada", "invite-hash", "videos/secret-key.mp4", "anon-visitor-0123456789"]) assert.ok(!text.includes(secret), `${secret} is left out`);
  });

  it("includes memberships, team seats, gifts and affiliate records without other people's data", () => {
    assert.deepEqual(rows("subscriptions").map((r) => r.id), ["sub_manual"]);
    assert.deepEqual(rows("orgSeats").map((r) => r.id), ["seat_ada", "seat_invite"], "seats are matched by member and by address");
    assert.deepEqual(rows("organizations").map((r) => r.id), ["org_1"]);
    assert.deepEqual(rows("gifts").map((r) => r.id), ["gift_to_ada", "gift_by_ada"]);
    assert.deepEqual(rows("affiliates").map((r) => r.id), ["aff_ada"]);
    assert.deepEqual(rows("affiliateReferrals"), [{ id: "ref_1", affiliateId: "aff_ada", landingPath: "/courses", createdAt: FIXED_NOW }]);
    assert.deepEqual(rows("commissions").map((r) => r.id), ["com_1"]);
    assert.deepEqual(rows("apiKeys").map((r) => r.id), ["key_ada"]);
    assert.deepEqual(rows("checkoutSessions").map((r) => r.id), ["chk_ada", "chk_guest"]);
    assert.deepEqual(rows("sequenceEnrollments").map((r) => r.id), ["seq_ada"]);
  });

  it("includes AI chats and direct messages of the member's own conversations only", () => {
    assert.deepEqual(rows("aiConversations").map((r) => r.id), ["aic_ada"]);
    assert.deepEqual(rows("aiMessages").map((r) => r.id), ["aim_1", "aim_2"], "questions and the answers they received");
    assert.deepEqual(rows("conversations").map((r) => r.id), ["cnv_1"]);
    assert.deepEqual(rows("directMessages").map((r) => r.id), ["dm_1", "dm_2"]);
  });

  it("hides hidden test cases, reviewers and evaluators", () => {
    const [submission] = rows("exerciseSubmissions") as unknown as { testResults: Record<string, unknown>[] }[];
    assert.deepEqual(submission!.testResults[0], { testCaseId: "t_open", input: "1 2", expectedOutput: "3", actualOutput: "3", passed: true });
    assert.deepEqual(submission!.testResults[1], { testCaseId: "t_hidden", actualOutput: "42", passed: true });
    assert.ok(!("evaluatorId" in rows("assignmentSubmissions")[0]!));
    const received = rows("peerReviewsReceived");
    assert.deepEqual(received.map((r) => r.id), ["pr_done"], "unfinished reviews are not included");
    assert.ok(!("reviewerId" in received[0]!), "peer reviewers stay anonymous");
    assert.deepEqual(rows("peerReviewsGiven").map((r) => r.id), ["pr_by_ada"]);
  });

  it("lists attended classes and authored content by title only", () => {
    assert.deepEqual(rows("liveClassAttendance"), [{ id: "lc_1", batchId: "bat_1", title: "Kickoff", date: "2026-02-01", time: "10:00", timezone: "UTC" }]);
    assert.deepEqual(rows("authoredContent"), [{ type: "blogPosts", id: "post_1", title: "On engines" }]);
    assert.deepEqual(rows("errorReports"), [{ id: "err_1", message: "boom", path: "/courses", count: 2, createdAt: FIXED_NOW, lastSeenAt: FIXED_NOW }], "stack traces stay internal");
    assert.ok(!("anonId" in rows("analyticsEvents")[0]!));
    assert.deepEqual(rows("uploadSessions").map((r) => r.id), ["up_done", "up_open"]);
  });
});

describe("erasure rules for growth-era records", () => {
  let db: Database;
  beforeEach(async () => {
    db = structuredClone(await resetDb(growthFixture()));
    eraseAccountInDb(db, ada.id, { now: new Date(FIXED_NOW), username: "deleted-abc123" });
  });

  it("leaves nothing personal on the account", () => {
    const user = db.users.find((u) => u.id === ada.id)!;
    assert.deepEqual(Object.keys(user).sort(), ["createdAt", "email", "enabled", "id", "lastActiveAt", "name", "passwordHash", "personaCaptured", "roles", "username"]);
    assert.equal(user.username, "deleted-abc123");
    assert.deepEqual(user.roles, ["student"]);
    assert.equal(personalDataSections(db, ada.id)!.find((s) => s.key === "account")!.rows[0]!.name, DELETED_USER_NAME);
  });

  it("ends memberships, revokes keys and seats, and pauses the affiliate account", () => {
    const sub = db.subscriptions.find((s) => s.id === "sub_manual")!;
    assert.equal(sub.status, "cancelled");
    assert.equal(db.subscriptions.find((s) => s.id === "sub_bob")!.status, "active");
    assert.equal(db.apiKeys.find((k) => k.id === "key_ada")!.revokedAt, FIXED_NOW);
    assert.equal(db.apiKeys.find((k) => k.id === "key_bob")!.revokedAt, undefined);
    for (const id of ["seat_ada", "seat_invite"]) {
      const seat = db.orgSeats.find((s) => s.id === id)!;
      assert.equal(seat.status, "revoked");
      assert.equal(seat.email, deletedEmailFor(ada.id));
      assert.equal(seat.inviteTokenHash, undefined);
    }
    assert.equal(db.orgSeats.find((s) => s.id === "seat_bob")!.email, "bob@example.com");
    assert.deepEqual(db.organizations[0]!.managerIds, []);
    const affiliate = db.affiliates[0]!;
    assert.equal(affiliate.status, "paused");
    assert.equal(affiliate.payoutEmail, undefined);
    assert.equal(db.commissions.length, 1, "commission amounts are kept for the books");
    const profile = db.instructorProfiles[0]!;
    assert.equal(profile.payoutEmail, undefined);
    assert.equal(profile.application, undefined);
  });

  it("keeps gifts and orders usable without the person's details", () => {
    const received = db.gifts.find((g) => g.id === "gift_to_ada")!;
    assert.equal(received.recipientEmail, deletedEmailFor(ada.id));
    assert.equal(received.recipientName, undefined);
    assert.equal(received.code, "GIFT-AAAA");
    assert.equal(db.gifts.find((g) => g.id === "gift_other")!.recipientEmail, "carol@example.com");
    const payment = db.payments[0]!;
    assert.equal(payment.invoiceNumber, "INV-0007");
    assert.equal(payment.amount, 10000);
    assert.equal(payment.pan, undefined);
    assert.equal(payment.source, undefined);
  });

  it("removes AI chats, started checkouts, email sequences and unfinished uploads", () => {
    assert.deepEqual(db.aiConversations.map((c) => c.id), ["aic_bob"]);
    assert.deepEqual(db.aiMessages.map((m) => m.id), ["aim_3"]);
    assert.deepEqual(db.checkoutSessions.map((c) => c.id), ["chk_bob"]);
    assert.equal(db.sequenceEnrollments.length, 0);
    assert.deepEqual(db.uploadSessions.map((u) => u.id), ["up_done"], "finished files stay where lessons use them");
    assert.deepEqual(db.liveClasses[0]!.attendeeIds, [bob.id]);
  });

  it("removes the messages the person sent but keeps replies and peer reviews for the others", () => {
    assert.deepEqual(db.directMessages.map((m) => m.id), ["dm_2", "dm_3"], "only the erased member's own messages go");
    assert.deepEqual(db.conversations.map((c) => c.id), ["cnv_1", "cnv_2"], "Bob can still read his side of the conversation");
    assert.equal(db.peerReviews.length, 3);
  });

  it("drops finished webhook logs that carried the address, and only those", () => {
    assert.deepEqual(db.webhookDeliveries.map((d) => d.id), ["whd_pending", "whd_bob", "whd_similar"]);
  });

  it("strips the person from the audit and error logs but keeps what happened", () => {
    const own = db.auditEvents.find((e) => e.id === "aud_own")!;
    assert.equal(own.ip, undefined, "their IP address goes");
    assert.equal(own.actorId, ada.id);
    const about = db.auditEvents.find((e) => e.id === "aud_about")!;
    assert.deepEqual(about.meta, { roles: "student" });
    assert.equal(about.ip, "198.51.100.1", "the administrator's IP stays");
    assert.equal(db.auditEvents.find((e) => e.id === "aud_only_identity")!.meta, undefined);
    assert.deepEqual(db.auditEvents.find((e) => e.id === "aud_other")!.meta, { email: "bob@example.com" }, "events about other members are untouched");
    assert.equal(db.errorEvents[0]!.userId, undefined);
    assert.equal(db.analyticsEvents[0]!.userId, undefined);
  });

  it("reports what it removed and anonymized", async () => {
    const fresh = structuredClone(await resetDb(growthFixture()));
    const summary = eraseAccountInDb(fresh, ada.id, { now: new Date(FIXED_NOW), username: "deleted-abc123" })!;
    assert.equal(summary.removed.aiMessages, 2);
    assert.equal(summary.removed.checkoutSessions, 2);
    assert.equal(summary.removed.webhookDeliveries, 1);
    assert.equal(summary.anonymized.users, 1);
    assert.equal(summary.anonymized.orgSeats, 2);
    assert.equal(summary.anonymized.auditEvents, 3);
    assert.equal(summary.removed.notes, undefined, "collections without matching rows are not listed");
  });
});

describe("POST /api/privacy/export", () => {
  beforeEach(async () => {
    await resetDb({
      users: [root, ada, bob],
      notes: [{ id: "note_ada", userId: ada.id, courseId: "crs_1", lessonId: "les_1", color: "yellow", note: "Mine", createdAt: FIXED_NOW, updatedAt: FIXED_NOW }] as Database["notes"],
    });
    resetRequest();
    authRateLimiter.resetPrefix("privacy-export:");
  });

  async function download(res: Response): Promise<ExportFile> {
    assert.equal(res.status, 200);
    return JSON.parse(await res.text()) as ExportFile;
  }

  it("sends visitors to sign in", async () => {
    const res = await exportPOST(exportRequest());
    assert.equal(redirectedTo(res), "/login?next=/settings/privacy");
    assert.equal((await getDb()).dataRequests.length, 0);
  });

  it("refuses requests from other sites", async () => {
    await createSession(ada.id);
    for (const init of [{ origin: "https://evil.example" }, { origin: null }, { origin: null, fetchSite: "cross-site" }]) {
      const res = await exportPOST(exportRequest(init));
      assert.equal(res.status, 403, JSON.stringify(init));
    }
    const db = await getDb();
    assert.equal(db.dataRequests.length, 0);
    assert.equal(db.auditEvents.length, 0);
    assert.equal((await exportPOST(exportRequest({ origin: null, fetchSite: "same-origin" }))).status, 200, "browsers that send no Origin header are recognised by Sec-Fetch-Site");
  });

  it("streams the member's own data as a JSON attachment", async () => {
    await createSession(ada.id);
    const res = await exportPOST(exportRequest());
    assert.match(res.headers.get("content-type")!, /^application\/json/);
    assert.match(res.headers.get("content-disposition")!, /^attachment; filename="personal-data-ada-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const file = await download(res);
    assert.equal(file.format, EXPORT_FORMAT);
    assert.equal(file.version, EXPORT_VERSION);
    assert.equal(file.site.url, ORIGIN);
    assert.equal(file.data.account![0]!.email, "ada@example.com");
    assert.ok(!("passwordHash" in file.data.account![0]!));
    assert.deepEqual(file.data.notes!.map((n) => n.id), ["note_ada"]);
    assert.equal(file.contents.find((c) => c.key === "notes")!.count, 1);
  });

  it("records the request, audits it and tells the member", async () => {
    await createSession(ada.id);
    await download(await exportPOST(exportRequest()));
    const db = await getDb();
    assert.equal(db.dataRequests.length, 1);
    const [request] = db.dataRequests;
    assert.equal(request!.userId, ada.id);
    assert.equal(request!.type, "export");
    assert.equal(request!.status, "completed");
    assert.ok(request!.completedAt);
    const event = db.auditEvents.find((e) => e.action === "privacy.export")!;
    assert.equal(event.actorId, ada.id);
    assert.equal(event.targetId, ada.id);
    assert.equal(event.meta?.byAdmin, false);
    assert.equal(event.meta?.requestId, request!.id);
    assert.ok(Number(event.meta?.records) >= 2, "the profile and the note at least");
    const notice = db.notifications.find((n) => n.userId === ada.id)!;
    assert.equal(notice.subject, "A copy of your data was downloaded");
    assert.equal(notice.link, "/settings/security");
  });

  it("treats a member's own id like no id at all", async () => {
    await createSession(ada.id);
    const file = await download(await exportPOST(exportRequest({ userId: ada.id })));
    assert.equal(file.data.account![0]!.id, ada.id);
    assert.equal((await getDb()).auditEvents.find((e) => e.action === "privacy.export")!.meta?.byAdmin, false);
  });

  it("only lets administrators download another member's data", async () => {
    await createSession(bob.id);
    assert.equal(redirectedTo(await exportPOST(exportRequest({ userId: ada.id }))), "/settings/privacy?export=denied");
    assert.equal((await getDb()).dataRequests.length, 0);

    resetRequest();
    await createSession(root.id);
    const file = await download(await exportPOST(exportRequest({ userId: ada.id })));
    assert.equal(file.data.account![0]!.id, ada.id);
    const db = await getDb();
    assert.deepEqual(db.dataRequests.map((r) => r.userId), [ada.id], "recorded for the member, not the administrator");
    const event = db.auditEvents.find((e) => e.action === "privacy.export")!;
    assert.equal(event.actorId, root.id);
    assert.equal(event.targetId, ada.id);
    assert.equal(event.meta?.byAdmin, true);
    const notice = db.notifications.find((n) => n.userId === ada.id)!;
    assert.equal(notice.subject, "An administrator downloaded a copy of your data");
    assert.ok(!db.notifications.some((n) => n.userId === root.id));
  });

  it("returns administrators to the requests list when the member is gone or erased", async () => {
    await createSession(root.id);
    assert.equal(redirectedTo(await exportPOST(exportRequest({ userId: "usr_missing" }))), "/admin/audit?tab=requests&export=missing");
    const erased = await adminEraseTarget();
    assert.equal(redirectedTo(await exportPOST(exportRequest({ userId: erased }))), "/admin/audit?tab=requests&export=missing");
    assert.equal((await getDb()).dataRequests.filter((r) => r.type === "export").length, 0);
  });

  /** Erase Bob directly in the store and return his id. */
  async function adminEraseTarget(): Promise<string> {
    const db = await getDb();
    const user = db.users.find((u) => u.id === bob.id)!;
    user.email = deletedEmailFor(bob.id);
    user.name = DELETED_USER_NAME;
    assert.ok(isDeletedAccount(user));
    return bob.id;
  }

  it("limits how often a member can download", async () => {
    await createSession(ada.id);
    for (let i = 0; i < 5; i++) assert.equal((await exportPOST(exportRequest())).status, 200, `download ${i + 1}`);
    assert.equal(redirectedTo(await exportPOST(exportRequest())), "/settings/privacy?export=limited");
    assert.equal((await getDb()).dataRequests.length, 5);
  });

  it("sends a large export in several chunks that form one document", async () => {
    const notes = Array.from({ length: 1500 }, (_, i) => ({ id: `note_${i}`, userId: ada.id, courseId: "crs_1", lessonId: "les_1", color: "yellow", note: `Note ${i} ${"x".repeat(80)}`, createdAt: FIXED_NOW, updatedAt: FIXED_NOW }));
    await resetDb({ users: [ada], notes: notes as Database["notes"] });
    await createSession(ada.id);
    const res = await exportPOST(exportRequest());
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    assert.ok(chunks > 1, `streamed in ${chunks} chunks`);
    assert.equal((JSON.parse(text) as ExportFile).data.notes!.length, 1500);
  });

  it("does not answer GET requests with data", async () => {
    await createSession(ada.id);
    const res = exportGET();
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });
});

describe("what an erasure leaves in the audit log", () => {
  const password = "correct horse battery";
  let passwordHash = "";

  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.set(k, v);
    return data;
  }

  /** Run `fn` as a request arriving through one trusted proxy from 198.51.100.4. */
  async function fromKnownIp<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = "1";
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
      else process.env.TRUST_PROXY_HOPS = previous;
    }
  }

  beforeEach(async () => {
    passwordHash ||= await hashPassword(password);
    await resetDb({ users: [{ ...root, passwordHash }, { ...ada, passwordHash }, bob] });
    resetRequest({ headers: { "x-forwarded-for": "198.51.100.4" } });
    authRateLimiter.resetPrefix("account-delete:");
    authRateLimiter.resetPrefix("account-erase:");
  });

  it("records a member's own deletion without their IP address", async () => {
    await createSession(ada.id);
    await fromKnownIp(() => captureRedirect(() => deleteAccountAction(null, form({ password, confirm: "DELETE" }))));
    const db = await getDb();
    const event = db.auditEvents.find((e) => e.action === "account.delete")!;
    assert.equal(event.actorId, ada.id);
    assert.equal(event.ip, undefined);
    const request = db.dataRequests.find((r) => r.type === "delete")!;
    assert.equal(event.meta?.requestId, request.id, "the event points at the recorded request");
    assert.equal(event.meta?.byOwner, true);
    assert.ok(Number(event.meta?.anonymized) >= 1);
  });

  it("records the administrator's IP address when they erase on a member's behalf", async () => {
    await createSession(root.id);
    const result = await fromKnownIp(() => adminEraseAccountAction(null, form({ userId: ada.id, password, confirm: "DELETE" })));
    assert.equal(result.ok, true);
    const db = await getDb();
    const event = db.auditEvents.find((e) => e.action === "account.erase")!;
    assert.equal(event.actorId, root.id);
    assert.equal(event.targetId, ada.id);
    assert.equal(event.ip, "198.51.100.4");
    assert.equal(event.meta?.byOwner, false);
    assert.equal(db.dataRequests.filter((r) => r.userId === ada.id && r.type === "delete").length, 1);
    assert.equal(db.auditEvents.filter((e) => e.action === "account.delete").length, 0);
  });

  it("refuses to delete the only administrator and changes nothing", async () => {
    await createSession(root.id);
    const result = await deleteAccountAction(null, form({ password, confirm: "DELETE" }));
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /only administrator/);
    const db = await getDb();
    assert.equal(db.users.find((u) => u.id === root.id)!.name, "Root Admin");
    assert.equal(db.dataRequests.length, 0);
    assert.equal(db.auditEvents.length, 0);
  });

  it("refuses while a gateway still bills a membership", async () => {
    const db = await getDb();
    db.subscriptions.push({ id: "sub_live", userId: ada.id, planId: "pln_1", status: "active", currentPeriodStart: FIXED_NOW, currentPeriodEnd: FIXED_NOW, cancelAtPeriodEnd: false, gateway: "stripe", gatewaySubscriptionId: "sub_123", createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
    await createSession(ada.id);
    const own = await deleteAccountAction(null, form({ password, confirm: "DELETE" }));
    assert.match(!own.ok ? own.error : "", /still billed automatically/);

    resetRequest();
    await createSession(root.id);
    const byAdmin = await adminEraseAccountAction(null, form({ userId: ada.id, password, confirm: "DELETE" }));
    assert.match(!byAdmin.ok ? byAdmin.error : "", /for this member/);
    assert.ok(!isDeletedAccount((await getDb()).users.find((u) => u.id === ada.id)!));
  });

  it("asks for a verification code when two-step verification is on", async () => {
    const db = await getDb();
    Object.assign(db.users.find((u) => u.id === ada.id)!, { twoFactorEnabled: true, twoFactorSecretEnc: "enc:secret" });
    await createSession(ada.id);
    const result = await deleteAccountAction(null, form({ password, confirm: "DELETE" }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.fieldErrors?.code);
    assert.ok(!isDeletedAccount((await getDb()).users.find((u) => u.id === ada.id)!));
  });
});

describe("erasure confirmation email", () => {
  it("explains what was kept and who asked", () => {
    const own = erasureEmailCopy("LearnLoop", false);
    assert.equal(own.subject, "Your LearnLoop account was deleted");
    assert.match(own.paragraphs[0]!, /as you asked/);
    assert.ok(own.paragraphs.some((p) => p.includes("invoice numbers")));
    const byAdmin = erasureEmailCopy("LearnLoop", true);
    assert.match(byAdmin.paragraphs[0]!, /an administrator deleted/);
    assert.deepEqual(byAdmin.paragraphs.slice(1), own.paragraphs.slice(1));
  });
});
