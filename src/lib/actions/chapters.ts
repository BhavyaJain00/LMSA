"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Chapter, Course, User } from "@/lib/types";
import { findById, getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { recomputeEnrollmentProgress, renumberOutline } from "@/lib/data/admin-courses";
import { fd, uid } from "@/lib/utils";

function revalidateOutline(course: Pick<Course, "id" | "slug">) {
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  revalidatePath(`/courses/${course.slug}`, "layout");
  revalidatePath("/admin/courses");
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

function validateChapter(formData: FormData): { title: string; description?: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const description = fd(formData, "description") || undefined;
  if (!title) fieldErrors.title = "Title is required";
  else if (title.length > 120) fieldErrors.title = "Keep the title under 120 characters.";
  if (description && description.length > 1000) fieldErrors.description = "Keep the description under 1,000 characters.";
  return { title, description, fieldErrors };
}

export async function createChapterAction(_prev: ActionResult<{ chapterId: string }> | null, formData: FormData): Promise<ActionResult<{ chapterId: string }>> {
  const loaded = await loadCourse(fd(formData, "courseId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course } = loaded;
  const { title, description, fieldErrors } = validateChapter(formData);
  if (Object.keys(fieldErrors).length) return { ok: false, error: fieldErrors.title ?? "Please fix the errors below.", fieldErrors };

  const chapterId = uid("chp");
  await mutate((db) => {
    const order = db.chapters.filter((c) => c.courseId === course.id).reduce((max, c) => Math.max(max, c.order), 0) + 1;
    db.chapters.push({ id: chapterId, courseId: course.id, title, description, order });
    const row = db.courses.find((c) => c.id === course.id);
    if (row) row.updatedAt = new Date().toISOString();
  });
  revalidateOutline(course);
  return { ok: true, data: { chapterId }, message: "Chapter added successfully" };
}

export async function updateChapterAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const loaded = await loadChapter(fd(formData, "chapterId"));
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, chapter } = loaded;
  const { title, description, fieldErrors } = validateChapter(formData);
  if (Object.keys(fieldErrors).length) return { ok: false, error: fieldErrors.title ?? "Please fix the errors below.", fieldErrors };

  await mutate((db) => {
    const row = db.chapters.find((c) => c.id === chapter.id);
    if (!row) return;
    row.title = title;
    if (description) row.description = description;
    else delete row.description;
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: "Chapter updated successfully" };
}

export async function renameChapterAction(chapterId: string, title: string): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const clean = typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
  if (!clean) return { ok: false, error: "Title is required" };
  if (clean.length > 120) return { ok: false, error: "Keep the title under 120 characters." };
  if (clean === loaded.chapter.title) return { ok: true, data: undefined };
  await mutate((db) => {
    const row = db.chapters.find((c) => c.id === chapterId);
    if (row) row.title = clean;
  });
  revalidateOutline(loaded.course);
  return { ok: true, data: undefined, message: "Chapter renamed successfully" };
}

export async function moveChapterAction(chapterId: string, direction: "up" | "down"): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course } = loaded;
  const db = await getDb();
  const siblings = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((c) => c.id === chapterId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= siblings.length) return { ok: false, error: "This chapter can't move any further." };

  await mutate((d) => {
    const ordered = d.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    ordered.forEach((c, i) => {
      c.order = i + 1;
    });
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: "Chapter moved successfully" };
}

export async function deleteChapterAction(chapterId: string): Promise<ActionResult> {
  const loaded = await loadChapter(chapterId);
  if ("error" in loaded) return { ok: false, error: "You do not have permission to delete this chapter." };
  const { course, chapter } = loaded;

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
    const row = db.courses.find((c) => c.id === course.id);
    if (row) row.updatedAt = new Date().toISOString();
  });
  revalidateOutline(course);
  return { ok: true, data: undefined, message: "Chapter deleted successfully" };
}
