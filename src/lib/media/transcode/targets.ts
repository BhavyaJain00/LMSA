import type { Course, Database, TranscodeJob, TranscodeTarget, VideoTranscodeState } from "@/lib/types";
import { SAFE_ID, hlsKeyPrefix, hlsMatchesSource, hlsVersionPrefix, transcodeSourceKey, type VideoBlock } from "./lesson-fields";

/**
 * Transcode targets (pure; unit tested).
 *
 * A job converts either a lesson video block (`videos/<lessonId>/<blockId>/hls/`)
 * or a course's preview video (`videos/course/<courseId>/preview/hls/`). The
 * queue reads and writes both through the same small "media" view so the
 * worker, retries, cancels and restart recovery treat them alike:
 *
 *  | media field  | lesson video block | course preview       |
 *  |--------------|--------------------|----------------------|
 *  | src          | `src`              | `videoUrl`           |
 *  | hlsUrl       | `hlsUrl`           | `previewHlsUrl`      |
 *  | storageKey   | `storageKey`       | `previewStorageKey`  |
 *  | transcode    | `transcode`        | `previewTranscode`   |
 *  | posterUrl    | `posterUrl`        | `previewPosterUrl`   |
 *  | duration     | `duration`         | (not stored)         |
 */

export const COURSE_PREVIEW_ROOT = "course";
export const COURSE_PREVIEW_DIR = "preview";

export function lessonBlockTarget(lessonId: string, blockId: string): TranscodeTarget {
  return { kind: "lesson-block", lessonId, blockId };
}

export function coursePreviewTarget(courseId: string): TranscodeTarget {
  return { kind: "course-preview", courseId };
}

/** Key prefix holding every HLS version of a course's preview video: `videos/course/<courseId>/preview/hls/`. */
export function coursePreviewKeyPrefix(courseId: string): string {
  if (!SAFE_ID.test(courseId)) throw new Error("Invalid course id for a storage path.");
  return `videos/${COURSE_PREVIEW_ROOT}/${courseId}/${COURSE_PREVIEW_DIR}/hls/`;
}

/** Key prefix holding every HLS version of a target. */
export function hlsPrefixFor(target: TranscodeTarget): string {
  return target.kind === "course-preview" ? coursePreviewKeyPrefix(target.courseId) : hlsKeyPrefix(target.lessonId, target.blockId);
}

/** Storage key of the poster frame captured for one HLS version. */
export function posterKeyFor(target: TranscodeTarget, version: string): string {
  if (!SAFE_ID.test(version)) throw new Error("Invalid HLS version for a storage path.");
  if (target.kind === "course-preview") {
    if (!SAFE_ID.test(target.courseId)) throw new Error("Invalid course id for a storage path.");
    return `posters/${COURSE_PREVIEW_ROOT}/${target.courseId}/${COURSE_PREVIEW_DIR}-${version}.jpg`;
  }
  if (!SAFE_ID.test(target.lessonId) || !SAFE_ID.test(target.blockId)) throw new Error("Invalid lesson or block id for a storage path.");
  return `posters/${target.lessonId}/${target.blockId}-${version}.jpg`;
}

/** What a job converts (jobs without a target are lesson block jobs). */
export function jobTarget(job: Pick<TranscodeJob, "target" | "lessonId" | "blockId">): TranscodeTarget {
  const t = job.target;
  if (t?.kind === "course-preview") return { kind: "course-preview", courseId: t.courseId };
  if (t?.kind === "lesson-block") return { kind: "lesson-block", lessonId: t.lessonId, blockId: t.blockId };
  return { kind: "lesson-block", lessonId: job.lessonId, blockId: job.blockId };
}

/** Stable identity of a target, for grouping jobs ("lesson:<l>/<b>", "course:<c>"). */
export function targetId(target: TranscodeTarget): string {
  return target.kind === "course-preview" ? `course:${target.courseId}` : `lesson:${target.lessonId}/${target.blockId}`;
}

export function jobTargetId(job: Pick<TranscodeJob, "target" | "lessonId" | "blockId">): string {
  return targetId(jobTarget(job));
}

export function isJobFor(job: Pick<TranscodeJob, "target" | "lessonId" | "blockId">, target: TranscodeTarget): boolean {
  return jobTargetId(job) === targetId(target);
}

