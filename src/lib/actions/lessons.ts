"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, Lesson, LessonBlock, User } from "@/lib/types";
import { findById, getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { recomputeEnrollmentProgress, renumberOutline } from "@/lib/data/admin-courses";
import { computeLessonDuration, createBlock, sanitizeBlocks } from "@/components/admin/courses/blocks";
import { fd, fdBool, uid, uniqueSlug } from "@/lib/utils";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function revalidateLessonPaths(course: Pick<Course, "id" | "slug">, lessonId?: string) {
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  if (lessonId) revalidatePath(`/admin/courses/${course.id}/lessons/${lessonId}`);
  revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/admin/courses");
}

async function loadCourse(courseId: string): Promise<{ user: User; course: Course } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  const course = await findById("courses", courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to modify this lesson." };
  return { user, course };
}

async function loadLesson(lessonId: string): Promise<{ user: User; course: Course; lesson: Lesson } | { error: string }> {
  const lesson = await findById("lessons", lessonId);
  if (!lesson) return { error: "This lesson no longer exists." };
  const loaded = await loadCourse(lesson.courseId);
  if ("error" in loaded) return loaded;
  return { ...loaded, lesson };
}

function touchCourse(db: { courses: Course[] }, courseId: string) {
  const row = db.courses.find((c) => c.id === courseId);
  if (row) row.updatedAt = new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Outline operations                                                  */
/* ------------------------------------------------------------------ */

export async function createLessonAction(
  _prev: ActionResult<{ lessonId: string; editHref: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ lessonId: string; editHref: string }>> {
  const loaded = await loadCourse(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course } = loaded;
  const chapterId = fd(formData, "chapterId");
  const title = fd(formData, "title").replace(/\s+/g, " ") || "Untitled lesson";
  if (title.length > 160) return { ok: false, error: "Keep the title under 160 characters.", fieldErrors: { title: "Keep the title under 160 characters." } };

  const db = await getDb();
  const chapter = db.chapters.find((c) => c.id === chapterId && c.courseId === course.id);
  if (!chapter) return { ok: false, error: "This chapter no longer exists." };

  const now = new Date().toISOString();
  const lessonId = uid("les");
  await mutate((d) => {
    const siblings = d.lessons.filter((l) => l.chapterId === chapter.id);
    const lesson: Lesson = {
      id: lessonId,
      courseId: course.id,
      chapterId: chapter.id,
      slug: uniqueSlug(title, d.lessons.filter((l) => l.courseId === course.id).map((l) => l.slug)),
      title,
      order: siblings.reduce((max, l) => Math.max(max, l.order), 0) + 1,
      blocks: [createBlock("markdown")],
      includeInPreview: false,
      durationSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
    d.lessons.push(lesson);
    recomputeEnrollmentProgress(d, course.id);
    touchCourse(d, course.id);
  });
  revalidateLessonPaths(course);
  return { ok: true, data: { lessonId, editHref: `/admin/courses/${course.id}/lessons/${lessonId}` }, message: "Lesson created successfully" };
}

export async function renameLessonAction(lessonId: string, title: string): Promise<ActionResult> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const clean = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!clean) return { ok: false, error: "Title is required" };
  if (clean.length > 160) return { ok: false, error: "Keep the title under 160 characters." };
  if (clean === loaded.lesson.title) return { ok: true, data: undefined };
  await mutate((db) => {
    const row = db.lessons.find((l) => l.id === lessonId);
    if (row) {
      row.title = clean;
      row.updatedAt = new Date().toISOString();
    }
  });
  revalidateLessonPaths(loaded.course, lessonId);
  return { ok: true, data: undefined, message: "Lesson renamed" };
}

export async function setLessonPreviewAction(lessonId: string, includeInPreview: boolean): Promise<ActionResult> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  await mutate((db) => {
    const row = db.lessons.find((l) => l.id === lessonId);
    if (row) {
      row.includeInPreview = !!includeInPreview;
      row.updatedAt = new Date().toISOString();
    }
  });
  revalidateLessonPaths(loaded.course, lessonId);
  return { ok: true, data: undefined, message: includeInPreview ? "Lesson is now a free preview" : "Lesson is visible to enrolled students only" };
}

/**
 * Move a lesson one step up or down. At the edge of a chapter the lesson
 * crosses into the neighbouring chapter (end of previous / start of next).
 */
export async function moveLessonAction(lessonId: string, direction: "up" | "down"): Promise<ActionResult> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, lesson } = loaded;
  let moved = false;

  await mutate((db) => {
    const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    const ci = chapters.findIndex((c) => c.id === lesson.chapterId);
    if (ci === -1) return;
    const inChapter = (chapterId: string) => db.lessons.filter((l) => l.chapterId === chapterId).sort((a, b) => a.order - b.order);
    const siblings = inChapter(lesson.chapterId);
    const li = siblings.findIndex((l) => l.id === lesson.id);
    const row = siblings[li];
    if (!row) return;

    if (direction === "up" && li > 0) {
      siblings.splice(li, 1);
      siblings.splice(li - 1, 0, row);
      siblings.forEach((l, i) => (l.order = i + 1));
      moved = true;
    } else if (direction === "down" && li < siblings.length - 1) {
      siblings.splice(li, 1);
      siblings.splice(li + 1, 0, row);
      siblings.forEach((l, i) => (l.order = i + 1));
      moved = true;
    } else {
      const neighbour = chapters[direction === "up" ? ci - 1 : ci + 1];
      if (!neighbour) return;
      const target = inChapter(neighbour.id);
      siblings.splice(li, 1);
      siblings.forEach((l, i) => (l.order = i + 1));
      row.chapterId = neighbour.id;
      if (direction === "up") target.push(row);
      else target.unshift(row);
      target.forEach((l, i) => (l.order = i + 1));
      for (const p of db.progress) if (p.lessonId === row.id) p.chapterId = neighbour.id;
      moved = true;
    }
    if (moved) {
      row.updatedAt = new Date().toISOString();
      touchCourse(db, course.id);
    }
  });
  if (!moved) return { ok: false, error: "This lesson can't move any further." };
  revalidateLessonPaths(course, lessonId);
  return { ok: true, data: undefined, message: "Lesson moved successfully" };
}

