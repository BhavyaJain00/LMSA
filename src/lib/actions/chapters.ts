"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Chapter, Course, User } from "@/lib/types";
import { findById, getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { recomputeEnrollmentProgress, renumberOutline, touchCourseContent, withReviewNote } from "@/lib/data/admin-courses";
import { fd, uid } from "@/lib/utils";
import { validateReleaseInput, type ReleaseRule } from "@/components/learn/drip-shared";

function revalidateOutline(course: Pick<Course, "id" | "slug">) {
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/admin/courses");
}

/** The message for the form-level error: the title error, else the release schedule error. */
function firstError(fieldErrors: Record<string, string>): string {
  return fieldErrors.title ?? fieldErrors.dripDays ?? fieldErrors.availableFrom ?? "Please fix the errors below.";
}

async function loadCourse(courseId: string): Promise<{ user: User; course: Course } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You are not permitted to manage chapters." };
  const course = await findById("courses", courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to modify this chapter." };
  return { user, course };
}

async function loadChapter(chapterId: string): Promise<{ user: User; course: Course; chapter: Chapter } | { error: string }> {
  const chapter = await findById("chapters", chapterId);
  if (!chapter) return { error: "This chapter no longer exists." };
  const loaded = await loadCourse(chapter.courseId);
  if ("error" in loaded) return loaded;
  return { ...loaded, chapter };
}

function validateChapter(formData: FormData): { title: string; description?: string; release: ReleaseRule | null; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const description = fd(formData, "description") || undefined;
  if (!title) fieldErrors.title = "Title is required";
  else if (title.length > 120) fieldErrors.title = "Keep the title under 120 characters.";
  if (description && description.length > 1000) fieldErrors.description = "Keep the description under 1,000 characters.";

  // Release schedule (drip): only when the form rendered the section, so older forms never clear it.
  let release: ReleaseRule | null = null;
  if (fd(formData, "releaseSchedule") === "1") {
    const parsed = validateReleaseInput({ dripDays: fd(formData, "dripDays"), availableFrom: fd(formData, "availableFrom") });
    if (parsed.ok) release = parsed.rule;
    else {
      if (parsed.errors.dripDays) fieldErrors.dripDays = parsed.errors.dripDays;
      if (parsed.errors.availableFrom) fieldErrors.availableFrom = parsed.errors.availableFrom;
    }
  }
  return { title, description, release, fieldErrors };
}

/** Write a validated release rule onto a chapter row (empty rule = available immediately). */
function applyRelease(row: Chapter, release: ReleaseRule | null): void {
  if (!release) return;
  if (release.dripDays) row.dripDays = release.dripDays;
  else delete row.dripDays;
  if (release.availableFrom) row.availableFrom = release.availableFrom;
  else delete row.availableFrom;
}

export async function createChapterAction(_prev: ActionResult<{ chapterId: string }> | null, formData: FormData): Promise<ActionResult<{ chapterId: string }>> {
  const loaded = await loadCourse(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  const { title, description, release, fieldErrors } = validateChapter(formData);
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  const chapterId = uid("chp");
  let reviewReset = false;
  await mutate((db) => {
    const order = db.chapters.filter((c) => c.courseId === course.id).reduce((max, c) => Math.max(max, c.order), 0) + 1;
    const row: Chapter = { id: chapterId, courseId: course.id, title, description, order };
    applyRelease(row, release);
    db.chapters.push(row);
    reviewReset = touchCourseContent(db, course.id, user);
  });
  revalidateOutline(course);
  return { ok: true, data: { chapterId }, message: withReviewNote("Chapter added successfully", reviewReset) };
}

export async function updateChapterAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const loaded = await loadChapter(fd(formData, "chapterId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course, chapter } = loaded;
  const { title, description, release, fieldErrors } = validateChapter(formData);
  if (Object.keys(fieldErrors).length) return { ok: false, error: firstError(fieldErrors), fieldErrors };

  let reviewReset = false;
  await mutate((db) => {
    const row = db.chapters.find((c) => c.id === chapter.id);
    if (!row) return;
    row.title = title;
    if (description) row.description = description;
    else delete row.description;
    applyRelease(row, release);
    reviewReset = touchCourseContent(db, course.id, user);
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: withReviewNote("Chapter updated successfully", reviewReset) };
}

export async function renameChapterAction(chapterId: string, title: string): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const clean = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!clean) return { ok: false, error: "Title is required" };
  if (clean.length > 120) return { ok: false, error: "Keep the title under 120 characters." };
  if (clean === loaded.chapter.title) return { ok: true, data: undefined };
  let reviewReset = false;
  await mutate((db) => {
    const row = db.chapters.find((c) => c.id === chapterId);
    if (!row) return;
    row.title = clean;
    reviewReset = touchCourseContent(db, loaded.course.id, loaded.user);
  });
  revalidateOutline(loaded.course);
  return { ok: true, data: undefined, message: withReviewNote("Chapter renamed successfully", reviewReset) };
}

export async function moveChapterAction(chapterId: string, direction: "up" | "down"): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  const db = await getDb();
  const siblings = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((c) => c.id === chapterId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= siblings.length) return { ok: false, error: "This chapter can't move any further." };

  let reviewReset = false;
  await mutate((d) => {
    const ordered = d.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    ordered.forEach((c, i) => {
      c.order = i + 1;
    });
    reviewReset = touchCourseContent(d, course.id, user);
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: withReviewNote("Chapter moved successfully", reviewReset) };
}

/** One chapter of a full outline order: the chapter id and its lesson ids, top to bottom. */
export interface OutlineOrderEntry {
  chapterId: string;
  lessonIds: string[];
}

const STALE_OUTLINE = "The outline changed since you opened it. Refresh the page and try again.";

/**
 * Persist a complete outline order (drag and drop). `layout` must list every
 * chapter of the course exactly once and every lesson exactly once; lessons may
 * move between chapters.
 */
export async function reorderOutlineAction(courseId: string, layout: OutlineOrderEntry[]): Promise<ActionResult> {
  const loaded = await loadCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;

  const wellFormed =
    Array.isArray(layout) &&
    layout.length <= 500 &&
    layout.every((e) => e !== null && typeof e === "object" && typeof e.chapterId === "string" && Array.isArray(e.lessonIds) && e.lessonIds.every((id) => typeof id === "string"));
  if (!wellFormed) return { ok: false, error: "Invalid outline order." };

  let outcome = "stale" as "stale" | "unchanged" | "moved";
  let reviewReset = false;
  await mutate((d) => {
    const chapters = d.chapters.filter((c) => c.courseId === course.id);
    const lessons = d.lessons.filter((l) => l.courseId === course.id);
    const chapterById = new Map(chapters.map((c) => [c.id, c]));
    const lessonById = new Map(lessons.map((l) => [l.id, l]));

    // The order must be a permutation of the current chapters and lessons.
    const seenChapters = new Set<string>();
    const seenLessons = new Set<string>();
    for (const entry of layout) {
      if (!chapterById.has(entry.chapterId) || seenChapters.has(entry.chapterId)) return;
      seenChapters.add(entry.chapterId);
      for (const id of entry.lessonIds) {
        if (!lessonById.has(id) || seenLessons.has(id)) return;
        seenLessons.add(id);
      }
    }
    if (seenChapters.size !== chapters.length || seenLessons.size !== lessons.length) return;

    const now = new Date().toISOString();
    let changed = false;
    layout.forEach((entry, ci) => {
      const chapter = chapterById.get(entry.chapterId)!;
      if (chapter.order !== ci + 1) {
        chapter.order = ci + 1;
        changed = true;
      }
      entry.lessonIds.forEach((id, li) => {
        const lesson = lessonById.get(id)!;
        if (lesson.chapterId !== entry.chapterId) {
          lesson.chapterId = entry.chapterId;
          lesson.updatedAt = now;
          for (const p of d.progress) if (p.lessonId === id) p.chapterId = entry.chapterId;
          changed = true;
        }
        if (lesson.order !== li + 1) {
          lesson.order = li + 1;
          changed = true;
        }
      });
    });
    outcome = changed ? "moved" : "unchanged";
    if (changed) reviewReset = touchCourseContent(d, course.id, user);
  });

  if (outcome === "stale") return { ok: false, error: STALE_OUTLINE };
  if (outcome === "unchanged") return { ok: true, data: undefined };
  revalidateOutline(course);
  return { ok: true, data: undefined, message: withReviewNote("Outline order saved", reviewReset) };
}

export async function deleteChapterAction(chapterId: string): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: "You do not have permission to delete this chapter." };
  const { user, course, chapter } = loaded;

  let reviewReset = false;
  await mutate((db) => {
    const lessonIds = new Set(db.lessons.filter((l) => l.chapterId === chapter.id).map((l) => l.id));
    const topicIds = new Set(db.discussionTopics.filter((t) => t.refType === "lesson" && lessonIds.has(t.refId)).map((t) => t.id));
    const unlink = <T extends { lessonId?: string }>(row: T): T => {
      if (!row.lessonId || !lessonIds.has(row.lessonId)) return row;
      const copy = { ...row };
      delete copy.lessonId;
      return copy;
    };
    db.chapters = db.chapters.filter((c) => c.id !== chapter.id);
    db.lessons = db.lessons.filter((l) => l.chapterId !== chapter.id);
    db.progress = db.progress.filter((p) => !lessonIds.has(p.lessonId));
    db.videoWatches = db.videoWatches.filter((w) => !lessonIds.has(w.lessonId));
    db.notes = db.notes.filter((n) => !lessonIds.has(n.lessonId));
    db.discussionTopics = db.discussionTopics.filter((t) => !topicIds.has(t.id));
    db.discussionReplies = db.discussionReplies.filter((r) => !topicIds.has(r.topicId));
    db.quizzes = db.quizzes.map(unlink);
    db.quizSubmissions = db.quizSubmissions.map(unlink);
    db.assignmentSubmissions = db.assignmentSubmissions.map(unlink);
    db.exerciseSubmissions = db.exerciseSubmissions.map(unlink);
    db.batches = db.batches.map((b) =>
      b.timetable.some((t) => t.type === "lesson" && t.refId && lessonIds.has(t.refId))
        ? { ...b, timetable: b.timetable.filter((t) => !(t.type === "lesson" && t.refId && lessonIds.has(t.refId))) }
        : b,
    );
    renumberOutline(db, course.id);
    recomputeEnrollmentProgress(db, course.id);
    reviewReset = touchCourseContent(db, course.id, user);
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: withReviewNote("Chapter deleted successfully", reviewReset) };
}
