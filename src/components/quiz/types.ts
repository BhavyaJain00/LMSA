/**
 * Client-safe view models shared by the quiz runner, the builder, the
 * question bank, the grading screens, the server actions and the data layer.
 *
 * This file has no runtime imports so it can be used from Server Components,
 * Client Components, Server Actions and Route Handlers alike.
 */
import type { Question, QuestionType, ViolationType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Runner (learner quiz experience)                                     */
/* ------------------------------------------------------------------ */

/** An option as sent to the learner. Never carries `isCorrect` or explanations. */
export interface RunnerOption {
  id: string;
  text: string;
}

export interface RunnerQuestion {
  id: string;
  /** Markdown */
  text: string;
  type: QuestionType;
  multiple: boolean;
  /** Marks this question is worth in this quiz. */
  marks: number;
  options: RunnerOption[];
}

export interface RunnerQuiz {
  id: string;
  title: string;
  /** Markdown instructions shown on the intro card. */
  description?: string;
  courseId?: string;
  courseTitle?: string;
  /** Number of questions in one attempt (the question limit applied). */
  questionCount: number;
  totalMarks: number;
  passingPercentage: number;
  /** 0 = unlimited */
  maxAttempts: number;
  showAnswers: boolean;
  showSubmissionHistory: boolean;
  shuffleQuestions: boolean;
  limitQuestionsTo: number;
  /** 0 = no time limit */
  durationSeconds: number;
  enableNegativeMarking: boolean;
  marksToCut: number;
  enableScheduling: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  enableProctoring: boolean;
  maxViolations: number;
  /**
   * Questions in quiz order. Only filled for the builder's preview: live
   * payloads leave it empty and the server issues the questions of each
   * attempt when it starts (see `StartAttemptResult`).
   */
  questions: RunnerQuestion[];
  /** Set when questions are issued by the server when an attempt starts (every live payload). */
  questionsWithheld: boolean;
  /** Number of questions available in the quiz (0 = nothing to take yet). */
  poolSize: number;
  hasOpenEnded: boolean;
}

export interface AttemptSummary {
  id: string;
  submittedAt: string;
  score: number;
  scoreOutOf: number;
  percentage: number;
  passed: boolean;
  pendingGrading: boolean;
  submissionReason?: string;
  violationCount: number;
  timeTakenSeconds: number;
}

export interface RunnerPayload {
  quiz: RunnerQuiz;
  /** The viewer's previous attempts, newest first. */
  attempts: AttemptSummary[];
  /** The viewer can edit this quiz (author, course manager or moderator). */
  canManage: boolean;
  /** Time (ms) the payload was built, used for the first schedule check without hydration drift. */
  serverTime: number;
}

/** "live" records attempts; "preview" grades without saving (quiz builder). */
export type RunnerMode = "live" | "preview";

export type SubmissionReason = "manual" | "timer_expired" | "max_violations" | "browser_closed";

export const submissionReasonLabels: Record<Exclude<SubmissionReason, "manual">, string> = {
  timer_expired: "Time limit exceeded",
  max_violations: "Maximum violations reached",
  browser_closed: "Browser closed",
};

/**
 * A live attempt as issued by the server. The signed `token` fixes the
 * learner, the questions of this attempt and the server-side start time; it
 * is sent back with proctoring events, answer checks and the submission.
 */
export interface StartAttemptResult {
  token: string;
  /** ISO time the attempt started on the server. */
  startedAt: string;
  /** Server clock (ms) when the attempt was issued, to derive a skew-free local deadline. */
  serverTime: number;
  /** The questions of this attempt, in the order they are shown. */
  questions: RunnerQuestion[];
}

export interface SubmitQuizInput {
  quizId: string;
  lessonId?: string;
  courseId?: string;
  /** Token from `StartAttemptResult` (required for live attempts). */
  attemptToken?: string;
  /** Preview only: question ids in the order they were shown. Live attempts use the token's questions. */
  questionIds?: string[];
  /** Selected option ids / typed answers keyed by question id. */
  answers: Record<string, string[]>;
  /** Preview only: ISO time the preview started. Live attempts use the token's start time. */
  startedAt?: string;
  violationCount: number;
  submissionReason: SubmissionReason;
  /** Managers only: grade without storing anything. */
  preview?: boolean;
}

/** Per-option outcome in a graded breakdown or a live check. */
export type OptionOutcome = "correct" | "missed" | "wrong" | "untouched";

export interface ResultOption {
  id: string;
  text: string;
  outcome: OptionOutcome;
  isCorrect: boolean;
  explanation?: string;
}

export interface ResultDetail {
  questionId: string;
  /** 1-based position in the attempt. */
  index: number;
  /** Markdown */
  text: string;
  type: QuestionType;
  multiple: boolean;
  /** The learner's answer(s) in readable form (option texts or typed text). */
  answerTexts: string[];
  answered: boolean;
  marksOutOf: number;
  /** False while an open-ended answer awaits manual grading. */
  graded: boolean;
  /** Present only when answers are revealed to the viewer. */
  isCorrect?: boolean;
  /** Present only when answers are revealed to the viewer. */
  marks?: number;
  /** Options with outcomes and explanations (choices, revealed only). */
  options?: ResultOption[];
  /** Accepted answers for user-input questions (revealed only). */
  possibilities?: string[];
}

export interface SubmitResult {
  submission: AttemptSummary;
  breakdown: ResultDetail[];
  /** Whether correct answers and per-question marks are included. */
  revealed: boolean;
  /** All of the viewer's attempts after this submission, newest first. */
  attempts: AttemptSummary[];
  lessonCompleted: boolean;
  preview: boolean;
}

export interface CheckAnswerResult {
  questionId: string;
  isCorrect: boolean;
  options?: ResultOption[];
}

export interface ViolationEvent {
  id: string;
  eventType: ViolationType;
  severity: "warning" | "violation";
  timestamp: string;
}

export const violationLabels: Record<ViolationType, string> = {
  tab_switch: "Tab switch",
  focus_loss: "Window focus lost",
  fullscreen_exit: "Fullscreen exited",
  copy_paste: "Copy or paste",
};

/** Labels used on the grading log (past tense, mirrors the reference app). */
export const violationLogLabels: Record<ViolationType, string> = {
  tab_switch: "Tab switched",
  focus_loss: "Window focus lost",
  fullscreen_exit: "Left fullscreen",
  copy_paste: "Copy or paste detected",
};

/* ------------------------------------------------------------------ */
/* Questions                                                            */
/* ------------------------------------------------------------------ */

export const questionTypeLabels: Record<QuestionType, string> = {
  choices: "Choices",
  user_input: "User input",
  open_ended: "Open ended",
};

/** UI-facing type that also distinguishes single vs multiple choice. */
export type UiQuestionType = "single" | "multiple" | "user_input" | "open_ended";

export const uiTypes: UiQuestionType[] = ["single", "multiple", "user_input", "open_ended"];

export const uiTypeLabels: Record<UiQuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  user_input: "User input",
  open_ended: "Open ended",
};

