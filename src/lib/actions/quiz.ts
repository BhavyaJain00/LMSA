"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionResult, Database, ViolationType } from "@/lib/types";
import { getCurrentUser, isCreator, isModerator } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { setFlash } from "@/lib/flash";
import { audit, auditEach, auditIdList } from "@/lib/audit";
import { awardQuizPoints } from "@/lib/services/points";
import { fd, fdNumber, uid } from "@/lib/utils";
import {
  canManageQuiz,
  checkQuizAnswer,
  gradeSubmission,
  recordQuizSubmission,
  revalidateQuizAttempt,
  recordQuizViolation,
  startQuizAttempt,
  type GradeOutcome,
  type QuizDoc,
} from "@/lib/data/quiz";
import {
  computeTotalMarks,
  MAX_MARKS,
  type CheckAnswerResult,
  type QuizQuestionRow,
  type SaveQuizInput,
  type StartAttemptResult,
  type SubmitQuizInput,
  type SubmitResult,
  type ViolationEvent,
} from "@/components/quiz/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Pages that list or render quizzes (route patterns carry their route groups so they match the page files). */
function revalidateQuizPages(quizId?: string) {
  revalidatePath("/admin/quizzes");
  revalidatePath("/admin/quizzes/submissions");
  if (quizId) revalidatePath(`/admin/quizzes/${quizId}`);
  revalidatePath("/(app)/quiz/[id]", "page");
  revalidatePath("/(learn)/courses/[slug]/learn/[ref]", "page");
  revalidatePath("/courses/[slug]/learn/[ref]", "page");
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Remove a quiz and everything that points at it (submissions, violations, lesson blocks, batch assessments). */
function removeQuizCascade(d: Database, quizId: string): void {
  d.quizzes = d.quizzes.filter((q) => q.id !== quizId);
  d.quizSubmissions = d.quizSubmissions.filter((s) => s.quizId !== quizId);
  d.quizViolations = d.quizViolations.filter((v) => v.quizId !== quizId);
  for (const lesson of d.lessons) {
    const uses = lesson.blocks.some(
      (b) => (b.type === "quiz" && b.quizId === quizId) || (b.type === "video" && !!b.quizMarkers?.some((m) => m.quizId === quizId)),
    );
    if (!uses) continue;
    lesson.blocks = lesson.blocks
      .filter((b) => !(b.type === "quiz" && b.quizId === quizId))
      .map((b) => (b.type === "video" && b.quizMarkers ? { ...b, quizMarkers: b.quizMarkers.filter((m) => m.quizId !== quizId) } : b));
    lesson.updatedAt = new Date().toISOString();
  }
  for (const batch of d.batches) {
    if (batch.assessments.some((a) => a.type === "quiz" && a.refId === quizId)) {
      batch.assessments = batch.assessments.filter((a) => !(a.type === "quiz" && a.refId === quizId));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Create / save / delete                                               */
/* ------------------------------------------------------------------ */

export async function createQuizAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!isCreator(user)) return { ok: false, error: "Only course creators and moderators can create quizzes." };

  const title = fd(formData, "title").replace(/\s+/g, " ");
  const courseId = fd(formData, "courseId");
  const passing = fdNumber(formData, "passingPercentage", NaN);
  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Give the quiz a title.";
  else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
  if (!Number.isFinite(passing) || passing < 0 || passing > 100) fieldErrors.passingPercentage = "Enter a percentage between 0 and 100.";

  const db = await getDb();
  if (courseId) {
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) fieldErrors.courseId = "That course no longer exists.";
    else if (!canManageCourse(user, course)) fieldErrors.courseId = "You can only attach quizzes to courses you manage.";
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the errors below.", fieldErrors };

  const now = new Date().toISOString();
  const quiz: QuizDoc = {
    id: uid("quiz"),
    title,
    courseId: courseId || undefined,
    questions: [],
    maxAttempts: 0,
    showAnswers: true,
    showSubmissionHistory: false,
    passingPercentage: Math.round(passing * 100) / 100,
    totalMarks: 0,
    shuffleQuestions: false,
    limitQuestionsTo: 0,
    durationSeconds: 0,
    enableNegativeMarking: false,
    marksToCut: 1,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 3,
    authorId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  await mutate((d) => {
    d.quizzes.push(quiz);
  });
  revalidatePath("/admin/quizzes");
  await setFlash("Quiz created. Add your first question.");
  redirect(`/admin/quizzes/${quiz.id}`);
}

export async function saveQuizAction(input: SaveQuizInput): Promise<ActionResult<{ updatedAt: string; totalMarks: number; showAnswers: boolean; limitQuestionsTo: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Log in again to save." };
  if (!input || typeof input.quizId !== "string" || !input.settings) return { ok: false, error: "Invalid request." };
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return { ok: false, error: "This quiz no longer exists." };
  if (!canManageQuiz(user, quiz, db)) return { ok: false, error: "You don't have permission to edit this quiz." };

  const s = input.settings;
  const fieldErrors: Record<string, string> = {};

  const title = String(s.title ?? "").trim().replace(/\s+/g, " ");
  if (!title) fieldErrors.title = "Title is required.";
  else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";

  const description = String(s.description ?? "").trim();
  if (description.length > 5000) fieldErrors.description = "Keep the description under 5,000 characters.";

  let courseId: string | undefined;
  if (s.courseId) {
    const course = db.courses.find((c) => c.id === s.courseId);
    if (!course) fieldErrors.courseId = "That course no longer exists.";
    else if (s.courseId !== quiz.courseId && !canManageCourse(user, course)) fieldErrors.courseId = "You can only attach quizzes to courses you manage.";
    else courseId = course.id;
  }

  const passingPercentage = num(s.passingPercentage, NaN);
  if (!Number.isFinite(passingPercentage) || passingPercentage < 0 || passingPercentage > 100) {
    fieldErrors.passingPercentage = "Passing percentage must be between 0 and 100.";
  }
  const maxAttempts = num(s.maxAttempts, NaN);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 1000) fieldErrors.maxAttempts = "Enter 0 (unlimited) or a whole number of attempts.";
  const durationMinutes = num(s.durationMinutes, NaN);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) fieldErrors.durationMinutes = "Enter 0 (no limit) or up to 1,440 minutes.";

  // Question rows.
  const rows: QuizQuestionRow[] = [];
  const seen = new Map<string, number>();
  const duplicates: number[] = [];
  (Array.isArray(input.questions) ? input.questions : []).forEach((row, i) => {
    const q = db.questions.find((x) => x.id === row?.questionId);
    if (!q) {
      fieldErrors.questions = `Question ${i + 1} no longer exists in the question bank.`;
      return;
    }
    if (seen.has(q.id)) duplicates.push(seen.get(q.id)! + 1, i + 1);
    seen.set(q.id, i);
    const marks = num(row.marks, NaN);
    if (!Number.isInteger(marks) || marks < 1 || marks > MAX_MARKS) {
      fieldErrors.questions = `Marks for question ${i + 1} must be a whole number between 1 and ${MAX_MARKS}.`;
    }
    rows.push({ questionId: q.id, marks });
  });
  if (duplicates.length) fieldErrors.questions = `Rows ${Array.from(new Set(duplicates)).sort((a, b) => a - b).join(", ")} have the duplicate questions.`;

  // Open-ended questions are graded by hand, so a quiz is either entirely open ended or has none.
  // Quizzes that already mixed both (created before this rule) can still be saved as long as no
  // question is added to them; removing questions is how they get back in line.
  const typeOf = (id: string) => db.questions.find((q) => q.id === id)?.type;
  const isMixed = (ids: string[]) => {
    const types = ids.map(typeOf);
    return types.includes("open_ended") && types.some((t) => t !== "open_ended");
  };
  const hasOpenEnded = rows.some((r) => typeOf(r.questionId) === "open_ended");
  if (isMixed(rows.map((r) => r.questionId))) {
    const previous = new Set(quiz.questions.map((r) => r.questionId));
    const legacy = isMixed(Array.from(previous)) && rows.every((r) => previous.has(r.questionId));
    if (!legacy) fieldErrors.questions = "If you want open ended questions then make sure each question in the quiz is of open ended type.";
  }

  const shuffleQuestions = !!s.shuffleQuestions;
  let limitQuestionsTo = shuffleQuestions ? num(s.limitQuestionsTo, NaN) : 0;
  if (shuffleQuestions) {
    if (!Number.isInteger(limitQuestionsTo) || limitQuestionsTo < 0) {
      fieldErrors.limitQuestionsTo = "Enter 0 (use all questions) or a whole number.";
      limitQuestionsTo = 0;
    } else if (limitQuestionsTo > 0) {
      if (limitQuestionsTo >= rows.length) fieldErrors.limitQuestionsTo = "Limit cannot be greater than or equal to the number of questions in the quiz.";
      else if (new Set(rows.map((r) => r.marks)).size > 1) fieldErrors.limitQuestionsTo = "All questions should have the same marks if the limit is set.";
    }
  }

  const enableNegativeMarking = !!s.enableNegativeMarking;
  const marksToCut = num(s.marksToCut, NaN);
  if (enableNegativeMarking && (!Number.isFinite(marksToCut) || marksToCut <= 0 || marksToCut > MAX_MARKS)) {
    fieldErrors.marksToCut = "Marks to deduct must be greater than 0.";
  }

  const enableProctoring = !!s.enableProctoring;
  const maxViolations = num(s.maxViolations, NaN);
  if (enableProctoring && (!Number.isInteger(maxViolations) || maxViolations < 1 || maxViolations > 50)) {
    fieldErrors.maxViolations = "Max violations must be a whole number between 1 and 50.";
  }

  const enableScheduling = !!s.enableScheduling;
  let scheduleStart: string | undefined;
  let scheduleEnd: string | undefined;
  if (enableScheduling) {
    const start = s.scheduleStart ? Date.parse(s.scheduleStart) : NaN;
    const end = s.scheduleEnd ? Date.parse(s.scheduleEnd) : NaN;
    if (!Number.isFinite(start)) fieldErrors.scheduleStart = "Set a start time, or turn scheduling off.";
    else scheduleStart = new Date(start).toISOString();
    if (s.scheduleEnd && !Number.isFinite(end)) fieldErrors.scheduleEnd = "Enter a valid date and time.";
    else if (Number.isFinite(end)) {
      if (Number.isFinite(start) && end <= start) fieldErrors.scheduleEnd = "The end time has to come after the start time.";
      else scheduleEnd = new Date(end).toISOString();
    }
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the highlighted fields.", fieldErrors };
  }

  // Open-ended answers are graded after submission, so there is nothing to reveal while answering.
  const showAnswers = !hasOpenEnded && !!s.showAnswers;
  const totalMarks = computeTotalMarks(rows, shuffleQuestions, limitQuestionsTo);
  const updatedAt = new Date().toISOString();

  await mutate((d) => {
    const row = d.quizzes.find((q) => q.id === quiz.id) as QuizDoc | undefined;
    if (!row) return;
    row.title = title;
    row.description = description || undefined;
    row.courseId = courseId;
    row.questions = rows;
    row.maxAttempts = maxAttempts;
    row.durationSeconds = Math.round(durationMinutes * 60);
    row.passingPercentage = Math.round(passingPercentage * 100) / 100;
    row.totalMarks = totalMarks;
    row.showAnswers = showAnswers;
    row.showSubmissionHistory = !!s.showSubmissionHistory;
    row.shuffleQuestions = shuffleQuestions;
    row.limitQuestionsTo = limitQuestionsTo;
    row.enableNegativeMarking = enableNegativeMarking;
    row.marksToCut = enableNegativeMarking ? marksToCut : Number.isFinite(marksToCut) && marksToCut > 0 ? marksToCut : row.marksToCut;
    row.enableProctoring = enableProctoring;
    row.maxViolations = enableProctoring ? maxViolations : Number.isInteger(maxViolations) && maxViolations > 0 ? maxViolations : row.maxViolations;
    row.enableScheduling = enableScheduling;
    row.scheduleStart = scheduleStart;
    row.scheduleEnd = scheduleEnd;
    row.updatedAt = updatedAt;
  });

  revalidateQuizPages(quiz.id);
  return { ok: true, data: { updatedAt, totalMarks, showAnswers, limitQuestionsTo }, message: "Quiz updated successfully" };
}

export async function deleteQuizAction(quizId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === quizId);
  if (!quiz) return { ok: false, error: "This quiz no longer exists." };
  if (!canManageQuiz(user, quiz, db)) return { ok: false, error: "You don't have permission to delete this quiz." };
  const submissions = db.quizSubmissions.filter((s) => s.quizId === quiz.id).length;
  if (submissions > 0 && !isModerator(user)) {
    return {
      ok: false,
      error: `This quiz has ${submissions} ${submissions === 1 ? "submission" : "submissions"}. Only moderators can delete a quiz that learners have taken.`,
    };
  }
  await mutate((d) => removeQuizCascade(d, quiz.id));
  await audit(user, "quiz.delete", { type: "quiz", id: quiz.id }, { title: quiz.title, submissions, ...(quiz.courseId ? { courseId: quiz.courseId } : {}) });
  revalidateQuizPages();
  return { ok: true, data: undefined, message: "Quiz deleted successfully" };
}

