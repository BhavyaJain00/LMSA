import "server-only";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { UploadSession, User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { isStaff } from "@/lib/auth/session";
import { findById, getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { localStorage, offloadLocalFile, uploadRoot, uploadUrlForKey } from "@/lib/storage";
import { PROTECTED_VIDEO_DIR } from "./paths";
import { looksLikeVideo } from "./upload";
import { checkUploadAdmission, freeDiskBytes, type UploadQuotaPolicy } from "./upload-quota";
import {
  DEFAULT_CHUNK_SIZE,
  SESSION_RECORD_RETENTION_MS,
  MAX_ACTIVE_SESSIONS_PER_USER,
  categoryOf,
  checkChunk,
  countActiveSessions,
  isStaleSession,
  storedFileName,
  validateUploadStart,
  type UploadErrorCode,
  type UploadStartInput,
} from "./resumable-shared";

/**
 * Resumable uploads on the server (protocol in `resumable-shared.ts`).
 *
 * Bytes are appended to a hidden `.resumable/<id>.part` file in the upload
 * folder as they arrive — a chunk is never held in memory as a whole — and
 * the file on disk is the source of truth for the offset: a chunk cut off by
 * a dropped connection keeps what was written, and the client continues from
 * there. When the last byte is in, the file is checked (videos must carry a
 * real container signature), renamed into place and, with S3 storage,
 * copied to the bucket in the background.
 */

const TEMP_DIR = ".resumable";
const SNIFF_BYTES = 16;

interface ResumableState {
  /** Sessions with a chunk being written right now (one writer per session). */
  writing: Set<string>;
  /** When the last opportunistic cleanup ran (epoch ms). */
  lastCleanup: number;
}

const g = globalThis as unknown as { __llResumable?: ResumableState };
const state: ResumableState = (g.__llResumable ??= { writing: new Set(), lastCleanup: 0 });
state.lastCleanup ??= 0;

/** Minimum time between cleanups triggered by new uploads (the media cron also runs one). */
const OPPORTUNISTIC_CLEANUP_MS = 60 * 60 * 1000;

export class UploadError extends Error {
  readonly status: number;
  readonly offset: number | null;
  /** Reason the upload field can show in the viewer's language (see `UPLOAD_ERROR_CODES`). */
  readonly code: UploadErrorCode | null;
  constructor(status: number, message: string, offset: number | null = null, code: UploadErrorCode | null = null) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.offset = offset;
    this.code = code;
  }
}

const NOT_VIDEO = "This file doesn't look like a video. Upload an MP4, WebM, OGG or MOV file.";

function tempDir(): string {
  return path.join(/* turbopackIgnore: true */ uploadRoot(), TEMP_DIR);
}

/** Absolute path of a session's partial file (ids are generated `ups_[a-z0-9]` strings). */
export function partialPathOf(sessionId: string): string {
  if (!/^ups_[a-z0-9]{8,32}$/.test(sessionId)) throw new UploadError(404, "This upload does not exist.");
  return path.join(/* turbopackIgnore: true */ tempDir(), `${sessionId}.part`);
}

async function fileSize(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return null;
  }
}

