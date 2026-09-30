import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { Database, Lesson, TranscodeJob, VideoTranscodeState } from "@/lib/types";
import { findById, getDb, getSettings, mutate } from "@/lib/db/store";
import { notifyMany } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import { getStorage, localStorage, s3Client, storageFor, uploadRoot, uploadUrlForKey } from "@/lib/storage";
import { siteOrigins } from "../access";
import { HLS_CONTENT_TYPES, buildMasterPlaylist, measureBandwidth, parseMasterRenditions, parseMediaSegments, type HlsVariant } from "../hls";
import { FfmpegError, detectFfmpeg, probeMedia, runFfmpeg } from "./ffmpeg";
import { hlsKeyPrefix, hlsVersionPrefix, pendingState, renditionLabel, transcodeSourceKey, type VideoBlock } from "./lesson-fields";
import { MASTER_PLAYLIST, POSTER_FILE, buildHlsPlan, buildPosterArgs, progressPercent, renditionLadder, tailText } from "./plan";

/**
 * Durable HLS transcoding queue.
 *
 * Jobs live in `db.transcodeJobs`, so a restart loses nothing: a job that was
 * running when the process stopped is queued again the next time the worker
 * starts. One job runs at a time, in this process, started lazily when a
 * video is queued, when the editor polls its status and by
 * `/api/cron/media`. Output is written to a hidden work folder, measured,
 * given a master playlist and then published under
 * `videos/<lessonId>/<blockId>/hls/<version>/`; the block's `hlsUrl` switches
 * to the new version only after everything is stored, and the previous
 * version is deleted afterwards.
 */

/** Kill ffmpeg when it reports nothing for this long. */
const STALL_MS = 15 * 60_000;
/** Minimum time between progress writes to the database. */
const PROGRESS_WRITE_MS = 2_000;
/** Presigned source URLs handed to ffmpeg for remote storage. */
const SOURCE_URL_TTL_SECONDS = 12 * 60 * 60;
/** Finished jobs older than this are pruned (the newest job of each block is kept). */
const JOB_RETENTION_DAYS = 30;
const MAX_ERROR_CHARS = 4000;

interface WorkerState {
  running: boolean;
  current: { jobId: string; abort: AbortController; heights: number[]; speed: number | null } | null;
}

const g = globalThis as unknown as { __llTranscodeWorker?: WorkerState };
const worker: WorkerState = (g.__llTranscodeWorker ??= { running: false, current: null });

class TranscodeCancelled extends Error {}

/* ------------------------------------------------------------------ */
/* Block helpers                                                        */
/* ------------------------------------------------------------------ */

function findVideoBlock(lesson: Lesson | undefined | null, blockId: string): VideoBlock | null {
  const block = lesson?.blocks.find((b) => b.id === blockId);
  return block?.type === "video" ? block : null;
}

/** Replace a video block inside a mutation. Returns false when the block is gone. */
function patchBlock(db: Database, lessonId: string, blockId: string, patch: (block: VideoBlock) => VideoBlock | null): boolean {
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return false;
  let changed = false;
  lesson.blocks = lesson.blocks.map((b) => {
    if (b.id !== blockId || b.type !== "video") return b;
    const next = patch(b);
    if (!next) return b;
    changed = true;
    return next;
  });
  return changed;
}

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
 * Queue a conversion of a block's uploaded video. Existing queued/running
 * jobs for the same file are reused. Without `force`, a block whose HLS
 * output already matches its file, or whose last conversion of this file
 * failed, is left alone (retries are explicit).
 */