export async function deleteQuizzesAction(ids: string[]): Promise<ActionResult<{ deleted: number; failed: { id: string; title: string; error: string }[] }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: "Select at least one quiz." };
  const db = await getDb();
  const failed: { id: string; title: string; error: string }[] = [];
  const toDelete: string[] = [];
  for (const id of Array.from(new Set(ids))) {
    const quiz = db.quizzes.find((q) => q.id === id);
    if (!quiz) {
      failed.push({ id, title: id, error: "Quiz not found" });
      continue;
    }
    if (!canManageQuiz(user, quiz, db)) {
      failed.push({ id, title: quiz.title, error: "Not permitted" });
      continue;
    }
    const subs = db.quizSubmissions.filter((s) => s.quizId === id).length;
    if (subs > 0 && !isModerator(user)) {
      failed.push({ id, title: quiz.title, error: `${subs} ${subs === 1 ? "submission exists" : "submissions exist"}` });
      continue;
    }
    toDelete.push(id);
  }
  if (toDelete.length) {
    // Captured before the cascade (the store snapshot is live and loses these rows).
    const removed = toDelete.map((id) => ({
      id,
      meta: { title: db.quizzes.find((q) => q.id === id)?.title ?? id, submissions: db.quizSubmissions.filter((s) => s.quizId === id).length },
    }));
    await mutate((d) => {
      for (const id of toDelete) removeQuizCascade(d, id);
    });
    await auditEach(user, "quiz.delete", "quiz", removed, { bulk: true });
    revalidateQuizPages();
  }
  return { ok: true, data: { deleted: toDelete.length, failed } };
}