/** Upload rules for a viewer (staff may upload videos and larger files). */
export function uploadPolicyFor(user: User): { staff: boolean; maxVideoBytes: number; maxAssetBytes: number } {
  return { staff: isStaff(user), maxVideoBytes: siteConfig.maxUploadBytes, maxAssetBytes: siteConfig.maxAssetBytes };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                             */
/* ------------------------------------------------------------------ */

export interface SessionView {
  id: string;
  kind: UploadSession["kind"];
  fileName: string;
  size: number;
  offset: number;
  status: UploadSession["status"];
  chunkSize: number;
  url: string | null;
}

export function sessionView(session: UploadSession, offset = session.received): SessionView {
  return {
    id: session.id,
    kind: session.kind,
    fileName: session.fileName,
    size: session.size,
    offset,
    status: session.status,
    chunkSize: DEFAULT_CHUNK_SIZE,
    url: session.completedUrl ?? null,
  };
}

/**
 * Start an upload for `user`. Refused when the account already has
 * `MAX_ACTIVE_SESSIONS_PER_USER` unfinished uploads, when the disk lacks room
 * (507) or when a learner's daily byte budget is used up (see `upload-quota.ts`).
 * `options` override the clock, the measured free space and the quota policy (tests).
 */
export async function createUploadSession(
  user: User,
  input: UploadStartInput,
  options: { now?: number; free?: number | null; policy?: UploadQuotaPolicy } = {},
): Promise<UploadSession> {
  const decision = validateUploadStart(input, uploadPolicyFor(user));
  if (!decision.ok) throw new UploadError(decision.status, decision.error);

  const now = options.now ?? Date.now();
  const free = options.free !== undefined ? options.free : await freeDiskBytes();
  const id = uid("ups");
  const name = storedFileName(decision.fileName, decision.ext, uid());
  const storageKey = decision.category === "video" ? `${PROTECTED_VIDEO_DIR}/${name}` : name;
  const iso = new Date(now).toISOString();
  const session: UploadSession = {
    id,
    userId: user.id,
    kind: decision.category,
    fileName: decision.fileName,
    mimeType: decision.type,
    size: decision.size,
    received: 0,
    storageKey,
    status: "uploading",
    createdAt: iso,
    updatedAt: iso,
  };

  // The limits and the insert run in one mutation, so parallel requests cannot all pass the same count.
  await mutate((db) => {
    if (countActiveSessions(db.uploadSessions, user.id, now) >= MAX_ACTIVE_SESSIONS_PER_USER) {
      throw new UploadError(429, `You have ${MAX_ACTIVE_SESSIONS_PER_USER} unfinished uploads. Finish or cancel one before starting another.`, null, "too-many-uploads");
    }
    const admission = checkUploadAdmission({ user, bytes: decision.size, sessions: db.uploadSessions, free, now, policy: options.policy });
    if (!admission.ok) throw new UploadError(admission.status, admission.error, null, admission.code);
    db.uploadSessions.push(session);
  });

  try {
    await fs.mkdir(tempDir(), { recursive: true });
    const handle = await fs.open(partialPathOf(id), "wx");
    await handle.close();
  } catch (err) {
    await mutate((db) => {
      db.uploadSessions = db.uploadSessions.filter((s) => s.id !== id);
    });
    throw err;
  }
  return session;
}

/** The session when it belongs to `user` (404 otherwise, so ids cannot be probed). */
export async function getOwnedSession(user: User, id: string): Promise<UploadSession> {
  const session = /^ups_[a-z0-9]{8,32}$/.test(id) ? await findById("uploadSessions", id) : null;
  if (!session || session.userId !== user.id) throw new UploadError(404, "This upload does not exist.");
  return session;
}

/** Bytes stored so far: the partial file's size (what really arrived), or the full size once complete. */
export async function currentOffset(session: UploadSession): Promise<number> {
  if (session.status === "complete") return session.size;
  if (session.status !== "uploading") return session.received;
  const size = await fileSize(partialPathOf(session.id));
  return size === null ? session.received : Math.min(size, session.size);
}

function assertUploading(session: UploadSession): void {
  if (session.status === "complete") throw new UploadError(409, "This upload is already complete.", session.size);
  if (session.status === "aborted") throw new UploadError(410, "This upload was cancelled. Start it again.", null, "session-gone");
  if (isStaleSession(session, Date.now())) throw new UploadError(410, "This upload expired after a day without activity. Start it again.", null, "session-gone");
}

async function saveProgress(sessionId: string, received: number): Promise<void> {
  await mutate((db) => {
    const row = db.uploadSessions.find((s) => s.id === sessionId);
    if (row && row.status === "uploading") Object.assign(row, { received, updatedAt: new Date().toISOString() });
  });
}

/** Write all of `chunk` at file position `position`. */
async function writeAll(handle: FileHandle, chunk: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, position + offset);
    if (bytesWritten <= 0) throw new Error("Short write while storing an upload chunk.");
    offset += bytesWritten;
  }
}

/**
 * Append one chunk (the raw request body) at `Upload-Offset`. Returns the
 * new offset. The body is streamed to disk; anything beyond the file's
 * declared size or the chunk limit is refused and cut back.
 */
