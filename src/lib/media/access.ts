import "server-only";
import type { Database, Lesson, User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { getDb } from "@/lib/db/store";
import { isEvaluator, isModerator, isStaff } from "@/lib/auth/session";
import { canViewCourse } from "@/lib/data/courses";
import { canManageBatch } from "@/lib/data/batches";
import { getLessonAccess, type LessonAccess } from "@/lib/data/lessons";
import { parseMediaSrc } from "./paths";

/**
 * Who may receive a signed URL for an uploaded video.
 *
 *  - Lesson videos: viewers who can open the lesson (enrolled learners on
 *    unlocked lessons, course managers, anyone on a free-preview lesson of a
 *    published course when guest access is on).
 *  - Course promo videos: anyone who can see the course page.
 *  - Live class recordings: learners of the batch, its managers and evaluators.
 *  - Files not referenced anywhere yet (fresh uploads in an editor): staff.
 *  - Moderators and admins: everything.
 */

export type MediaAccessDecision =
  | { ok: true; via: "lesson" | "course" | "recording" | "staff" }
  | { ok: false; status: 401 | 403 | 404; error: string };

const MAX_LESSON_CHECKS = 25;

/** Origins that count as "this site" when a src is an absolute URL. */
export function siteOrigins(requestOrigin?: string | null): string[] {
  const origins = [siteConfig.appUrl];
  if (requestOrigin) origins.push(requestOrigin);
  return origins;
}

/** Canonical path of a stored src when it is an upload on this site. */
export function uploadPathOf(src: string | undefined | null, origins: readonly string[] = siteOrigins()): string | null {
  if (!src) return null;
  const parsed = parseMediaSrc(src, origins);
  return parsed?.isUpload ? parsed.path : null;
}

/** Every video src of a lesson (main sources and extra qualities). */
export function lessonVideoSrcs(lesson: Pick<Lesson, "blocks">): string[] {
  const out: string[] = [];
  for (const block of lesson.blocks) {
    if (block.type !== "video") continue;
    if (block.src) out.push(block.src);
    for (const s of block.sources ?? []) if (s?.src) out.push(s.src);
  }
  return out;
}

/** Whether a lesson plays the upload at `path`. */
export function lessonReferencesPath(lesson: Pick<Lesson, "blocks">, path: string, origins: readonly string[] = siteOrigins()): boolean {
  return lessonVideoSrcs(lesson).some((src) => uploadPathOf(src, origins) === path);
}

/** The lesson is open to this viewer for playback purposes. */
export function canPlayLessonMedia(access: LessonAccess): boolean {
  if (access.manager || access.canView) return true;
  const { lesson, course, settings } = access;
  return lesson.includeInPreview && course.published && settings.learning.allowGuestAccess;
}

function deny(user: User | null, message: string): MediaAccessDecision {
  return user
    ? { ok: false, status: 403, error: message }
    : { ok: false, status: 401, error: "Sign in to watch this video." };
}

async function checkLesson(user: User | null, lessonId: string, path: string, origins: readonly string[]): Promise<MediaAccessDecision> {
  const access = await getLessonAccess(user, lessonId);
  if (!access) return { ok: false, status: 404, error: "This lesson no longer exists." };
  if (!lessonReferencesPath(access.lesson, path, origins)) return { ok: false, status: 403, error: "This video is not part of the lesson." };
  if (canPlayLessonMedia(access)) return { ok: true, via: "lesson" };
  if (access.lockReason === "sequential") return deny(user, "Complete the previous lessons to unlock this video.");
  return deny(user, access.enrolled ? "This lesson is not available yet." : "Enroll in the course to watch this video.");
}

function recordingAllowed(db: Database, user: User | null, batchId: string): boolean {
  if (!user) return false;
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return false;
  if (canManageBatch(user, batch) || isEvaluator(user)) return true;
  return db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === user.id);
}

/**
 * Decide whether `user` may play the upload at `path` (canonical). With a
 * `lessonId` the decision is scoped to that lesson; without one every place
 * that uses the file is considered.
 */
export async function authorizeMediaAccess(
  user: User | null,
  path: string,
  context: { lessonId?: string | null; requestOrigin?: string | null } = {},
): Promise<MediaAccessDecision> {
  const origins = siteOrigins(context.requestOrigin);
  if (isModerator(user)) return { ok: true, via: "staff" };
  if (context.lessonId) return checkLesson(user, context.lessonId, path, origins);

  const db = await getDb();
  let referenced = false;
  let lastDenied: MediaAccessDecision | null = null;

  const lessons = db.lessons.filter((l) => lessonReferencesPath(l, path, origins));
  if (lessons.length) referenced = true;
  for (const lesson of lessons.slice(0, MAX_LESSON_CHECKS)) {
    const decision = await checkLesson(user, lesson.id, path, origins);
    if (decision.ok) return decision;
    lastDenied = decision;
  }

  for (const course of db.courses) {
    if (uploadPathOf(course.videoUrl, origins) !== path) continue;
    referenced = true;
    if (canViewCourse(user, course)) return { ok: true, via: "course" };
  }

  for (const liveClass of db.liveClasses) {
    if (uploadPathOf(liveClass.recordingUrl, origins) !== path) continue;
    referenced = true;
    if (recordingAllowed(db, user, liveClass.batchId)) return { ok: true, via: "recording" };
  }

  if (!referenced) {
    if (isStaff(user)) return { ok: true, via: "staff" };
    return { ok: false, status: 404, error: "This video could not be found." };
  }
  if (lastDenied && !lastDenied.ok && lastDenied.status !== 404) return lastDenied;
  return deny(user, "You don't have access to this video.");
}
