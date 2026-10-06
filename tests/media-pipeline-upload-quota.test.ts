import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { UploadSession, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { mediaEnv } from "@/lib/server-env";
import { UploadError, createUploadSession } from "@/lib/media/resumable";
import { MAX_ACTIVE_SESSIONS_PER_USER, isFatalUploadStatus, parseUploadErrorCode } from "@/lib/media/resumable-shared";
import {
  admitSingleUpload,
  checkDiskRoom,
  checkLearnerBudget,
  pendingSessionBytes,
  resetUploadLedger,
  sessionBytesInWindow,
  singleUploadBytesInWindow,
  type UploadQuotaPolicy,
} from "@/lib/media/upload-quota";
import { POST as uploadRoute } from "@/app/api/upload/route";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Review fix: uploads cannot fill the disk. `/api/upload` is rate limited and
 * same-site like `/api/uploads`, learners have a daily byte budget, new
 * uploads stop when the disk runs low, and the per-user limit on unfinished
 * uploads holds under parallel requests.
 */

const instructor: User = makeUser({ id: "usr_q_instr", roles: ["course_creator"] });
const student: User = makeUser({ id: "usr_q_student", roles: ["student"] });
const other: User = makeUser({ id: "usr_q_other", roles: ["student"] });

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-06T12:00:00Z");
const policy = (overrides: Partial<UploadQuotaPolicy> = {}): UploadQuotaPolicy => ({ minFreeBytes: 0, learnerBytesPerWindow: 1000, windowMs: DAY, ...overrides });

function session(overrides: Partial<UploadSession>): UploadSession {
  const iso = new Date(NOW - 60_000).toISOString();
  return {
    id: "ups_aaaaaaaa",
    userId: student.id,
    kind: "document",
    fileName: "a.pdf",
    mimeType: "application/pdf",
    size: 100,
    received: 0,
    storageKey: "a.pdf",
    status: "uploading",
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  };
}

async function rejectsWith(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof UploadError, `expected UploadError, got ${String(err)}`);
    assert.equal(err.status, status);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

beforeEach(async () => {
  await resetDb({ users: [instructor, student, other] });
  resetUploadLedger();
  resetRequest();
});

describe("quota rules", () => {
  it("counts a learner's resumable uploads of the last day, not aborted, stale or other people's", () => {
    const sessions = [
      session({ id: "ups_a1", size: 100 }),
      session({ id: "ups_a2", size: 200, status: "complete", received: 200 }),
      session({ id: "ups_a3", size: 400, status: "aborted" }),
      session({ id: "ups_a4", size: 800, createdAt: new Date(NOW - 2 * DAY).toISOString(), status: "complete" }),
      session({ id: "ups_a5", size: 1600, updatedAt: new Date(NOW - 2 * DAY).toISOString() }),
      session({ id: "ups_a6", size: 3200, userId: other.id }),
    ];
    assert.equal(sessionBytesInWindow(sessions, student.id, NOW), 300);
  });

  it("counts the bytes unfinished uploads still expect", () => {
    const sessions = [session({ size: 100, received: 40 }), session({ size: 50, status: "complete", received: 50 }), session({ size: 70, received: 0, userId: other.id })];
    assert.equal(pendingSessionBytes(sessions, NOW), 130);
  });

  it("refuses uploads that would leave the disk below the reserve", () => {
    assert.deepEqual(checkDiskRoom(null, 10, 0, 100), { ok: true });
    assert.deepEqual(checkDiskRoom(1000, 100, 300, 600), { ok: true });
    const full = checkDiskRoom(1000, 101, 300, 600);
    assert.equal(full.ok, false);
    assert.equal(!full.ok && full.status, 507);
    assert.equal(!full.ok && full.code, "disk-full");
  });

  it("holds learners to their daily budget", () => {
    assert.deepEqual(checkLearnerBudget(400, 600, 1000), { ok: true });
    const over = checkLearnerBudget(400, 601, 1000);
    assert.equal(!over.ok && over.status, 429);
    assert.equal(!over.ok && over.code, "quota");
  });

  it("treats a full disk as final on the client and knows the error codes", () => {
    assert.equal(isFatalUploadStatus(507), true);
    assert.equal(parseUploadErrorCode("quota"), "quota");
    assert.equal(parseUploadErrorCode("rm -rf"), null);
    assert.equal(parseUploadErrorCode(42), null);
  });
});

describe("resumable uploads", () => {
  it("keeps the unfinished-upload limit under parallel requests", async () => {
    const attempts = Array.from({ length: MAX_ACTIVE_SESSIONS_PER_USER + 6 }, (_, i) =>
      createUploadSession(instructor, { kind: "document", fileName: `doc-${i}.pdf`, size: 10, mimeType: "application/pdf" }, { free: null }),
    );
    const results = await Promise.allSettled(attempts);
    const created = results.filter((r) => r.status === "fulfilled").length;
    assert.equal(created, MAX_ACTIVE_SESSIONS_PER_USER);
    for (const r of results) {
      if (r.status === "rejected") {
        assert.ok(r.reason instanceof UploadError);
        assert.equal(r.reason.status, 429);
        assert.equal(r.reason.code, "too-many-uploads");
      }
    }
    const db = await getDb();
    assert.equal(db.uploadSessions.filter((s) => s.userId === instructor.id).length, MAX_ACTIVE_SESSIONS_PER_USER);
  });

  it("holds learners to the daily byte budget, counting single uploads too, but not staff", async () => {
    const p = policy({ learnerBytesPerWindow: 100 });
    await createUploadSession(student, { kind: "document", fileName: "a.pdf", size: 60, mimeType: "application/pdf" }, { free: null, policy: p });
    await rejectsWith(createUploadSession(student, { kind: "document", fileName: "b.pdf", size: 41, mimeType: "application/pdf" }, { free: null, policy: p }), 429, "quota");

    const single = await admitSingleUpload(student, 30, { free: null, policy: p });
    assert.ok(single.ok);
    await rejectsWith(createUploadSession(student, { kind: "document", fileName: "c.pdf", size: 11, mimeType: "application/pdf" }, { free: null, policy: p }), 429, "quota");
    // A failed single upload gives its reservation back.
    single.reservation.settle(0);
    await createUploadSession(student, { kind: "document", fileName: "c.pdf", size: 11, mimeType: "application/pdf" }, { free: null, policy: p });

    // Other learners and staff are not affected.
    await createUploadSession(other, { kind: "document", fileName: "d.pdf", size: 90, mimeType: "application/pdf" }, { free: null, policy: p });
    await createUploadSession(instructor, { kind: "video", fileName: "e.mp4", size: 10_000, mimeType: "video/mp4" }, { free: null, policy: p });
  });

  it("refuses new uploads with 507 when the disk is nearly full, counting unfinished uploads", async () => {
    const p = policy({ minFreeBytes: 1000, learnerBytesPerWindow: Number.MAX_SAFE_INTEGER });
    await createUploadSession(instructor, { kind: "video", fileName: "a.mp4", size: 500, mimeType: "video/mp4" }, { free: 2000, policy: p });
    // 2000 free − 500 promised to the first upload − 600 would leave 900 < 1000.
    await rejectsWith(createUploadSession(instructor, { kind: "video", fileName: "b.mp4", size: 600, mimeType: "video/mp4" }, { free: 2000, policy: p }), 507, "disk-full");
    await createUploadSession(instructor, { kind: "video", fileName: "b.mp4", size: 500, mimeType: "video/mp4" }, { free: 2000, policy: p });
    const db = await getDb();
    assert.equal(db.uploadSessions.length, 2, "refused uploads leave no session behind");
  });
});

describe("single-request uploads", () => {
  it("reserves bytes before the body is read, so parallel requests cannot all pass", async () => {
    const p = policy({ learnerBytesPerWindow: 100 });
    const results = await Promise.all(Array.from({ length: 5 }, () => admitSingleUpload(student, 40, { free: null, policy: p })));
    assert.equal(results.filter((r) => r.ok).length, 2);
    assert.equal(singleUploadBytesInWindow(student.id), 80);
    const refused = results.find((r) => !r.ok);
    assert.ok(refused && !refused.ok && refused.code === "quota");
  });

  it("does not budget staff uploads", async () => {
    const p = policy({ learnerBytesPerWindow: 10 });
    const res = await admitSingleUpload(instructor, 10_000, { free: null, policy: p });
    assert.ok(res.ok);
    assert.equal(singleUploadBytesInWindow(instructor.id), 0);
  });

  it("forgets reservations older than the window", async () => {
    const p = policy({ learnerBytesPerWindow: 100 });
    assert.ok((await admitSingleUpload(student, 100, { free: null, policy: p, now: NOW - 2 * DAY })).ok);
    assert.equal(singleUploadBytesInWindow(student.id, NOW), 0);
    assert.ok((await admitSingleUpload(student, 100, { free: null, policy: p, now: NOW })).ok);
  });
});

describe("POST /api/upload", () => {
  const BOUNDARY = "----llQuotaBoundary";
  function uploadRequest(text: string, headers: Record<string, string> = {}): NextRequest {
    const body = new TextEncoder().encode(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${BOUNDARY}--\r\n`,
    );
    return new Request("http://localhost:3000/api/upload", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`, "Content-Length": String(body.byteLength), ...headers },
      body,
    }) as unknown as NextRequest;
  }

  it("requires a signed-in user and refuses other sites", async () => {
    const anonymous = await uploadRoute(uploadRequest("hello"));
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, "sign-in");

    await createSession(student.id);
    const crossSite = await uploadRoute(uploadRequest("hello", { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }));
    assert.equal(crossSite.status, 403);
  });

  it("stores a learner's file and counts it against the daily budget", async () => {
    await createSession(student.id);
    const res = await uploadRoute(uploadRequest("hello world"));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(singleUploadBytesInWindow(student.id), 11, "the reservation is settled to the stored size");
  });

  it("refuses a learner whose daily budget is used up", async () => {
    await createSession(student.id);
    // Fill the budget (default policy) with an earlier upload.
    const filled = await admitSingleUpload(student, mediaEnv.learnerDailyUploadBytes, { free: null });
    assert.ok(filled.ok);
    const res = await uploadRoute(uploadRequest("hello"));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, "quota");
    assert.equal(res.headers.get("Retry-After"), null, "waiting a moment does not help, so the client stops");
  });
});
