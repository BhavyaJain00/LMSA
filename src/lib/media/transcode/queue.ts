import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Database, TranscodeJob, TranscodeTarget } from "@/lib/types";
import { findById, getDb, getSettings, mutate } from "@/lib/db/store";
import { notifyMany } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import { getStorage, localStorage, s3Client, storageFor, uploadRoot, uploadUrlForKey } from "@/lib/storage";
import { siteOrigins } from "../access";
import { HLS_CONTENT_TYPES, buildMasterPlaylist, measureBandwidth, parseMasterRenditions, parseMediaSegments, type HlsVariant } from "../hls";
import { looksLikeVideo } from "../upload";
import { FfmpegError, detectFfmpeg, probeMedia, runFfmpeg } from "./ffmpeg";
import { GENERATED_POSTER_KEY, hlsVersionFolderOfKey, hlsVersionPrefix, pendingState, renditionLabel, transcodeSourceKey } from "./lesson-fields";
import { MASTER_PLAYLIST, POSTER_FILE, buildHlsPlan, buildPosterArgs, progressPercent, renditionLadder, tailText } from "./plan";
import {
  COURSE_PREVIEW_DIR,
  COURSE_PREVIEW_ROOT,
  coursePreviewTarget,
  hasGeneratedPoster,
  hlsPrefixFor,
  jobIdentity,
  jobTarget,
  jobTargetId,
  latestJobForTarget,
  lessonBlockTarget,
  needsConversion,
  ownGeneratedPosterKey,
  patchTargetMedia,
  planEnqueue,
  planStaleOutputRelease,
  posterKeyFor,
  readTargetMedia,
  referencedHlsVersions,
  referencedPosterKeys,
  settledState,
} from "./targets";

/**
 * Durable HLS transcoding queue.
 *
 * Jobs live in `db.transcodeJobs`, so a restart loses nothing: a job that was
 * running when the process stopped is queued again the next time the worker
 * starts. One job runs at a time, in this process, started lazily when a
 * video is queued, when an editor polls its status and by `/api/cron/media`.
 *
 * A job converts a target (see `./targets`): a lesson video block, published
 * under `videos/<lessonId>/<blockId>/hls/<version>/`, or a course's preview
 * video, published under `videos/course/<courseId>/preview/hls/<version>/`.
 * Output is written to a hidden work folder, measured, given a master
 * playlist and then published; the target's HLS URL switches to the new
 * version only after everything is stored, and the previous version is
 * deleted afterwards (unless something else still plays it).
 */

/** Folder of generated poster frames in the upload storage. */
const POSTERS_ROOT = "posters";
/** Kill ffmpeg when it reports nothing for this long. */
const STALL_MS = 15 * 60_000;
/** Minimum time between progress writes to the database. */
const PROGRESS_WRITE_MS = 2_000;
/** Presigned source URLs handed to ffmpeg for remote storage. */
const SOURCE_URL_TTL_SECONDS = 12 * 60 * 60;
/** Finished jobs older than this are pruned (the newest job of each target is kept). */
const JOB_RETENTION_DAYS = 30;
const MAX_ERROR_CHARS = 4000;
/** A job interrupted by this many server restarts is failed instead of started again. */
export const MAX_JOB_ATTEMPTS = 3;

interface WorkerState {
  running: boolean;
  current: { jobId: string; abort: AbortController; heights: number[]; speed: number | null } | null;
}

const g = globalThis as unknown as { __llTranscodeWorker?: WorkerState };
const worker: WorkerState = (g.__llTranscodeWorker ??= { running: false, current: null });

class TranscodeCancelled extends Error {}

