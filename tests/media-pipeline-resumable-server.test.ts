import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UploadSession, User } from "@/lib/types";
import { findById, getDb, mutate } from "@/lib/db/store";
import { uploadRoot } from "@/lib/storage";
import {
  UploadError,
  abortUploadSession,
  appendChunk,
  cleanupStaleUploads,
  completeUploadSession,
  createUploadSession,
  currentOffset,
  getOwnedSession,
  getUploadSessionStats,
  partialPathOf,
} from "@/lib/media/resumable";
import { MAX_ACTIVE_SESSIONS_PER_USER, STALE_SESSION_MS } from "@/lib/media/resumable-shared";
import { makeUser, resetDb } from "./helpers/db";

/** Resumable upload protocol on the server: sessions, streamed appends, completion, abort and cleanup. */

const instructor: User = makeUser({ id: "usr_mp_instr", roles: ["course_creator"] });
const student: User = makeUser({ id: "usr_mp_student", roles: ["student"] });

/** 64 bytes that sniff as an MP4 ("ftyp" box at offset 4) followed by `size - 64` filler bytes. */
function mp4Bytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  for (let i = 12; i < size; i++) out[i] = i % 251;
  return out;
}

/** A body delivered in `piece`-byte parts; when `failAfter` is set the stream errors once that many bytes went out (a dropped connection). */
function bodyStream(bytes: Uint8Array, piece = 1000, failAfter?: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (failAfter !== undefined && offset >= failAfter) {
          controller.error(new Error("socket hang up"));
          return;
        }
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(bytes.byteLength, offset + piece, failAfter ?? Infinity);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    },
    { highWaterMark: 0 },
  );
}

function patch(sessionId: string, offset: number | string, body: Uint8Array, opts: { contentLength?: boolean; piece?: number; failAfter?: number } = {}): Request {
  const headers = new Headers({ "Upload-Offset": String(offset) });
  if (opts.contentLength !== false) headers.set("Content-Length", String(body.byteLength));
  return new Request(`http://localhost:3000/api/uploads/${sessionId}`, {
    method: "PATCH",
    headers,
    body: bodyStream(body, opts.piece, opts.failAfter),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function fresh(id: string): Promise<UploadSession> {
  const s = await findById("uploadSessions", id);
  assert.ok(s, "session exists");
  return s;
}

async function rejectsWith(promise: Promise<unknown>, status: number, offset?: number): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof UploadError, `expected UploadError, got ${String(err)}`);
    assert.equal(err.status, status);
    if (offset !== undefined) assert.equal(err.offset, offset);
    return true;
  });
}

beforeEach(async () => {
  await resetDb({ users: [instructor, student] });
});

