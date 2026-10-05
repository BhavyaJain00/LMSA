import "server-only";
import type { Course, Lesson, User } from "@/lib/types";
import { getDb, getSettings } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { siteOrigins } from "../access";
import { detectFfmpeg, FFMPEG_INSTALL_HINT } from "./ffmpeg";
import { SAFE_ID, hlsMatchesSource, transcodeSourceKey, type VideoBlock } from "./lesson-fields";
import {
  enqueueTargetTranscode,
  enqueueTranscode,
  isWorkerRunning,
  jobView,
  kickTranscodeWorker,
  latestJobFor,
  latestJobForTarget,
  releaseStaleTargetOutput,
} from "./queue";
import type { MediaStatusCore } from "./status-view";
import { coursePreviewHlsMatches, coursePreviewTarget } from "./targets";

/**
 * What the editors show under a video: conversion state, the latest job,
 * ffmpeg availability and links — for a lesson video block (lesson editor)
 * or a course's preview video (course settings). Shared by
 * `GET /api/media/status` and the editors' server actions.
 */

export type { MediaStatusCore };

export interface BlockMediaStatus extends MediaStatusCore {
  lessonId: string;
  blockId: string;
  courseId: string;
  transcriptId: string | null;
  transcriptHref: string;
  editHref: string;
}

export type StatusLookup = { ok: true; status: BlockMediaStatus } | { ok: false; status: 400 | 403 | 404; error: string };

/** Conversion state of a course's preview video (`Course.videoUrl`). */
export interface CoursePreviewMediaStatus extends MediaStatusCore {
  courseId: string;
  /** Poster frame captured by the conversion (shown when the course has no cover image). */
  posterUrl: string | null;
  editHref: string;
}

export type CoursePreviewStatusLookup = { ok: true; status: CoursePreviewMediaStatus } | { ok: false; status: 400 | 403 | 404; error: string };

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

/**
 * Status of a course's preview video for a course manager. With `autoQueue`
 * (the course settings poll it), output made from a replaced or removed
 * video is released and a saved upload that has never been converted is
 * queued now, so conversions start even when nothing else triggered them.
 */
export async function getCoursePreviewMediaStatus(user: User | null, courseId: string, opts: { autoQueue?: boolean } = {}): Promise<CoursePreviewStatusLookup> {
  if (!SAFE_ID.test(courseId)) return { ok: false, status: 400, error: "Invalid course." };
  let db = await getDb();
  let course = db.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, status: 404, error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { ok: false, status: 403, error: "You can't manage this course." };

  const settings = await getSettings();
  const origins = siteOrigins();
  const target = coursePreviewTarget(courseId);
  if (opts.autoQueue) {
    const reload = async () => {
      db = await getDb();
      course = db.courses.find((c) => c.id === courseId) ?? course!;
    };
    if (await releaseStaleTargetOutput(target)) await reload();
    const key = transcodeSourceKey(course.videoUrl, origins);
    if (settings.storage.transcodeToHls && key) {
      const latest = latestJobForTarget(db.transcodeJobs, target);
      const needs = !coursePreviewHlsMatches(course, origins) && (!latest || latest.sourceKey !== key || latest.status === "done");
      if (needs) {
        await enqueueTargetTranscode(target);
        await reload();
      } else if (latest && latest.status === "queued" && !isWorkerRunning()) {
        kickTranscodeWorker();
      }
    }
  }

  const ffmpeg = await detectFfmpeg();
  const key = transcodeSourceKey(course.videoUrl, origins);
  const latest = latestJobForTarget(db.transcodeJobs, target);
  const job = latest && key && latest.sourceKey === key ? jobView(latest, db.transcodeJobs) : null;
  return {
    ok: true,
    status: {
      courseId: course.id,
      enabled: settings.storage.transcodeToHls,
      ffmpeg: { available: ffmpeg.available, error: ffmpeg.error, hint: ffmpeg.available ? null : FFMPEG_INSTALL_HINT },
      convertible: !!key,
      saved: true,
      savedSrc: course.videoUrl ?? "",
      transcode: course.previewTranscode ?? null,
      hlsReady: coursePreviewHlsMatches(course, origins),
      job,
      configuredRenditions: settings.storage.renditions,
      posterUrl: course.previewPosterUrl ?? null,
      editHref: `/admin/courses/${course.id}`,
    },
  };
}
