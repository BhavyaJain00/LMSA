import "server-only";
import type { Certificate, Course, Lesson, ProgressStatus, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { percent, shortCode, toDateKey, uid } from "@/lib/utils";
import { evaluateBadges } from "./badges";
import { logActivity, getStreak } from "./activity";
import { notify } from "./notifications";
import { awardPoints } from "./points";
import { computeProgramProgress } from "@/lib/data/programs";

/**
 * Central place for everything that happens when a learner makes progress:
 * lesson status, enrollment percentage, course completion, certificates,
 * badges, streaks and notifications.
 */

export interface CompletionRequirements {
  videoWatched: boolean;
  quizPassed: boolean;
  assignmentSubmitted: boolean;
  exercisePassed: boolean;
  dwellTimeMet: boolean;
  /** Whether every enforced requirement is satisfied. */
  allMet: boolean;
  missing: string[];
}

/**
 * Check whether a learner has satisfied the lesson's completion requirements
 * according to the platform settings (mirrors Frappe's enforce_* settings).
 */
export async function getCompletionRequirements(user: User, lesson: Lesson, dwellSeconds: number): Promise<CompletionRequirements> {
  const db = await getDb();
  const s = db.settings.learning;
  const missing: string[] = [];

  const videoBlocks = lesson.blocks.filter((b) => b.type === "video");
  const quizBlocks = lesson.blocks.filter((b) => b.type === "quiz");
  const assignmentBlocks = lesson.blocks.filter((b) => b.type === "assignment");
  const exerciseBlocks = lesson.blocks.filter((b) => b.type === "exercise");

  let videoWatched = true;
  if (videoBlocks.length && s.enforceVideoCompletion) {
    videoWatched = videoBlocks.every((b) =>
      db.videoWatches.some((w) => w.userId === user.id && w.lessonId === lesson.id && w.blockId === b.id && w.completed),
    );
    if (!videoWatched) missing.push(`Watch at least ${s.videoCompletionThreshold}% of the video`);
  }

  let quizPassed = true;
  if (quizBlocks.length && s.enforceQuizCompletion) {
    quizPassed = quizBlocks.every((b) => b.type === "quiz" && db.quizSubmissions.some((q) => q.userId === user.id && q.quizId === b.quizId && q.passed));
    if (!quizPassed) missing.push("Pass the quiz");
  }

  let assignmentSubmitted = true;
  if (assignmentBlocks.length && s.enforceAssignmentCompletion) {
    assignmentSubmitted = assignmentBlocks.every(
      (b) => b.type === "assignment" && db.assignmentSubmissions.some((a) => a.userId === user.id && a.assignmentId === b.assignmentId),
    );
    if (!assignmentSubmitted) missing.push("Submit the assignment");
  }

  let exercisePassed = true;
  if (exerciseBlocks.length) {
    exercisePassed = exerciseBlocks.every(
      (b) => b.type === "exercise" && db.exerciseSubmissions.some((e) => e.userId === user.id && e.exerciseId === b.exerciseId && e.status === "passed"),
    );
    if (!exercisePassed) missing.push("Pass all test cases in the exercise");
  }

  const dwellTimeMet = dwellSeconds >= s.lessonDwellTimeSeconds || videoBlocks.length > 0 || quizBlocks.length > 0;
  if (!dwellTimeMet) missing.push(`Spend at least ${s.lessonDwellTimeSeconds} seconds on the lesson`);

  return {
    videoWatched,
    quizPassed,
    assignmentSubmitted,
    exercisePassed,
    dwellTimeMet,
    allMet: videoWatched && quizPassed && assignmentSubmitted && exercisePassed && dwellTimeMet,
    missing,
  };
}

/** Upsert the progress row for a lesson. Returns the new status. */
export async function setLessonStatus(user: User, lesson: Lesson, status: ProgressStatus, dwellDelta = 0): Promise<ProgressStatus> {
  const now = new Date().toISOString();
  let finalStatus = status;
  await mutate((db) => {
    let row = db.progress.find((p) => p.userId === user.id && p.lessonId === lesson.id);
    if (!row) {
      row = {
        id: uid("prg"),
        userId: user.id,
        courseId: lesson.courseId,
        chapterId: lesson.chapterId,
        lessonId: lesson.id,
        status: "incomplete",
        dwellSeconds: 0,
        updatedAt: now,
      };
      db.progress.push(row);
    }
    // Never downgrade a completed lesson.
    if (row.status === "complete") {
      finalStatus = "complete";
    } else {
      row.status = status;
      if (status === "complete") row.completedAt = now;
    }
    row.dwellSeconds += Math.max(0, dwellDelta);
    row.updatedAt = now;

    const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === lesson.courseId);
    if (enrollment) enrollment.currentLessonId = lesson.id;
  });
  await logActivity(user.id, status === "complete" ? "lesson_complete" : "lesson_view", lesson.id);
  if (finalStatus === "complete") await awardPoints(user.id, "lesson_complete", { refId: lesson.id, courseId: lesson.courseId });
  if (finalStatus === "complete") await recalculateCourseProgress(user, lesson.courseId);
  return finalStatus;
}

