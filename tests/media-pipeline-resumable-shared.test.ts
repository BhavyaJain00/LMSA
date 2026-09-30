import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_BYTES,
  RESUMABLE_THRESHOLD,
  STALE_SESSION_MS,
  checkChunk,
  countActiveSessions,
  describeTimeLeft,
  effectiveChunkSize,
  estimateRemaining,
  extensionOf,
  isFatalUploadStatus,
  isStaleSession,
  nextChunkRange,
  parseOffsetHeader,
  parseResumeRecord,
  resolveFileType,
  resumeKeyFor,
  retryDelayMs,
  shouldUseResumable,
  smoothSpeed,
  storedFileName,
  validateUploadStart,
  type UploadPolicy,
} from "@/lib/media/resumable-shared";

const MB = 1024 * 1024;
const STAFF: UploadPolicy = { staff: true, maxVideoBytes: 10_240 * MB, maxAssetBytes: 25 * MB };
const STUDENT: UploadPolicy = { ...STAFF, staff: false };

describe("validateUploadStart", () => {
  it("accepts a staff video larger than 5 GB within the limit", () => {
    const size = 6 * 1024 * MB;
    const d = validateUploadStart({ kind: "video", fileName: "Lecture 1.MP4", size, mimeType: "video/mp4" }, STAFF);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.category, "video");
    assert.equal(d.ext, ".mp4");
    assert.equal(d.size, size);
  });

  it("refuses videos from students with 403", () => {
    const d = validateUploadStart({ kind: "auto", fileName: "clip.mp4", size: 1000, mimeType: "video/mp4" }, STUDENT);
    assert.deepEqual(d, { ok: false, status: 403, error: "Only instructors can upload videos." });
  });

  it("lets students upload documents and images", () => {
    assert.equal(validateUploadStart({ kind: "document", fileName: "essay.pdf", size: 5 * MB, mimeType: "application/pdf" }, STUDENT).ok, true);
    assert.equal(validateUploadStart({ kind: "image", fileName: "me.jpeg", size: MB, mimeType: "image/jpeg" }, STUDENT).ok, true);
  });

  it("enforces the size limit per category with 413", () => {
    const d = validateUploadStart({ kind: "document", fileName: "big.pdf", size: 26 * MB, mimeType: "application/pdf" }, STUDENT);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.status, 413);
    assert.match(d.error, /max 25 MB/);
  });

  it("rejects empty, missing or invalid sizes", () => {
    for (const size of [0, -1, 1.5, "abc", undefined, Number.MAX_SAFE_INTEGER + 2]) {
      const d = validateUploadStart({ kind: "document", fileName: "a.pdf", size, mimeType: "application/pdf" }, STAFF);
      assert.equal(d.ok, false, `size ${String(size)}`);
    }
    assert.equal(validateUploadStart({ kind: "document", fileName: "a.pdf", size: "2048", mimeType: "application/pdf" }, STAFF).ok, true);
  });

  it("rejects unknown kinds, names and types", () => {
    assert.equal(validateUploadStart({ kind: "exe", fileName: "a.pdf", size: 1, mimeType: "application/pdf" }, STAFF).ok, false);
    assert.equal(validateUploadStart({ kind: "auto", fileName: "   ", size: 1, mimeType: "application/pdf" }, STAFF).ok, false);
    assert.equal(validateUploadStart({ kind: "auto", fileName: "x".repeat(300), size: 1, mimeType: "application/pdf" }, STAFF).ok, false);
    const exe = validateUploadStart({ kind: "auto", fileName: "setup.exe", size: 1, mimeType: "application/x-msdownload" }, STAFF);
    assert.equal(exe.ok, false);
    if (!exe.ok) assert.equal(exe.status, 415);
  });

  it("requires the kind's category", () => {
    const d = validateUploadStart({ kind: "video", fileName: "notes.pdf", size: 10, mimeType: "application/pdf" }, STAFF);
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.status, 415);
    assert.equal(validateUploadStart({ kind: "image", fileName: "a.mp4", size: 10, mimeType: "video/mp4" }, STAFF).ok, false);
  });

  it("refuses an extension of another category (a video disguised as a PDF)", () => {
    const d = validateUploadStart({ kind: "auto", fileName: "movie.mp4", size: 10, mimeType: "application/pdf" }, STAFF);
    assert.equal(d.ok, false);
    if (!d.ok) assert.match(d.error, /extension does not match/);
  });

  it("strips folders and control characters from the name", () => {
    const d = validateUploadStart({ kind: "auto", fileName: "C:\\Users\\me\\intro\u0007.png", size: 10, mimeType: "image/png" }, STAFF);
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.fileName, "intro.png");
  });

  it("uses the type's default extension when the name has none", () => {
    const d = validateUploadStart({ kind: "auto", fileName: "recording", size: 10, mimeType: "video/quicktime" }, STAFF);
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.ext, ".mov");
  });
});

