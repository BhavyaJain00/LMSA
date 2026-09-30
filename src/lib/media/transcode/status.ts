import "server-only";
import type { Course, Lesson, User, VideoTranscodeState } from "@/lib/types";
import { getDb, getSettings } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { siteOrigins } from "../access";
import { detectFfmpeg, FFMPEG_INSTALL_HINT } from "./ffmpeg";
import { SAFE_ID, hlsMatchesSource, transcodeSourceKey, type VideoBlock } from "./lesson-fields";
import { enqueueTranscode, isWorkerRunning, jobView, kickTranscodeWorker, latestJobFor, type TranscodeJobView } from "./queue";

/**
 * What the lesson editor shows under a video block: conversion state, the
 * latest job, ffmpeg availability and links. Shared by
 * `GET /api/media/status` and the editor's server actions.
 */

export interface BlockMediaStatus {
  lessonId: string;
  blockId: string;
  courseId: string;
  /** Adaptive streaming is switched on in Settings → Storage & video. */
  enabled: boolean;
  ffmpeg: { available: boolean; error: string | null; hint: string | null };
  /** The block plays a file uploaded to this site that ffmpeg can convert. */
  convertible: boolean;
  /** The block exists in the saved lesson (unsaved blocks cannot be converted yet). */
  saved: boolean;
  /** Video URL of the saved block (the editor compares it with unsaved edits). */
  savedSrc: string | null;
  transcode: VideoTranscodeState | null;
  /** An HLS stream made from the current file exists. */
  hlsReady: boolean;
  job: TranscodeJobView | null;
  /** Rendition heights configured in settings (what a new conversion produces, capped at the source height). */
  configuredRenditions: number[];
  transcriptId: string | null;
  transcriptHref: string;
  editHref: string;
}

export type StatusLookup = { ok: true; status: BlockMediaStatus } | { ok: false; status: 400 | 403 | 404; error: string };

/** Find a lesson holding `blockId` (block ids are unique), optionally checking the lesson id. */
function locate(lessons: readonly Lesson[], blockId: string, lessonId: string | null): { lesson: Lesson; block: VideoBlock } | null {
  const pool = lessonId ? lessons.filter((l) => l.id === lessonId) : lessons;
  for (const lesson of pool) {
    const block = lesson.blocks.find((b) => b.id === blockId);
    if (block?.type === "video") return { lesson, block };
  }
  return null;
}

/**
 * Status of a video block for a course manager. With `autoQueue`, a saved
 * upload that has never been converted is queued now (the editor polls this,
 * so conversions start even when nothing else triggered them).
 */
export async function getBlockMediaStatus(user: User | null, lessonId: string | null, blockId: string, opts: { autoQueue?: boolean } = {}): Promise<StatusLookup> {
  if (!SAFE_ID.test(blockId) || (lessonId !== null && !SAFE_ID.test(lessonId))) return { ok: false, status: 400, error: "Invalid lesson or block." };
  let db = await getDb();
  let found = locate(db.lessons, blockId, lessonId);
  const course: Course | undefined = found ? db.courses.find((c) => c.id === found!.lesson.courseId) : undefined;
  if (found && course && !canManageCourse(user, course)) return { ok: false, status: 403, error: "You can't manage this course." };
  if (lessonId && !found) {
    // The block is not saved yet: report what the editor can do once it is.
    const lesson = db.lessons.find((l) => l.id === lessonId);
    const owner = lesson ? db.courses.find((c) => c.id === lesson.courseId) : undefined;
    if (!lesson || !owner) return { ok: false, status: 404, error: "This lesson no longer exists." };
    if (!canManageCourse(user, owner)) return { ok: false, status: 403, error: "You can't manage this course." };
    return { ok: true, status: await unsavedStatus(lesson, owner, blockId) };
  }
  if (!found || !course) return { ok: false, status: 404, error: "This video block no longer exists." };

  const settings = await getSettings();
  const origins = siteOrigins();
  const key = transcodeSourceKey(found.block.src, origins);
  if (opts.autoQueue && settings.storage.transcodeToHls && key) {
    const latest = latestJobFor(db, found.lesson.id, blockId);
    const needs = !hlsMatchesSource(found.block, origins) && (!latest || latest.sourceKey !== key || latest.status === "done");
    if (needs) {
      await enqueueTranscode(found.lesson.id, blockId);
      db = await getDb();
      found = locate(db.lessons, blockId, found.lesson.id) ?? found;
    } else if (latest && latest.status === "queued" && !isWorkerRunning()) {
      kickTranscodeWorker();
    }
  }

  const ffmpeg = await detectFfmpeg();
  const latest = latestJobFor(db, found.lesson.id, blockId);
  const job = latest && latest.sourceKey === key ? jobView(latest, db.transcodeJobs) : null;
  return {
    ok: true,
    status: {
      lessonId: found.lesson.id,
      blockId,
      courseId: course.id,
      enabled: settings.storage.transcodeToHls,
      ffmpeg: { available: ffmpeg.available, error: ffmpeg.error, hint: ffmpeg.available ? null : FFMPEG_INSTALL_HINT },
      convertible: !!key,
      saved: true,
      savedSrc: found.block.src,
      transcode: found.block.transcode ?? null,
      hlsReady: hlsMatchesSource(found.block, origins),
      job,
      configuredRenditions: settings.storage.renditions,
      transcriptId: found.block.transcriptId ?? null,
      transcriptHref: transcriptHref(course.id, found.lesson.id, blockId),
      editHref: `/admin/courses/${course.id}/lessons/${found.lesson.id}`,
    },
  };
}

function transcriptHref(courseId: string, lessonId: string, blockId: string): string {
  return `/admin/courses/${courseId}/lessons/${lessonId}/transcript?block=${encodeURIComponent(blockId)}`;
}

async function unsavedStatus(lesson: Lesson, course: Course, blockId: string): Promise<BlockMediaStatus> {
  const settings = await getSettings();
  const ffmpeg = await detectFfmpeg();
  return {
    lessonId: lesson.id,
    blockId,
    courseId: course.id,
    enabled: settings.storage.transcodeToHls,
    ffmpeg: { available: ffmpeg.available, error: ffmpeg.error, hint: ffmpeg.available ? null : FFMPEG_INSTALL_HINT },
    convertible: false,
    saved: false,
    savedSrc: null,
    transcode: null,
    hlsReady: false,
    job: null,
    configuredRenditions: settings.storage.renditions,
    transcriptId: null,
    transcriptHref: transcriptHref(course.id, lesson.id, blockId),
    editHref: `/admin/courses/${course.id}/lessons/${lesson.id}`,
  };
}
