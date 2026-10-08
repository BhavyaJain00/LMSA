import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
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
import { canManageCourse, getLessonHref } from "@/lib/data/courses";
import { getLessonAccess, lockedLessonError } from "@/lib/data/lessons";
import { isCreator, isModerator, toPublicUser } from "@/lib/auth/session";
import { completeLesson } from "@/lib/services/progress";
import { evaluateBadges } from "@/lib/services/badges";
import { logActivity } from "@/lib/services/activity";
import { notify, notifyMany } from "@/lib/services/notifications";
import { siteConfig } from "@/lib/config";
import { seededShuffle, stripMarkdown, uid, unique } from "@/lib/utils";
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
  type StartAttemptResult,
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
 * A stored quiz record. `Quiz.description` (optional markdown instructions
 * shown on the intro card) is declared on the shared type; this alias is kept
 * for existing imports.
 */
export type QuizDoc = Quiz;

export function quizDescription(quiz: Quiz): string {
  return typeof quiz.description === "string" ? quiz.description : "";
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

/**
 * Write access to a quiz (settings, questions, deletion, every submission):
 * moderators, the quiz author and the instructors of the course the quiz is
 * explicitly attached to (`quiz.courseId`).
 *
 * Lessons that merely embed the quiz do NOT grant write access: any creator
 * can drop an existing quiz into one of their lessons, so placements only
 * give read/take access (see `teachesQuizPlacement`) and course-scoped
 * submission access (see `canViewQuizSubmission`).
 */
export function canManageQuiz(user: Pick<User, "id" | "roles"> | null | undefined, quiz: Quiz, db: Database): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  if (!isCreator(user)) return false;
  if (quiz.authorId === user.id) return true;
  if (!quiz.courseId) return false;
  const course = db.courses.find((c) => c.id === quiz.courseId);
  return course ? canManageCourse(user, course) : false;
}

/** The user teaches a course whose lessons embed the quiz (read/take access only). */
export function teachesQuizPlacement(user: Pick<User, "id" | "roles">, quiz: Quiz, db: Database): boolean {
  if (!isCreator(user)) return false;
  return quizCourseIds(db, quiz).some((cid) => {
    const course = db.courses.find((c) => c.id === cid);
    return course ? canManageCourse(user, course) : false;
  });
}

/**
 * Staff access to one submission: quiz managers see every submission; other
 * instructors only see (and grade) submissions made in a course they manage.
 */
