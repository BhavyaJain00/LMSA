import "server-only";
import path from "node:path";
import { isRemoteStorage, migrateLocalToRemote } from "@/lib/storage";
import { UPLOAD_MIME_TYPES } from "./files";
import { cleanupStaleUploads, type UploadCleanupResult } from "./resumable";
import { cleanupOrphanedHls, cleanupOrphanedPosters, getQueueCounts, isWorkerRunning, kickTranscodeWorker, pruneTranscodeJobs, syncAllTranscodes, type QueueCounts } from "./transcode/queue";

/**
 * One pass of media housekeeping (run by `/api/cron/media` and from
 * Settings → Storage & video). Every step is independent: a failing step is
 * reported and the others still run.
 */

/** Files moved from local disk to the bucket per run. */
const MIGRATE_PER_RUN = 100;

export interface MediaMaintenanceResult {
  uploads: UploadCleanupResult | null;
  queued: number;
  prunedJobs: number;
  removedHlsVersions: number;
  /** Generated poster frames no lesson or course shows any more. */
  removedPosters: number;
  migrated: { moved: number; failed: number; more: boolean } | null;
  queue: QueueCounts;
  workerRunning: boolean;
  errors: string[];
}

/** Content type of a stored file from its extension. */
export function contentTypeForKey(key: string): string {
  return UPLOAD_MIME_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

export async function runMediaMaintenance(): Promise<MediaMaintenanceResult> {
  const errors: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
      return fallback;
    }
  };

  const uploads = await step("uploads", () => cleanupStaleUploads(), null);
  const queued = await step("queue", () => syncAllTranscodes(), 0);
  const prunedJobs = await step("prune", () => pruneTranscodeJobs(), 0);
  const removedHlsVersions = await step("orphans", () => cleanupOrphanedHls(), 0);
  const removedPosters = await step("posters", () => cleanupOrphanedPosters(), 0);
  const migrated = isRemoteStorage()
    ? await step(
        "migrate",
        async () => {
          const r = await migrateLocalToRemote(MIGRATE_PER_RUN, contentTypeForKey);
          return { moved: r.moved, failed: r.failed, more: r.more };
        },
        null,
      )
    : null;
  // Resume jobs left queued (e.g. by a restart) even when nothing new was queued.
  kickTranscodeWorker();
  const queue = await getQueueCounts();
  return { uploads, queued, prunedJobs, removedHlsVersions, removedPosters, migrated, queue, workerRunning: isWorkerRunning(), errors };
}