export async function enqueueTranscode(lessonId: string, blockId: string, opts: { force?: boolean } = {}): Promise<EnqueueResult> {
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return { ok: false, reason: "disabled", message: "Adaptive streaming is turned off in Settings → Storage & video." };
  const ffmpeg = await detectFfmpeg();
  const origins = siteOrigins();

  // A lesson saved by an editor that dropped the server-managed fields: re-link the finished output instead of converting again.
  if (!opts.force && (await recoverHlsOutput(lessonId, blockId))) return { ok: false, reason: "ready", message: "This video is already converted." };

  const result = await mutate((db): EnqueueResult => {
    const lesson = db.lessons.find((l) => l.id === lessonId);
    const block = findVideoBlock(lesson, blockId);
    if (!lesson || !block) return { ok: false, reason: "not-found", message: "This video block no longer exists. Save the lesson first." };
    const key = transcodeSourceKey(block.src, origins);
    if (!key) return { ok: false, reason: "not-upload", message: "Only videos uploaded to this site can be converted." };

    const now = nowIso();
    const stale = !!block.storageKey && block.storageKey !== key;
    if (!ffmpeg.available) {
      patchBlock(db, lessonId, blockId, (b) => ({
        ...b,
        ...(stale ? { hlsUrl: undefined, storageKey: undefined } : {}),
        transcode: { status: "unavailable", error: ffmpeg.error ?? undefined, updatedAt: now },
      }));
      return { ok: false, reason: "unavailable", message: "ffmpeg is not installed on the server, so the original file is played." };
    }

    const jobs = db.transcodeJobs.filter((j) => j.lessonId === lessonId && j.blockId === blockId);
    const active = jobs.find((j) => isActive(j) && j.sourceKey === key);
    if (active) return { ok: true, job: active, created: false };
    if (!opts.force) {
      if (block.hlsUrl && block.storageKey === key && block.transcode?.status === "ready") return { ok: false, reason: "ready", message: "This video is already converted." };
      const last = jobs.filter((j) => j.sourceKey === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (last?.status === "failed") return { ok: false, reason: "failed", message: last.error?.split("\n")[0] ?? "The last conversion failed." };
    }
    // Jobs for an older file of this block are obsolete.
    for (const j of jobs) if (j.status === "queued" && j.sourceKey !== key) Object.assign(j, { status: "failed", error: "Replaced by a newer video.", finishedAt: now });

    const job: TranscodeJob = { id: uid("tcj"), lessonId, blockId, sourceKey: key, status: "queued", progress: 0, attempts: 0, createdAt: now };
    db.transcodeJobs.push(job);
    patchBlock(db, lessonId, blockId, (b) => ({
      ...b,
      // A new file must never play the previous file's stream.
      ...(stale ? { hlsUrl: undefined, storageKey: undefined, transcode: pendingState(undefined, now) } : { transcode: pendingState(b.transcode, now) }),
    }));
    return { ok: true, job, created: true };
  });
  if (result.ok) kickTranscodeWorker();
  return result;
}

/** Newest published HLS version folder of a block (one with a master playlist), or null. */
async function newestHlsVersion(lessonId: string, blockId: string): Promise<string | null> {
  const prefix = hlsKeyPrefix(lessonId, blockId);
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
 * Re-link a block to HLS output that was already produced for its current
 * file (the latest job of the block finished for this very file) when the
 * block lost its `hlsUrl` — e.g. saved by an editor that does not carry the
 * server-managed fields over. Returns true when the block plays HLS again.
 */
export async function recoverHlsOutput(lessonId: string, blockId: string): Promise<boolean> {
  const db = await getDb();
  const origins = siteOrigins();
  const block = findVideoBlock(db.lessons.find((l) => l.id === lessonId), blockId);
  const key = block ? transcodeSourceKey(block.src, origins) : null;
  if (!block || !key || (block.hlsUrl && block.storageKey === key)) return false;
  const latest = latestJobFor(db, lessonId, blockId);
  if (!latest || latest.status !== "done" || latest.sourceKey !== key) return false;

  const prefix = await newestHlsVersion(lessonId, blockId).catch(() => null);
  if (!prefix) return false;
  const masterKey = `${prefix}${MASTER_PLAYLIST}`;
  const text = await (await storageFor(masterKey)).readText(masterKey, 256 * 1024).catch(() => null);
  const renditions = text ? parseMasterRenditions(text) : [];
  if (!renditions.length) return false;

  return mutate((d) =>
    patchBlock(d, lessonId, blockId, (b) =>
      transcodeSourceKey(b.src, origins) === key && !b.hlsUrl
        ? {
            ...b,
            hlsUrl: uploadUrlForKey(masterKey),
            storageKey: key,
            transcode: { status: "ready", progress: 100, renditions: renditions.map((r) => ({ height: r.height, bandwidth: r.bandwidth })), updatedAt: nowIso() },
          }
        : null,
    ),
  );
}

/**
 * Queue conversions a lesson still needs (call after saving a lesson): new
 * uploads, replaced files and videos that waited for ffmpeg. Returns the
 * number of new jobs.
 */
export async function syncLessonTranscodes(lessonId: string): Promise<number> {
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return 0;
  const lesson = await findById("lessons", lessonId);
  if (!lesson) return 0;
  const origins = siteOrigins();
  let created = 0;
  for (const block of lesson.blocks) {
    if (block.type !== "video") continue;
    const key = transcodeSourceKey(block.src, origins);
    if (!key) continue;
    if (block.hlsUrl && block.storageKey === key && block.transcode?.status === "ready") continue;
    const res = await enqueueTranscode(lessonId, block.id);
    if (res.ok && res.created) created++;
  }
  return created;
}

/** Queue every uploaded lesson video that has no current HLS version (cron and "Convert all"). */
export async function syncAllTranscodes(): Promise<number> {
  const settings = await getSettings();
  if (!settings.storage.transcodeToHls) return 0;
  const db = await getDb();
  const origins = siteOrigins();
  const lessonIds = db.lessons
    .filter((l) =>
      l.blocks.some((b) => {
        if (b.type !== "video") return false;
        const key = transcodeSourceKey(b.src, origins);
        return !!key && !(b.hlsUrl && b.storageKey === key && b.transcode?.status === "ready");
      }),
    )
    .map((l) => l.id);
  let created = 0;
  for (const id of lessonIds) created += await syncLessonTranscodes(id);
  return created;
}

/** Retry a failed job (or re-run a finished one) as a new job for the block's current file. */
export async function retryTranscodeJob(jobId: string): Promise<EnqueueResult> {
  const job = await findById("transcodeJobs", jobId);
  if (!job) return { ok: false, reason: "not-found", message: "This job no longer exists." };
  return enqueueTranscode(job.lessonId, job.blockId, { force: true });
}

/** Queue a new job for every block whose latest job failed. */
export async function retryFailedTranscodes(): Promise<number> {
  const db = await getDb();
  const latest = new Map<string, TranscodeJob>();
  for (const job of db.transcodeJobs) {
    const key = `${job.lessonId}|${job.blockId}`;
    const current = latest.get(key);
    if (!current || job.createdAt > current.createdAt) latest.set(key, job);
  }
  let queued = 0;
  for (const job of latest.values()) {
    if (job.status !== "failed") continue;
    const res = await enqueueTranscode(job.lessonId, job.blockId, { force: true });
    if (res.ok && res.created) queued++;
  }
  return queued;
}

/** Cancel a queued or running job. The block keeps any earlier finished HLS version. */
export async function cancelTranscodeJob(jobId: string): Promise<boolean> {
  if (worker.current?.jobId === jobId) {
    worker.current.abort.abort();
    return true;
  }
  return mutate((db) => {
    const job = db.transcodeJobs.find((j) => j.id === jobId);
    if (!job || job.status !== "queued") return false;
    const now = nowIso();
    Object.assign(job, { status: "failed", error: "Cancelled by an administrator.", finishedAt: now });
    patchBlock(db, job.lessonId, job.blockId, (b) => ({ ...b, transcode: settledState(b, "Cancelled by an administrator.", now) }));
    return true;
  });
}

/** Block state after a job stopped without output: ready when an earlier version still plays, else failed. */
function settledState(block: VideoBlock, error: string, now: string): VideoTranscodeState {
  if (block.hlsUrl && block.storageKey && block.storageKey === transcodeSourceKey(block.src, siteOrigins())) {
    return { status: "ready", progress: 100, renditions: block.transcode?.renditions, updatedAt: now };
  }
  return { status: "failed", progress: block.transcode?.progress, error, renditions: block.transcode?.renditions, updatedAt: now };
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

/** Latest job of a block. */
export function latestJobFor(db: Pick<Database, "transcodeJobs">, lessonId: string, blockId: string): TranscodeJob | null {
  let latest: TranscodeJob | null = null;
  for (const job of db.transcodeJobs) {
    if (job.lessonId !== lessonId || job.blockId !== blockId) continue;
    if (!latest || job.createdAt > latest.createdAt) latest = job;
  }
  return latest;
}

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

/** Requeue jobs orphaned by a restart and claim the oldest queued job. */
async function claimNextJob(): Promise<TranscodeJob | null> {
  return mutate((db) => {
    for (const job of db.transcodeJobs) {
      if (job.status === "running" && worker.current?.jobId !== job.id) Object.assign(job, { status: "queued", progress: 0 });
    }
    const next = db.transcodeJobs.filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;
    Object.assign(next, { status: "running", progress: 0, attempts: next.attempts + 1, startedAt: nowIso(), error: undefined, finishedAt: undefined });
    return { ...next };
  });
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
  worker.current = { jobId: job.id, abort, heights: [], speed: null };
  const workDir = path.join(/* turbopackIgnore: true */ uploadRoot(), ".transcode", job.id);
  let published: string | null = null;
  try {
    const db = await getDb();
    const lesson = db.lessons.find((l) => l.id === job.lessonId);
    const block = findVideoBlock(lesson, job.blockId);
    if (!block || transcodeSourceKey(block.src, siteOrigins()) !== job.sourceKey) throw new TranscodeCancelled("The video was removed or replaced before it was converted.");

    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg.available) throw new FfmpegError(`ffmpeg is not available: ${ffmpeg.error ?? "unknown error"}`);

    await mutate((d) => patchBlock(d, job.lessonId, job.blockId, (b) => ({ ...b, transcode: { status: "processing", progress: 0, renditions: b.transcode?.renditions, updatedAt: nowIso() } })));

    const settings = await getSettings();
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
          patchBlock(d, job.lessonId, job.blockId, (b) =>
            b.transcode?.status === "processing" ? { ...b, transcode: { ...b.transcode, progress: percent, updatedAt: nowIso() } } : null,
          );
        });
      },
    });

    // Poster frame: nice to have, never fails the job.
    let posterMade = false;
    try {
      await runFfmpeg(buildPosterArgs(source.input, probe), { cwd: workDir, signal: abort.signal, stallMs: 120_000, timeoutMs: 180_000 });
      posterMade = true;
    } catch (err) {
      if (abort.signal.aborted) throw err;
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
    const prefix = `${hlsKeyPrefix(job.lessonId, job.blockId)}${version}/`;
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
      const posterKey = `posters/${job.lessonId}/${job.blockId}-${version}.jpg`;
      await storage.putFile(posterKey, path.join(/* turbopackIgnore: true */ workDir, POSTER_FILE), { contentType: "image/jpeg", move: true, cacheControl: "public, max-age=31536000, immutable" });
      posterUrl = uploadUrlForKey(posterKey);
    }

    // Switch the block to the new version (only if it still plays the same file).
    const origins = siteOrigins();
    const outcome = await mutate((d) => {
      let previous: string | null = null;
      const now = nowIso();
      const ok = patchBlock(d, job.lessonId, job.blockId, (b) => {
        if (transcodeSourceKey(b.src, origins) !== job.sourceKey) return null;
        previous = hlsVersionPrefix(b.hlsUrl, origins);
        return {
          ...b,
          hlsUrl: uploadUrlForKey(`${prefix}${MASTER_PLAYLIST}`),
          storageKey: job.sourceKey,
          transcode: { status: "ready", progress: 100, renditions: variants.map((v) => ({ height: v.height, bandwidth: v.bandwidth })), updatedAt: now },
          duration: b.duration ?? (probe.duration > 0 ? Math.round(probe.duration) : undefined),
          posterUrl: b.posterUrl || posterUrl || undefined,
        };
      });
      const row = d.transcodeJobs.find((j) => j.id === job.id);
      if (row) Object.assign(row, ok ? { status: "done", progress: 100, finishedAt: now, error: undefined } : { status: "failed", error: "The video was replaced while it was being converted.", finishedAt: now });
      return { ok, previous: previous as string | null };
    });
    if (!outcome.ok) {
      await storage.deletePrefix(prefix).catch(() => undefined);
      return;
    }
    published = null;
    if (outcome.previous && outcome.previous !== prefix) await deleteHlsVersion(outcome.previous);

    await notifyInstructors(job, "ready", `Converted to ${renditionLabel(variants.map((v) => v.height))}.`);
    await onVideoReady(job.lessonId, job.blockId);
  } catch (err) {
    const cancelled = abort.signal.aborted || err instanceof TranscodeCancelled;
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof FfmpegError && err.stderr ? `${message}\n${err.stderr}` : message;
    if (!(err instanceof FfmpegError) && !cancelled) console.error("[transcode] job failed:", job.id, message);
    await mutate((d) => {
      const now = nowIso();
      const row = d.transcodeJobs.find((j) => j.id === job.id);
      if (row) Object.assign(row, { status: "failed", error: tailText(detail, MAX_ERROR_CHARS), finishedAt: now });
      patchBlock(d, job.lessonId, job.blockId, (b) => (transcodeSourceKey(b.src, siteOrigins()) === job.sourceKey ? { ...b, transcode: settledState(b, message, now) } : null));
    });
    if (published) await getStorage().deletePrefix(published).catch(() => undefined);
    if (!cancelled) await notifyInstructors(job, "failed", message);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    worker.current = null;
  }
}