export async function appendChunk(session: UploadSession, request: Request): Promise<number> {
  assertUploading(session);
  if (state.writing.has(session.id)) throw new UploadError(409, "Another chunk of this upload is still being written. Wait for it, then resume.", null);
  state.writing.add(session.id);
  const file = partialPathOf(session.id);
  let handle: FileHandle | null = null;
  try {
    const stored = await fileSize(file);
    if (stored === null) throw new UploadError(410, "The partial file of this upload is gone. Start it again.", null, "session-gone");
    if (stored !== session.received) await saveProgress(session.id, stored);

    const check = checkChunk(stored, session.size, request.headers.get("upload-offset"), request.headers.get("content-length"));
    if (!check.ok) throw new UploadError(check.status, check.error, check.offset);
    if (!request.body) throw new UploadError(400, "The chunk is empty.", stored);

    const category = categoryOf(session.mimeType);
    const head: number[] = [];
    let sniffed = !(category === "video" && stored === 0);
    let written = 0;
    // Positional writes on an "r+" handle (not "a"): Windows refuses to truncate append-mode handles,
    // and a refused chunk must be rolled back to `stored`.
    handle = await fs.open(file, "r+");
    const reader = request.body.getReader();
    try {
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch {
          // The connection dropped: keep what arrived, the client resumes from there.
          break;
        }
        if (result.done) break;
        const chunk = result.value;
        if (!chunk?.byteLength) continue;
        if (written + chunk.byteLength > check.maxBytes) {
          await reader.cancel().catch(() => undefined);
          await handle.truncate(stored);
          written = 0;
          throw new UploadError(413, "This chunk goes past the end of the file or over the chunk size limit.", stored);
        }
        if (!sniffed) {
          for (let i = 0; i < chunk.byteLength && head.length < SNIFF_BYTES; i++) head.push(chunk[i]!);
          if (head.length >= SNIFF_BYTES) {
            sniffed = true;
            if (!looksLikeVideo(Uint8Array.from(head))) {
              await reader.cancel().catch(() => undefined);
              await handle.truncate(stored);
              throw new UploadError(415, NOT_VIDEO, stored, "not-video");
            }
          }
        }
        await writeAll(handle, chunk, stored + written);
        written += chunk.byteLength;
      }
    } finally {
      reader.releaseLock?.();
    }
    await handle.close();
    handle = null;
    const offset = (await fileSize(file)) ?? stored + written;
    await saveProgress(session.id, Math.min(offset, session.size));
    return Math.min(offset, session.size);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    state.writing.delete(session.id);
  }
}