describe("file types", () => {
  it("resolves aliases, parameters and extensions", () => {
    assert.equal(resolveFileType("image/JPG", "a.jpg"), "image/jpeg");
    assert.equal(resolveFileType("video/mp4; codecs=avc1", "a.mp4"), "video/mp4");
    assert.equal(resolveFileType("", "Lecture.MOV"), "video/quicktime");
    assert.equal(resolveFileType("application/octet-stream", "clip.webm"), "video/webm");
    assert.equal(resolveFileType("", "unknown.bin"), "application/octet-stream");
  });

  it("reads extensions safely", () => {
    assert.equal(extensionOf("Intro.MP4"), ".mp4");
    assert.equal(extensionOf(".hidden"), "");
    assert.equal(extensionOf("dir/name."), "");
    assert.equal(extensionOf("a.b/c"), "");
  });

  it("builds slugged stored names with the id", () => {
    assert.equal(storedFileName("Intro to CSS!.mp4", ".mp4", "ab12cd34ef"), "intro-to-css-ab12cd34ef.mp4");
    assert.equal(storedFileName("???", ".png", "x_1"), "item-x1.png");
    assert.equal(storedFileName(`${"a".repeat(39)} b.mp4`, ".mp4", "id1"), `${"a".repeat(39)}-id1.mp4`);
  });
});

describe("offset validation (checkChunk)", () => {
  const total = 20 * MB;

  it("accepts a chunk at the stored offset and caps the body", () => {
    const c = checkChunk(8 * MB, total, String(8 * MB), String(8 * MB));
    assert.deepEqual(c, { ok: true, offset: 8 * MB, maxBytes: 12 * MB });
  });

  it("caps the body at the chunk limit when more remains", () => {
    const c = checkChunk(0, 200 * MB, "0", null);
    assert.equal(c.ok, true);
    if (c.ok) assert.equal(c.maxBytes, MAX_CHUNK_BYTES);
  });

  it("answers 409 with the real offset when the client is behind or ahead", () => {
    for (const sent of ["0", String(16 * MB)]) {
      const c = checkChunk(8 * MB, total, sent, "10");
      assert.equal(c.ok, false);
      if (!c.ok) {
        assert.equal(c.status, 409);
        assert.equal(c.offset, 8 * MB);
      }
    }
  });

  it("answers 400 for a missing or malformed offset", () => {
    for (const header of [null, undefined, "", "-1", "1e3", "12abc", "99999999999999999"]) {
      const c = checkChunk(0, total, header, "1");
      assert.equal(c.ok, false, `header ${String(header)}`);
      if (!c.ok) assert.equal(c.status, 400);
    }
  });

  it("answers 413 when the chunk passes the end of the file or the chunk limit", () => {
    const past = checkChunk(total - 10, total, String(total - 10), "11");
    assert.equal(past.ok, false);
    if (!past.ok) assert.equal(past.status, 413);
    const huge = checkChunk(0, 500 * MB, "0", String(MAX_CHUNK_BYTES + 1));
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.equal(huge.status, 413);
  });

  it("answers 409 once every byte is in", () => {
    const c = checkChunk(total, total, String(total), "1");
    assert.equal(c.ok, false);
    if (!c.ok) assert.equal(c.status, 409);
  });

  it("rejects an invalid Content-Length", () => {
    const c = checkChunk(0, total, "0", "ten");
    assert.equal(c.ok, false);
    if (!c.ok) assert.equal(c.status, 400);
  });

  it("parses offset headers strictly", () => {
    assert.equal(parseOffsetHeader(" 42 "), 42);
    assert.equal(parseOffsetHeader("0"), 0);
    assert.equal(parseOffsetHeader("+1"), null);
    assert.equal(parseOffsetHeader("1.0"), null);
  });

  it("computes chunk ranges", () => {
    assert.deepEqual(nextChunkRange(0, 20, 8), { start: 0, end: 8 });
    assert.deepEqual(nextChunkRange(16, 20, 8), { start: 16, end: 20 });
    assert.equal(nextChunkRange(20, 20, 8), null);
    assert.equal(nextChunkRange(0, 20, 0), null);
  });
});