/* ------------------------------------------------------------------ */
/* Taking a quiz                                                        */
/* ------------------------------------------------------------------ */

/**
 * Grade and store an attempt. `recordQuizSubmission` re-checks access, the
 * schedule and the attempt limit, and — for a passing attempt taken inside a
 * lesson — completes the lesson (services/progress.completeLesson with a
 * dwell of 9999s), evaluates "quiz_passed" badges and logs the activity.
 * The lesson player, course page and dashboard are revalidated so the
 * lesson's completion shows up immediately (the runner also calls
 * router.refresh()).
 */
export async function submitQuizAction(input: SubmitQuizInput): Promise<ActionResult<SubmitResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Log in again to submit the quiz." };
  const result = await recordQuizSubmission(user, input);
  if (result.ok && !result.data.preview) {
    await awardQuizPoints(result.data.submission.id);
    await revalidateQuizAttempt({
      quizId: input.quizId,
      submissionId: result.data.submission.id,
      lessonId: typeof input.lessonId === "string" ? input.lessonId : undefined,
      courseId: typeof input.courseId === "string" ? input.courseId : undefined,
    });
  }
  return result;
}

/** Issue a live attempt (server-side start time and question selection). */
export async function startQuizAttemptAction(quizId: string): Promise<ActionResult<StartAttemptResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to access the quiz." };
  if (typeof quizId !== "string") return { ok: false, error: "Invalid request." };
  return startQuizAttempt(user, quizId);
}

