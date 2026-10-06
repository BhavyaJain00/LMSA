import "server-only";
import fs from "node:fs/promises";
import type { UploadSession, User } from "@/lib/types";
import { isStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { mediaEnv } from "@/lib/server-env";
import { uploadRoot } from "@/lib/storage";
import { isStaleSession, type UploadErrorCode } from "./resumable-shared";

/**
 * Upload admission: keeps one account (or everyone together) from filling
 * the upload disk.
 *
 *  - Disk room: a new upload is refused with 507 when the upload folder's
 *    disk would drop below `UPLOAD_MIN_FREE_MB`, counting the bytes still
 *    expected by every unfinished resumable upload.
 *  - Learner budget: accounts that are not staff may upload at most
 *    `UPLOAD_LEARNER_DAILY_MB` per rolling 24 hours. Resumable uploads count
 *    from their session records (unfinished ones by their declared size);
 *    single-request uploads are counted in memory, reserved by their
 *    Content-Length before the body is read so parallel requests cannot all
 *    pass the check.
 *
 * Staff accounts have no byte budget (they upload course videos) but are
 * still held to the disk check and the request rate limits.
 */

const MiB = 1024 * 1024;
export const LEARNER_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UploadQuotaPolicy {
  minFreeBytes: number;
  learnerBytesPerWindow: number;
  windowMs: number;
}

export function uploadQuotaPolicy(): UploadQuotaPolicy {
  return { minFreeBytes: mediaEnv.uploadMinFreeBytes, learnerBytesPerWindow: mediaEnv.learnerDailyUploadBytes, windowMs: LEARNER_QUOTA_WINDOW_MS };
}

export type QuotaDecision = { ok: true } | { ok: false; status: 429 | 507; error: string; code: UploadErrorCode };

const mb = (bytes: number) => Math.max(0, Math.round(bytes / MiB)).toLocaleString("en-US");

/* ------------------------------------------------------------------ */
/* Pure rules                                                           */
/* ------------------------------------------------------------------ */

type SessionLike = Pick<UploadSession, "userId" | "status" | "size" | "received" | "createdAt" | "updatedAt">;

/** Bytes `userId`'s resumable uploads claimed in the window: finished ones by size, unfinished ones by declared size. */
export function sessionBytesInWindow(sessions: readonly SessionLike[], userId: string, now: number, windowMs = LEARNER_QUOTA_WINDOW_MS): number {
  let total = 0;
  for (const s of sessions) {
    if (s.userId !== userId || s.status === "aborted") continue;
    if (s.status === "uploading" && isStaleSession(s, now)) continue;
    const created = Date.parse(s.createdAt);
    if (!Number.isFinite(created) || now - created > windowMs) continue;
    total += s.size;
  }
  return total;
}

/** Bytes every unfinished (non-stale) resumable upload still expects. */
export function pendingSessionBytes(sessions: readonly SessionLike[], now: number): number {
  let total = 0;
  for (const s of sessions) {
    if (s.status !== "uploading" || isStaleSession(s, now)) continue;
    total += Math.max(0, s.size - s.received);
  }
  return total;
}

/**
 * Whether `incoming` more bytes fit on a disk with `free` bytes available
 * while keeping `minFree` spare (`pending` bytes are already promised to
 * unfinished uploads). An unknown free space (`null`) is not a reason to refuse.
 */
export function checkDiskRoom(free: number | null, incoming: number, pending: number, minFree: number): QuotaDecision {
  if (free === null || !Number.isFinite(free)) return { ok: true };
  if (free - pending - incoming >= minFree) return { ok: true };
  return { ok: false, status: 507, error: "The server is running out of storage space, so new uploads are paused. Please tell an administrator.", code: "disk-full" };
}

/** Whether a learner who already uploaded `used` bytes in the window may add `incoming` more. */
export function checkLearnerBudget(used: number, incoming: number, budget: number): QuotaDecision {
  if (used + incoming <= budget) return { ok: true };
  return {
    ok: false,
    status: 429,
    error: `You can upload up to ${mb(budget)} MB per day and have used ${mb(used)} MB. Try again tomorrow or upload a smaller file.`,
    code: "quota",
  };
}

/* ------------------------------------------------------------------ */
/* Single-request upload ledger (in memory)                             */
/* ------------------------------------------------------------------ */

interface LedgerEntry {
  at: number;
  bytes: number;
}

const g = globalThis as unknown as { __llUploadLedger?: Map<string, LedgerEntry[]> };
const ledger: Map<string, LedgerEntry[]> = (g.__llUploadLedger ??= new Map());
/** Accounts tracked at most (oldest dropped first) so the map cannot grow without bound. */
const MAX_LEDGER_USERS = 50_000;

function pruned(userId: string, now: number, windowMs: number): LedgerEntry[] {
  const entries = (ledger.get(userId) ?? []).filter((e) => now - e.at <= windowMs);
  if (entries.length) ledger.set(userId, entries);
  else ledger.delete(userId);
  return entries;
}

/** Bytes of single-request uploads by `userId` in the window (including reservations in flight). */
export function singleUploadBytesInWindow(userId: string, now = Date.now(), windowMs = LEARNER_QUOTA_WINDOW_MS): number {
  return pruned(userId, now, windowMs).reduce((sum, e) => sum + e.bytes, 0);
}

export interface UploadReservation {
  /** Record what was really stored (0 when the upload failed). */
  settle(actualBytes: number): void;
}

const NOOP_RESERVATION: UploadReservation = { settle() {} };

function reserve(userId: string, bytes: number, now: number): UploadReservation {
  const entry: LedgerEntry = { at: now, bytes: Math.max(0, bytes) };
  const list = ledger.get(userId) ?? [];
  list.push(entry);
  ledger.delete(userId);
  ledger.set(userId, list);
  while (ledger.size > MAX_LEDGER_USERS) {
    const oldest = ledger.keys().next().value;
    if (oldest === undefined) break;
    ledger.delete(oldest);
  }
  return {
    settle(actualBytes) {
      entry.bytes = Math.max(0, actualBytes);
    },
  };
}

/** Forget every ledger entry (tests). */
export function resetUploadLedger(): void {
  ledger.clear();
}

/* ------------------------------------------------------------------ */
/* Admission                                                            */
/* ------------------------------------------------------------------ */

/** Free bytes on the upload folder's disk, or null when it cannot be measured. */
export async function freeDiskBytes(dir = uploadRoot()): Promise<number | null> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const s = await fs.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export interface AdmissionInput {
  user: User;
  /** Bytes about to be written. */
  bytes: number;
  sessions: readonly SessionLike[];
  /** Free disk bytes measured just before (null = unknown). */
  free: number | null;
  now: number;
  policy?: UploadQuotaPolicy;
}

/**
 * Disk room plus, for learners, the daily byte budget. Synchronous so it can
 * run inside a store mutation together with the insert it guards.
 */
export function checkUploadAdmission(input: AdmissionInput): QuotaDecision {
  const policy = input.policy ?? uploadQuotaPolicy();
  const disk = checkDiskRoom(input.free, input.bytes, pendingSessionBytes(input.sessions, input.now), policy.minFreeBytes);
  if (!disk.ok) return disk;
  if (isStaff(input.user)) return { ok: true };
  const used = sessionBytesInWindow(input.sessions, input.user.id, input.now, policy.windowMs) + singleUploadBytesInWindow(input.user.id, input.now, policy.windowMs);
  return checkLearnerBudget(used, input.bytes, policy.learnerBytesPerWindow);
}

/**
 * Admit a single-request upload of (at most) `bytes`: checks the disk and the
 * learner budget and reserves the bytes until `settle()` records the real size.
 */
export async function admitSingleUpload(
  user: User,
  bytes: number,
  options: { now?: number; policy?: UploadQuotaPolicy; free?: number | null } = {},
): Promise<{ ok: true; reservation: UploadReservation } | Extract<QuotaDecision, { ok: false }>> {
  const now = options.now ?? Date.now();
  const free = options.free !== undefined ? options.free : await freeDiskBytes();
  const db = await getDb();
  // No await between the check and the reservation: parallel requests see each other's bytes.
  const decision = checkUploadAdmission({ user, bytes, sessions: db.uploadSessions, free, now, policy: options.policy });
  if (!decision.ok) return decision;
  return { ok: true, reservation: isStaff(user) ? NOOP_RESERVATION : reserve(user.id, bytes, now) };
}
