"use server";

import type { ActionResult, Course, User } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { cleanReleaseRule, findPrerequisiteCycle, type ReleaseRule } from "@/components/learn/drip-shared";

/**
 * Read-only loaders for the admin drip editors. The lesson editor and the
 * course settings form use them to fetch the current release schedule and
 * the prerequisite options when their page did not pass that data as props.
 * Every call re-checks that the user manages the course.
 */

export interface LessonReleaseInfo {
  lessonId: string;
  rule: ReleaseRule;
  chapter: { id: string; title: string; rule: ReleaseRule };
  /** The course unlocks lessons strictly in order. */
  enforceOrder: boolean;
}

export interface PrerequisiteOption {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  lessonCount: number;
}

export interface PrerequisiteSettings {
  /** Current prerequisite course ids (only courses that still exist). */
  selected: string[];
  /** Courses that can be picked (published, not this course, no cycles) plus the current selection. */
  options: PrerequisiteOption[];
  /** Published courses left out because they already require this course. */
  excludedTitles: string[];
}

async function manageableCourse(courseId: string): Promise<{ user: User; course: Course } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to manage this course." };
  return { user, course };
}

/** Current release schedule of a lesson and of its chapter (lesson editor "Release schedule"). */
export async function loadLessonReleaseAction(lessonId: string): Promise<ActionResult<LessonReleaseInfo>> {
  const id = typeof lessonId === "string" ? lessonId.trim() : "";
  const db = await getDb();
  const lesson = id ? db.lessons.find((l) => l.id === id) : undefined;
  if (!lesson) return { ok: false, error: "This lesson no longer exists." };
  const loaded = await manageableCourse(lesson.courseId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const chapter = db.chapters.find((c) => c.id === lesson.chapterId);
  return {
    ok: true,
    data: {
      lessonId: lesson.id,
      rule: cleanReleaseRule(lesson),
      chapter: { id: chapter?.id ?? lesson.chapterId, title: chapter?.title ?? "", rule: cleanReleaseRule(chapter) },
      enforceOrder: loaded.course.enforceLessonCompletion,
    },
  };
}

/** Prerequisite selection and pickable courses for the course settings form. */
export async function loadPrerequisiteSettingsAction(courseId: string): Promise<ActionResult<PrerequisiteSettings>> {
  const loaded = await manageableCourse(typeof courseId === "string" ? courseId.trim() : "");
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course } = loaded;
  const db = await getDb();

  const lessonCounts = new Map<string, number>();
  for (const l of db.lessons) lessonCounts.set(l.courseId, (lessonCounts.get(l.courseId) ?? 0) + 1);
  const selected = (course.prerequisiteCourseIds ?? []).filter((id) => id !== course.id && db.courses.some((c) => c.id === id));
  const selectedSet = new Set(selected);
  const graph = new Map(db.courses.filter((c) => c.id !== course.id).map((c) => [c.id, c.prerequisiteCourseIds ?? []]));

  const options: PrerequisiteOption[] = [];
  const excludedTitles: string[] = [];
  for (const c of db.courses) {
    if (c.id === course.id) continue;
    if (!c.published && !selectedSet.has(c.id)) continue;
    if (!selectedSet.has(c.id) && findPrerequisiteCycle(course.id, [c.id], graph)) {
      excludedTitles.push(c.title);
      continue;
    }
    options.push({ id: c.id, title: c.title, slug: c.slug, published: c.published, lessonCount: lessonCounts.get(c.id) ?? 0 });
  }
  options.sort((a, b) => a.title.localeCompare(b.title));
  return { ok: true, data: { selected, options, excludedTitles: excludedTitles.sort((a, b) => a.localeCompare(b)) } };
}