export async function checkAnswerAction(input: {
  quizId: string;
  questionId: string;
  answer: string[];
  attemptToken?: string;
}): Promise<ActionResult<CheckAnswerResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Log in again." };
  return checkQuizAnswer(user, input);
}

export async function logQuizViolationAction(input: {
  quizId: string;
  eventType: ViolationType;
  attemptToken: string;
}): Promise<ActionResult<{ event: ViolationEvent; count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired." };
  return recordQuizViolation(user, input);
}

/* ------------------------------------------------------------------ */
/* Grading & submissions                                                */
/* ------------------------------------------------------------------ */

export async function gradeSubmissionAction(input: { submissionId: string; marks: Record<string, number> }): Promise<ActionResult<GradeOutcome>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Log in again to save." };
  if (!isCreator(user)) return { ok: false, error: "Only instructors and moderators can grade quizzes." };
  const result = await gradeSubmission(user, input);
  if (result.ok) {
    await awardQuizPoints(input.submissionId);
    const db = await getDb();
    const submission = db.quizSubmissions.find((s) => s.id === input.submissionId);
    revalidatePath(`/admin/quizzes/submissions/${input.submissionId}`);
    revalidatePath(`/quiz/submissions/${input.submissionId}`);
    // A passing grade can complete the learner's lesson, so refresh the learning pages too.
    if (submission) await revalidateQuizAttempt({ quizId: submission.quizId, submissionId: submission.id });
    else revalidateQuizPages();
  }
  return result;
}