export function toUiType(type: QuestionType, multiple: boolean): UiQuestionType {
  if (type === "choices") return multiple ? "multiple" : "single";
  return type;
}

export function fromUiType(ui: UiQuestionType): { type: QuestionType; multiple: boolean } {
  if (ui === "single") return { type: "choices", multiple: false };
  if (ui === "multiple") return { type: "choices", multiple: true };
  return { type: ui, multiple: false };
}

export const MAX_OPTIONS = 10;
export const MAX_POSSIBILITIES = 10;
export const MAX_MARKS = 100;

/** Editable question shape sent to the save action. */
export interface QuestionInput {
  id?: string;
  text: string;
  uiType: UiQuestionType;
  marks: number;
  options: { id?: string; text: string; isCorrect: boolean; explanation: string }[];
  possibilities: string[];
}

/**
 * Validate an editor payload. Shared by the client (to enable "Save") and the
 * server action (authoritative). Returns field errors keyed by path.
 */
export function validateQuestionInput(input: QuestionInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.text.trim()) errors.text = "Type the question.";
  if (!Number.isInteger(input.marks) || input.marks < 1 || input.marks > MAX_MARKS) {
    errors.marks = `Marks must be a whole number between 1 and ${MAX_MARKS}.`;
  }
  if (input.uiType === "single" || input.uiType === "multiple") {
    const filled = input.options.filter((o) => o.text.trim());
    if (input.options.length > MAX_OPTIONS) errors.options = `A question can have at most ${MAX_OPTIONS} options.`;
    else if (filled.length < 2) errors.options = "Add at least two options.";
    const correct = input.options.filter((o) => o.isCorrect);
    if (correct.some((o) => !o.text.trim())) errors.correct = "A correct option can't be empty.";
    else if (input.uiType === "single" && correct.length !== 1) errors.correct = "Mark the correct answer";
    else if (input.uiType === "multiple" && correct.length < 2) errors.correct = "Mark at least two correct answers";
    const seen = new Set<string>();
    for (const o of filled) {
      const key = o.text.trim().toLowerCase();
      if (seen.has(key)) {
        errors.options = "Duplicate options found for this question.";
        break;
      }
      seen.add(key);
    }
  }
  if (input.uiType === "user_input") {
    const filled = input.possibilities.filter((p) => p.trim());
    if (input.possibilities.length > MAX_POSSIBILITIES) errors.possibilities = `Add at most ${MAX_POSSIBILITIES} accepted answers.`;
    else if (!filled.length) errors.possibilities = "Add at least one accepted answer.";
  }
  return errors;
}

export function questionToInput(q: Question): QuestionInput {
  return {
    id: q.id,
    text: q.text,
    uiType: toUiType(q.type, q.multiple),
    marks: q.marks > 0 ? q.marks : 1,
    options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, explanation: o.explanation ?? "" })),
    possibilities: [...q.possibilities],
  };
}