describe("resumable upload sessions", () => {
  it("uploads a video in chunks and completes it under videos/", async () => {
    const bytes = mp4Bytes(25_000);
    const session = await createUploadSession(instructor, { kind: "video", fileName: "Week 1 Intro.mp4", size: bytes.byteLength, mimeType: "video/mp4" });
    assert.equal(session.kind, "video");
    assert.match(session.storageKey, /^videos\/week-1-intro-[a-z0-9]+\.mp4$/);
    assert.equal(statSync(partialPathOf(session.id)).size, 0);

    assert.equal(await appendChunk(await fresh(session.id), patch(session.id, 0, bytes.subarray(0, 10_000))), 10_000);
    assert.equal(await appendChunk(await fresh(session.id), patch(session.id, 10_000, bytes.subarray(10_000), { piece: 777 })), 25_000);
    assert.equal((await fresh(session.id)).received, 25_000);

    const done = await completeUploadSession(await fresh(session.id));
    assert.equal(done.url, `/uploads/${session.storageKey}`);
    assert.deepEqual(new Uint8Array(readFileSync(path.join(uploadRoot(), session.storageKey))), bytes);
    assert.equal(existsSync(partialPathOf(session.id)), false);

    const row = await fresh(session.id);
    assert.equal(row.status, "complete");
    assert.equal(row.completedUrl, done.url);
    // Completing again is idempotent.
    assert.equal((await completeUploadSession(row)).url, done.url);
    assert.equal(await currentOffset(row), 25_000);
  });

  it("stores documents at the upload root", async () => {
    const session = await createUploadSession(student, { kind: "document", fileName: "essay.pdf", size: 10, mimeType: "application/pdf" });
    assert.match(session.storageKey, /^essay-[a-z0-9]+\.pdf$/);
    await appendChunk(session, patch(session.id, 0, new TextEncoder().encode("%PDF-1.7 x")));
    const done = await completeUploadSession(await fresh(session.id));
    assert.equal(done.type, "application/pdf");
    assert.ok(existsSync(path.join(uploadRoot(), session.storageKey)));
  });

  it("refuses videos from students and invalid metadata", async () => {
    await rejectsWith(createUploadSession(student, { kind: "video", fileName: "a.mp4", size: 100, mimeType: "video/mp4" }), 403);
    await rejectsWith(createUploadSession(instructor, { kind: "auto", fileName: "a.exe", size: 100, mimeType: "application/x-msdownload" }), 415);
    await rejectsWith(createUploadSession(instructor, { kind: "auto", fileName: "a.pdf", size: 0, mimeType: "application/pdf" }), 400);
  });

  it("limits unfinished uploads per user", async () => {
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER; i++) {
      await createUploadSession(student, { kind: "document", fileName: `f${i}.pdf`, size: 10, mimeType: "application/pdf" });
    }
    await rejectsWith(createUploadSession(student, { kind: "document", fileName: "more.pdf", size: 10, mimeType: "application/pdf" }), 429);
    // Other users are not affected.
    await createUploadSession(instructor, { kind: "document", fileName: "mine.pdf", size: 10, mimeType: "application/pdf" });
  });

  it("hides sessions from other users", async () => {
    const session = await createUploadSession(student, { kind: "document", fileName: "a.pdf", size: 10, mimeType: "application/pdf" });
    await rejectsWith(getOwnedSession(instructor, session.id), 404);
    await rejectsWith(getOwnedSession(student, "ups_doesnotexist1"), 404);
    await rejectsWith(getOwnedSession(student, "../../etc/passwd"), 404);
    assert.equal((await getOwnedSession(student, session.id)).id, session.id);
  });
});

describe("chunk validation", () => {
  it("answers 409 with the stored offset for a wrong Upload-Offset", async () => {
    const bytes = mp4Bytes(3000);
    const session = await createUploadSession(instructor, { kind: "video", fileName: "a.mp4", size: 3000, mimeType: "video/mp4" });
    await appendChunk(session, patch(session.id, 0, bytes.subarray(0, 1000)));
    await rejectsWith(appendChunk(await fresh(session.id), patch(session.id, 0, bytes.subarray(0, 1000))), 409, 1000);
    await rejectsWith(appendChunk(await fresh(session.id), patch(session.id, 2000, bytes.subarray(2000))), 409, 1000);
    await rejectsWith(appendChunk(await fresh(session.id), patch(session.id, "abc", bytes.subarray(1000))), 400, 1000);
    assert.equal(statSync(partialPathOf(session.id)).size, 1000);
  });

  it("keeps the bytes of a chunk cut off by a dropped connection", async () => {
    const bytes = mp4Bytes(5000);
    const session = await createUploadSession(instructor, { kind: "video", fileName: "a.mp4", size: 5000, mimeType: "video/mp4" });
    const offset = await appendChunk(session, patch(session.id, 0, bytes, { piece: 500, failAfter: 2500 }));
    assert.equal(offset, 2500);
    const row = await fresh(session.id);
    assert.equal(row.received, 2500);
    assert.equal(await currentOffset(row), 2500);
    // Resuming from the server's offset finishes the file intact.
    assert.equal(await appendChunk(row, patch(session.id, 2500, bytes.subarray(2500))), 5000);
    await completeUploadSession(await fresh(session.id));
    assert.deepEqual(new Uint8Array(readFileSync(path.join(uploadRoot(), session.storageKey))), bytes);
  });

  it("refuses a body longer than the rest of the file and rolls the chunk back", async () => {
    const bytes = mp4Bytes(3000);
    const session = await createUploadSession(instructor, { kind: "video", fileName: "a.mp4", size: 2000, mimeType: "video/mp4" });
    await appendChunk(session, patch(session.id, 0, bytes.subarray(0, 1000)));
    // Declared length too long: refused before reading.
    await rejectsWith(appendChunk(await fresh(session.id), patch(session.id, 1000, bytes.subarray(1000, 2500))), 413, 1000);
    // No Content-Length, and the stream carries too much: cut off and rolled back.
    await rejectsWith(appendChunk(await fresh(session.id), patch(session.id, 1000, bytes.subarray(1000, 2500), { contentLength: false, piece: 300 })), 413, 1000);
    assert.equal(statSync(partialPathOf(session.id)).size, 1000);
  });

  it("refuses a video whose first bytes are not a video container", async () => {
    const session = await createUploadSession(instructor, { kind: "video", fileName: "fake.mp4", size: 100, mimeType: "video/mp4" });
    await rejectsWith(appendChunk(session, patch(session.id, 0, new TextEncoder().encode("<html>".padEnd(100, "x")))), 415, 0);
    assert.equal(statSync(partialPathOf(session.id)).size, 0);
  });

  it("will not complete before every byte arrived", async () => {
    const bytes = mp4Bytes(2000);
    const session = await createUploadSession(instructor, { kind: "video", fileName: "a.mp4", size: 2000, mimeType: "video/mp4" });
    await appendChunk(session, patch(session.id, 0, bytes.subarray(0, 1200)));
    await rejectsWith(completeUploadSession(await fresh(session.id)), 409, 1200);
  });
});