export async function moveLessonToChapterAction(lessonId: string, chapterId: string): Promise<ActionResult> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, lesson } = loaded;
  if (lesson.chapterId === chapterId) return { ok: true, data: undefined };
  const target = await findById("chapters", chapterId);
  if (!target || target.courseId !== course.id) return { ok: false, error: "Pick a chapter of this course." };

  await mutate((db) => {
    const row = db.lessons.find((l) => l.id === lessonId);
    if (!row) return;
    const end = db.lessons.filter((l) => l.chapterId === chapterId).reduce((max, l) => Math.max(max, l.order), 0);
    row.chapterId = chapterId;
    row.order = end + 1;
    row.updatedAt = new Date().toISOString();
    for (const p of db.progress) if (p.lessonId === lessonId) p.chapterId = chapterId;
    renumberOutline(db, course.id);
    touchCourse(db, course.id);
  });
  revalidateLessonPaths(course, lessonId);
  return { ok: true, data: undefined, message: `Lesson moved to "${target.title}"` };
}

export async function deleteLessonAction(lessonId: string): Promise<ActionResult> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: "You do not have permission to delete this lesson." };
  const { course } = loaded;

  await mutate((db) => {
    const topicIds = new Set(db.discussionTopics.filter((t) => t.refType === "lesson" && t.refId === lessonId).map((t) => t.id));
    const unlink = <T extends { lessonId?: string }>(row: T): T => {
      if (row.lessonId !== lessonId) return row;
      const copy = { ...row };
      delete copy.lessonId;
      return copy;
    };
    db.lessons = db.lessons.filter((l) => l.id !== lessonId);
    db.progress = db.progress.filter((p) => p.lessonId !== lessonId);
    db.videoWatches = db.videoWatches.filter((w) => w.lessonId !== lessonId);
    db.notes = db.notes.filter((n) => n.lessonId !== lessonId);
    db.discussionTopics = db.discussionTopics.filter((t) => !topicIds.has(t.id));
    db.discussionReplies = db.discussionReplies.filter((r) => !topicIds.has(r.topicId));
    db.quizzes = db.quizzes.map(unlink);
    db.quizSubmissions = db.quizSubmissions.map(unlink);
    db.assignmentSubmissions = db.assignmentSubmissions.map(unlink);
    db.exerciseSubmissions = db.exerciseSubmissions.map(unlink);
    db.batches = db.batches.map((b) =>
      b.timetable.some((t) => t.type === "lesson" && t.refId === lessonId) ? { ...b, timetable: b.timetable.filter((t) => !(t.type === "lesson" && t.refId === lessonId)) } : b,
    );
    renumberOutline(db, course.id);
    recomputeEnrollmentProgress(db, course.id);
    touchCourse(db, course.id);
  });
  revalidateLessonPaths(course);
  return { ok: true, data: undefined, message: "Lesson deleted successfully" };
}