export function emptyQuestionInput(uiType: UiQuestionType = "single", marks = 1): QuestionInput {
  return {
    text: "",
    uiType,
    marks,
    options:
      uiType === "single" || uiType === "multiple"
        ? [
            { text: "", isCorrect: false, explanation: "" },
            { text: "", isCorrect: false, explanation: "" },
          ]
        : [],
    possibilities: uiType === "user_input" ? [""] : [],
  };
}

export interface QuestionBankItem {
  question: Question;
  authorName: string;
  /** Number of distinct quizzes that use the question. */
  usedIn: number;
  canEdit: boolean;
}

/* ------------------------------------------------------------------ */
/* Builder                                                              */
/* ------------------------------------------------------------------ */

export interface QuizQuestionRow {
  questionId: string;
  marks: number;
}

/** The quiz fields edited in the builder's Details/Settings panel. */
export interface QuizSettingsInput {
  title: string;
  description: string;
  courseId: string;
  maxAttempts: number;
  /** Minutes; converted to durationSeconds on save. */
  durationMinutes: number;
  passingPercentage: number;
  showAnswers: boolean;
  showSubmissionHistory: boolean;
  shuffleQuestions: boolean;
  limitQuestionsTo: number;
  enableNegativeMarking: boolean;
  marksToCut: number;
  enableProctoring: boolean;
  maxViolations: number;
  enableScheduling: boolean;
  /** ISO strings ("" when unset). */
  scheduleStart: string;
  scheduleEnd: string;
}

export interface SaveQuizInput {
  quizId: string;
  settings: QuizSettingsInput;
  questions: QuizQuestionRow[];
}

export interface CourseOption {
  id: string;
  title: string;
}

export interface QuizEditorData {
  quizId: string;
  settings: QuizSettingsInput;
  rows: QuizQuestionRow[];
  /** Full question records for every row (staff only). */
  questions: Record<string, Question>;
  /** Distinct quizzes using each question. */
  usage: Record<string, number>;
  /** Question ids the viewer may edit in place. */
  editable: string[];
  authorNames: Record<string, string>;
  courses: CourseOption[];
  submissionCount: number;
  pendingGradingCount: number;
  updatedAt: string;
  placements: { lessonTitle: string; courseTitle: string; href: string | null }[];
  canDelete: boolean;
}

/** Total marks of a quiz given its rows and question limit (mirrors the server). */
export function computeTotalMarks(rows: QuizQuestionRow[], shuffle: boolean, limit: number): number {
  if (!rows.length) return 0;
  const effectiveLimit = shuffle && limit > 0 && limit < rows.length ? limit : 0;
  const counted = effectiveLimit ? rows.slice(0, effectiveLimit) : rows;
  return counted.reduce((acc, r) => acc + r.marks, 0);
}

/* ------------------------------------------------------------------ */
/* Admin lists                                                          */
/* ------------------------------------------------------------------ */

export interface QuizListItem {
  id: string;
  title: string;
  courseTitle?: string;
  questionCount: number;
  totalMarks: number;
  passingPercentage: number;
  maxAttempts: number;
  showAnswers: boolean;
  submissionCount: number;
  pendingGradingCount: number;
  updatedAt: string;
}

export type SubmissionStatus = "passed" | "failed" | "pending";

export interface SubmissionListItem {
  id: string;
  quizId: string;
  quizTitle: string;
  userId: string;
  learnerName: string;
  learnerEmail: string;
  learnerAvatar?: string;
  courseTitle?: string;
  score: number;
  scoreOutOf: number;
  percentage: number;
  status: SubmissionStatus;
  violationCount: number;
  submittedAt: string;
}

export function submissionStatus(s: { pendingGrading: boolean; passed: boolean }): SubmissionStatus {
  if (s.pendingGrading) return "pending";
  return s.passed ? "passed" : "failed";
}

export const submissionStatusLabels: Record<SubmissionStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  pending: "Pending grading",
};

/* ------------------------------------------------------------------ */
/* Scheduling & formatting helpers                                      */
/* ------------------------------------------------------------------ */

export type ScheduleState = { state: "open" } | { state: "not_started"; opensAt: string } | { state: "ended"; endedAt: string };

export function getScheduleState(
  quiz: { enableScheduling: boolean; scheduleStart?: string; scheduleEnd?: string },
  now: number,
): ScheduleState {
  if (!quiz.enableScheduling) return { state: "open" };
  if (quiz.scheduleStart) {
    const start = new Date(quiz.scheduleStart).getTime();
    if (Number.isFinite(start) && now < start) return { state: "not_started", opensAt: quiz.scheduleStart };
  }
  if (quiz.scheduleEnd) {
    const end = new Date(quiz.scheduleEnd).getTime();
    if (Number.isFinite(end) && now > end) return { state: "ended", endedAt: quiz.scheduleEnd };
  }
  return { state: "open" };
}

export function marksLabel(n: number): string {
  return `${formatScore(n)} ${Math.abs(n) === 1 ? "mark" : "marks"}`;
}

/** 7 -> "7", 6.5 -> "6.5", -1 -> "-1" */
export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 100) / 100);
}

/** 85.71 -> "86%" (percentages are shown rounded, like the reference app). */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n)}%`;
}