describe("abort and cleanup", () => {
  it("abort deletes the partial file and blocks further chunks", async () => {
    const session = await createUploadSession(student, { kind: "document", fileName: "a.pdf", size: 100, mimeType: "application/pdf" });
    await appendChunk(session, patch(session.id, 0, new Uint8Array(40)));
    await abortUploadSession(await fresh(session.id));
    assert.equal(existsSync(partialPathOf(session.id)), false);
    const row = await fresh(session.id);
    assert.equal(row.status, "aborted");
    await rejectsWith(appendChunk(row, patch(session.id, 40, new Uint8Array(10))), 410);
    await rejectsWith(completeUploadSession(row), 410);
  });

  it("refuses to abort a completed upload", async () => {
    const session = await createUploadSession(student, { kind: "document", fileName: "a.txt", size: 3, mimeType: "text/plain" });
    await appendChunk(session, patch(session.id, 0, new TextEncoder().encode("abc")));
    await completeUploadSession(await fresh(session.id));
    await rejectsWith(abortUploadSession(await fresh(session.id)), 409);
  });

  it("expires idle sessions, drops old records and orphaned partial files", async () => {
    const now = Date.now();
    const idle = await createUploadSession(student, { kind: "document", fileName: "idle.pdf", size: 100, mimeType: "application/pdf" });
    const active = await createUploadSession(student, { kind: "document", fileName: "active.pdf", size: 100, mimeType: "application/pdf" });
    await mutate((db) => {
      const row = db.uploadSessions.find((s) => s.id === idle.id)!;
      row.updatedAt = new Date(now - STALE_SESSION_MS - 60_000).toISOString();
      db.uploadSessions.push({
        ...row,
        id: "ups_oldcompleted01",
        status: "complete",
        updatedAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    });
    const orphan = path.join(path.dirname(partialPathOf(idle.id)), "ups_orphanfile0001.part");
    writeFileSync(orphan, "left over");
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    utimesSync(orphan, twoHoursAgo, twoHoursAgo);

    // An idle session is refused right away, even before the cleanup ran.
    await rejectsWith(appendChunk(await fresh(idle.id), patch(idle.id, 0, new Uint8Array(10))), 410);

    const result = await cleanupStaleUploads(now);
    assert.equal(result.expired, 1);
    assert.equal(result.removedRecords, 1);
    assert.ok(result.removedFiles >= 2, `removed ${result.removedFiles} files`);
    assert.equal(existsSync(partialPathOf(idle.id)), false);
    assert.equal(existsSync(orphan), false);
    assert.equal(existsSync(partialPathOf(active.id)), true);
    assert.equal((await fresh(idle.id)).status, "aborted");
    assert.equal((await getDb()).uploadSessions.some((s) => s.id === "ups_oldcompleted01"), false);

    const stats = await getUploadSessionStats(now);
    assert.equal(stats.active, 1);
    assert.equal(stats.activeBytes, 100);
    assert.equal(stats.abortedLastWeek, 1);
  });
});
