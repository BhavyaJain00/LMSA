"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, Database, Lesson, User } from "@/lib/types";
import { findById, getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { RESERVED_COURSE_SLUGS, canCreateCourses, getWorkflowFlags, touchCourseContent, withReviewNote } from "@/lib/data/admin-courses";
import { audit } from "@/lib/audit";
import { COURSE_TITLE_MAX, copyCourseGraph, countGraph, uniqueCopyTitle, type CopyCounts, type CourseGraph } from "@/lib/teaching/course-copy";
import {
  coursePublishState,
  isCourseLive,
  parsePublishAt,
  publishTime,
  type CourseScheduleInfo,
  type LessonScheduleInfo,
  type ScheduledLessonRow,
} from "@/lib/teaching/schedule-shared";
import { armPublishTimer } from "@/lib/teaching/scheduling";
import { runPublishSweep } from "@/lib/teaching/publish-sweep";

/**
 * Course tools: duplicate a course, and scheduled publishing of courses and
 * lessons (the publish sweep in `src/lib/teaching/publish-sweep.ts` writes
 * the schedules down and sends the notifications when their time comes).
 */

function revalidateCourse(course: Pick<Course, "id" | "slug">, lessonId?: string) {
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${course.id}`, "layout");
  if (lessonId) revalidatePath(`/admin/courses/${course.id}/lessons/${lessonId}`);
  revalidatePath("/courses");
  revalidatePath(`/courses/${course.slug}`, "layout");
}

async function loadCourse(courseId: unknown): Promise<{ user: User; course: Course } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  if (typeof courseId !== "string" || !courseId) return { error: "This course no longer exists." };
  const course = await findById("courses", courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to change this course." };
  return { user, course };
}

async function loadLesson(lessonId: unknown): Promise<{ user: User; course: Course; lesson: Lesson } | { error: string }> {
  if (typeof lessonId !== "string" || !lessonId) return { error: "This lesson no longer exists." };
  const lesson = await findById("lessons", lessonId);
  if (!lesson) return { error: "This lesson no longer exists." };
  const loaded = await loadCourse(lesson.courseId);
  if ("error" in loaded) return loaded;
  return { ...loaded, lesson };
}

/* ------------------------------------------------------------------ */
/* Duplicate course                                                    */
/* ------------------------------------------------------------------ */

/** The course and everything its lessons use (see `copyCourseGraph` for what is copied). */
function collectGraph(db: Database, course: Course): CourseGraph {
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const lessons = db.lessons.filter((l) => l.courseId === course.id).sort((a, b) => a.order - b.order);
  const lessonIds = new Set(lessons.map((l) => l.id));
  const quizIds = new Set<string>();
  const assignmentIds = new Set<string>();
  const exerciseIds = new Set<string>();
  for (const block of lessons.flatMap((l) => l.blocks)) {
    if (block.type === "quiz") quizIds.add(block.quizId);
    else if (block.type === "assignment") assignmentIds.add(block.assignmentId);
    else if (block.type === "exercise") exerciseIds.add(block.exerciseId);
    else if (block.type === "video") for (const marker of block.quizMarkers ?? []) quizIds.add(marker.quizId);
  }
  const quizzes = db.quizzes.filter((q) => quizIds.has(q.id) || q.courseId === course.id);
  const questionIds = new Set(quizzes.flatMap((q) => q.questions.map((ref) => ref.questionId)));
  return {
    course,
    chapters,
    lessons,
    quizzes,
    questions: db.questions.filter((q) => questionIds.has(q.id)),
    assignments: db.assignments.filter((a) => assignmentIds.has(a.id) || a.courseId === course.id),
    exercises: db.exercises.filter((e) => exerciseIds.has(e.id) || e.courseId === course.id),
    transcripts: db.transcripts.filter((t) => lessonIds.has(t.lessonId)),
  };
}

/** Slugs a new course may not use: other courses, reserved route names and old slugs that redirect. */
function takenCourseSlugs(db: Database): string[] {
  const redirected = db.slugRedirects.map((r) => /^\/courses\/([^/?#]+)$/.exec(r.fromPath)?.[1]).filter((s): s is string => !!s);
  return [...db.courses.map((c) => c.slug), ...RESERVED_COURSE_SLUGS, ...redirected];
}

export interface DuplicatePreview {
  title: string;
  suggestedTitle: string;
  counts: CopyCounts;
  /** Learners enrolled in the original (they are not copied). */
  enrollments: number;
  hasSalesPage: boolean;
}

/** What "Duplicate course" will copy, for the confirmation dialog. */
export async function getDuplicatePreviewAction(courseId: string): Promise<ActionResult<DuplicatePreview>> {
  const loaded = await loadCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (!canCreateCourses(loaded.user)) return { ok: false, error: "You are not permitted to create courses." };
  const db = await getDb();
  const { course } = loaded;
  return {
    ok: true,
    data: {
      title: course.title,
      suggestedTitle: uniqueCopyTitle(course.title, db.courses.map((c) => c.title)),
      counts: countGraph(collectGraph(db, course)),
      enrollments: db.enrollments.filter((e) => e.courseId === course.id).length,
      hasSalesPage: !!course.salesPage,
    },
  };
}

/**
 * Deep copy of a course as a new unpublished draft ("Copy of …") with a
 * unique slug: details, settings, sales page, chapters, lessons and the
 * assessments its lessons use, all with new ids. Enrollments, progress,
 * reviews and other learner data stay with the original.
 */
export async function duplicateCourseAction(courseId: string, input: { title?: string } = {}): Promise<ActionResult<{ id: string; slug: string; editHref: string }>> {
  const loaded = await loadCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  if (!canCreateCourses(user)) return { ok: false, error: "You are not permitted to create courses." };

  const title = typeof input?.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  if (title.length > COURSE_TITLE_MAX) return { ok: false, error: `Keep the title under ${COURSE_TITLE_MAX} characters.`, fieldErrors: { title: `Keep the title under ${COURSE_TITLE_MAX} characters.` } };

  const result = await mutate((db) => {
    const source = db.courses.find((c) => c.id === course.id);
    if (!source) return null;
    const graph = collectGraph(db, source);
    const copy = copyCourseGraph(graph, {
      actorId: user.id,
      now: new Date().toISOString(),
      title: title || uniqueCopyTitle(source.title, db.courses.map((c) => c.title)),
      takenSlugs: takenCourseSlugs(db),
    });
    db.courses.push(copy.course);
    db.chapters.push(...copy.chapters);
    db.lessons.push(...copy.lessons);
    db.questions.push(...copy.questions);
    db.quizzes.push(...copy.quizzes);
    db.assignments.push(...copy.assignments);
    db.exercises.push(...copy.exercises);
    db.transcripts.push(...copy.transcripts);
    return { course: copy.course, counts: countGraph(graph) };
  });
  if (!result) return { ok: false, error: "This course no longer exists." };

  const { course: created, counts } = result;
  await audit(user, "course.duplicate", { type: "course", id: created.id }, {
    sourceId: course.id,
    sourceTitle: course.title,
    title: created.title,
    slug: created.slug,
    chapters: counts.chapters,
    lessons: counts.lessons,
    quizzes: counts.quizzes,
    questions: counts.questions,
    assignments: counts.assignments,
    exercises: counts.exercises,
  });
  revalidatePath("/admin/courses");
  return {
    ok: true,
    data: { id: created.id, slug: created.slug, editHref: `/admin/courses/${created.id}` },
    message: `Created “${created.title}”. It is an unpublished draft.`,
  };
}

/* ------------------------------------------------------------------ */
/* Scheduled publishing: courses                                       */
/* ------------------------------------------------------------------ */

function lessonRows(db: Database, course: Course, now: number): ScheduledLessonRow[] {
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const rows: (ScheduledLessonRow & { at: number })[] = [];
  chapters.forEach((chapter, ci) => {
    db.lessons
      .filter((l) => l.chapterId === chapter.id)
      .sort((a, b) => a.order - b.order)
      .forEach((lesson, li) => {
        const at = publishTime(lesson);
        if (at === null || at <= now) return;
        rows.push({ at, lessonId: lesson.id, title: lesson.title, index: `${ci + 1}.${li + 1}`, publishAt: lesson.publishAt!, editHref: `/admin/courses/${course.id}/lessons/${lesson.id}` });
      });
  });
  return rows.sort((a, b) => a.at - b.at).map((row) => ({ lessonId: row.lessonId, title: row.title, index: row.index, publishAt: row.publishAt, editHref: row.editHref }));
}

function scheduleInfo(db: Database, user: User, course: Course, now: number): CourseScheduleInfo {
  const flags = getWorkflowFlags(user, course);
  const state = coursePublishState(course, now);
  let reason: string | null = null;
  if (course.published) reason = "The course is already published.";
  else if (!flags.canPublish) reason = "A moderator must approve the course before it can be scheduled. Submit it for review first.";
  return {
    courseId: course.id,
    title: course.title,
    state,
    publishAt: course.publishAt ?? null,
    canSchedule: flags.canPublish,
    reason,
    lessonCount: db.lessons.filter((l) => l.courseId === course.id).length,
    notifiesMembers: db.settings.learning.notifyOnPublishedCourses !== "none",
    firstPublish: !course.publishedOn,
    scheduledLessons: lessonRows(db, course, now),
  };
}

/** The publish schedule of a course and of its lessons, for the schedule card in the course settings. */
export async function getCourseScheduleAction(courseId: string): Promise<ActionResult<CourseScheduleInfo>> {
  const loaded = await loadCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const db = await getDb();
  return { ok: true, data: scheduleInfo(db, loaded.user, loaded.course, Date.now()) };
}

/**
 * Publish a course automatically at `publishAt` (an ISO instant chosen in the
 * author's local time), or cancel its schedule (`null`). Going live then has
 * the same effects as publishing by hand, exactly once.
 */
export async function scheduleCoursePublishAction(courseId: string, publishAt: string | null): Promise<ActionResult<CourseScheduleInfo>> {
  const loaded = await loadCourse(courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course } = loaded;
  const now = Date.now();
  // Store rows are live objects: keep what the schedule was before writing.
  const previous = course.publishAt;

  if (publishAt === null) {
    if (!previous) return { ok: false, error: "This course has no publish schedule." };
    await mutate((db) => {
      const row = db.courses.find((c) => c.id === course.id);
      if (!row) return;
      delete row.publishAt;
      row.updatedAt = new Date(now).toISOString();
    });
    await audit(user, "course.schedule_cancel", { type: "course", id: course.id }, { title: course.title, publishAt: previous });
    revalidateCourse(course);
    const db = await getDb();
    const fresh = db.courses.find((c) => c.id === course.id) ?? course;
    return { ok: true, data: scheduleInfo(db, user, fresh, now), message: "Schedule cancelled. The course stays unpublished." };
  }

  if (!getWorkflowFlags(user, course).canPublish) {
    return { ok: false, error: course.published ? "The course is already published." : "A moderator must approve the course before it can be scheduled. Submit it for review first." };
  }
  const parsed = parsePublishAt(publishAt, now);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { publishAt: parsed.error } };

  await mutate((db) => {
    const row = db.courses.find((c) => c.id === course.id);
    if (!row) return;
    row.publishAt = parsed.iso;
    // Moderators may publish without a review; scheduling counts as their approval, as publishing by hand does.
    if (isModerator(user)) row.status = "approved";
    row.updatedAt = new Date(now).toISOString();
  });
  armPublishTimer(parsed.at);
  await audit(user, previous ? "course.schedule_change" : "course.schedule", { type: "course", id: course.id }, { title: course.title, publishAt: parsed.iso });
  revalidateCourse(course);
  const db = await getDb();
  const fresh = db.courses.find((c) => c.id === course.id) ?? course;
  return { ok: true, data: scheduleInfo(db, user, fresh, now), message: previous ? "Publish time changed" : "Course scheduled" };
}

/* ------------------------------------------------------------------ */
/* Scheduled publishing: lessons                                       */
/* ------------------------------------------------------------------ */

function lessonInfo(db: Database, course: Course, lesson: Lesson, now: number): LessonScheduleInfo {
  const at = publishTime(lesson);
  return {
    lessonId: lesson.id,
    title: lesson.title,
    publishAt: lesson.publishAt ?? null,
    hidden: at !== null && at > now,
    courseLive: isCourseLive(course, now),
    learnerCount: db.enrollments.filter((e) => e.courseId === course.id && e.memberType === "student").length,
    openedCount: new Set(db.progress.filter((p) => p.lessonId === lesson.id).map((p) => p.userId)).size,
  };
}

export async function getLessonScheduleAction(lessonId: string): Promise<ActionResult<LessonScheduleInfo>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const db = await getDb();
  return { ok: true, data: lessonInfo(db, loaded.course, loaded.lesson, Date.now()) };
}

/**
 * Hide a lesson from learners until `publishAt`, or publish a scheduled
 * lesson right away (`null`). Either way the lesson is announced to the
 * learners of a live course once, by the publish sweep, when it appears.
 */
export async function scheduleLessonPublishAction(lessonId: string, publishAt: string | null): Promise<ActionResult<LessonScheduleInfo>> {
  const loaded = await loadLesson(lessonId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course, lesson } = loaded;
  const now = Date.now();
  const previous = lesson.publishAt;

  if (publishAt === null) {
    if (!previous) return { ok: false, error: "This lesson has no publish schedule." };
    // The publish time moves to now and the sweep releases it, so learners are told as they would be at the scheduled time.
    await mutate((db) => {
      const row = db.lessons.find((l) => l.id === lesson.id);
      if (row?.publishAt) row.publishAt = new Date(now).toISOString();
    });
    const sweep = await runPublishSweep(now);
    const announced = sweep.released.some((l) => l.id === lesson.id && l.announced);
    await audit(user, "lesson.publish_now", { type: "lesson", id: lesson.id }, { courseId: course.id, title: lesson.title, scheduledFor: previous });
    revalidateCourse(course, lesson.id);
    const db = await getDb();
    const fresh = db.lessons.find((l) => l.id === lesson.id) ?? lesson;
    return { ok: true, data: lessonInfo(db, course, fresh, now), message: announced ? "Lesson published. Learners were notified." : "Lesson published" };
  }

  const parsed = parsePublishAt(publishAt, now);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { publishAt: parsed.error } };

  let reviewReset = false;
  await mutate((db) => {
    const row = db.lessons.find((l) => l.id === lesson.id);
    if (!row) return;
    row.publishAt = parsed.iso;
    row.updatedAt = new Date(now).toISOString();
    reviewReset = touchCourseContent(db, course.id, user);
  });
  armPublishTimer(parsed.at);
  await audit(user, previous ? "lesson.schedule_change" : "lesson.schedule", { type: "lesson", id: lesson.id }, { courseId: course.id, title: lesson.title, publishAt: parsed.iso });
  revalidateCourse(course, lesson.id);
  const db = await getDb();
  const fresh = db.lessons.find((l) => l.id === lesson.id) ?? lesson;
  return {
    ok: true,
    data: lessonInfo(db, course, fresh, now),
    message: withReviewNote(previous ? "Publish time changed" : "Lesson scheduled. Learners will not see it until then", reviewReset),
  };
}