export interface CompletedUpload {
  url: string;
  name: string;
  size: number;
  type: string;
  key: string;
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Finish an upload whose bytes are all in: verify, move the file into the
 * upload folder under its generated name and mark the session complete.
 * Idempotent: completing a finished session returns the same URL.
 */
export async function completeUploadSession(session: UploadSession): Promise<CompletedUpload> {
  if (session.status === "complete" && session.completedUrl) {
    return { url: session.completedUrl, name: session.fileName, size: session.size, type: session.mimeType, key: session.storageKey };
  }
  assertUploading(session);
  if (state.writing.has(session.id)) throw new UploadError(409, "A chunk of this upload is still being written.");
  const file = partialPathOf(session.id);
  const size = await fileSize(file);
  if (size === null) throw new UploadError(410, "The partial file of this upload is gone. Start it again.", null, "session-gone");
  if (size !== session.size) throw new UploadError(409, `Only ${size} of ${session.size} bytes have arrived. Resume the upload first.`, size);
  if (categoryOf(session.mimeType) === "video" && !looksLikeVideo(await readHead(file, SNIFF_BYTES))) {
    await abortUploadSession(session);
    throw new UploadError(415, NOT_VIDEO, null, "not-video");
  }

  // Received on local disk; with S3 storage the caller offloads it to the bucket afterwards.
  await localStorage().putFile(session.storageKey, file, { contentType: session.mimeType, move: true });
  const url = uploadUrlForKey(session.storageKey);
  await mutate((db) => {
    const row = db.uploadSessions.find((s) => s.id === session.id);
    if (row) Object.assign(row, { status: "complete", received: session.size, completedUrl: url, updatedAt: new Date().toISOString() });
  });
  return { url, name: session.fileName, size: session.size, type: session.mimeType, key: session.storageKey };
}

/** Cancel an upload and delete its partial file. */
export async function abortUploadSession(session: UploadSession): Promise<void> {
  if (session.status === "complete") throw new UploadError(409, "This upload is already complete.");
  await mutate((db) => {
    const row = db.uploadSessions.find((s) => s.id === session.id);
    if (row && row.status === "uploading") Object.assign(row, { status: "aborted", updatedAt: new Date().toISOString() });
  });
  if (!state.writing.has(session.id)) await fs.rm(partialPathOf(session.id), { force: true }).catch(() => undefined);
}

/** Copy a finished upload to remote storage (no-op with local storage). Never throws. */
export async function offloadCompletedUpload(key: string, contentType: string): Promise<void> {
  try {
    await offloadLocalFile(key, contentType);
  } catch (err) {
    console.error("[uploads] could not copy the file to object storage (it stays on local disk):", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                         */
/* ------------------------------------------------------------------ */

export interface UploadCleanupResult {
  expired: number;
  removedRecords: number;
  removedFiles: number;
}

/**
 * Expire unfinished uploads idle for a day (their partial files are
 * deleted), drop old finished/aborted records and delete partial files no
 * session knows about.
 */
export async function cleanupStaleUploads(now = Date.now()): Promise<UploadCleanupResult> {
  const result: UploadCleanupResult = { expired: 0, removedRecords: 0, removedFiles: 0 };
  const expiredIds: string[] = [];
  await mutate((db) => {
    const iso = new Date(now).toISOString();
    for (const s of db.uploadSessions) {
      if (isStaleSession(s, now) && !state.writing.has(s.id)) {
        Object.assign(s, { status: "aborted", updatedAt: iso });
        expiredIds.push(s.id);
      }
    }
    const before = db.uploadSessions.length;
    db.uploadSessions = db.uploadSessions.filter((s) => s.status === "uploading" || now - Date.parse(s.updatedAt) <= SESSION_RECORD_RETENTION_MS);
    result.removedRecords = before - db.uploadSessions.length;
  });
  result.expired = expiredIds.length;
  for (const id of expiredIds) {
    const file = partialPathOf(id);
    if ((await fileSize(file)) === null) continue;
    await fs.rm(file, { force: true }).then(
      () => result.removedFiles++,
      () => undefined,
    );
  }

  const db = await getDb();
  const live = new Set(db.uploadSessions.filter((s) => s.status === "uploading").map((s) => `${s.id}.part`));
  const entries = await fs.readdir(tempDir(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || live.has(entry.name)) continue;
    const full = path.join(/* turbopackIgnore: true */ tempDir(), entry.name);
    const stat = await fs.stat(full).catch(() => null);
    // A just-created session may not be visible yet: only touch files idle for an hour.
    if (!stat || now - stat.mtimeMs < 60 * 60 * 1000) continue;
    await fs.rm(full, { force: true }).then(
      () => result.removedFiles++,
      () => undefined,
    );
  }
  return result;
}

/**
 * Run `cleanupStaleUploads` at most once an hour, triggered when uploads
 * start, so abandoned partial files are removed even without the media cron.
 * Never throws.
 */
export async function maybeCleanupStaleUploads(now = Date.now()): Promise<void> {
  if (now - state.lastCleanup < OPPORTUNISTIC_CLEANUP_MS) return;
  state.lastCleanup = now;
  try {
    await cleanupStaleUploads(now);
  } catch (err) {
    console.error("[uploads] stale upload cleanup failed:", err instanceof Error ? err.message : err);
  }
}

export interface UploadSessionStats {
  active: number;
  activeBytes: number;
  receivedBytes: number;
  completedLastWeek: number;
  abortedLastWeek: number;
}

/** Overview for Settings → Storage & video. */
export async function getUploadSessionStats(now = Date.now()): Promise<UploadSessionStats> {
  const db = await getDb();
  const stats: UploadSessionStats = { active: 0, activeBytes: 0, receivedBytes: 0, completedLastWeek: 0, abortedLastWeek: 0 };
  for (const s of db.uploadSessions) {
    if (s.status === "uploading" && !isStaleSession(s, now)) {
      stats.active++;
      stats.activeBytes += s.size;
      stats.receivedBytes += s.received;
    } else if (now - Date.parse(s.updatedAt) <= SESSION_RECORD_RETENTION_MS) {
      if (s.status === "complete") stats.completedLastWeek++;
      else stats.abortedLastWeek++;
    }
  }
  return stats;
}