function isActive(job: TranscodeJob): boolean {
  return job.status === "queued" || job.status === "running";
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Queueing                                                             */
/* ------------------------------------------------------------------ */

export type EnqueueResult =
  | { ok: true; job: TranscodeJob; created: boolean }
  | { ok: false; reason: "disabled" | "not-found" | "not-upload" | "unavailable" | "ready" | "failed"; message: string };

/**
 * Queue a conversion of a target's uploaded video. Existing queued/running
 * jobs for the same file are reused. Without `force`, a target whose HLS
 * output already matches its file, or whose last conversion of this file
 * failed, is left alone (retries are explicit).
 */
export async function enqueueTargetTranscode(target: TranscodeTarget, opts: { force?: boolean } = {}): Promise<EnqueueResult> {
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return { ok: false, reason: "disabled", message: "Adaptive streaming is turned off in Settings → Storage & video." };
  const ffmpeg = await detectFfmpeg();
  const origins = siteOrigins();

  // A target saved by an editor that dropped the server-managed fields: re-link the finished output instead of converting again.
  if (!opts.force && (await recoverTargetHlsOutput(target))) return { ok: false, reason: "ready", message: "This video is already converted." };

  let abortJobId: string | null = null;
  const result = await mutate((db): EnqueueResult => {
    const plan = planEnqueue({ target, media: readTargetMedia(db, target), jobs: db.transcodeJobs, ffmpegAvailable: ffmpeg.available, force: opts.force, siteOrigins: origins });
    const now = nowIso();
    switch (plan.action) {
      case "refuse":
        return { ok: false, reason: plan.reason, message: plan.message };
      case "unavailable":
        patchTargetMedia(db, target, () => ({
          ...(plan.stale ? { hlsUrl: undefined, storageKey: undefined } : {}),
          transcode: { status: "unavailable", error: ffmpeg.error ?? undefined, updatedAt: now },
        }));
        return { ok: false, reason: "unavailable", message: plan.message };
      case "reuse":
        return { ok: true, job: plan.job, created: false };
      case "skip":
        return { ok: false, reason: plan.reason, message: plan.message };
      case "create": {
        // Jobs for an older file of this target are obsolete.
        const obsolete = new Set(plan.obsoleteJobIds);
        for (const j of db.transcodeJobs) if (obsolete.has(j.id)) Object.assign(j, { status: "failed", error: "Replaced by a newer video.", finishedAt: now });
        abortJobId = plan.abortJobId;
        const job: TranscodeJob = { id: uid("tcj"), ...jobIdentity(target), sourceKey: plan.sourceKey, status: "queued", progress: 0, attempts: 0, createdAt: now };
        db.transcodeJobs.push(job);
        patchTargetMedia(db, target, (m) =>
          // A new file must never play the previous file's stream.
          plan.stale ? { hlsUrl: undefined, storageKey: undefined, transcode: pendingState(undefined, now) } : { transcode: pendingState(m.transcode, now) },
        );
        return { ok: true, job, created: true };
      }
    }
  });
  // A conversion of the target's previous file is stopped now rather than finished and thrown away.
  abortRunningJob(abortJobId);
  if (result.ok) kickTranscodeWorker();
  return result;
}

/** Abort the worker's current job when it is `jobId` (it notices, finds its file replaced and fails quietly). */
function abortRunningJob(jobId: string | null): void {
  if (jobId && worker.current?.jobId === jobId) worker.current.abort.abort();
}

/** Queue a conversion of a lesson video block (see `enqueueTargetTranscode`). */
export function enqueueTranscode(lessonId: string, blockId: string, opts: { force?: boolean } = {}): Promise<EnqueueResult> {
  return enqueueTargetTranscode(lessonBlockTarget(lessonId, blockId), opts);
}

/** Queue a conversion of a course's uploaded preview video (see `enqueueTargetTranscode`). */
export function enqueueCoursePreviewTranscode(courseId: string, opts: { force?: boolean } = {}): Promise<EnqueueResult> {
  return enqueueTargetTranscode(coursePreviewTarget(courseId), opts);
}

/** Newest published HLS version folder of a target (one with a master playlist), or null. */
async function newestHlsVersion(target: TranscodeTarget): Promise<string | null> {
  const prefix = hlsPrefixFor(target);
  const candidates: { prefix: string; time: number }[] = [];
  const dir = path.join(/* turbopackIgnore: true */ uploadRoot(), ...prefix.slice(0, -1).split("/"));
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const stat = await fs.stat(path.join(/* turbopackIgnore: true */ dir, entry.name, MASTER_PLAYLIST)).catch(() => null);
    if (stat?.isFile()) candidates.push({ prefix: `${prefix}${entry.name}/`, time: stat.mtimeMs });
  }
  const client = s3Client();
  if (client) {
    const keys = await client.listKeys(prefix, 20_000).catch(() => [] as string[]);
    for (const key of keys) {
      if (!key.endsWith(`/${MASTER_PLAYLIST}`)) continue;
      const info = await client.headObject(key).catch(() => null);
      if (info) candidates.push({ prefix: key.slice(0, -MASTER_PLAYLIST.length), time: info.lastModified?.getTime() ?? 0 });
    }
  }
  candidates.sort((a, b) => b.time - a.time);
  return candidates[0]?.prefix ?? null;
}

/**
 * Re-link a target to HLS output that was already produced for its current
 * file (its latest job finished for this very file) when it lost its HLS URL
 * — e.g. saved by an editor that does not carry the server-managed fields
 * over. Returns true when the target plays HLS again.
 */
export async function recoverTargetHlsOutput(target: TranscodeTarget): Promise<boolean> {
  const db = await getDb();
  const origins = siteOrigins();
  const media = readTargetMedia(db, target);
  const key = media ? transcodeSourceKey(media.src, origins) : null;
  if (!media || !key || (media.hlsUrl && media.storageKey === key)) return false;
  const latest = latestJobForTarget(db.transcodeJobs, target);
  if (!latest || latest.status !== "done" || latest.sourceKey !== key) return false;

  const prefix = await newestHlsVersion(target).catch(() => null);
  if (!prefix) return false;
  const masterKey = `${prefix}${MASTER_PLAYLIST}`;
  const text = await (await storageFor(masterKey)).readText(masterKey, 256 * 1024).catch(() => null);
  const renditions = text ? parseMasterRenditions(text) : [];
  if (!renditions.length) return false;

  return mutate((d) =>
    patchTargetMedia(d, target, (m) =>
      transcodeSourceKey(m.src, origins) === key && !m.hlsUrl
        ? {
            hlsUrl: uploadUrlForKey(masterKey),
            storageKey: key,
            transcode: { status: "ready", progress: 100, renditions: renditions.map((r) => ({ height: r.height, bandwidth: r.bandwidth })), updatedAt: nowIso() },
          }
        : null,
    ),
  );
}

/** Lesson block form of `recoverTargetHlsOutput`. */
export function recoverHlsOutput(lessonId: string, blockId: string): Promise<boolean> {
  return recoverTargetHlsOutput(lessonBlockTarget(lessonId, blockId));
}

