import "server-only";
import type {
  ActionResult,
  Course,
  Database,
  Lesson,
  PublicUser,
  Question,
  Quiz,
  QuizResultRow,
  QuizSubmission,
  User,
  ViolationType,
} from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { canManageCourse, getCourseOutline, getLessonHref } from "@/lib/data/courses";
import { isCreator, isModerator, toPublicUser } from "@/lib/auth/session";
import { completeLesson } from "@/lib/services/progress";
import { evaluateBadges } from "@/lib/services/badges";
import { logActivity } from "@/lib/services/activity";
import { notify, notifyMany } from "@/lib/services/notifications";
import { stripMarkdown, uid, unique } from "@/lib/utils";
import {
  computeTotalMarks,
  formatScore,
  getScheduleState,
  submissionReasonLabels,
  submissionStatus,
  toUiType,
  type AttemptSummary,
  type CheckAnswerResult,
  type CourseOption,
  type QuestionBankItem,
  type QuizEditorData,
  type QuizListItem,
  type ResultDetail,
  type ResultOption,
  type RunnerPayload,
  type RunnerQuestion,
  type RunnerQuiz,
  type SubmissionListItem,
  type SubmissionStatus,
  type SubmitQuizInput,
  type SubmitResult,
  type UiQuestionType,
  type ViolationEvent,
} from "@/components/quiz/types";

/**
 * Quiz domain logic: access rules, runner payloads, grading, submissions,
 * proctoring logs and the read models used by the admin screens.
 *
 * Mutations that must be shared between Server Actions and Route Handlers
 * (a quiz can also be submitted through a `sendBeacon` request when the
 * learner closes the tab) live here; everything else is in lib/actions.
 */

/**
 * Quizzes may carry an optional markdown `description` (instructions shown on
 * the intro card). It is stored on the record but not declared on `Quiz`.
 */
export type QuizDoc = Quiz & { description?: string };

export function quizDescription(quiz: Quiz): string {
  const d = (quiz as QuizDoc).description;
  return typeof d === "string" ? d : "";
}

function fail(error: string, fieldErrors?: Record<string, string>): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  return { ok: false, error, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* Placements & permissions                                             */
/* ------------------------------------------------------------------ */

export function lessonUsesQuiz(lesson: Lesson, quizId: string): boolean {
  return lesson.blocks.some(
    (b) => (b.type === "quiz" && b.quizId === quizId) || (b.type === "video" && !!b.quizMarkers?.some((m) => m.quizId === quizId)),
  );
}

export interface QuizPlacement {
  lesson: Lesson;
  course: Course | null;
}

/** Lessons that embed the quiz (quiz blocks and in-video quiz markers). */
export function findQuizPlacements(db: Database, quiz: Pick<Quiz, "id" | "lessonId">): QuizPlacement[] {
  const out: QuizPlacement[] = [];
  const seen = new Set<string>();
  for (const lesson of db.lessons) {
    if (!lessonUsesQuiz(lesson, quiz.id)) continue;
    seen.add(lesson.id);
    out.push({ lesson, course: db.courses.find((c) => c.id === lesson.courseId) ?? null });
  }
  if (quiz.lessonId && !seen.has(quiz.lessonId)) {
    const lesson = db.lessons.find((l) => l.id === quiz.lessonId);
    if (lesson) out.push({ lesson, course: db.courses.find((c) => c.id === lesson.courseId) ?? null });
  }
  return out;
}

/** Every course the quiz belongs to (explicit course first, then courses of lessons that embed it). */
export function quizCourseIds(db: Database, quiz: Pick<Quiz, "id" | "lessonId" | "courseId">): string[] {
  const ids = findQuizPlacements(db, quiz)
    .map((p) => p.course?.id)
    .filter((id): id is string => !!id);
  if (quiz.courseId) ids.unshift(quiz.courseId);
  return unique(ids);
}

function primaryCourse(db: Database, quiz: Quiz): Course | null {
  const id = quizCourseIds(db, quiz)[0];
  return id ? (db.courses.find((c) => c.id === id) ?? null) : null;
}

/** Moderators manage every quiz; creators manage quizzes they wrote or that live in their courses. */
export function canManageQuiz(user: Pick<User, "id" | "roles"> | null | undefined, quiz: Quiz, db: Database): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  if (!isCreator(user)) return false;
  if (quiz.authorId === user.id) return true;
  return quizCourseIds(db, quiz).some((cid) => {
    const course = db.courses.find((c) => c.id === cid);
    return course ? canManageCourse(user, course) : false;
  });
}

/** Moderators edit any question; creators edit the questions they wrote. */
export function canEditQuestion(user: Pick<User, "id" | "roles"> | null | undefined, question: Question): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  return isCreator(user) && question.authorId === user.id;
}