/** Try to mark a lesson complete; returns the requirements if something is missing. */
export async function completeLesson(user: User, lesson: Lesson, dwellSeconds: number): Promise<{ completed: boolean; requirements: CompletionRequirements }> {
  const requirements = await getCompletionRequirements(user, lesson, dwellSeconds);
  if (!requirements.allMet) {
    await setLessonStatus(user, lesson, "partial");
    return { completed: false, requirements };
  }
  await setLessonStatus(user, lesson, "complete");
  return { completed: true, requirements };
}

/**
 * Recompute enrollment.progress and handle course completion side effects
 * (completedAt, certificate, badges, notification, program progress).
 */
export async function recalculateCourseProgress(user: User, courseId: string): Promise<number> {
  const db = await getDb();
  const total = db.lessons.filter((l) => l.courseId === courseId).length;
  const done = db.progress.filter((p) => p.userId === user.id && p.courseId === courseId && p.status === "complete").length;
  const pct = percent(done, total);
  const course = db.courses.find((c) => c.id === courseId);
  let justCompleted = false;

  await mutate((d) => {
    const enrollment = d.enrollments.find((e) => e.userId === user.id && e.courseId === courseId);
    if (!enrollment) return;
    enrollment.progress = pct;
    if (pct >= 100 && total > 0 && !enrollment.completedAt) {
      enrollment.completedAt = new Date().toISOString();
      justCompleted = true;
    }
    // Program progress = ceil(average course progress within the program), same rule as the programs area.
    for (const program of d.programs) {
      if (!program.courseIds.includes(courseId)) continue;
      const member = d.programMembers.find((m) => m.programId === program.id && m.userId === user.id);
      if (!member) continue;
      member.progress = computeProgramProgress(d, program, user.id);
    }
  });

  if (justCompleted && course) {
    await notify(user.id, {
      type: "system",
      subject: `You completed ${course.title}!`,
      message: "Congratulations on finishing the course.",
      link: `/courses/${course.slug}`,
    });
    await evaluateBadges(user.id, "course_completed");
    await awardPoints(user.id, "course_complete", { refId: courseId, courseId });
    if (course.enableCertification && !course.paidCertificate && db.settings.features.certifications) {
      await issueCertificate(user, course);
    }
    const streak = await getStreak(user.id);
    if (streak.current >= 7) await evaluateBadges(user.id, "streak_7", streak.current);
    if (streak.current >= 30) await evaluateBadges(user.id, "streak_30", streak.current);
  }
  return pct;
}

/** Issue a certificate for a course (idempotent per user/course). */
export async function issueCertificate(user: User, course: Course, opts: { batchId?: string; evaluatorId?: string; expiryDate?: string } = {}): Promise<Certificate> {
  const db = await getDb();
  const existing = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id);
  if (existing) return existing;
  const cert: Certificate = {
    id: uid("cert"),
    code: `LL-${shortCode(2, 4)}`,
    userId: user.id,
    courseId: course.id,
    batchId: opts.batchId,
    evaluatorId: opts.evaluatorId,
    issueDate: toDateKey(),
    expiryDate: opts.expiryDate,
    published: true,
  };
  await mutate((d) => {
    d.certificates.push(cert);
    const enrollment = d.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
    if (enrollment) enrollment.certificateId = cert.id;
  });
  await notify(user.id, {
    type: "certificate",
    subject: "Your certificate is ready",
    message: `Congratulations on completing ${course.title}!`,
    link: `/certificates/${cert.code}`,
  });
  await evaluateBadges(user.id, "certificate_issued");
  await awardPoints(user.id, "certificate", { refId: cert.id, courseId: course.id });
  return cert;
}
