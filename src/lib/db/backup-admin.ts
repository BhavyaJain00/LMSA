import "server-only";
import fs from "node:fs";
import { Readable } from "node:stream";
import type { User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { BackupError, type BackupErrorCode } from "./backup";

/**
 * Shared by the backup Server Actions (`/admin/settings/data`) and route
 * handlers (`/api/admin/backup/**`): who may use them, how often, how
 * failures are worded and how a backup file is sent to the browser.
 *
 * Backups contain password hashes, sessions and payment records, so every
 * entry point is admin-only and rate limited per account.
 */

export const BACKUP_RATE_LIMITS = {
  /** Snapshots written to the server's disk. */
  create: { limit: 12, windowMs: 10 * 60_000 },
  /** Downloads of stored backups and of the live data. */
  download: { limit: 30, windowMs: 10 * 60_000 },
  /** Uploaded backup files. */
  upload: { limit: 10, windowMs: 10 * 60_000 },
  /** Previews, integrity checks and deletions. */
  inspect: { limit: 120, windowMs: 10 * 60_000 },
  restore: { limit: 6, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type BackupOperation = keyof typeof BACKUP_RATE_LIMITS;

const g = globalThis as unknown as { __llBackupLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llBackupLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 1_000 }));

export type BackupAccess = { ok: true; user: User } | { ok: false; status: 401 | 403 | 429; error: string };

/** The signed-in administrator, or why the operation is refused. */
export async function authorizeBackupAdmin(operation: BackupOperation): Promise<BackupAccess> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "Sign in to manage backups." };
  if (!isAdmin(user)) return { ok: false, status: 403, error: "Only administrators can manage backups." };
  const hit = limiter.hit(`backup:${operation}:${user.id}`, BACKUP_RATE_LIMITS[operation]);
  if (!hit.ok) {
    const minutes = Math.max(1, Math.ceil(hit.retryAfterMs / 60_000));
    return { ok: false, status: 429, error: `Too many requests. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` };
  }
  return { ok: true, user };
}

/** How the administrator who made or restored a backup is named in manifests and notifications. */
export function backupActorLabel(user: Pick<User, "name" | "email">): string {
  return `${user.name} (${user.email})`;
}

const STATUS: Record<BackupErrorCode, number> = { "not-found": 404, invalid: 422, busy: 503, "too-large": 413, failed: 500 };

/**
 * Message and HTTP status for a failed backup operation. `BackupError`s are
 * written for administrators and shown as they are; anything else is logged
 * and replaced by a generic message.
 */
export function describeBackupFailure(err: unknown, fallback: string): { error: string; status: number } {
  if (err instanceof BackupError) return { error: err.message, status: STATUS[err.code] };
  console.error("[backup]", fallback, err);
  return { error: fallback, status: 500 };
}

const CONTENT_TYPES = { sqlite: "application/vnd.sqlite3", json: "application/json; charset=utf-8" } as const;

/**
 * Stream a backup file as a download. `downloadName` must already be a safe
 * file name (backup names are; generated names are built from digits).
 * With `removeAfter` the file is deleted once it has been sent or the
 * browser gave up.
 */
export function backupFileResponse(file: string, options: { downloadName: string; format: keyof typeof CONTENT_TYPES; sizeBytes: number; removeAfter?: boolean }): Response {
  const stream = fs.createReadStream(file);
  if (options.removeAfter) stream.once("close", () => fs.rm(file, { force: true }, () => undefined));
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[options.format],
      "Content-Length": String(options.sizeBytes),
      "Content-Disposition": `attachment; filename="${options.downloadName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