/**
 * Bring a lesson's video blocks in line with its saved content (call after
 * saving a lesson): output, generated posters and jobs for replaced or
 * removed videos are released — a conversion still running for an old file
 * is stopped so it does not hold up the queue — and new uploads, replaced
 * files and videos that waited for ffmpeg are queued. Returns the number of
 * new jobs.
 */
export async function syncLessonTranscodes(lessonId: string): Promise<number> {
  await releaseRemovedLessonBlocks(lessonId);
  const stored = await findById("lessons", lessonId);
  if (!stored) return 0;
  for (const block of stored.blocks) {
    if (block.type === "video") await releaseStaleTargetOutput(lessonBlockTarget(lessonId, block.id));
  }
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return 0;
  const lesson = await findById("lessons", lessonId);
  if (!lesson) return 0;
  const origins = siteOrigins();
  let created = 0;
  for (const block of lesson.blocks) {
    if (block.type !== "video") continue;
    if (!needsConversion(block, origins)) continue;
    const res = await enqueueTranscode(lessonId, block.id);
    if (res.ok && res.created) created++;
  }
  return created;
}

/**
 * Fail queued jobs and stop a running one for video blocks of a lesson that
 * no longer exist (the block was deleted or is no longer a video, or the
 * lesson is gone). Their output is left to the orphan sweep.
 */
export async function releaseRemovedLessonBlocks(lessonId: string): Promise<number> {
  const isGone = (db: Database, job: TranscodeJob) => {
    const target = jobTarget(job);
    return isActive(job) && target.kind === "lesson-block" && target.lessonId === lessonId && !readTargetMedia(db, target);
  };
  // Most saves remove nothing: look before taking the write lock.
  const current = await getDb();
  if (!current.transcodeJobs.some((j) => isGone(current, j))) return 0;
  const { failed, abortJobId } = await mutate((db) => {
    const now = nowIso();
    let failed = 0;
    let abortJobId: string | null = null;
    for (const job of db.transcodeJobs) {
      if (!isGone(db, job)) continue;
      if (job.status === "running") abortJobId = job.id;
      else {
        Object.assign(job, { status: "failed", error: "The video block was removed.", finishedAt: now });
        failed++;
      }
    }
    return { failed, abortJobId };
  });
  abortRunningJob(abortJobId);
  return failed + (abortJobId ? 1 : 0);
}

/**
 * Clear the HLS output, conversion state and generated poster a target keeps
 * for a file it no longer plays (a new upload, a link or no video), fail
 * queued jobs for older files and stop a running one. The released HLS
 * version is deleted right away unless something else still plays it (the
 * orphan sweep catches anything left). Returns true when anything changed.
 */
export async function releaseStaleTargetOutput(target: TranscodeTarget): Promise<boolean> {
  const origins = siteOrigins();
  const hasWork = (db: Database) => {
    const plan = planStaleOutputRelease({ target, media: readTargetMedia(db, target), jobs: db.transcodeJobs, siteOrigins: origins });
    return !!plan.patch || plan.obsoleteJobIds.length > 0 || !!plan.abortJobId;
  };
  // Most saves change nothing here: look before taking the write lock.
  if (!hasWork(await getDb())) return false;
  const outcome = await mutate((db) => {
    const plan = planStaleOutputRelease({ target, media: readTargetMedia(db, target), jobs: db.transcodeJobs, siteOrigins: origins });
    const now = nowIso();
    const obsolete = new Set(plan.obsoleteJobIds);
    for (const j of db.transcodeJobs) if (obsolete.has(j.id)) Object.assign(j, { status: "failed", error: "Replaced by a newer video.", finishedAt: now });
    const patch = plan.patch;
    const changed = patch ? patchTargetMedia(db, target, () => patch) : false;
    const stillUsed = plan.releasedVersion ? referencedHlsVersions(db, origins).has(plan.releasedVersion) : false;
    return {
      changed: changed || obsolete.size > 0 || !!plan.abortJobId,
      abortJobId: plan.abortJobId,
      releasedVersion: changed && !stillUsed ? plan.releasedVersion : null,
      releasedPoster: changed ? plan.releasedPoster : null,
    };
  });
  // The running job notices the abort, finds the target playing another file and fails quietly.
  abortRunningJob(outcome.abortJobId);
  if (outcome.releasedVersion) await deleteHlsVersion(outcome.releasedVersion);
  if (outcome.releasedPoster) await deleteGeneratedPoster(target, outcome.releasedPoster);
  return outcome.changed;
}

/**
 * Bring a course's preview video in line with its saved `videoUrl` (call
 * after saving a course): output made from a replaced or removed video is
 * released, and a new upload, a replaced file or a video that waited for
 * ffmpeg is queued for conversion while adaptive streaming is on. Never
 * throws; returns the number of new jobs (0 or 1).
 */