/** Courses a user may attach a quiz to. */
export function manageableCourses(user: Pick<User, "id" | "roles">, db: Database): CourseOption[] {
  return db.courses
    .filter((c) => canManageCourse(user, c))
    .map((c) => ({ id: c.id, title: c.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type QuizAccess = { ok: true; manage: boolean } | { ok: false; reason: "guest" | "forbidden" | "locked"; message: string };

/**
 * Who may take a quiz (mirrors Frappe's can_access_quiz):
 *  - managers (moderators, the author, instructors of a course that uses it)
 *  - learners enrolled in a course that embeds it, unless the lesson is locked
 *    by sequential completion
 *  - anyone logged in, for a free-preview lesson of a published course
 *  - instructors and members of a batch whose assessments list the quiz
 */
export async function getQuizAccess(user: User | null, quiz: Quiz): Promise<QuizAccess> {
  if (!user) return { ok: false, reason: "guest", message: "Please log in to access the quiz." };
  const db = await getDb();
  if (canManageQuiz(user, quiz, db)) return { ok: true, manage: true };

  let locked = false;
  for (const placement of findQuizPlacements(db, quiz)) {
    const course = placement.course;
    if (!course) continue;
    const enrolled = db.enrollments.some((e) => e.userId === user.id && e.courseId === course.id);
    if (enrolled) {
      if (!course.enforceLessonCompletion) return { ok: true, manage: false };
      const outline = await getCourseOutline(course, user);
      const row = outline.flatMap((c) => c.lessons).find((l) => l.id === placement.lesson.id);
      if (row && !row.locked) return { ok: true, manage: false };
      locked = true;
      continue;
    }
    if (course.published && placement.lesson.includeInPreview) return { ok: true, manage: false };
  }
  if (quiz.courseId && db.enrollments.some((e) => e.userId === user.id && e.courseId === quiz.courseId)) {
    return { ok: true, manage: false };
  }
  for (const batch of db.batches) {
    if (!batch.assessments.some((a) => a.type === "quiz" && a.refId === quiz.id)) continue;
    if (batch.instructorIds.includes(user.id)) return { ok: true, manage: false };
    if (db.batchEnrollments.some((b) => b.batchId === batch.id && b.userId === user.id)) return { ok: true, manage: false };
  }
  if (locked) return { ok: false, reason: "locked", message: "Complete the previous lessons to unlock this quiz." };
  return { ok: false, reason: "forbidden", message: "You are not authorized to view this quiz." };
}

/* ------------------------------------------------------------------ */
/* Questions of a quiz                                                  */
/* ------------------------------------------------------------------ */

export interface QuizEntry {
  question: Question;
  marks: number;
}

/** Resolve the quiz rows to questions, dropping rows whose question no longer exists. */
export function resolveQuizQuestions(db: Database, quiz: Pick<Quiz, "questions">): QuizEntry[] {
  const byId = new Map(db.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const out: QuizEntry[] = [];
  for (const row of quiz.questions) {
    if (seen.has(row.questionId)) continue;
    const question = byId.get(row.questionId);
    if (!question) continue;
    seen.add(row.questionId);
    out.push({ question, marks: row.marks });
  }
  return out;
}

/** How many questions one attempt contains (the limit only applies when shuffling). */
export function attemptQuestionCount(quiz: Pick<Quiz, "shuffleQuestions" | "limitQuestionsTo">, total: number): number {
  if (quiz.shuffleQuestions && quiz.limitQuestionsTo > 0 && quiz.limitQuestionsTo < total) return quiz.limitQuestionsTo;
  return total;
}

export function toRunnerQuestion(entry: QuizEntry): RunnerQuestion {
  const q = entry.question;
  return {
    id: q.id,
    text: q.text,
    type: q.type,
    multiple: q.type === "choices" && q.multiple,
    marks: entry.marks,
    options: q.type === "choices" ? q.options.map((o) => ({ id: o.id, text: o.text })) : [],
  };
}

export function buildRunnerQuiz(db: Database, quiz: Quiz, withholdQuestions: boolean): RunnerQuiz {
  const entries = resolveQuizQuestions(db, quiz);
  const course = primaryCourse(db, quiz);
  const description = quizDescription(quiz);
  return {
    id: quiz.id,
    title: quiz.title,
    description: description || undefined,
    courseId: course?.id,
    courseTitle: course?.title,
    questionCount: attemptQuestionCount(quiz, entries.length),
    totalMarks: computeTotalMarks(
      entries.map((e) => ({ questionId: e.question.id, marks: e.marks })),
      quiz.shuffleQuestions,
      quiz.limitQuestionsTo,
    ),
    passingPercentage: quiz.passingPercentage,
    maxAttempts: quiz.maxAttempts,
    showAnswers: quiz.showAnswers,
    showSubmissionHistory: quiz.showSubmissionHistory,
    shuffleQuestions: quiz.shuffleQuestions,
    limitQuestionsTo: quiz.limitQuestionsTo,
    durationSeconds: quiz.durationSeconds,
    enableNegativeMarking: quiz.enableNegativeMarking,
    marksToCut: quiz.marksToCut,
    enableScheduling: quiz.enableScheduling,
    scheduleStart: quiz.scheduleStart,
    scheduleEnd: quiz.scheduleEnd,
    enableProctoring: quiz.enableProctoring,
    maxViolations: quiz.maxViolations,
    questions: withholdQuestions ? [] : entries.map(toRunnerQuestion),
    questionsWithheld: withholdQuestions,
    hasOpenEnded: entries.some((e) => e.question.type === "open_ended"),
  };
}

export function toAttemptSummary(s: QuizSubmission): AttemptSummary {
  return {
    id: s.id,
    submittedAt: s.submittedAt,
    score: s.score,
    scoreOutOf: s.scoreOutOf,
    percentage: s.percentage,
    passed: s.passed,
    pendingGrading: s.pendingGrading,
    submissionReason: s.submissionReason,
    violationCount: s.violationCount,
    timeTakenSeconds: s.timeTakenSeconds,
  };
}

export function getAttemptSummaries(db: Database, userId: string, quizId: string): AttemptSummary[] {
  return db.quizSubmissions
    .filter((s) => s.userId === userId && s.quizId === quizId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(toAttemptSummary);
}

/** Everything the runner needs for one viewer. Questions are withheld while the schedule is closed. */
export async function getRunnerPayload(quiz: Quiz, user: User, manage: boolean): Promise<RunnerPayload> {
  const db = await getDb();
  const serverTime = Date.now();
  const schedule = getScheduleState(quiz, serverTime);
  const withhold = !manage && schedule.state !== "open";
  return {
    quiz: buildRunnerQuiz(db, quiz, withhold),
    attempts: getAttemptSummaries(db, user.id, quiz.id),
    canManage: manage,
    serverTime,
  };
}

/* ------------------------------------------------------------------ */
/* Grading                                                              */
/* ------------------------------------------------------------------ */

const MAX_INPUT_ANSWER = 500;
const MAX_OPEN_ANSWER = 20000;

function normalizeAnswer(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface GradedAnswer {
  answer: string[];
  answered: boolean;
  isCorrect: boolean;
  marks: number;
  graded: boolean;
}

/**
 * Grade one answer.
 *  - choices: correct only when the selected set equals the correct set
 *  - user_input: case-insensitive, trimmed (whitespace-normalised) match against any accepted answer
 *  - open_ended: stored for manual grading (0 marks until graded)
 * With negative marking, a wrong (answered) choice/user-input answer costs `marksToCut`.
 */
export function gradeAnswer(
  question: Question,
  rawAnswer: string[] | undefined,
  marks: number,
  quiz: Pick<Quiz, "enableNegativeMarking" | "marksToCut">,
): GradedAnswer {
  const answer = Array.isArray(rawAnswer) ? rawAnswer.filter((a): a is string => typeof a === "string") : [];
  const penalty = quiz.enableNegativeMarking && quiz.marksToCut > 0 ? quiz.marksToCut : 0;

  if (question.type === "choices") {
    const valid = new Set(question.options.map((o) => o.id));
    let selected = unique(answer.filter((a) => valid.has(a)));
    if (!question.multiple) selected = selected.slice(0, 1);
    const correct = question.options.filter((o) => o.isCorrect).map((o) => o.id);
    const answered = selected.length > 0;
    const isCorrect = answered && selected.length === correct.length && selected.every((id) => correct.includes(id));
    return { answer: selected, answered, isCorrect, marks: isCorrect ? marks : answered ? -penalty : 0, graded: true };
  }

  if (question.type === "user_input") {
    const text = (answer[0] ?? "").slice(0, MAX_INPUT_ANSWER).trim();
    const answered = text.length > 0;
    const isCorrect = answered && question.possibilities.some((p) => normalizeAnswer(p) === normalizeAnswer(text));
    return { answer: answered ? [text] : [], answered, isCorrect, marks: isCorrect ? marks : answered ? -penalty : 0, graded: true };
  }

  const text = (answer[0] ?? "").slice(0, MAX_OPEN_ANSWER).trim();
  // A blank open-ended answer has nothing to grade.
  return { answer: text ? [text] : [], answered: !!text, isCorrect: false, marks: 0, graded: !text };
}

export function computeScore(rows: Pick<QuizResultRow, "marks" | "marksOutOf">[]): { score: number; scoreOutOf: number; percentage: number } {
  const score = Math.round(rows.reduce((a, r) => a + r.marks, 0) * 100) / 100;
  const scoreOutOf = rows.reduce((a, r) => a + r.marksOutOf, 0);
  const raw = scoreOutOf > 0 ? Math.max(0, (score / scoreOutOf) * 100) : 0;
  return { score, scoreOutOf, percentage: Math.round(raw * 10) / 10 };
}

export function optionOutcomes(question: Question, selected: string[], withExplanations: boolean): ResultOption[] {
  return question.options.map((o) => {
    const picked = selected.includes(o.id);
    return {
      id: o.id,
      text: o.text,
      isCorrect: o.isCorrect,
      outcome: picked ? (o.isCorrect ? "correct" : "wrong") : o.isCorrect ? "missed" : "untouched",
      explanation: withExplanations && o.explanation?.trim() ? o.explanation : undefined,
    };
  });
}

/** Per-question breakdown of a submission. Correctness, marks and answer keys only when `reveal`. */
export function buildBreakdown(results: QuizResultRow[], questionsById: Map<string, Question>, reveal: boolean): ResultDetail[] {
  return results.map((row, i) => {
    const q = questionsById.get(row.questionId);
    const answerTexts =
      row.questionType === "choices"
        ? row.answer.map((id) => q?.options.find((o) => o.id === id)?.text ?? id)
        : row.answer.filter((a) => a.trim().length > 0);
    const detail: ResultDetail = {
      questionId: row.questionId,
      index: i + 1,
      text: row.questionText || q?.text || "",
      type: row.questionType,
      multiple: row.questionType === "choices" && (q?.multiple ?? row.answer.length > 1),
      answerTexts,
      answered: answerTexts.length > 0,
      marksOutOf: row.marksOutOf,
      graded: row.graded,
    };
    if (reveal) {
      detail.isCorrect = row.isCorrect;
      detail.marks = row.marks;
      if (row.questionType === "choices" && q) detail.options = optionOutcomes(q, row.answer, true);
      if (row.questionType === "user_input" && q) detail.possibilities = [...q.possibilities];
    }
    return detail;
  });
}

function questionMap(db: Database): Map<string, Question> {
  return new Map(db.questions.map((q) => [q.id, q]));
}

/* ------------------------------------------------------------------ */
/* Submitting                                                           */
/* ------------------------------------------------------------------ */

/** Grace period after the timer / schedule end for slow networks (seconds). */
const SUBMIT_GRACE_SECONDS = 120;

function sanitizeAnswers(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[key] = value.filter((v): v is string => typeof v === "string").slice(0, 20);
  }
  return out;
}

function clampInt(value: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/**
 * Grade and store a quiz attempt. Enforces access, schedule, attempts and the
 * proctoring rules; runs the lesson/badge/activity side effects on success.
 * With `input.preview` (managers only) the attempt is graded but not stored.
 */
export async function recordQuizSubmission(user: User, input: SubmitQuizInput): Promise<ActionResult<SubmitResult>> {
  if (!input || typeof input.quizId !== "string") return fail("Invalid submission.");
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return fail("This quiz no longer exists.");

  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail("You are not authorized to submit this quiz.");
  const preview = input.preview === true;
  if (preview && !access.manage) return fail("Only people who manage this quiz can preview it.");

  const now = Date.now();
  const startedMs = typeof input.startedAt === "string" ? Date.parse(input.startedAt) : NaN;
  const hasStart = Number.isFinite(startedMs) && startedMs <= now + 60_000;

  if (!preview && !access.manage && quiz.enableScheduling) {
    const schedule = getScheduleState(quiz, now);
    if (schedule.state === "not_started") return fail(`${quiz.title} opens on ${formatWhen(schedule.opensAt)}.`);
    if (schedule.state === "ended") {
      const end = Date.parse(schedule.endedAt);
      const allowance = (quiz.durationSeconds || 0) + SUBMIT_GRACE_SECONDS;
      const startedInWindow = hasStart && startedMs <= end;
      if (!startedInWindow || now > end + allowance * 1000) return fail(`The schedule for ${quiz.title} has ended.`);
    }
  }

  if (!preview && quiz.maxAttempts > 0) {
    const used = db.quizSubmissions.filter((s) => s.quizId === quiz.id && s.userId === user.id).length;
    if (used >= quiz.maxAttempts) return fail(`You have exceeded the maximum number of attempts (${quiz.maxAttempts}) for this quiz.`);
  }

  const entries = resolveQuizQuestions(db, quiz);
  if (!entries.length) return fail("This quiz has no questions available yet.");
  const expected = attemptQuestionCount(quiz, entries.length);
  const byId = new Map(entries.map((e) => [e.question.id, e]));
  const ids = unique((Array.isArray(input.questionIds) ? input.questionIds : []).filter((id): id is string => typeof id === "string"));
  if (ids.length !== expected || ids.some((id) => !byId.has(id))) {
    return fail("This quiz was updated while you were taking it. Reload the page and try again.");
  }

  const answers = sanitizeAnswers(input.answers);
  const results: QuizResultRow[] = ids.map((id) => {
    const { question, marks } = byId.get(id)!;
    const g = gradeAnswer(question, answers[id], marks, quiz);
    return {
      questionId: id,
      questionText: question.text,
      questionType: question.type,
      answer: g.answer,
      isCorrect: g.isCorrect,
      marks: g.marks,
      marksOutOf: marks,
      graded: g.graded,
    };
  });
  const { score, scoreOutOf, percentage } = computeScore(results);
  const pendingGrading = results.some((r) => !r.graded);
  const passed = !pendingGrading && percentage >= quiz.passingPercentage;

  // Time taken: trust the client only up to the time that actually elapsed on the server.
  const elapsed = hasStart ? Math.max(0, Math.round((now - startedMs) / 1000)) : null;
  let timeTaken = clampInt(input.timeTakenSeconds, 0, 7 * 86400);
  if (elapsed !== null) timeTaken = timeTaken > 0 ? Math.min(timeTaken, elapsed) : elapsed;
  if (quiz.durationSeconds > 0) timeTaken = Math.min(timeTaken, quiz.durationSeconds);

  let reason: string | undefined;
  if (input.submissionReason === "timer_expired" && quiz.durationSeconds > 0) reason = submissionReasonLabels.timer_expired;
  else if (input.submissionReason === "browser_closed") reason = submissionReasonLabels.browser_closed;
  if (!reason && quiz.durationSeconds > 0 && elapsed !== null && elapsed > quiz.durationSeconds + SUBMIT_GRACE_SECONDS) {
    reason = submissionReasonLabels.timer_expired;
  }

  // Proctoring: the stored events are authoritative; the client count covers events that failed to log.
  let violationCount = 0;
  let linkedViolationIds: string[] = [];
  if (quiz.enableProctoring && !preview) {
    const since = hasStart ? startedMs - 5000 : now - Math.max(quiz.durationSeconds, 3600) * 1000;
    const events = db.quizViolations.filter(
      (v) => v.quizId === quiz.id && v.userId === user.id && !v.submissionId && Date.parse(v.timestamp) >= since,
    );
    linkedViolationIds = events.map((e) => e.id);
    const reported = clampInt(input.violationCount, 0, 1000);
    violationCount = Math.max(events.length, Math.min(reported, quiz.maxViolations));
    if (quiz.maxViolations > 0 && violationCount >= quiz.maxViolations) reason = submissionReasonLabels.max_violations;
  }

  const questionsById = questionMap(db);
  const reveal = access.manage || quiz.showAnswers;
  const submittedAt = new Date(now).toISOString();

  if (preview) {
    const summary: AttemptSummary = {
      id: "preview",
      submittedAt,
      score,
      scoreOutOf,
      percentage,
      passed,
      pendingGrading,
      submissionReason: reason,
      violationCount: 0,
      timeTakenSeconds: timeTaken,
    };
    return {
      ok: true,
      data: {
        submission: summary,
        breakdown: buildBreakdown(results, questionsById, true),
        revealed: true,
        attempts: [],
        lessonCompleted: false,
        preview: true,
      },
    };
  }

  // Resolve where the attempt happened (only lessons that really embed this quiz count).
  let lesson: Lesson | null = null;
  if (input.lessonId) {
    const candidate = db.lessons.find((l) => l.id === input.lessonId);
    if (candidate && (lessonUsesQuiz(candidate, quiz.id) || quiz.lessonId === candidate.id)) lesson = candidate;
  }
  const courseIds = quizCourseIds(db, quiz);
  const courseId = lesson?.courseId ?? (input.courseId && courseIds.includes(input.courseId) ? input.courseId : undefined) ?? courseIds[0];

  const submission: QuizSubmission = {
    id: uid("qsub"),
    quizId: quiz.id,
    quizTitle: quiz.title,
    userId: user.id,
    courseId,
    lessonId: lesson?.id,
    results,
    score,
    scoreOutOf,
    percentage,
    passingPercentage: quiz.passingPercentage,
    passed,
    violationCount,
    submissionReason: reason,
    timeTakenSeconds: timeTaken,
    pendingGrading,
    submittedAt,
  };

  const stored = await mutate((d) => {
    if (quiz.maxAttempts > 0) {
      const used = d.quizSubmissions.filter((s) => s.quizId === quiz.id && s.userId === user.id).length;
      if (used >= quiz.maxAttempts) return false;
    }
    d.quizSubmissions.push(submission);
    if (linkedViolationIds.length) {
      const set = new Set(linkedViolationIds);
      for (const v of d.quizViolations) if (set.has(v.id)) v.submissionId = submission.id;
    }
    return true;
  });
  if (!stored) return fail(`You have exceeded the maximum number of attempts (${quiz.maxAttempts}) for this quiz.`);

  await logActivity(user.id, "quiz_submit", quiz.id);

  let lessonCompleted = false;
  if (passed) {
    if (lesson) {
      try {
        const res = await completeLesson(user, lesson, 9999);
        lessonCompleted = res.completed;
      } catch (err) {
        console.error("[quiz] could not update lesson progress", err);
      }
    }
    await evaluateBadges(user.id, "quiz_passed", percentage);
  }

  if (pendingGrading) {
    const graders = new Set<string>();
    const course = courseId ? db.courses.find((c) => c.id === courseId) : null;
    course?.instructorIds.forEach((id) => graders.add(id));
    graders.add(quiz.authorId);
    graders.delete(user.id);
    await notifyMany(Array.from(graders), {
      type: "system",
      subject: `${user.name} submitted ${quiz.title} for grading`,
      message: "An open-ended answer is waiting for your review.",
      link: `/admin/quizzes/submissions/${submission.id}`,
      fromUserId: user.id,
    });
  }

  const fresh = await getDb();
  return {
    ok: true,
    data: {
      submission: toAttemptSummary(submission),
      breakdown: buildBreakdown(results, questionsById, reveal),
      revealed: reveal,
      attempts: getAttemptSummaries(fresh, user.id, quiz.id),
      lessonCompleted,
      preview: false,
    },
  };
}

/** Live answer check for quizzes that reveal answers after each question. */
export async function checkQuizAnswer(
  user: User,
  input: { quizId: string; questionId: string; answer: string[] },
): Promise<ActionResult<CheckAnswerResult>> {
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail("You are not authorized to view this quiz.");
  if (!quiz.showAnswers && !access.manage) return fail("Live answer checking is not enabled for this quiz.");
  const entry = resolveQuizQuestions(db, quiz).find((e) => e.question.id === input.questionId);
  if (!entry) return fail("Question not found in this quiz.");
  if (entry.question.type === "open_ended") return fail("Open-ended answers are graded by your instructor.");
  const graded = gradeAnswer(entry.question, input.answer, entry.marks, { enableNegativeMarking: false, marksToCut: 0 });
  if (!graded.answered) return fail(entry.question.type === "choices" ? "Please select an option" : "Please type an answer");
  return {
    ok: true,
    data: {
      questionId: entry.question.id,
      isCorrect: graded.isCorrect,
      options: entry.question.type === "choices" ? optionOutcomes(entry.question, graded.answer, true) : undefined,
    },
  };
}

/** Questions for a runner whose schedule has just opened. */
export async function loadRunnerQuestions(user: User, quizId: string): Promise<ActionResult<RunnerQuestion[]>> {
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail(access.message);
  const schedule = getScheduleState(quiz, Date.now());
  if (!access.manage && schedule.state === "not_started") return fail(`${quiz.title} is not open yet.`);
  if (!access.manage && schedule.state === "ended") return fail(`The schedule for ${quiz.title} has ended.`);
  return { ok: true, data: resolveQuizQuestions(db, quiz).map(toRunnerQuestion) };
}

/* ------------------------------------------------------------------ */
/* Proctoring                                                           */
/* ------------------------------------------------------------------ */

const VIOLATION_TYPES: ViolationType[] = ["tab_switch", "focus_loss", "fullscreen_exit", "copy_paste"];
const MAX_EVENTS_PER_ATTEMPT = 200;

/**
 * Log one proctoring event for the attempt that started at `startedAt`.
 * Events are warnings until the count reaches `maxViolations`; that event is a
 * violation (and the client auto-submits).
 */
export async function recordQuizViolation(
  user: User,
  input: { quizId: string; eventType: ViolationType; startedAt: string },
): Promise<ActionResult<{ event: ViolationEvent; count: number }>> {
  if (!VIOLATION_TYPES.includes(input.eventType)) return fail("Unknown event type.");
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  if (!quiz.enableProctoring) return fail("Proctoring is not enabled for this quiz.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail("You are not authorized to take this quiz.");
  const started = Date.parse(input.startedAt);
  const now = Date.now();
  if (!Number.isFinite(started) || started > now + 60_000) return fail("Invalid attempt.");

  const result = await mutate((d): { event: ViolationEvent; count: number } | null => {
    const existing = d.quizViolations.filter(
      (v) => v.quizId === quiz.id && v.userId === user.id && !v.submissionId && Date.parse(v.timestamp) >= started - 5000,
    );
    if (existing.length >= MAX_EVENTS_PER_ATTEMPT) return null;
    const count = existing.length + 1;
    const event: ViolationEvent = {
      id: uid("qvl"),
      eventType: input.eventType,
      severity: quiz.maxViolations > 0 && count >= quiz.maxViolations ? "violation" : "warning",
      timestamp: new Date(now).toISOString(),
    };
    d.quizViolations.push({ ...event, quizId: quiz.id, userId: user.id });
    return { event, count };
  });
  if (!result) return fail("Too many events were recorded for this attempt.");
  return { ok: true, data: result };
}

export function violationsForSubmission(db: Database, submissionId: string): ViolationEvent[] {
  return db.quizViolations
    .filter((v) => v.submissionId === submissionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((v) => ({ id: v.id, eventType: v.eventType, severity: v.severity, timestamp: v.timestamp }));
}

/* ------------------------------------------------------------------ */
/* Admin read models                                                    */
/* ------------------------------------------------------------------ */

/** Number of distinct quizzes using each question. */
export function questionUsage(db: Database): Map<string, number> {
  const usage = new Map<string, number>();
  for (const quiz of db.quizzes) {
    for (const id of new Set(quiz.questions.map((r) => r.questionId))) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return usage;
}

export async function listQuizzesForManager(user: User, search = ""): Promise<QuizListItem[]> {
  const db = await getDb();
  const term = search.trim().toLowerCase();
  const subs = new Map<string, { total: number; pending: number }>();
  for (const s of db.quizSubmissions) {
    const entry = subs.get(s.quizId) ?? { total: 0, pending: 0 };
    entry.total++;
    if (s.pendingGrading) entry.pending++;
    subs.set(s.quizId, entry);
  }
  return db.quizzes
    .filter((q) => canManageQuiz(user, q, db))
    .filter((q) => !term || q.title.toLowerCase().includes(term))
    .map((q): QuizListItem => {
      const entries = resolveQuizQuestions(db, q);
      return {
        id: q.id,
        title: q.title,
        courseTitle: primaryCourse(db, q)?.title,
        questionCount: entries.length,
        totalMarks: computeTotalMarks(
          entries.map((e) => ({ questionId: e.question.id, marks: e.marks })),
          q.shuffleQuestions,
          q.limitQuestionsTo,
        ),
        passingPercentage: q.passingPercentage,
        maxAttempts: q.maxAttempts,
        showAnswers: q.showAnswers,
        submissionCount: subs.get(q.id)?.total ?? 0,
        pendingGradingCount: subs.get(q.id)?.pending ?? 0,
        updatedAt: q.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function matchesUiType(q: Question, type: UiQuestionType | "" | undefined): boolean {
  if (!type) return true;
  return toUiType(q.type, q.multiple) === type;
}

function authorNames(db: Database): Map<string, string> {
  return new Map(db.users.map((u) => [u.id, u.name]));
}

function toBankItem(user: User, q: Question, usage: Map<string, number>, names: Map<string, string>): QuestionBankItem {
  return { question: q, authorName: names.get(q.authorId) ?? "Unknown", usedIn: usage.get(q.id) ?? 0, canEdit: canEditQuestion(user, q) };
}

/** The shared question bank (every creator can read it; editing is limited to authors and moderators). */
export async function listQuestionBank(user: User, filters: { search?: string; type?: UiQuestionType | "" } = {}): Promise<QuestionBankItem[]> {
  const db = await getDb();
  const term = (filters.search ?? "").trim().toLowerCase();
  const usage = questionUsage(db);
  const names = authorNames(db);
  return db.questions
    .filter((q) => matchesUiType(q, filters.type))
    .filter((q) => !term || stripMarkdown(q.text).toLowerCase().includes(term) || q.text.toLowerCase().includes(term) || q.id === term)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((q) => toBankItem(user, q, usage, names));
}

export type BankScope = "any" | "open_ended" | "closed";

/** Search used by the builder's question bank panel (max 100 results). */
export async function searchQuestionBank(
  user: User,
  opts: { search?: string; type?: UiQuestionType | ""; exclude?: string[]; scope?: BankScope },
): Promise<QuestionBankItem[]> {
  const items = await listQuestionBank(user, { search: opts.search, type: opts.type });
  const exclude = new Set(opts.exclude ?? []);
  return items
    .filter((i) => !exclude.has(i.question.id))
    .filter((i) => {
      if (opts.scope === "open_ended") return i.question.type === "open_ended";
      if (opts.scope === "closed") return i.question.type !== "open_ended";
      return true;
    })
    .slice(0, 100);
}

export async function getQuestionDetail(
  user: User,
  questionId: string,
): Promise<{ item: QuestionBankItem; quizzes: { id: string; title: string; canManage: boolean }[] } | null> {
  const db = await getDb();
  const q = db.questions.find((x) => x.id === questionId);
  if (!q) return null;
  const quizzes = db.quizzes
    .filter((quiz) => quiz.questions.some((r) => r.questionId === q.id))
    .map((quiz) => ({ id: quiz.id, title: quiz.title, canManage: canManageQuiz(user, quiz, db) }));
  return { item: toBankItem(user, q, questionUsage(db), authorNames(db)), quizzes };
}

function isoOrEmpty(value: string | undefined): string {
  if (!value) return "";
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export async function getQuizEditorData(user: User, quizId: string): Promise<QuizEditorData | null> {
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === quizId);
  if (!quiz) return null;
  const byId = questionMap(db);
  const rows = quiz.questions.filter((r) => byId.has(r.questionId));
  const questions: Record<string, Question> = {};
  const usageMap = questionUsage(db);
  const usage: Record<string, number> = {};
  const editable: string[] = [];
  const names: Record<string, string> = {};
  const allNames = authorNames(db);
  for (const row of rows) {
    const q = byId.get(row.questionId)!;
    questions[q.id] = q;
    usage[q.id] = usageMap.get(q.id) ?? 0;
    if (canEditQuestion(user, q)) editable.push(q.id);
    names[q.id] = allNames.get(q.authorId) ?? "Unknown";
  }
  const courses = manageableCourses(user, db);
  if (quiz.courseId && !courses.some((c) => c.id === quiz.courseId)) {
    const c = db.courses.find((x) => x.id === quiz.courseId);
    if (c) courses.unshift({ id: c.id, title: c.title });
  }
  const submissions = db.quizSubmissions.filter((s) => s.quizId === quiz.id);
  const placements = await Promise.all(
    findQuizPlacements(db, quiz).map(async (p) => ({
      lessonTitle: p.lesson.title,
      courseTitle: p.course?.title ?? "",
      href: await getLessonHref(p.lesson.id),
    })),
  );
  return {
    quizId: quiz.id,
    settings: {
      title: quiz.title,
      description: quizDescription(quiz),
      courseId: quiz.courseId ?? "",
      maxAttempts: quiz.maxAttempts,
      durationMinutes: Math.round((quiz.durationSeconds / 60) * 100) / 100,
      passingPercentage: quiz.passingPercentage,
      showAnswers: quiz.showAnswers,
      showSubmissionHistory: quiz.showSubmissionHistory,
      shuffleQuestions: quiz.shuffleQuestions,
      limitQuestionsTo: quiz.limitQuestionsTo,
      enableNegativeMarking: quiz.enableNegativeMarking,
      marksToCut: quiz.marksToCut,
      enableProctoring: quiz.enableProctoring,
      maxViolations: quiz.maxViolations,
      enableScheduling: quiz.enableScheduling,
      scheduleStart: isoOrEmpty(quiz.scheduleStart),
      scheduleEnd: isoOrEmpty(quiz.scheduleEnd),
    },
    rows,
    questions,
    usage,
    editable,
    authorNames: names,
    courses,
    submissionCount: submissions.length,
    pendingGradingCount: submissions.filter((s) => s.pendingGrading).length,
    updatedAt: quiz.updatedAt,
    placements,
    canDelete: submissions.length === 0 || isModerator(user),
  };
}

/* ------------------------------------------------------------------ */
/* Submissions (staff)                                                  */
/* ------------------------------------------------------------------ */

export interface SubmissionFilters {
  quiz?: string;
  member?: string;
  course?: string;
  status?: SubmissionStatus | "";
}

/** Submissions a staff user may see: all for moderators, otherwise those of quizzes they manage. */
function scopedSubmissions(db: Database, user: User): QuizSubmission[] {
  if (isModerator(user)) return db.quizSubmissions;
  const manageable = new Set(db.quizzes.filter((q) => canManageQuiz(user, q, db)).map((q) => q.id));
  return db.quizSubmissions.filter((s) => manageable.has(s.quizId));
}

export async function listQuizSubmissions(user: User, filters: SubmissionFilters): Promise<SubmissionListItem[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  return scopedSubmissions(db, user)
    .filter((s) => !filters.quiz || s.quizId === filters.quiz)
    .filter((s) => !filters.member || s.userId === filters.member)
    .filter((s) => !filters.course || s.courseId === filters.course)
    .filter((s) => !filters.status || submissionStatus(s) === filters.status)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((s): SubmissionListItem => {
      const u = users.get(s.userId);
      return {
        id: s.id,
        quizId: s.quizId,
        quizTitle: s.quizTitle,
        userId: s.userId,
        learnerName: u?.name ?? "Deleted user",
        learnerEmail: u?.email ?? "",
        learnerAvatar: u?.avatarUrl,
        courseTitle: s.courseId ? courses.get(s.courseId)?.title : undefined,
        score: s.score,
        scoreOutOf: s.scoreOutOf,
        percentage: s.percentage,
        status: submissionStatus(s),
        violationCount: s.violationCount,
        submittedAt: s.submittedAt,
      };
    });
}

/** Raw submissions in the viewer's scope, keyed by id (used by the CSV export for extra columns). */
export async function getScopedSubmissionMap(user: User): Promise<Map<string, QuizSubmission>> {
  const db = await getDb();
  return new Map(scopedSubmissions(db, user).map((s) => [s.id, s]));
}

export async function getSubmissionFilterOptions(user: User): Promise<{
  quizzes: { value: string; label: string }[];
  members: { value: string; label: string }[];
  courses: { value: string; label: string }[];
}> {
  const db = await getDb();
  const scoped = scopedSubmissions(db, user);
  const quizIds = new Set(scoped.map((s) => s.quizId));
  const quizzes = db.quizzes
    .filter((q) => quizIds.has(q.id) || canManageQuiz(user, q, db))
    .map((q) => ({ value: q.id, label: q.title }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const memberIds = new Set(scoped.map((s) => s.userId));
  const members = db.users
    .filter((u) => memberIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const courseIds = new Set(scoped.map((s) => s.courseId).filter((c): c is string => !!c));
  const courses = db.courses
    .filter((c) => courseIds.has(c.id))
    .map((c) => ({ value: c.id, label: c.title }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { quizzes, members, courses };
}

export interface SubmissionDetailData {
  submission: QuizSubmission;
  learner: PublicUser | null;
  quiz: { id: string; title: string; showAnswers: boolean; maxAttempts: number } | null;
  course: { id: string; title: string; slug: string } | null;
  lessonHref: string | null;
  breakdown: ResultDetail[];
  revealed: boolean;
  violations: ViolationEvent[];
  canManage: boolean;
  canGrade: boolean;
  isOwn: boolean;
  /** 1-based attempt number for the learner. */
  attemptNumber: number;
  attemptsUsed: number;
}

/** A submission as seen by its learner or by someone who manages the quiz. Null when not allowed. */
export async function getSubmissionDetail(user: User, submissionId: string): Promise<SubmissionDetailData | null> {
  const db = await getDb();
  const submission = db.quizSubmissions.find((s) => s.id === submissionId);
  if (!submission) return null;
  const quiz = db.quizzes.find((q) => q.id === submission.quizId) ?? null;
  const isOwn = submission.userId === user.id;
  const canManage = quiz ? canManageQuiz(user, quiz, db) : isModerator(user);
  if (!isOwn && !canManage) return null;
  const learnerRecord = db.users.find((u) => u.id === submission.userId);
  const course = submission.courseId ? db.courses.find((c) => c.id === submission.courseId) : null;
  const revealed = canManage || (quiz?.showAnswers ?? false);
  const attempts = db.quizSubmissions
    .filter((s) => s.userId === submission.userId && s.quizId === submission.quizId)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return {
    submission,
    learner: learnerRecord ? toPublicUser(learnerRecord) : null,
    quiz: quiz ? { id: quiz.id, title: quiz.title, showAnswers: quiz.showAnswers, maxAttempts: quiz.maxAttempts } : null,
    course: course ? { id: course.id, title: course.title, slug: course.slug } : null,
    lessonHref: await getLessonHref(submission.lessonId),
    breakdown: buildBreakdown(submission.results, questionMap(db), revealed),
    revealed,
    violations: violationsForSubmission(db, submission.id),
    canManage,
    canGrade: canManage && !isOwn,
    isOwn,
    attemptNumber: attempts.findIndex((s) => s.id === submission.id) + 1,
    attemptsUsed: attempts.length,
  };
}

export interface GradeOutcome {
  score: number;
  scoreOutOf: number;
  percentage: number;
  passed: boolean;
  pendingGrading: boolean;
}

/**
 * Apply manual marks to open-ended answers, recompute the score and notify
 * the learner. Passing after grading completes the lesson and awards badges.
 */
export async function gradeSubmission(grader: User, input: { submissionId: string; marks: Record<string, number> }): Promise<ActionResult<GradeOutcome>> {
  const db = await getDb();
  const submission = db.quizSubmissions.find((s) => s.id === input.submissionId);
  if (!submission) return fail("This submission no longer exists.");
  const quiz = db.quizzes.find((q) => q.id === submission.quizId);
  const canManage = quiz ? canManageQuiz(grader, quiz, db) : isModerator(grader);
  if (!canManage) return fail("You don't have permission to grade this submission.");
  if (submission.userId === grader.id) return fail("You cannot grade your own submission.");

  const marks = input.marks && typeof input.marks === "object" ? input.marks : {};
  const fieldErrors: Record<string, string> = {};
  const nextResults = submission.results.map((row, i) => {
    if (row.questionType !== "open_ended") return row;
    if (!(row.questionId in marks)) return row;
    const value = Number(marks[row.questionId]);
    if (!Number.isFinite(value) || value < 0) {
      fieldErrors[row.questionId] = "Enter zero or a positive number.";
      return row;
    }
    if (value > row.marksOutOf) {
      fieldErrors[row.questionId] = `Marks for question number ${i + 1} cannot be greater than the marks allotted for that question.`;
      return row;
    }
    const rounded = Math.round(value * 100) / 100;
    return { ...row, marks: rounded, graded: true, isCorrect: rounded >= row.marksOutOf };
  });
  if (Object.keys(fieldErrors).length) return fail(Object.values(fieldErrors)[0]!, fieldErrors);

  const { score, scoreOutOf, percentage } = computeScore(nextResults);
  const pendingGrading = nextResults.some((r) => !r.graded);
  const passed = !pendingGrading && percentage >= submission.passingPercentage;
  const wasPending = submission.pendingGrading;
  const wasPassed = submission.passed;
  const scoreChanged = score !== submission.score;

  await mutate((d) => {
    const row = d.quizSubmissions.find((s) => s.id === submission.id);
    if (!row) return;
    row.results = nextResults;
    row.score = score;
    row.scoreOutOf = scoreOutOf;
    row.percentage = percentage;
    row.pendingGrading = pendingGrading;
    row.passed = passed;
  });

  if (scoreChanged || (wasPending && !pendingGrading)) {
    await notify(submission.userId, {
      type: "quiz_graded",
      subject: `Your ${submission.quizTitle} submission has been graded`,
      message: `You have got a score of ${formatScore(score)} out of ${formatScore(scoreOutOf)} for the quiz ${submission.quizTitle}.`,
      link: `/quiz/submissions/${submission.id}`,
      fromUserId: grader.id,
    });
  }

  if (passed && !wasPassed) {
    const learner = db.users.find((u) => u.id === submission.userId);
    const lesson = submission.lessonId ? db.lessons.find((l) => l.id === submission.lessonId) : null;
    if (learner) {
      if (lesson) {
        try {
          await completeLesson(learner, lesson, 9999);
        } catch (err) {
          console.error("[quiz] could not update lesson progress after grading", err);
        }
      }
      await evaluateBadges(learner.id, "quiz_passed", percentage);
    }
  }
  return { ok: true, data: { score, scoreOutOf, percentage, passed, pendingGrading }, message: "Saved" };
}

/** Build the submissions CSV (RFC 4180, formula-injection safe). */
export function submissionsToCsv(items: SubmissionListItem[], raw: Map<string, QuizSubmission>): string {
  const header = [
    "Submission ID",
    "Learner",
    "Email",
    "Quiz",
    "Course",
    "Score",
    "Score out of",
    "Percentage",
    "Status",
    "Violations",
    "Submission reason",
    "Time taken (seconds)",
    "Submitted at (UTC)",
  ];
  const escape = (value: string | number | undefined) => {
    const s = value === undefined || value === null ? "" : String(value);
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [header.map(escape).join(",")];
  for (const item of items) {
    const s = raw.get(item.id);
    lines.push(
      [
        item.id,
        item.learnerName,
        item.learnerEmail,
        item.quizTitle,
        item.courseTitle ?? "",
        formatScore(item.score),
        formatScore(item.scoreOutOf),
        item.percentage,
        item.status === "pending" ? "Pending grading" : item.status === "passed" ? "Passed" : "Failed",
        item.violationCount,
        s?.submissionReason ?? "",
        s?.timeTakenSeconds ?? "",
        item.submittedAt,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