async function deleteHlsVersion(prefix: string): Promise<void> {
  // An old version may sit on local disk (before switching to S3) or in the bucket.
  await Promise.all([localStorage().deletePrefix(prefix).catch(() => 0), getStorage().kind === "s3" ? getStorage().deletePrefix(prefix).catch(() => 0) : Promise.resolve(0)]);
}

async function notifyInstructors(job: TranscodeJob, outcome: "ready" | "failed", detail: string): Promise<void> {
  try {
    const db = await getDb();
    const lesson = db.lessons.find((l) => l.id === job.lessonId);
    const course = lesson ? db.courses.find((c) => c.id === lesson.courseId) : null;
    if (!lesson || !course) return;
    const recipients = Array.from(new Set([...course.instructorIds, course.createdById])).filter(Boolean);
    await notifyMany(recipients, {
      type: "system",
      subject: outcome === "ready" ? `Video ready: ${lesson.title}` : `Video conversion failed: ${lesson.title}`,
      message: outcome === "ready" ? `${detail} Learners now get adaptive streaming.` : `${detail.split("\n")[0]} Learners still get the original file. Open the lesson to retry.`,
      link: `/admin/courses/${course.id}/lessons/${lesson.id}`,
      // Success is informational only; failures also go out by email.
      email: outcome === "failed",
      dedupeKey: `transcode:${job.id}:${outcome}`,
    });
  } catch (err) {
    console.error("[transcode] could not notify instructors:", err instanceof Error ? err.message : err);
  }
}