export async function deleteSubmissionsAction(ids: string[]): Promise<ActionResult<{ deleted: number; failed: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again." };
  if (!isCreator(user)) return { ok: false, error: "Only instructors and moderators can delete submissions." };
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: "Select at least one submission." };
  const db = await getDb();
  const allowed = new Set<string>();
  let failed = 0;
  for (const id of Array.from(new Set(ids))) {
    const sub = db.quizSubmissions.find((s) => s.id === id);
    if (!sub) {
      failed++;
      continue;
    }
    const quiz = db.quizzes.find((q) => q.id === sub.quizId);
    const ok = quiz ? canManageQuiz(user, quiz, db) : isModerator(user);
    if (ok) allowed.add(id);
    else failed++;
  }
  if (allowed.size) {
    const quizIds = Array.from(new Set(db.quizSubmissions.filter((s) => allowed.has(s.id)).map((s) => s.quizId)));
    await mutate((d) => {
      d.quizSubmissions = d.quizSubmissions.filter((s) => !allowed.has(s.id));
      d.quizViolations = d.quizViolations.filter((v) => !v.submissionId || !allowed.has(v.submissionId));
    });
    await audit(user, "quiz.submissions_delete", undefined, {
      count: allowed.size,
      quizIds: auditIdList(quizIds),
      submissionIds: auditIdList(Array.from(allowed)),
    });
    revalidatePath("/admin/quizzes/submissions");
    revalidatePath("/admin/quizzes");
  }
  return { ok: true, data: { deleted: allowed.size, failed } };
}