/* ------------------------------------------------------------------ */
/* Lesson editor                                                       */
/* ------------------------------------------------------------------ */

export interface SavedLesson {
  slug: string;
  title: string;
  blocks: LessonBlock[];
  durationSeconds: number;
  updatedAt: string;
}

export async function saveLessonAction(_prev: ActionResult<SavedLesson> | null, formData: FormData): Promise<ActionResult<SavedLesson>> {
  const loaded = await loadLesson(fd(formData, "lessonId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, lesson } = loaded;
  const db = await getDb();
  const fieldErrors: Record<string, string> = {};

  const title = fd(formData, "title").replace(/\s+/g, " ");
  if (!title) fieldErrors.title = "Title is required";
  else if (title.length > 160) fieldErrors.title = "Keep the title under 160 characters.";

  let slug = fd(formData, "slug").toLowerCase();
  const courseSlugs = db.lessons.filter((l) => l.courseId === course.id && l.id !== lesson.id).map((l) => l.slug);
  if (!slug) slug = uniqueSlug(title || lesson.title, courseSlugs);
  else if (!SLUG_RE.test(slug) || slug.length > 80) fieldErrors.slug = "Use lowercase letters, numbers and single hyphens only (max 80).";
  else if (courseSlugs.includes(slug)) fieldErrors.slug = "Another lesson in this course already uses this slug.";

  const includeInPreview = fdBool(formData, "includeInPreview");
  const instructorNotes = fd(formData, "instructorNotes");
  if (instructorNotes.length > 50_000) fieldErrors.instructorNotes = "Instructor notes are too long (max 50,000 characters).";

  let rawBlocks: unknown;
  try {
    rawBlocks = JSON.parse(String(formData.get("blocks") ?? "[]"));
  } catch {
    return { ok: false, error: "Lesson content could not be read. Reload the page and try again." };
  }
  const { blocks, errors } = sanitizeBlocks(rawBlocks, {
    quizIds: new Set(db.quizzes.map((q) => q.id)),
    assignmentIds: new Set(db.assignments.map((a) => a.id)),
    exerciseIds: new Set(db.exercises.map((e) => e.id)),
  });
  if (errors._) return { ok: false, error: errors._ };
  for (const [blockId, message] of Object.entries(errors)) fieldErrors[`block.${blockId}`] = message;

  if (Object.keys(fieldErrors).length) {
    const blockErrorCount = Object.keys(errors).length;
    return {
      ok: false,
      error: blockErrorCount ? `${blockErrorCount} ${blockErrorCount === 1 ? "block needs" : "blocks need"} attention before saving.` : "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  const durationSeconds = computeLessonDuration(blocks);
  const updatedAt = new Date().toISOString();
  await mutate((d) => {
    const row = d.lessons.find((l) => l.id === lesson.id);
    if (!row) return;
    row.title = title;
    row.slug = slug;
    row.includeInPreview = includeInPreview;
    row.blocks = blocks;
    row.durationSeconds = durationSeconds;
    row.updatedAt = updatedAt;
    if (instructorNotes) row.instructorNotes = instructorNotes;
    else delete row.instructorNotes;
    touchCourse(d, course.id);
  });
  revalidateLessonPaths(course, lesson.id);
  return { ok: true, data: { slug, title, blocks, durationSeconds, updatedAt }, message: "Lesson saved" };
}