describe("sessions", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("marks only idle unfinished sessions as stale", () => {
    assert.equal(isStaleSession({ status: "uploading", updatedAt: iso(STALE_SESSION_MS + 1) }, now), true);
    assert.equal(isStaleSession({ status: "uploading", updatedAt: iso(STALE_SESSION_MS - 1000) }, now), false);
    assert.equal(isStaleSession({ status: "complete", updatedAt: iso(STALE_SESSION_MS * 3) }, now), false);
    assert.equal(isStaleSession({ status: "uploading", updatedAt: "garbage" }, now), true);
  });

  it("counts a user's active sessions (not stale, not finished, not others')", () => {
    const sessions = [
      { userId: "u1", status: "uploading", updatedAt: iso(1000) },
      { userId: "u1", status: "uploading", updatedAt: iso(STALE_SESSION_MS + 5) },
      { userId: "u1", status: "complete", updatedAt: iso(1000) },
      { userId: "u1", status: "aborted", updatedAt: iso(1000) },
      { userId: "u2", status: "uploading", updatedAt: iso(1000) },
    ];
    assert.equal(countActiveSessions(sessions, "u1", now), 1);
  });
});

describe("client helpers", () => {
  it("backs off exponentially with jitter and a cap", () => {
    const low = () => 0;
    const high = () => 1;
    assert.equal(retryDelayMs(1, 1000, 30_000, high), 1000);
    assert.equal(retryDelayMs(2, 1000, 30_000, high), 2000);
    assert.equal(retryDelayMs(4, 1000, 30_000, high), 8000);
    assert.equal(retryDelayMs(4, 1000, 30_000, low), 6000);
    assert.equal(retryDelayMs(20, 1000, 30_000, high), 30_000);
    assert.equal(retryDelayMs(0, 1000, 30_000, high), 1000);
  });

  it("classifies fatal statuses", () => {
    for (const s of [400, 401, 403, 404, 410, 413, 415]) assert.equal(isFatalUploadStatus(s), true, String(s));
    for (const s of [408, 409, 429, 500, 502, 503]) assert.equal(isFatalUploadStatus(s), false, String(s));
  });

  it("keys resume records by kind, size, date and name", () => {
    assert.equal(resumeKeyFor({ name: "a.mp4", size: 10, lastModified: 99 }, "video"), "ll-upload:video:10:99:a.mp4");
  });

  it("parses resume records and drops stale or malformed ones", () => {
    const now = 1_700_000_000_000;
    const good = { id: "ups_abcdef123456", fileName: "a.mp4", size: 100, offset: 40, savedAt: now - 1000, scope: "video:videoUrl" };
    assert.deepEqual(parseResumeRecord(JSON.stringify(good), now), good);
    assert.equal(parseResumeRecord(JSON.stringify({ ...good, savedAt: now - STALE_SESSION_MS - 1 }), now), null);
    assert.equal(parseResumeRecord(JSON.stringify({ ...good, id: "../etc" }), now), null);
    assert.equal(parseResumeRecord(JSON.stringify({ ...good, offset: 101 }), now), null);
    assert.equal(parseResumeRecord("{not json", now), null);
    assert.equal(parseResumeRecord(null, now), null);
    const legacy: Partial<typeof good> = { ...good };
    delete legacy.scope;
    assert.equal(parseResumeRecord(JSON.stringify(legacy), now)?.scope, "");
  });

  it("sends videos and large files through the resumable protocol", () => {
    assert.equal(shouldUseResumable({ name: "a.mp4", size: 100, type: "video/mp4" }), true);
    assert.equal(shouldUseResumable({ name: "clip.mov", size: 100, type: "" }), true);
    assert.equal(shouldUseResumable({ name: "a.pdf", size: RESUMABLE_THRESHOLD, type: "application/pdf" }), false);
    assert.equal(shouldUseResumable({ name: "a.pdf", size: RESUMABLE_THRESHOLD + 1, type: "application/pdf" }), true);
  });

  it("bounds the chunk size", () => {
    assert.equal(effectiveChunkSize(undefined), DEFAULT_CHUNK_SIZE);
    assert.equal(effectiveChunkSize(10), 256 * 1024);
    assert.equal(effectiveChunkSize(10 ** 12), MAX_CHUNK_BYTES);
    assert.equal(effectiveChunkSize(4 * MB), 4 * MB);
  });

  it("smooths the speed and estimates the time left", () => {
    assert.equal(smoothSpeed(0, 1000, 1000), 1000);
    assert.equal(smoothSpeed(1000, 3000, 1000, 0.5), 2000);
    assert.equal(smoothSpeed(500, 100, 0), 500);
    assert.equal(estimateRemaining(1000, 100), 10);
    assert.equal(estimateRemaining(1000, 0), null);
  });

  it("describes the time left", () => {
    assert.equal(describeTimeLeft(null), null);
    assert.equal(describeTimeLeft(3), "a few seconds left");
    assert.equal(describeTimeLeft(42), "45 s left");
    assert.equal(describeTimeLeft(170), "about 3 min left");
    assert.equal(describeTimeLeft(3600 * 2 + 60 * 5), "about 2 h 5 min left");
    assert.equal(describeTimeLeft(7200), "about 2 h left");
  });
});