/** Identity fields of a new job for a target (lesson ids stay filled for lesson jobs, as before). */
export function jobIdentity(target: TranscodeTarget): Pick<TranscodeJob, "target" | "lessonId" | "blockId"> {
  return target.kind === "course-preview"
    ? { target: { kind: "course-preview", courseId: target.courseId }, lessonId: "", blockId: "" }
    : { target: { kind: "lesson-block", lessonId: target.lessonId, blockId: target.blockId }, lessonId: target.lessonId, blockId: target.blockId };
}

/** Newest job of a target. */
export function latestJobForTarget(jobs: readonly TranscodeJob[], target: TranscodeTarget): TranscodeJob | null {
  const id = targetId(target);
  let latest: TranscodeJob | null = null;
  for (const job of jobs) {
    if (jobTargetId(job) !== id) continue;
    if (!latest || job.createdAt > latest.createdAt) latest = job;
  }
  return latest;
}

/* ------------------------------------------------------------------ */
/* Course preview fields                                                */
/* ------------------------------------------------------------------ */

export type CoursePreviewFields = Pick<Course, "videoUrl" | "previewHlsUrl" | "previewStorageKey">;

/** Storage key of a course's uploaded preview video, or null when it is a link or not convertible. */
export function coursePreviewSourceKey(course: Pick<Course, "videoUrl">, siteOrigins: readonly string[] = []): string | null {
  return transcodeSourceKey(course.videoUrl, siteOrigins);
}

/** The preview's HLS stream was made from its current video file. */
export function coursePreviewHlsMatches(course: CoursePreviewFields, siteOrigins: readonly string[] = []): boolean {
  return hlsMatchesSource({ src: course.videoUrl ?? "", hlsUrl: course.previewHlsUrl, storageKey: course.previewStorageKey }, siteOrigins);
}

/** HLS master playlist to play for the preview, or undefined (no stream, or one made from a replaced file). */
export function coursePreviewHlsUrl(course: CoursePreviewFields, siteOrigins: readonly string[] = []): string | undefined {
  return course.previewHlsUrl && coursePreviewHlsMatches(course, siteOrigins) ? course.previewHlsUrl : undefined;
}

/* ------------------------------------------------------------------ */
/* Reading and writing a target's media fields                          */
/* ------------------------------------------------------------------ */

export interface TargetMedia {
  src?: string;
  hlsUrl?: string;
  storageKey?: string;
  transcode?: VideoTranscodeState;
  posterUrl?: string;
  duration?: number;
}

/** Fields to change; a key present with `undefined` removes the field. */
export type TargetMediaPatch = Partial<Omit<TargetMedia, "src">>;

type TargetDb = Pick<Database, "lessons" | "courses">;

function findBlock(db: TargetDb, lessonId: string, blockId: string): VideoBlock | null {
  const block = db.lessons.find((l) => l.id === lessonId)?.blocks.find((b) => b.id === blockId);
  return block?.type === "video" ? block : null;
}

/** Current media fields of a target, or null when it no longer exists. */
export function readTargetMedia(db: TargetDb, target: TranscodeTarget): TargetMedia | null {
  if (target.kind === "course-preview") {
    const course = (db.courses ?? []).find((c) => c.id === target.courseId);
    if (!course) return null;
    return { src: course.videoUrl, hlsUrl: course.previewHlsUrl, storageKey: course.previewStorageKey, transcode: course.previewTranscode, posterUrl: course.previewPosterUrl };
  }
  const block = findBlock(db, target.lessonId, target.blockId);
  if (!block) return null;
  return { src: block.src, hlsUrl: block.hlsUrl, storageKey: block.storageKey, transcode: block.transcode, posterUrl: block.posterUrl, duration: block.duration };
}

function applyPatch<T extends object>(record: T, patch: TargetMediaPatch, names: Partial<Record<keyof TargetMediaPatch, string>>): T {
  const out = { ...record } as Record<string, unknown>;
  for (const [field, value] of Object.entries(patch) as [keyof TargetMediaPatch, unknown][]) {
    const name = names[field];
    if (!name) continue;
    if (value === undefined) delete out[name];
    else out[name] = value;
  }
  return out as T;
}

const BLOCK_FIELDS: Record<keyof TargetMediaPatch, string> = { hlsUrl: "hlsUrl", storageKey: "storageKey", transcode: "transcode", posterUrl: "posterUrl", duration: "duration" };
const COURSE_FIELDS: Partial<Record<keyof TargetMediaPatch, string>> = {
  hlsUrl: "previewHlsUrl",
  storageKey: "previewStorageKey",
  transcode: "previewTranscode",
  posterUrl: "previewPosterUrl",
};

