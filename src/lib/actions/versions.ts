"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, Lesson, User } from "@/lib/types";
import { findById, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { touchCourseContent, withReviewNote } from "@/lib/data/admin-courses";
import { audit } from "@/lib/audit";
import { getVersionDiff, getVersionTimeline, restoreLessonVersion } from "@/lib/teaching/versions";
import { CURRENT_VERSION_ID, cleanVersionNote, type LessonDiff, type RestoredLesson, type VersionCompareMode, type VersionTimelineView } from "@/lib/teaching/version-shared";

/**
 * Lesson history panel of the lesson editor: list the kept versions, compare
 * them, restore one and label a version with a note. Everyone who may edit
 * the lesson may use its history.
 */

async function loadLesson(lessonId: unknown): Promise<{ user: User; course: Course; lesson: Lesson } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  if (typeof lessonId !== "string" || !lessonId) return { error: "This lesson no longer exists." };
  const lesson = await findById("lessons", lessonId);
  if (!lesson) return { error: "This lesson no longer exists." };
  const course = await findById("courses", lesson.courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to see the history of this lesson." };
  return { user, course, lesson };
}

/** Every kept state of the lesson, newest first. */
export async function loadLessonHistoryAction(lessonId: string): Promise<ActionResult<VersionTimelineView>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  return { ok: true, data: await getVersionTimeline(loaded.lesson) };
}

/**
 * Compare one state of the lesson: with the state before it ("changes") or
 * with the live lesson ("current"). `data` is null when there is nothing to
 * compare with (the oldest kept state, or the live lesson against itself).
 */
export async function loadLessonVersionDiffAction(lessonId: string, entryId: string, mode: VersionCompareMode): Promise<ActionResult<LessonDiff | null>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (typeof entryId !== "string" || !entryId) return { ok: false, error: "Pick a version to compare." };
  const compare: VersionCompareMode = mode === "current" ? "current" : "changes";
  const diff = await getVersionDiff(loaded.lesson, entryId, compare);
  if (diff === null && entryId !== CURRENT_VERSION_ID) {
    // Either the oldest kept state or a version that was pruned meanwhile.
    const timeline = await getVersionTimeline(loaded.lesson);
    if (!timeline.entries.some((entry) => entry.id === entryId)) return { ok: false, error: "This version is no longer kept. Reload the history." };
  }
  return { ok: true, data: diff };
}

export interface RestoreResult extends RestoredLesson {
  /** "Oct 3, 2026 at 09:15 UTC": when the restored content was saved ("" when unknown). */
  restoredFrom: string;
  /** Quiz, assignment or exercise blocks left out because their target was deleted. */
  skippedBlocks: number;
}

/**
 * Put a stored version back as the live lesson. The current content is kept
 * as a new version first, so the restore can be undone from the history too.
 */
export async function restoreLessonVersionAction(lessonId: string, versionId: string): Promise<ActionResult<RestoreResult>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (typeof versionId !== "string" || !versionId || versionId === CURRENT_VERSION_ID) return { ok: false, error: "Pick an earlier version to restore." };
  const { user, course, lesson } = loaded;

  const outcome = await mutate((db) => {
    const result = restoreLessonVersion(db, lesson.id, versionId, user, Date.now());
    const reviewReset = result.ok ? touchCourseContent(db, course.id, user) : false;
    return { result, reviewReset };
  });
  const { result, reviewReset } = outcome;
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === "unchanged" ? "The lesson already has this content, so there is nothing to restore." : "This version is no longer kept. Reload the history.",
    };
  }

  await audit(user, "lesson.version_restore", { type: "lesson", id: lesson.id }, {
    courseId: course.id,
    title: result.lesson.title,
    versionId,
    restoredFrom: result.restoredFrom,
    skippedBlocks: result.skippedBlocks,
  });
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath(`/admin/courses/${course.id}/lessons/${lesson.id}`);
  revalidatePath(`/courses/${course.slug}`, "layout");

  const base = withReviewNote("Version restored", reviewReset);
  const skipped = result.skippedBlocks
    ? `${base.endsWith(".") ? "" : "."} ${result.skippedBlocks === 1 ? "One block was" : `${result.skippedBlocks} blocks were`} left out because the quiz, assignment or exercise it used was deleted.`
    : "";
  return {
    ok: true,
    data: { ...result.lesson, restoredFrom: result.restoredFrom, skippedBlocks: result.skippedBlocks },
    message: `${base}${skipped}`,
  };
}

/** Label a stored version ("Before the rewrite of section 2"); an empty note removes it. */
export async function setLessonVersionNoteAction(lessonId: string, versionId: string, note: string): Promise<ActionResult<{ note: string | null }>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (typeof versionId !== "string" || !versionId) return { ok: false, error: "This version is no longer kept. Reload the history." };
  const clean = cleanVersionNote(note);

  const found = await mutate((db) => {
    const row = db.lessonVersions.find((v) => v.id === versionId && v.lessonId === loaded.lesson.id);
    if (!row) return false;
    if (clean) row.note = clean;
    else delete row.note;
    return true;
  });
  if (!found) return { ok: false, error: "This version is no longer kept. Reload the history." };
  return { ok: true, data: { note: clean || null }, message: clean ? "Note saved" : "Note removed" };
}