export function canViewQuizSubmission(
  user: Pick<User, "id" | "roles"> | null | undefined,
  submission: Pick<QuizSubmission, "quizId" | "courseId">,
  quiz: Quiz | null | undefined,
  db: Database,
): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  if (quiz && canManageQuiz(user, quiz, db)) return true;
  if (!isCreator(user) || !submission.courseId) return false;
  const course = db.courses.find((c) => c.id === submission.courseId);
  return course ? canManageCourse(user, course) : false;
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
 *  - managers (moderators, the author, instructors of the quiz's own course)
 *  - instructors of a course whose lessons embed it (take only, no management)
 *  - learners enrolled in a course that embeds it, only while that lesson is
 *    open to them (not locked by sequential completion, a drip schedule or
 *    unmet prerequisites — the same rule as the lesson player)
 *  - learners enrolled in the quiz's own course when the quiz is not placed in
 *    any lesson of that course
 *  - anyone logged in, for a free-preview lesson they can open (published
 *    course, guest access on, and past its `availableFrom` date)
 *  - instructors and members of a batch whose assessments list the quiz
 *
 * Access to the quiz does not open the lessons that embed it: an attempt only
 * counts toward (and completes) a lesson the learner can open, see
 * `recordQuizSubmission`.
 */
export async function getQuizAccess(user: User | null, quiz: Quiz): Promise<QuizAccess> {
  if (!user) return { ok: false, reason: "guest", message: "Please log in to access the quiz." };
  const db = await getDb();
  if (canManageQuiz(user, quiz, db)) return { ok: true, manage: true };
  // Instructors of a course that embeds the quiz may take it, but not edit it.
  if (teachesQuizPlacement(user, quiz, db)) return { ok: true, manage: false };

  let lockedMessage: string | null = null;
  const placements = findQuizPlacements(db, quiz);
  for (const placement of placements) {
    const course = placement.course;
    if (!course) continue;
    const enrolled = db.enrollments.some((e) => e.userId === user.id && e.courseId === course.id);
    if (enrolled) {
      // The placement lesson must be open for this learner (drip, order and prerequisites).
      const access = await getLessonAccess(user, placement.lesson.id);
      if (access?.canView) return { ok: true, manage: false };
      if (access) lockedMessage ??= access.lock && access.lock.reason !== "order" ? lockedLessonError(access) : "Complete the previous lessons to unlock this quiz.";
      continue;
    }
    if (course.published && placement.lesson.includeInPreview) {
      // Free previews follow the lesson player: guest access must be on, and a preview scheduled
      // with `availableFrom` stays closed to everyone until that date.
      const preview = await getLessonAccess(user, placement.lesson.id);
      if (preview?.canView) return { ok: true, manage: false };
      if (preview?.lock?.reason === "drip") lockedMessage ??= lockedLessonError(preview);
    }
  }
  // A course quiz that isn't placed in any of the course's lessons (so no lesson can lock it).
  if (
    quiz.courseId &&
    !placements.some((p) => p.course?.id === quiz.courseId) &&
    db.enrollments.some((e) => e.userId === user.id && e.courseId === quiz.courseId)
  ) {
    return { ok: true, manage: false };
  }
  for (const batch of db.batches) {
    if (!batch.assessments.some((a) => a.type === "quiz" && a.refId === quiz.id)) continue;
    if (batch.instructorIds.includes(user.id)) return { ok: true, manage: false };
    if (db.batchEnrollments.some((b) => b.batchId === batch.id && b.userId === user.id)) return { ok: true, manage: false };
  }
  if (lockedMessage) return { ok: false, reason: "locked", message: lockedMessage };
  return { ok: false, reason: "forbidden", message: "You are not authorized to view this quiz." };
}

/**
 * Whether a quiz attempt may be tied to `lessonId` and complete it: people who
 * manage the quiz, and anyone who can open that lesson right now (its course
 * managers, enrolled learners once it is released and unlocked, visitors on an
 * open free preview). Taking the quiz is authorized separately — another
 * placement or a batch assessment may open it — so without this check a
 * passing attempt would complete, and so unlock, a lesson that is still
 * scheduled (drip), order-locked or behind prerequisites.
 */
async function attemptMayCompleteLesson(user: User, lessonId: string, managesQuiz: boolean): Promise<boolean> {
  if (managesQuiz) return true;
  return (await getLessonAccess(user, lessonId))?.canView === true;
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

/**
 * The quiz as sent to a live runner. Questions are never included: the server
 * picks and issues the questions of each attempt when it starts
 * (`startQuizAttempt`), so the full pool never reaches the browser.
 */
export function buildRunnerQuiz(db: Database, quiz: Quiz): RunnerQuiz {
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
    questions: [],
    questionsWithheld: true,
    poolSize: entries.length,
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

/** Everything the runner needs for one viewer (questions are issued per attempt by `startQuizAttempt`). */
export async function getRunnerPayload(quiz: Quiz, user: User, manage: boolean): Promise<RunnerPayload> {
  const db = await getDb();
  const serverTime = Date.now();
  return {
    quiz: buildRunnerQuiz(db, quiz),
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

/**
 * Per-question breakdown of a submission. Correctness, marks and answer keys
 * only when `reveal`; the marks awarded to a graded written answer are always included.
 */
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
    if (row.questionType === "open_ended" && row.graded && row.answer.length > 0) {
      // Marks given by the grader reveal no answer key, so the learner always sees them.
      detail.marks = row.marks;
    }
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

/* ------------------------------------------------------------------ */
/* Attempts (server-issued start, question selection)                   */
/* ------------------------------------------------------------------ */

/**
 * A live attempt is described by a signed token issued when the learner
 * presses Start. It fixes who is taking which quiz, the server-side start
 * time, the attempt number and the exact questions (the random subset when
 * the quiz limits questions), so none of these can be chosen by the client.
 */
interface AttemptClaims {
  v: 1;
  /** Quiz id */
  q: string;
  /** User id */
  u: string;
  /** Server start time (ms) */
  s: number;
  /** Attempt number (submissions before it + 1) */
  n: number;
  /** Question ids of this attempt, in order */
  ids: string[];
}

const attemptGlobals = globalThis as unknown as {
  __llQuizAttemptKey?: Promise<Buffer>;
  __llQuizAttemptStarts?: Map<string, number>;
};

async function readKeyFile(file: string): Promise<string | null> {
  try {
    const value = (await fs.readFile(file, "utf8")).trim();
    return value.length >= 32 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Signing key for attempt tokens: `QUIZ_ATTEMPT_SECRET` when set, otherwise a
 * random key persisted in the storage folder (STORAGE_DIR) so tokens survive restarts.
 */
function attemptKey(): Promise<Buffer> {
  attemptGlobals.__llQuizAttemptKey ??= (async () => {
    const fromEnv = process.env.QUIZ_ATTEMPT_SECRET?.trim();
    if (fromEnv) return Buffer.from(fromEnv, "utf8");
    const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.storageDir, ".quiz-attempt-key");
    const existing = await readKeyFile(file);
    if (existing) return Buffer.from(existing, "utf8");
    const fresh = randomBytes(32).toString("hex");
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, fresh, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (err) {
      const raced = (err as NodeJS.ErrnoException).code === "EEXIST" ? await readKeyFile(file) : null;
      if (raced) return Buffer.from(raced, "utf8");
      console.error("[quiz] could not persist the attempt signing key; attempts in progress will not survive a restart", err);
    }
    return Buffer.from(fresh, "utf8");
  })();
  return attemptGlobals.__llQuizAttemptKey;
}

function hmac(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

async function signAttempt(claims: AttemptClaims): Promise<string> {
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${body}.${hmac(await attemptKey(), body)}`;
}

/** Verify a token and check it belongs to this user and quiz. Null when invalid. */
async function verifyAttempt(token: unknown, userId: string, quizId: string): Promise<AttemptClaims | null> {
  if (typeof token !== "string" || token.length > 20000) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(hmac(await attemptKey(), body), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<AttemptClaims>;
    if (c.v !== 1 || c.q !== quizId || c.u !== userId) return null;
    if (typeof c.s !== "number" || typeof c.n !== "number" || !Array.isArray(c.ids)) return null;
    if (!c.ids.every((id) => typeof id === "string")) return null;
    return c as AttemptClaims;
  } catch {
    return null;
  }
}

/**
 * Start time of a timed attempt. Restarting the same attempt (same attempt
 * number, e.g. after reloading the page instead of submitting) keeps the
 * original start while its time window is open, so abandoning an attempt
 * does not reset the timer.
 */
function stickyStart(key: string, now: number, windowMs: number): number {
  const starts = (attemptGlobals.__llQuizAttemptStarts ??= new Map());
  const previous = starts.get(key);
  if (previous !== undefined && now - previous < windowMs) return previous;
  starts.set(key, now);
  if (starts.size > 5000) {
    for (const [k, t] of starts) if (now - t > 2 * 86400_000) starts.delete(k);
  }
  return now;
}

function usedAttempts(db: Pick<Database, "quizSubmissions">, quizId: string, userId: string): number {
  return db.quizSubmissions.filter((s) => s.quizId === quizId && s.userId === userId).length;
}

/**
 * Start a live attempt: re-checks access, the schedule and the attempt
 * limit, picks the questions on the server (a random subset when the quiz
 * limits questions; the same subset for the same attempt number) and signs
 * the start time. Only the questions of this attempt are sent to the browser.
 */
export async function startQuizAttempt(user: User, quizId: string): Promise<ActionResult<StartAttemptResult>> {
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail(access.message);

  const now = Date.now();
  if (!access.manage && quiz.enableScheduling) {
    const schedule = getScheduleState(quiz, now);
    if (schedule.state === "not_started") return fail(`${quiz.title} opens on ${formatWhen(schedule.opensAt)}.`);
    if (schedule.state === "ended") return fail(`The schedule for ${quiz.title} has ended.`);
  }
  const used = usedAttempts(db, quiz.id, user.id);
  if (quiz.maxAttempts > 0 && used >= quiz.maxAttempts) {
    return fail(`You have exceeded the maximum number of attempts (${quiz.maxAttempts}) for this quiz.`);
  }

  const entries = resolveQuizQuestions(db, quiz);
  if (!entries.length) return fail("There are no questions in this quiz yet.");
  const n = used + 1;
  const key = await attemptKey();
  const pool = quiz.shuffleQuestions ? seededShuffle(entries, hmac(key, `order|${quiz.id}|${user.id}|${n}`)) : entries;
  const picked = pool.slice(0, attemptQuestionCount(quiz, entries.length));

  const startedMs =
    quiz.durationSeconds > 0
      ? stickyStart(`${quiz.id}|${user.id}|${n}`, now, (quiz.durationSeconds + SUBMIT_GRACE_SECONDS) * 1000)
      : now;
  const token = await signAttempt({ v: 1, q: quiz.id, u: user.id, s: startedMs, n, ids: picked.map((e) => e.question.id) });
  return {
    ok: true,
    data: { token, startedAt: new Date(startedMs).toISOString(), serverTime: now, questions: picked.map(toRunnerQuestion) },
  };
}

/**
 * Grade and store a quiz attempt. Enforces access, schedule, attempts, the
 * time limit and the proctoring rules; runs the lesson/badge/activity side
 * effects on success. Live attempts must carry the token issued by
 * `startQuizAttempt`: the questions and the start time come from it, never
 * from the client. With `input.preview` (managers only) the attempt is graded
 * but not stored.
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
  const entries = resolveQuizQuestions(db, quiz);
  if (!entries.length) return fail("There are no questions in this quiz yet.");
  const byId = new Map(entries.map((e) => [e.question.id, e]));

  let ids: string[];
  let startedMs: number;
  let attemptNumber = 0;
  if (preview) {
    // Previews store nothing, so the manager's client picks the questions.
    ids = unique((Array.isArray(input.questionIds) ? input.questionIds : []).filter((id): id is string => typeof id === "string"));
    if (!ids.length || ids.length !== attemptQuestionCount(quiz, entries.length) || ids.some((id) => !byId.has(id))) {
      return fail("This quiz was updated while you were taking it. Reload the page and try again.");
    }
    const parsed = typeof input.startedAt === "string" ? Date.parse(input.startedAt) : NaN;
    startedMs = Number.isFinite(parsed) && parsed <= now ? parsed : now;
  } else {
    const claims = await verifyAttempt(input.attemptToken, user.id, quiz.id);
    if (!claims) return fail("This attempt could not be verified. Reload the page and start the quiz again.");
    ids = unique(claims.ids);
    startedMs = Math.min(claims.s, now);
    attemptNumber = claims.n;
    if (!ids.length || ids.some((id) => !byId.has(id))) {
      return fail("This quiz was updated while you were taking it. Reload the page and try again.");
    }
  }

  if (!preview && !access.manage && quiz.enableScheduling) {
    const schedule = getScheduleState(quiz, now);
    if (schedule.state === "not_started") return fail(`${quiz.title} opens on ${formatWhen(schedule.opensAt)}.`);
    if (schedule.state === "ended") {
      const end = Date.parse(schedule.endedAt);
      const allowance = (quiz.durationSeconds || 0) + SUBMIT_GRACE_SECONDS;
      if (startedMs > end || now > end + allowance * 1000) return fail(`The schedule for ${quiz.title} has ended.`);
    }
  }

  if (!preview) {
    const used = usedAttempts(db, quiz.id, user.id);
    if (quiz.maxAttempts > 0 && used >= quiz.maxAttempts) {
      return fail(`You have exceeded the maximum number of attempts (${quiz.maxAttempts}) for this quiz.`);
    }
    if (attemptNumber !== used + 1) return fail("This attempt has already been submitted.");
  }

  // Time limit, measured from the server-side start. An attempt that arrives
  // after the time limit plus a grace period for slow networks is recorded
  // with no answers: nothing was handed in on time.
  const elapsed = Math.max(0, Math.round((now - startedMs) / 1000));
  const late = !preview && quiz.durationSeconds > 0 && elapsed > quiz.durationSeconds + SUBMIT_GRACE_SECONDS;
  const timeTaken = quiz.durationSeconds > 0 ? Math.min(elapsed, quiz.durationSeconds) : elapsed;

  const answers = late ? {} : sanitizeAnswers(input.answers);
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

  let reason: string | undefined;
  if (late || (input.submissionReason === "timer_expired" && quiz.durationSeconds > 0)) reason = submissionReasonLabels.timer_expired;
  else if (input.submissionReason === "browser_closed") reason = submissionReasonLabels.browser_closed;

  // Proctoring: the stored events are authoritative; the client count covers events that failed to log.
  let violationCount = 0;
  let linkedViolationIds: string[] = [];
  if (quiz.enableProctoring && !preview) {
    const since = startedMs - 5000;
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

  // Resolve where the attempt happened: only a lesson that really embeds this quiz and that the
  // learner can open right now counts. An attempt naming a lesson that is still locked for them is
  // recorded without a lesson, so it can't complete (and so unlock) that lesson.
  let lesson: Lesson | null = null;
  if (input.lessonId) {
    const candidate = db.lessons.find((l) => l.id === input.lessonId);
    if (candidate && (lessonUsesQuiz(candidate, quiz.id) || quiz.lessonId === candidate.id) && (await attemptMayCompleteLesson(user, candidate.id, access.manage))) {
      lesson = candidate;
    }
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

  const stored = await mutate((d): string | null => {
    const used = usedAttempts(d, quiz.id, user.id);
    if (quiz.maxAttempts > 0 && used >= quiz.maxAttempts) {
      return `You have exceeded the maximum number of attempts (${quiz.maxAttempts}) for this quiz.`;
    }
    if (attemptNumber !== used + 1) return "This attempt has already been submitted.";
    d.quizSubmissions.push(submission);
    if (linkedViolationIds.length) {
      const set = new Set(linkedViolationIds);
      for (const v of d.quizViolations) if (set.has(v.id)) v.submissionId = submission.id;
    }
    return null;
  });
  if (stored) return fail(stored);

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

/**
 * Refresh every page that shows the outcome of a quiz attempt: the admin
 * lists, the quiz and submission pages, and — because a passing attempt (or a
 * passing grade) completes the lesson — the lesson player, its course outline,
 * the course page, the catalog and the dashboard.
 *
 * Route patterns include their route groups (`(app)`, `(learn)`) so they match
 * the page files; the concrete lesson and course URLs are revalidated too.
 */
export async function revalidateQuizAttempt(opts: { quizId: string; submissionId?: string; lessonId?: string; courseId?: string }): Promise<void> {
  revalidatePath("/admin/quizzes");
  revalidatePath("/admin/quizzes/submissions");
  revalidatePath(`/admin/quizzes/${opts.quizId}`);
  revalidatePath("/(app)/quiz/[id]", "page");
  revalidatePath("/(app)/quiz/submissions/[id]", "page");
  revalidatePath("/(app)/admin/quizzes/submissions/[id]", "page");

  revalidatePath("/(learn)/courses/[slug]/learn", "layout");
  revalidatePath("/(learn)/courses/[slug]/learn/[ref]", "page");
  revalidatePath("/courses/[slug]/learn/[ref]", "page");
  revalidatePath("/(app)/courses/[slug]", "page");
  revalidatePath("/courses");
  revalidatePath("/dashboard");

  const db = await getDb();
  const submission = opts.submissionId ? db.quizSubmissions.find((s) => s.id === opts.submissionId) : undefined;
  const lessonId = submission?.lessonId ?? opts.lessonId;
  const lesson = lessonId ? db.lessons.find((l) => l.id === lessonId) : undefined;
  const courseIds = unique([lesson?.courseId, submission?.courseId, opts.courseId].filter((id): id is string => !!id));
  for (const id of courseIds) {
    const course = db.courses.find((c) => c.id === id);
    if (course) revalidatePath(`/courses/${course.slug}`);
  }
  if (lesson) {
    const href = await getLessonHref(lesson.id);
    if (href) revalidatePath(href);
  }
}

/** Live answer check for quizzes that reveal answers after each question. */
export async function checkQuizAnswer(
  user: User,
  input: { quizId: string; questionId: string; answer: string[]; attemptToken?: string },
): Promise<ActionResult<CheckAnswerResult>> {
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail("You are not authorized to view this quiz.");
  if (!quiz.showAnswers && !access.manage) return fail("Live answer checking is not enabled for this quiz.");
  if (!access.manage) {
    // Learners can only check the questions of the attempt they are taking.
    const claims = await verifyAttempt(input.attemptToken, user.id, quiz.id);
    if (!claims || !claims.ids.includes(input.questionId)) return fail("This attempt could not be verified. Reload the page and start the quiz again.");
  }
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

/* ------------------------------------------------------------------ */
/* Proctoring                                                           */
/* ------------------------------------------------------------------ */

const VIOLATION_TYPES: ViolationType[] = ["tab_switch", "focus_loss", "fullscreen_exit", "copy_paste"];
const MAX_EVENTS_PER_ATTEMPT = 200;

/**
 * Log one proctoring event for the attempt identified by `attemptToken`.
 * Events are warnings until the count reaches `maxViolations`; that event is a
 * violation (and the client auto-submits).
 */
export async function recordQuizViolation(
  user: User,
  input: { quizId: string; eventType: ViolationType; attemptToken: string },
): Promise<ActionResult<{ event: ViolationEvent; count: number }>> {
  if (!VIOLATION_TYPES.includes(input.eventType)) return fail("Unknown event type.");
  const db = await getDb();
  const quiz = db.quizzes.find((q) => q.id === input.quizId);
  if (!quiz) return fail("This quiz no longer exists.");
  if (!quiz.enableProctoring) return fail("Proctoring is not enabled for this quiz.");
  const access = await getQuizAccess(user, quiz);
  if (!access.ok) return fail("You are not authorized to take this quiz.");
  const claims = await verifyAttempt(input.attemptToken, user.id, quiz.id);
  if (!claims) return fail("Invalid attempt.");
  const started = claims.s;
  const now = Date.now();

  const result = await mutate((d): { event: ViolationEvent; count: number } | "submitted" | null => {
    // Events that arrive after the attempt was stored are not attached to a later attempt.
    if (usedAttempts(d, quiz.id, user.id) >= claims.n) return "submitted";
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
  if (result === "submitted") return fail("This attempt has already been submitted.");
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

/**
 * Submissions a staff user may see: all for moderators; otherwise every
 * submission of the quizzes they manage plus the submissions made in courses
 * they teach (see `canViewQuizSubmission`).
 */
function scopedSubmissions(db: Database, user: User): QuizSubmission[] {
  if (isModerator(user)) return db.quizSubmissions;
  const quizzes = new Map(db.quizzes.map((q) => [q.id, q]));
  return db.quizSubmissions.filter((s) => canViewQuizSubmission(user, s, quizzes.get(s.quizId), db));
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
  quizzes: { value: string; label: string; canEdit: boolean }[];
  members: { value: string; label: string }[];
  courses: { value: string; label: string }[];
}> {
  const db = await getDb();
  const scoped = scopedSubmissions(db, user);
  const quizIds = new Set(scoped.map((s) => s.quizId));
  const quizzes = db.quizzes
    .map((q) => ({ value: q.id, label: q.title, canEdit: canManageQuiz(user, q, db) }))
    .filter((q) => quizIds.has(q.value) || q.canEdit)
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
  /** Staff access to this submission (quiz manager, or instructor of the submission's course). */
  canManage: boolean;
  /** The viewer may edit the quiz itself. */
  canEditQuiz: boolean;
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
  const canManage = canViewQuizSubmission(user, submission, quiz, db);
  const canEditQuiz = quiz ? canManageQuiz(user, quiz, db) : false;
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
    canEditQuiz,
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
  if (!canViewQuizSubmission(grader, submission, quiz, db)) return fail("You don't have permission to grade this submission.");
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
      // Re-checked now: the lesson may be locked for the learner at grading time (or the attempt may
      // predate this check), and a passing grade must not complete a lesson they can't open.
      const managesQuiz = !!quiz && canManageQuiz(learner, quiz, db);
      if (lesson && (await attemptMayCompleteLesson(learner, lesson.id, managesQuiz))) {
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