/**
 * Change a target's media fields inside a mutation. `fn` sees the current
 * fields and returns a patch, or null to leave the target alone. Returns
 * false when the target is gone or `fn` declined.
 */
export function patchTargetMedia(db: TargetDb, target: TranscodeTarget, fn: (media: TargetMedia) => TargetMediaPatch | null): boolean {
  if (target.kind === "course-preview") {
    const index = (db.courses ?? []).findIndex((c) => c.id === target.courseId);
    if (index === -1) return false;
    const media = readTargetMedia(db, target)!;
    const patch = fn(media);
    if (!patch) return false;
    db.courses[index] = applyPatch(db.courses[index]!, patch, COURSE_FIELDS);
    return true;
  }
  const lesson = db.lessons.find((l) => l.id === target.lessonId);
  if (!lesson) return false;
  let changed = false;
  lesson.blocks = lesson.blocks.map((b) => {
    if (b.id !== target.blockId || b.type !== "video") return b;
    const patch = fn(readTargetMedia(db, target)!);
    if (!patch) return b;
    changed = true;
    return applyPatch(b, patch, BLOCK_FIELDS);
  });
  return changed;
}

/** The target's HLS output was made from its current file. */
export function mediaHlsMatches(media: TargetMedia, siteOrigins: readonly string[] = []): boolean {
  return hlsMatchesSource({ src: media.src ?? "", hlsUrl: media.hlsUrl, storageKey: media.storageKey }, siteOrigins);
}

/** State after a job stopped without output: ready when an earlier version still plays, else failed. */
export function settledState(media: TargetMedia, error: string, now: string, siteOrigins: readonly string[] = []): VideoTranscodeState {
  if (media.hlsUrl && media.storageKey && media.storageKey === transcodeSourceKey(media.src, siteOrigins)) {
    return { status: "ready", progress: 100, renditions: media.transcode?.renditions, updatedAt: now };
  }
  return { status: "failed", progress: media.transcode?.progress, error, renditions: media.transcode?.renditions, updatedAt: now };
}