/**
 * Hook point run after a video's HLS version is published: starts automatic
 * captions when the transcripts module is present (it is optional, so it is
 * loaded dynamically and its absence is not an error).
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

/** Remove finished jobs older than the retention period (the newest job of each block stays). */
export async function pruneTranscodeJobs(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - JOB_RETENTION_DAYS * 86_400_000).toISOString();
  return mutate((db) => {
    const newest = new Map<string, string>();
    for (const j of db.transcodeJobs) {
      const k = `${j.lessonId}|${j.blockId}`;
      if ((newest.get(k) ?? "") < j.createdAt) newest.set(k, j.createdAt);
    }
    const before = db.transcodeJobs.length;
    db.transcodeJobs = db.transcodeJobs.filter((j) => isActive(j) || j.createdAt >= cutoff || newest.get(`${j.lessonId}|${j.blockId}`) === j.createdAt);
    return before - db.transcodeJobs.length;
  });
}

/**
 * Delete HLS versions no lesson block points at any more (deleted lessons or
 * blocks, replaced videos). Versions younger than a day are kept so a job
 * being published is never touched.
 */
export async function cleanupOrphanedHls(now = Date.now()): Promise<number> {
  const db = await getDb();
  const origins = siteOrigins();
  const referenced = new Set<string>();
  for (const lesson of db.lessons) {
    for (const block of lesson.blocks) {
      if (block.type !== "video") continue;
      const prefix = hlsVersionPrefix(block.hlsUrl, origins);
      if (prefix) referenced.add(prefix);
    }
  }
  let removed = 0;
  const minAge = 86_400_000;

  // Local disk: videos/<lesson>/<block>/hls/<version>/
  const videosDir = path.join(/* turbopackIgnore: true */ uploadRoot(), "videos");
  const lessons = await fs.readdir(videosDir, { withFileTypes: true }).catch(() => []);
  for (const l of lessons) {
    if (!l.isDirectory()) continue;
    const blocks = await fs.readdir(path.join(/* turbopackIgnore: true */ videosDir, l.name), { withFileTypes: true }).catch(() => []);
    for (const b of blocks) {
      if (!b.isDirectory()) continue;
      const hlsDir = path.join(/* turbopackIgnore: true */ videosDir, l.name, b.name, "hls");
      const versions = await fs.readdir(hlsDir, { withFileTypes: true }).catch(() => []);
      for (const v of versions) {
        if (!v.isDirectory()) continue;
        const prefix = `videos/${l.name}/${b.name}/hls/${v.name}/`;
        if (referenced.has(prefix)) continue;
        const stat = await fs.stat(path.join(/* turbopackIgnore: true */ hlsDir, v.name)).catch(() => null);
        if (!stat || now - stat.mtimeMs < minAge) continue;
        removed += await localStorage().deletePrefix(prefix).catch(() => 0);
      }
    }
  }

  // Bucket: group keys by version folder.
  const storage = getStorage();
  const client = s3Client();
  if (storage.kind === "s3" && client) {
    const keys = await client.listKeys("videos/").catch(() => [] as string[]);
    const prefixes = new Set<string>();
    for (const key of keys) {
      const m = /^(videos\/[^/]+\/[^/]+\/hls\/[^/]+\/)/.exec(key);
      if (m) prefixes.add(m[1]!);
    }
    for (const prefix of prefixes) {
      if (referenced.has(prefix)) continue;
      // A version without its master playlist is still being published (or failed half-way): judge it by age only when the master exists.
      const master = await client.headObject(`${prefix}${MASTER_PLAYLIST}`).catch(() => null);
      if (!master?.lastModified || now - master.lastModified.getTime() < minAge) continue;
      removed += await storage.deletePrefix(prefix).catch(() => 0);
    }
  }
  return removed;
}