export async function syncCoursePreviewTranscode(courseId: string): Promise<number> {
  try {
    const target = coursePreviewTarget(courseId);
    await releaseStaleTargetOutput(target);
    const settings = await getSettings();
    if (!settings.storage.transcodeToHls) return 0;
    const db = await getDb();
    if (!needsConversion(readTargetMedia(db, target), siteOrigins())) return 0;
    const res = await enqueueTargetTranscode(target);
    return res.ok && res.created ? 1 : 0;
  } catch (err) {
    console.error("[transcode] could not queue a course preview video:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Queue every uploaded lesson video and course preview that has no current HLS version (cron and "Convert all"). */
export async function syncAllTranscodes(): Promise<number> {
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return 0;
  const db = await getDb();
  const origins = siteOrigins();
  const lessonIds = db.lessons.filter((l) => l.blocks.some((b) => b.type === "video" && needsConversion(b, origins))).map((l) => l.id);
  const courseIds = db.courses.filter((c) => needsConversion(readTargetMedia(db, coursePreviewTarget(c.id)), origins)).map((c) => c.id);
  let created = 0;
  for (const id of lessonIds) created += await syncLessonTranscodes(id);
  for (const id of courseIds) {
    const res = await enqueueCoursePreviewTranscode(id);
    if (res.ok && res.created) created++;
  }
  return created;
}

/**
 * A video finished uploading (`/api/upload`, `/api/uploads/:id/complete`):
 * queue the saved lesson blocks and course previews that already play this
 * file, warm the ffmpeg check for the editor's first status poll and resume
 * any waiting jobs. Targets saved later are queued by their save, the
 * editors' status polls and the cron. Never throws; returns the number of
 * new jobs.
 */
export async function onSourceUploaded(key: string): Promise<number> {
  try {
    const settings = await getSettings();
    if (!settings.storage.transcodeToHls) return 0;
    await detectFfmpeg();
    const db = await getDb();
    const origins = siteOrigins();
    let created = 0;
    for (const lesson of db.lessons) {
      for (const block of lesson.blocks) {
        if (block.type !== "video" || transcodeSourceKey(block.src, origins) !== key) continue;
        const res = await enqueueTranscode(lesson.id, block.id);
        if (res.ok && res.created) created++;
      }
    }
    for (const course of db.courses) {
      if (transcodeSourceKey(course.videoUrl, origins) !== key) continue;
      const res = await enqueueCoursePreviewTranscode(course.id);
      if (res.ok && res.created) created++;
    }
    kickTranscodeWorker();
    return created;
  } catch (err) {
    console.error("[transcode] could not queue an uploaded video:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Retry a failed job (or re-run a finished one) as a new job for the target's current file. */
export async function retryTranscodeJob(jobId: string): Promise<EnqueueResult> {
  const job = await findById("transcodeJobs", jobId);
  if (!job) return { ok: false, reason: "not-found", message: "This job no longer exists." };
  return enqueueTargetTranscode(jobTarget(job), { force: true });
}

/** Queue a new job for every target whose latest job failed. */
export async function retryFailedTranscodes(): Promise<number> {
  const db = await getDb();
  const latest = new Map<string, TranscodeJob>();
  for (const job of db.transcodeJobs) {
    const key = jobTargetId(job);
    const current = latest.get(key);
    if (!current || job.createdAt > current.createdAt) latest.set(key, job);
  }
  let queued = 0;
  for (const job of latest.values()) {
    if (job.status !== "failed") continue;
    const res = await enqueueTargetTranscode(jobTarget(job), { force: true });
    if (res.ok && res.created) queued++;
  }
  return queued;
}

/** Cancel a queued or running job. The target keeps any earlier finished HLS version. */
export async function cancelTranscodeJob(jobId: string): Promise<boolean> {
  if (worker.current?.jobId === jobId) {
    worker.current.abort.abort();
    return true;
  }
  return mutate((db) => {
    const job = db.transcodeJobs.find((j) => j.id === jobId);
    if (!job || job.status !== "queued") return false;
    const now = nowIso();
    const origins = siteOrigins();
    Object.assign(job, { status: "failed", error: "Cancelled by an administrator.", finishedAt: now });
    patchTargetMedia(db, jobTarget(job), (m) => ({ transcode: settledState(m, "Cancelled by an administrator.", now, origins) }));
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */

export interface TranscodeJobView {
  id: string;
  status: TranscodeJob["status"];
  progress: number;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** 1-based place in the queue (queued jobs only). */
  queuePosition: number | null;
  /** Heights being produced (running job only). */
  heights: number[] | null;
  /** Encoding speed relative to real time (running job only). */
  speed: number | null;
}

export function jobView(job: TranscodeJob, all: readonly TranscodeJob[]): TranscodeJobView {
  const running = worker.current?.jobId === job.id ? worker.current : null;
  const queuePosition = job.status === "queued" ? all.filter((j) => j.status === "queued" && j.createdAt <= job.createdAt).length : null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    attempts: job.attempts,
    error: job.error ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    queuePosition,
    heights: running?.heights.length ? running.heights : null,
    speed: running?.speed ?? null,
  };
}

/** Latest job of a lesson video block. */
export function latestJobFor(db: Pick<Database, "transcodeJobs">, lessonId: string, blockId: string): TranscodeJob | null {
  return latestJobForTarget(db.transcodeJobs, lessonBlockTarget(lessonId, blockId));
}

export { latestJobForTarget };

export interface QueueCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
}

export async function getQueueCounts(): Promise<QueueCounts> {
  const db = await getDb();
  const counts: QueueCounts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const job of db.transcodeJobs) counts[job.status]++;
  return counts;
}

export function isWorkerRunning(): boolean {
  return worker.running;
}

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

/** Start the worker if it is idle and there may be work. Never throws. */
export function kickTranscodeWorker(): void {
  if (worker.running) return;
  worker.running = true;
  void runLoop()
    .catch((err) => console.error("[transcode] worker stopped:", err instanceof Error ? err.message : err))
    .finally(() => {
      worker.running = false;
      worker.current = null;
    });
}

async function runLoop(): Promise<void> {
  for (;;) {
    const job = await claimNextJob();
    if (!job) return;
    await processJob(job);
  }
}

/**
 * Settle jobs marked running that this worker is not running (the process
 * stopped mid-conversion): queue them again, or fail them once they were
 * interrupted `MAX_JOB_ATTEMPTS` times — a video that keeps crashing the
 * server must not be retried forever. Returns the failed jobs.
 */
export function recoverOrphanedJobs(db: Database, activeJobId: string | null, now = nowIso()): TranscodeJob[] {
  const failed: TranscodeJob[] = [];
  const origins = siteOrigins();
  for (const job of db.transcodeJobs) {
    if (job.status !== "running" || job.id === activeJobId) continue;
    if (job.attempts < MAX_JOB_ATTEMPTS) {
      Object.assign(job, { status: "queued", progress: 0 });
      continue;
    }
    const error = `The conversion was interrupted ${job.attempts} times (the server stopped while it ran), so it was not started again. Retry it once the server is stable, or upload a smaller or re-encoded file.`;
    Object.assign(job, { status: "failed", error, finishedAt: now });
    patchTargetMedia(db, jobTarget(job), (m) => (transcodeSourceKey(m.src, origins) === job.sourceKey ? { transcode: settledState(m, error, now, origins) } : null));
    failed.push({ ...job });
  }
  return failed;
}

/** Settle jobs orphaned by a restart and claim the oldest queued job. */
async function claimNextJob(): Promise<TranscodeJob | null> {
  const { next, failed } = await mutate((db) => {
    const failed = recoverOrphanedJobs(db, worker.current?.jobId ?? null);
    const next = db.transcodeJobs.filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (next) Object.assign(next, { status: "running", progress: 0, attempts: next.attempts + 1, startedAt: nowIso(), error: undefined, finishedAt: undefined });
    return { next: next ? { ...next } : null, failed };
  });
  for (const job of failed) await notifyInstructors(job, "failed", job.error ?? "The conversion was interrupted too often.");
  return next;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (HLS_CONTENT_TYPES[ext]) return HLS_CONTENT_TYPES[ext]!;
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg") return "image/jpeg";
  return "application/octet-stream";
}

async function processJob(job: TranscodeJob): Promise<void> {
  const abort = new AbortController();
  const target = jobTarget(job);
  worker.current = { jobId: job.id, abort, heights: [], speed: null };
  const workDir = path.join(/* turbopackIgnore: true */ uploadRoot(), ".transcode", job.id);
  let published: string | null = null;
  try {
    const db = await getDb();
    const media = readTargetMedia(db, target);
    if (!media || transcodeSourceKey(media.src, siteOrigins()) !== job.sourceKey) throw new TranscodeCancelled("The video was removed or replaced before it was converted.");

    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg.available) throw new FfmpegError(`ffmpeg is not available: ${ffmpeg.error ?? "unknown error"}`);

    await mutate((d) => patchTargetMedia(d, target, (m) => ({ transcode: { status: "processing", progress: 0, renditions: m.transcode?.renditions, updatedAt: nowIso() } })));

    const settings = await getSettings();
    // Uploads are checked when they arrive; check again so ffmpeg only ever parses real video containers.
    if (!looksLikeVideo(await readSourceHead(job.sourceKey))) throw new FfmpegError("This file is not a video (MP4, WebM, OGG, MOV or MKV), so it was not converted.");
    const source = await (await storageFor(job.sourceKey)).processingInput(job.sourceKey, SOURCE_URL_TTL_SECONDS);
    const probe = await probeMedia(source.input);
    if (!probe.hasVideo) throw new FfmpegError("This file has no video track.");
    const heights = renditionLadder(probe, settings.storage.renditions);
    if (!heights.length) throw new FfmpegError("The video's picture size could not be read.");
    worker.current.heights = heights;

    await fs.rm(workDir, { recursive: true, force: true });
    const plan = buildHlsPlan(source.input, probe, heights);
    for (const v of plan.variants) await fs.mkdir(path.join(/* turbopackIgnore: true */ workDir, v.dir), { recursive: true });

    let lastWrite = 0;
    let lastPercent = -1;
    await runFfmpeg(plan.args, {
      cwd: workDir,
      signal: abort.signal,
      stallMs: STALL_MS,
      onProgress: (p) => {
        if (worker.current) worker.current.speed = p.speed;
        const percent = progressPercent(p.outTime, probe.duration);
        const now = Date.now();
        if (percent === lastPercent || now - lastWrite < PROGRESS_WRITE_MS) return;
        lastWrite = now;
        lastPercent = percent;
        void mutate((d) => {
          const row = d.transcodeJobs.find((j) => j.id === job.id);
          if (row && row.status === "running") row.progress = percent;
          patchTargetMedia(d, target, (m) => (m.transcode?.status === "processing" ? { transcode: { ...m.transcode, progress: percent, updatedAt: nowIso() } } : null));
        });
      },
    });

    // Poster frame: nice to have, never fails the job. A lesson block showing a poster its editor chose keeps it, so none is made.
    let posterMade = false;
    if (!media.posterUrl || hasGeneratedPoster(target, media, siteOrigins())) {
      try {
        await runFfmpeg(buildPosterArgs(source.input, probe), { cwd: workDir, signal: abort.signal, stallMs: 120_000, timeoutMs: 180_000 });
        posterMade = true;
      } catch (err) {
        if (abort.signal.aborted) throw err;
      }
    }

    // Measure each rendition and write the master playlist.
    const variants: HlsVariant[] = [];
    for (const v of plan.variants) {
      const playlist = await fs.readFile(path.join(/* turbopackIgnore: true */ workDir, v.playlist), "utf8");
      const info = parseMediaSegments(playlist);
      if (!info.segments.length) throw new FfmpegError(`The ${v.height}p rendition has no segments.`);
      const sizes = await Promise.all(info.segments.map(async (s) => ({ duration: s.duration, bytes: (await fs.stat(path.join(/* turbopackIgnore: true */ workDir, v.dir, s.uri))).size })));
      const initBytes = info.initUri ? (await fs.stat(path.join(/* turbopackIgnore: true */ workDir, v.dir, info.initUri)).catch(() => null))?.size ?? 0 : 0;
      const { peak, average } = measureBandwidth(sizes, initBytes);
      variants.push({ uri: v.playlist, width: v.width, height: v.height, bandwidth: peak, averageBandwidth: average, codecs: v.codecs, frameRate: probe.fps > 0 ? Math.min(probe.fps, 60) : undefined });
    }
    await fs.writeFile(path.join(/* turbopackIgnore: true */ workDir, MASTER_PLAYLIST), buildMasterPlaylist(variants), "utf8");

    // Publish: segments and playlists first, the master playlist last.
    const version = uid().slice(0, 10);
    const prefix = `${hlsPrefixFor(target)}${version}/`;
    published = prefix;
    const storage = getStorage();
    const files = (await listFiles(workDir)).filter((f) => f !== POSTER_FILE && f !== MASTER_PLAYLIST);
    for (const file of files) {
      abort.signal.throwIfAborted();
      await storage.putFile(`${prefix}${file}`, path.join(/* turbopackIgnore: true */ workDir, ...file.split("/")), { contentType: contentTypeFor(file), move: true, cacheControl: "private, max-age=31536000, immutable" });
    }
    await storage.putFile(`${prefix}${MASTER_PLAYLIST}`, path.join(/* turbopackIgnore: true */ workDir, MASTER_PLAYLIST), { contentType: HLS_CONTENT_TYPES[".m3u8"]!, move: true });
    let posterUrl: string | null = null;
    if (posterMade) {
      const posterKey = posterKeyFor(target, version);
      await storage.putFile(posterKey, path.join(/* turbopackIgnore: true */ workDir, POSTER_FILE), { contentType: "image/jpeg", move: true, cacheControl: "public, max-age=31536000, immutable" });
      posterUrl = uploadUrlForKey(posterKey);
    }

    // Switch the target to the new version (only if it still plays the same file).
    const origins = siteOrigins();
    const outcome = await mutate((d) => {
      let previous: string | null = null;
      let previousPoster: string | null = null;
      let posterUsed = false;
      const now = nowIso();
      const ok = patchTargetMedia(d, target, (m) => {
        if (transcodeSourceKey(m.src, origins) !== job.sourceKey) return null;
        previous = hlsVersionPrefix(m.hlsUrl, origins);
        const common = {
          hlsUrl: uploadUrlForKey(`${prefix}${MASTER_PLAYLIST}`),
          storageKey: job.sourceKey,
          transcode: { status: "ready" as const, progress: 100, renditions: variants.map((v) => ({ height: v.height, bandwidth: v.bandwidth })), updatedAt: now },
        };
        if (target.kind === "course-preview") {
          // The preview poster is generated only: a new conversion replaces it.
          if (posterUrl && m.posterUrl && m.posterUrl !== posterUrl) previousPoster = m.posterUrl;
          posterUsed = !!posterUrl;
          return { ...common, posterUrl: posterUrl ?? m.posterUrl };
        }
        // Lesson blocks keep a poster and duration the editor set; a poster generated by an earlier conversion is replaced.
        let poster = m.posterUrl || undefined;
        if (posterUrl && (!m.posterUrl || hasGeneratedPoster(target, m, origins))) {
          if (m.posterUrl && m.posterUrl !== posterUrl) previousPoster = m.posterUrl;
          poster = posterUrl;
          posterUsed = true;
        }
        return { ...common, duration: m.duration ?? (probe.duration > 0 ? Math.round(probe.duration) : undefined), posterUrl: poster };
      });
      const row = d.transcodeJobs.find((j) => j.id === job.id);
      if (row) Object.assign(row, ok ? { status: "done", progress: 100, finishedAt: now, error: undefined } : { status: "failed", error: "The video was replaced while it was being converted.", finishedAt: now });
      // An older version is deleted only when nothing else (e.g. a duplicated course or lesson) still plays it.
      const stillUsed = previous ? referencedHlsVersions(d, origins).has(previous) : false;
      return { ok, previous: stillUsed ? null : (previous as string | null), previousPoster: previousPoster as string | null, posterUsed: ok && posterUsed };
    });
    if (!outcome.ok) {
      await storage.deletePrefix(prefix).catch(() => undefined);
      if (posterUrl) await deleteGeneratedPoster(target, posterUrl);
      return;
    }
    published = null;
    if (outcome.previous && outcome.previous !== prefix) await deleteHlsVersion(outcome.previous);
    if (outcome.previousPoster) await deleteGeneratedPoster(target, outcome.previousPoster);
    // The editor chose a poster while the video was converting: the captured one is not needed.
    if (posterUrl && !outcome.posterUsed) await deleteGeneratedPoster(target, posterUrl);

    await notifyInstructors(job, "ready", `Converted to ${renditionLabel(variants.map((v) => v.height))}.`);
    if (target.kind === "lesson-block") await onVideoReady(target.lessonId, target.blockId);
  } catch (err) {
    const cancelled = abort.signal.aborted || err instanceof TranscodeCancelled;
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof FfmpegError && err.stderr ? `${message}\n${err.stderr}` : message;
    if (!(err instanceof FfmpegError) && !cancelled) console.error("[transcode] job failed:", job.id, message);
    await mutate((d) => {
      const now = nowIso();
      const origins = siteOrigins();
      const row = d.transcodeJobs.find((j) => j.id === job.id);
      if (row) Object.assign(row, { status: "failed", error: tailText(detail, MAX_ERROR_CHARS), finishedAt: now });
      patchTargetMedia(d, target, (m) => (transcodeSourceKey(m.src, origins) === job.sourceKey ? { transcode: settledState(m, message, now, origins) } : null));
    });
    if (published) await getStorage().deletePrefix(published).catch(() => undefined);
    if (!cancelled) await notifyInstructors(job, "failed", message);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    worker.current = null;
  }
}

/** First bytes of a stored source file (empty when it cannot be read). */
async function readSourceHead(key: string, bytes = 16): Promise<Uint8Array> {
  const result = await (await storageFor(key)).read(key, `bytes=0-${bytes - 1}`).catch(() => null);
  if (!result || result === "unsatisfiable") return new Uint8Array(0);
  const reader = result.body.getReader();
  const out: number[] = [];
  try {
    while (out.length < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.byteLength && out.length < bytes; i++) out.push(value[i]!);
    }
  } catch {
    /* treated as unreadable below */
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Uint8Array.from(out);
}

async function deleteHlsVersion(prefix: string): Promise<void> {
  // An old version may sit on local disk (before switching to S3) or in the bucket.
  await Promise.all([localStorage().deletePrefix(prefix).catch(() => 0), getStorage().kind === "s3" ? getStorage().deletePrefix(prefix).catch(() => 0) : Promise.resolve(0)]);
}

/**
 * Delete a poster this pipeline generated for `target` once nothing shows it
 * (a duplicated lesson or course may still do). Never touches any other upload.
 */
async function deleteGeneratedPoster(target: TranscodeTarget, url: string): Promise<void> {
  const origins = siteOrigins();
  const key = ownGeneratedPosterKey(target, url, origins);
  if (!key || referencedPosterKeys(await getDb(), origins).has(key)) return;
  await deletePosterKey(key);
}

async function deletePosterKey(key: string): Promise<void> {
  // A poster may sit on local disk (made before switching to S3) or in the bucket.
  await localStorage().delete(key).catch(() => undefined);
  if (getStorage().kind === "s3") await getStorage().delete(key).catch(() => undefined);
}

async function notifyInstructors(job: TranscodeJob, outcome: "ready" | "failed", detail: string): Promise<void> {
  try {
    const db = await getDb();
    const target = jobTarget(job);
    let course = null;
    let name: string;
    let link: string;
    if (target.kind === "course-preview") {
      course = db.courses.find((c) => c.id === target.courseId) ?? null;
      if (!course) return;
      name = `${course.title} (preview video)`;
      link = `/admin/courses/${course.id}`;
    } else {
      const lesson = db.lessons.find((l) => l.id === target.lessonId);
      course = lesson ? (db.courses.find((c) => c.id === lesson.courseId) ?? null) : null;
      if (!lesson || !course) return;
      name = lesson.title;
      link = `/admin/courses/${course.id}/lessons/${lesson.id}`;
    }
    const audience = target.kind === "course-preview" ? "Visitors" : "Learners";
    const recipients = Array.from(new Set([...course.instructorIds, course.createdById])).filter(Boolean);
    await notifyMany(recipients, {
      type: "system",
      subject: outcome === "ready" ? `Video ready: ${name}` : `Video conversion failed: ${name}`,
      message:
        outcome === "ready"
          ? `${detail} ${audience} now get adaptive streaming.`
          : `${detail.split("\n")[0]} ${audience} still get the original file. Open the ${target.kind === "course-preview" ? "course" : "lesson"} to retry.`,
      link,
      // Success is informational only; failures also go out by email.
      email: outcome === "failed",
      dedupeKey: `transcode:${job.id}:${outcome}`,
    });
  } catch (err) {
    console.error("[transcode] could not notify instructors:", err instanceof Error ? err.message : err);
  }
}

/**
 * Hook point run after a lesson video's HLS version is published: starts
 * automatic captions when the transcripts module is present (it is optional,
 * so it is loaded dynamically and its absence is not an error).
 */
export async function onVideoReady(lessonId: string, blockId: string): Promise<void> {
  try {
    const mod: { requestAutoTranscript?: (lessonId: string, blockId: string) => unknown } = await import("@/lib/transcripts/auto");
    await mod.requestAutoTranscript?.(lessonId, blockId);
  } catch (err) {
    console.error("[transcode] automatic transcript request failed:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                         */
/* ------------------------------------------------------------------ */

/** Remove finished jobs older than the retention period (the newest job of each target stays). */
export async function pruneTranscodeJobs(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - JOB_RETENTION_DAYS * 86_400_000).toISOString();
  return mutate((db) => {
    const newest = new Map<string, string>();
    for (const j of db.transcodeJobs) {
      const k = jobTargetId(j);
      if ((newest.get(k) ?? "") < j.createdAt) newest.set(k, j.createdAt);
    }
    const before = db.transcodeJobs.length;
    db.transcodeJobs = db.transcodeJobs.filter((j) => isActive(j) || j.createdAt >= cutoff || newest.get(jobTargetId(j)) === j.createdAt);
    return before - db.transcodeJobs.length;
  });
}

/** Version folders `<hlsDir>/<version>/` on local disk, as storage prefixes under `prefix`. */
async function localVersions(hlsDir: string, prefix: string): Promise<{ prefix: string; dir: string }[]> {
  const versions = await fs.readdir(hlsDir, { withFileTypes: true }).catch(() => []);
  return versions.filter((v) => v.isDirectory()).map((v) => ({ prefix: `${prefix}${v.name}/`, dir: path.join(/* turbopackIgnore: true */ hlsDir, v.name) }));
}

/**
 * Delete HLS versions no lesson block or course preview points at any more
 * (deleted lessons, blocks or courses, replaced videos). Versions younger
 * than a day are kept so a job being published is never touched.
 */
export async function cleanupOrphanedHls(now = Date.now()): Promise<number> {
  const db = await getDb();
  const origins = siteOrigins();
  const referenced = referencedHlsVersions(db, origins);
  let removed = 0;
  const minAge = 86_400_000;

  // Local disk: videos/<lesson>/<block>/hls/<version>/ and videos/course/<course>/preview/hls/<version>/
  const videosDir = path.join(/* turbopackIgnore: true */ uploadRoot(), "videos");
  const candidates: { prefix: string; dir: string }[] = [];
  const level1 = await fs.readdir(videosDir, { withFileTypes: true }).catch(() => []);
  for (const l of level1) {
    if (!l.isDirectory()) continue;
    const level2 = await fs.readdir(path.join(/* turbopackIgnore: true */ videosDir, l.name), { withFileTypes: true }).catch(() => []);
    for (const b of level2) {
      if (!b.isDirectory()) continue;
      candidates.push(...(await localVersions(path.join(/* turbopackIgnore: true */ videosDir, l.name, b.name, "hls"), `videos/${l.name}/${b.name}/hls/`)));
      if (l.name === COURSE_PREVIEW_ROOT) {
        candidates.push(
          ...(await localVersions(path.join(/* turbopackIgnore: true */ videosDir, l.name, b.name, COURSE_PREVIEW_DIR, "hls"), `videos/${COURSE_PREVIEW_ROOT}/${b.name}/${COURSE_PREVIEW_DIR}/hls/`)),
        );
      }
    }
  }
  for (const c of candidates) {
    if (referenced.has(c.prefix)) continue;
    const stat = await fs.stat(c.dir).catch(() => null);
    if (!stat || now - stat.mtimeMs < minAge) continue;
    removed += await localStorage().deletePrefix(c.prefix).catch(() => 0);
  }

  // Bucket: group keys by version folder.
  const storage = getStorage();
  const client = s3Client();
  if (storage.kind === "s3" && client) {
    const keys = await client.listKeys("videos/").catch(() => [] as string[]);
    const prefixes = new Set<string>();
    for (const key of keys) {
      const folder = hlsVersionFolderOfKey(key);
      if (folder) prefixes.add(folder);
    }
    for (const prefix of prefixes) {
      if (referenced.has(prefix)) continue;
      // A version without its master playlist is still being published (or failed half-way): judge it by age only when the master exists.
      const master = await client.headObject(`${prefix}${MASTER_PLAYLIST}`).catch(() => null);
      if (!master?.lastModified || now - master.lastModified.getTime() < minAge) continue;
      removed += await storage.deletePrefix(prefix).catch(() => 0);
    }
  }
  return removed + (await cleanupOrphanedPosters(now));
}

/**
 * Delete generated posters (`posters/…`) no lesson block or course preview
 * shows any more — replaced videos, re-conversions, deleted lessons — once
 * they are a day old (a job being published is never touched).
 */
export async function cleanupOrphanedPosters(now = Date.now()): Promise<number> {
  const referenced = referencedPosterKeys(await getDb(), siteOrigins());
  const minAge = 86_400_000;
  let removed = 0;

  const postersDir = path.join(/* turbopackIgnore: true */ uploadRoot(), POSTERS_ROOT);
  const entries = await fs.readdir(postersDir, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(/* turbopackIgnore: true */ entry.parentPath, entry.name);
    const key = `${POSTERS_ROOT}/${path.relative(postersDir, full).split(path.sep).join("/")}`;
    if (!GENERATED_POSTER_KEY.test(key) || referenced.has(key)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || now - stat.mtimeMs < minAge) continue;
    await localStorage()
      .delete(key)
      .then(
        () => removed++,
        () => undefined,
      );
  }

  const storage = getStorage();
  const client = s3Client();
  if (storage.kind === "s3" && client) {
    const keys = await client.listKeys(`${POSTERS_ROOT}/`).catch(() => [] as string[]);
    for (const key of keys) {
      if (!GENERATED_POSTER_KEY.test(key) || referenced.has(key)) continue;
      const info = await client.headObject(key).catch(() => null);
      if (!info?.lastModified || now - info.lastModified.getTime() < minAge) continue;
      await storage.delete(key).then(
        () => removed++,
        () => undefined,
      );
    }
  }
  return removed;
}