/** Every HLS version folder some lesson block or course preview points at. */
export function referencedHlsVersions(db: TargetDb, siteOrigins: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  for (const lesson of db.lessons) {
    for (const block of lesson.blocks) {
      if (block.type !== "video") continue;
      const prefix = hlsVersionPrefix(block.hlsUrl, siteOrigins);
      if (prefix) out.add(prefix);
    }
  }
  for (const course of db.courses ?? []) {
    const prefix = hlsVersionPrefix(course.previewHlsUrl, siteOrigins);
    if (prefix) out.add(prefix);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Planning a new job                                                   */
/* ------------------------------------------------------------------ */

export type EnqueuePlan =
  | { action: "refuse"; reason: "not-found" | "not-upload"; message: string }
  | { action: "unavailable"; sourceKey: string; stale: boolean; message: string }
  | { action: "reuse"; job: TranscodeJob }
  | { action: "skip"; reason: "ready" | "failed"; message: string }
  | { action: "create"; sourceKey: string; stale: boolean; obsoleteJobIds: string[] };

export const UNAVAILABLE_MESSAGE = "ffmpeg is not installed on the server, so the original file is played.";

/**
 * Decide what queueing a conversion of `target` does:
 *  - the target is gone, or plays a link rather than an upload → refuse;
 *  - no ffmpeg → mark it "unavailable" (the original file keeps playing);
 *  - a queued/running job for the same file → reuse it;
 *  - without `force`: a stream made from this file is ready, or the last
 *    conversion of this file failed → skip (retries are explicit);
 *  - otherwise create a job; queued jobs for an older file are obsolete, and
 *    `stale` says the stored stream belongs to a replaced file.
 */
export function planEnqueue(args: {
  target: TranscodeTarget;
  media: TargetMedia | null;
  jobs: readonly TranscodeJob[];
  ffmpegAvailable: boolean;
  force?: boolean;
  siteOrigins?: readonly string[];
}): EnqueuePlan {
  const { target, media } = args;
  const origins = args.siteOrigins ?? [];
  if (!media) {
    return {
      action: "refuse",
      reason: "not-found",
      message: target.kind === "course-preview" ? "This course no longer exists." : "This video block no longer exists. Save the lesson first.",
    };
  }
  const key = transcodeSourceKey(media.src, origins);
  if (!key) return { action: "refuse", reason: "not-upload", message: "Only videos uploaded to this site can be converted." };
  const stale = !!media.storageKey && media.storageKey !== key;
  if (!args.ffmpegAvailable) return { action: "unavailable", sourceKey: key, stale, message: UNAVAILABLE_MESSAGE };

  const own = args.jobs.filter((j) => isJobFor(j, target));
  const active = own.find((j) => (j.status === "queued" || j.status === "running") && j.sourceKey === key);
  if (active) return { action: "reuse", job: active };
  if (!args.force) {
    if (media.hlsUrl && media.storageKey === key && media.transcode?.status === "ready") return { action: "skip", reason: "ready", message: "This video is already converted." };
    const last = own.filter((j) => j.sourceKey === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (last?.status === "failed") return { action: "skip", reason: "failed", message: last.error?.split("\n")[0] ?? "The last conversion failed." };
  }
  const obsoleteJobIds = own.filter((j) => j.status === "queued" && j.sourceKey !== key).map((j) => j.id);
  return { action: "create", sourceKey: key, stale, obsoleteJobIds };
}

/** Whether a target still needs a conversion of its current upload (sync after saves and by the cron). */
export function needsConversion(media: TargetMedia | null, siteOrigins: readonly string[] = []): boolean {
  if (!media) return false;
  const key = transcodeSourceKey(media.src, siteOrigins);
  return !!key && !(media.hlsUrl && media.storageKey === key && media.transcode?.status === "ready");
}

/* ------------------------------------------------------------------ */
/* Releasing output of a replaced or removed video                      */
/* ------------------------------------------------------------------ */

export interface StaleOutputPlan {
  /** Fields to clear on the target, or null when its stored output still belongs to its video. */
  patch: TargetMediaPatch | null;
  /** HLS version folder that stops being played (delete it unless something else plays it). */
  releasedVersion: string | null;
  /** Generated poster that stops being shown (course previews only). */
  releasedPoster: string | null;
  /** Queued jobs converting a file the target no longer plays. */
  obsoleteJobIds: string[];
  /** Running job converting a file the target no longer plays (abort it). */
  abortJobId: string | null;
}

/**
 * What to clean up when a target no longer plays the file its stored output
 * was made from (a new upload, a link, or no video at all):
 *  - the HLS URL, its source key and the conversion state are cleared, and
 *    the HLS version folder is released;
 *  - a course preview's generated poster is released as well (a lesson
 *    block's poster may have been set by the editor and is left alone);
 *  - a conversion state left behind by a job for an older file (pending,
 *    processing or failed) is cleared even without stored output;
 *  - queued jobs for older files become obsolete and a running one is aborted.
 * The conversion of the current file, if any, is queued separately.
 */
export function planStaleOutputRelease(args: {
  target: TranscodeTarget;
  media: TargetMedia | null;
  jobs: readonly TranscodeJob[];
  siteOrigins?: readonly string[];
}): StaleOutputPlan {
  const { target, media } = args;
  const origins = args.siteOrigins ?? [];
  const none: StaleOutputPlan = { patch: null, releasedVersion: null, releasedPoster: null, obsoleteJobIds: [], abortJobId: null };
  if (!media) return none;
  const key = transcodeSourceKey(media.src, origins);
  const own = args.jobs.filter((j) => isJobFor(j, target));
  const obsoleteJobIds = own.filter((j) => j.status === "queued" && j.sourceKey !== key).map((j) => j.id);
  const abortJobId = own.find((j) => j.status === "running" && j.sourceKey !== key)?.id ?? null;

  const outputStale = !!(media.hlsUrl || media.storageKey) && (!key || media.storageKey !== key);
  let patch: TargetMediaPatch | null = null;
  let releasedVersion: string | null = null;
  let releasedPoster: string | null = null;
  if (outputStale) {
    patch = { hlsUrl: undefined, storageKey: undefined, transcode: undefined };
    releasedVersion = hlsVersionPrefix(media.hlsUrl, origins);
    if (target.kind === "course-preview" && media.posterUrl) {
      patch.posterUrl = undefined;
      releasedPoster = media.posterUrl;
    }
  } else if (media.transcode && !media.hlsUrl) {
    const latest = latestJobForTarget(args.jobs, target);
    const state = media.transcode.status;
    // "unavailable" describes the server (no ffmpeg), not a file: it only goes when there is nothing to convert.
    const leftover = state === "unavailable" ? !key : !key || (!!latest && latest.sourceKey !== key);
    if (leftover) patch = { transcode: undefined };
  }
  return { patch, releasedVersion, releasedPoster, obsoleteJobIds, abortJobId };
}
