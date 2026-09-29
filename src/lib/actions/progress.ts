"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getLessonAccess, lockedLessonError } from "@/lib/data/lessons";
import { completeLesson, setLessonStatus } from "@/lib/services/progress";
import { clamp } from "@/lib/utils";

export interface CompleteLessonResult {
  /** The lesson is complete after this call. */
  completed: boolean;
  /** It was already complete before this call (nothing changed). */
  alreadyComplete: boolean;
  /** Human readable requirements that are still missing. */
  missing: string[];
  /** Course progress 0-100 after this call. */
  courseProgress: number;
  /** The whole course is complete. */
  courseCompleted: boolean;
  /** Set when a certificate exists for the course (e.g. just issued). */
  certificateCode?: string;
}

function revalidateLearning(courseSlug: string, lessonHref: string) {
  revalidatePath("/(learn)/courses/[slug]/learn", "layout");
  revalidatePath(lessonHref);
  revalidatePath(`/courses/${courseSlug}`);
  revalidatePath("/dashboard");
  revalidatePath("/courses");
}

/**
 * Try to mark a lesson as complete for the current learner (Frappe:
 * save_progress / mark_lesson_progress). Completion requirements come from the
 * platform settings (video watched, quiz passed, assignment submitted, exercise
 * passed, dwell time). When something is missing the lesson stays "partial"
 * and the missing requirements are returned so the UI can list them.
 *
 * `dwellDelta` lets the client include the few seconds spent on the page since
 * its last heartbeat; it is capped server-side.
 *
 * Quiz, assignment and exercise blocks may call this after a successful
 * submission to complete the lesson immediately.
 */
export async function completeLessonAction(input: { lessonId: string; dwellDelta?: number }): Promise<ActionResult<CompleteLessonResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to track your progress." };

  const lessonId = typeof input?.lessonId === "string" ? input.lessonId.trim() : "";
  const access = lessonId ? await getLessonAccess(user, lessonId) : null;
  if (!access) return { ok: false, error: "This lesson no longer exists." };
  if (!access.enrolled) return { ok: false, error: "Enroll in this course to track your progress." };
  // Locked lessons (scheduled/drip, enforced order, prerequisites) can never be completed early.
  if (!access.canView) return { ok: false, error: lockedLessonError(access) };

  const summary = async (completed: boolean, alreadyComplete: boolean, missing: string[]): Promise<CompleteLessonResult> => {
    const db = await getDb();
    const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === access.course.id);
    const certificate = db.certificates.find((c) => c.userId === user.id && c.courseId === access.course.id && c.published);
    return {
      completed,
      alreadyComplete,
      missing,
      courseProgress: enrollment?.progress ?? 0,
      courseCompleted: !!enrollment?.completedAt,
      certificateCode: certificate?.code,
    };
  };

  if (access.status === "complete") {
    return { ok: true, data: await summary(true, true, []) };
  }

  const delta = clamp(Math.round(Number(input.dwellDelta) || 0), 0, 60);
  if (delta > 0) await setLessonStatus(user, access.lesson, "partial", delta);

  const db = await getDb();
  const row = db.progress.find((p) => p.userId === user.id && p.lessonId === access.lesson.id);
  const dwellSeconds = row?.dwellSeconds ?? 0;

  const result = await completeLesson(user, access.lesson, dwellSeconds);
  if (!result.completed) {
    return {
      ok: true,
      data: await summary(false, false, result.requirements.missing),
      message: "A few requirements are still missing.",
    };
  }

  revalidateLearning(access.course.slug, access.href);
  const data = await summary(true, false, []);
  return { ok: true, data, message: data.courseCompleted ? "Course completed!" : "Lesson completed" };
}
