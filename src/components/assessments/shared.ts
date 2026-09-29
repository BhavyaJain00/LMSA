/**
 * Client-safe constants, view models and pure helpers shared by the
 * assignment and programming-exercise UI, the server actions and the data
 * layer. Only type imports: this module has no runtime dependencies.
 */
import type { AssignmentStatus, AssignmentType, ExerciseLanguage } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  text: "Text",
  url: "URL",
  document: "Document",
  pdf: "PDF",
  image: "Image",
};

export const ASSIGNMENT_TYPE_OPTIONS: { value: AssignmentType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "document", label: "Document" },
  { value: "text", label: "Text" },
  { value: "url", label: "URL" },
];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_graded: "Not graded",
  pass: "Pass",
  fail: "Fail",
  not_applicable: "Not applicable",
};

export const ASSIGNMENT_STATUS_OPTIONS: { value: AssignmentStatus; label: string }[] = [
  { value: "not_graded", label: "Not graded" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "not_applicable", label: "Not applicable" },
];

export const LANGUAGE_LABELS: Record<ExerciseLanguage, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
};

export const LANGUAGE_OPTIONS: { value: ExerciseLanguage; label: string }[] = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
];

/** Languages the in-browser worker and the server sandbox can execute. */
export function isRunnableLanguage(language: ExerciseLanguage): boolean {
  return language === "javascript" || language === "typescript";
}

export const NOT_RUNNABLE_NOTICE = "Automatic checks are available for JavaScript only; your submission is saved for instructor review.";
export const NOT_RUNNABLE_RESULT_NOTE = "Not run: automatic checks are available for JavaScript only.";
export const TYPESCRIPT_NOTICE =
  "TypeScript exercises run as plain JavaScript (nothing is transpiled), so write your solution without type annotations.";

/** Per-test time limit for both the browser worker and the server sandbox. */
export const TEST_TIMEOUT_MS = 3000;
export const MAX_CODE_LENGTH = 20000;
export const MAX_TEST_CASES = 50;

export const DEFAULT_STARTER_CODE: Record<ExerciseLanguage, string> = {
  javascript: `function solve(input) {\n  // input is a string\n  return input;\n}\n`,
  typescript: `function solve(input) {\n  // Runs as plain JavaScript: no type annotations.\n  return input;\n}\n`,
  python: `def solve(input):\n    # input is a string\n    return input\n`,
  go: `package main\n\nfunc solve(input string) string {\n\treturn input\n}\n`,
  rust: `fn solve(input: &str) -> String {\n    input.to_string()\n}\n`,
};

/* ------------------------------------------------------------------ */
/* Assignment uploads                                                  */
/* ------------------------------------------------------------------ */

export type UploadAssignmentType = "pdf" | "document" | "image";

export const ASSIGNMENT_UPLOAD: Record<
  UploadAssignmentType,
  { accept: string; kind: "document" | "image"; extensions: string[]; error: string; label: string }
> = {
  pdf: {
    accept: ".pdf,application/pdf",
    kind: "document",
    extensions: [".pdf"],
    error: "Only PDF files are allowed.",
    label: "PDF",
  },
  document: {
    accept: ".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
    extensions: [".doc", ".docx"],
    error: "Only document file of type .doc or .docx are allowed.",
    label: "Document",
  },
  image: {
    accept: "image/png,image/jpeg,image/gif,image/webp,image/avif",
    kind: "image",
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"],
    error: "Only image file is allowed.",
    label: "Image",
  },
};

export function isUploadType(type: AssignmentType): type is UploadAssignmentType {
  return type === "pdf" || type === "document" || type === "image";
}

export function fileExtension(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0] ?? "";
  const base = clean.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** Uploaded files are stored as `<slug>-<16 char id>.<ext>`; show the readable part. */
export function fileNameFromUrl(url: string): string {
  let base = (url.split(/[?#]/)[0] ?? "").split("/").pop() ?? url;
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep the raw name */
  }
  const m = /^(.*)-[a-z0-9]{16}(\.[a-z0-9]+)$/.exec(base);
  return m ? `${m[1]}${m[2]}` : base;
}

export function isImageUrl(url: string): boolean {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].includes(fileExtension(url));
}

export function isPdfUrl(url: string): boolean {
  return fileExtension(url) === ".pdf";
}

/* ------------------------------------------------------------------ */
/* Test execution helpers                                              */
/* ------------------------------------------------------------------ */

/** Normalize a solve() return value exactly like the worker and the server sandbox. */
export function coerceOutput(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function outputsMatch(actual: string, expected: string): boolean {
  return actual.trim() === expected.trim();
}

/* ------------------------------------------------------------------ */
/* View models passed from the server to client components             */
/* ------------------------------------------------------------------ */

/**
 * A test case as sent to the runner. For learners, hidden tests carry
 * neither input nor expected output (`serverOnly`): they are checked by the
 * server sandbox on submit.
 */
export interface RunnerTestCase {
  id: string;
  /** 1-based position for "Test n" labels. */
  index: number;
  hidden: boolean;
  input?: string;
  expectedOutput?: string;
  /** Not runnable in the browser; graded on submit. */
  serverOnly?: boolean;
}

export interface RunnerExercise {
  id: string;
  title: string;
  problemStatement: string;
  language: ExerciseLanguage;
  starterCode: string;
  tests: RunnerTestCase[];
  courseId?: string;
}

/** Result of one test as shown in the UI. Hidden tests omit input/expected/actual for learners. */
export interface TestResultView {
  testCaseId: string;
  index: number;
  hidden: boolean;
  passed: boolean;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
  logs?: string[];
  durationMs?: number;
  /** True when the test was not executed (non-runnable language). */
  skipped?: boolean;
  /** Browser run only: a hidden test that the server checks on submit. */
  pending?: boolean;
}

export interface ExerciseSubmissionView {
  id: string;
  exerciseId: string;
  code: string;
  status: "passed" | "failed";
  submittedAt: string;
  results: TestResultView[];
  passedCount: number;
  totalCount: number;
}

/** Raw result the browser sends with a submission (validated on the server). */
export interface ClientTestResult {
  testCaseId: string;
  passed: boolean;
  actualOutput: string;
  error?: string;
}

export interface AssignmentView {
  id: string;
  title: string;
  question: string;
  type: AssignmentType;
  showAnswer: boolean;
  answer?: string;
  gradeAssignment: boolean;
  enableScheduling: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  courseId?: string;
}

export interface AssignmentSubmissionView {
  id: string;
  type: AssignmentType;
  answer?: string;
  attachmentUrl?: string;
  status: AssignmentStatus;
  comments?: string;
  evaluatorName?: string;
  gradedAt?: string;
  submittedAt: string;
  updatedAt: string;
}

/** Schedule state of an assignment at a given instant. */
export function assignmentScheduleState(
  a: Pick<AssignmentView, "enableScheduling" | "scheduleStart" | "scheduleEnd">,
  now: number,
): { blocked: boolean; reason: "not_started" | "ended" | null } {
  if (!a.enableScheduling) return { blocked: false, reason: null };
  if (a.scheduleStart) {
    const start = new Date(a.scheduleStart).getTime();
    if (Number.isFinite(start) && now < start) return { blocked: true, reason: "not_started" };
  }
  if (a.scheduleEnd) {
    const end = new Date(a.scheduleEnd).getTime();
    if (Number.isFinite(end) && now > end) return { blocked: true, reason: "ended" };
  }
  return { blocked: false, reason: null };
}

/* ------------------------------------------------------------------ */
/* List pagination (?size= page length, ?pages= pages loaded)          */
/* ------------------------------------------------------------------ */

export const PAGE_SIZES = [24, 60, 120] as const;

export function parsePaging(size: string | string[] | undefined, pages: string | string[] | undefined): { size: number; pages: number; limit: number } {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const s = Number(first(size));
  const p = Number(first(pages));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(s) ? s : 24;
  const pageCount = Number.isInteger(p) && p > 0 ? Math.min(p, 50) : 1;
  return { size: pageSize, pages: pageCount, limit: pageSize * pageCount };
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim() : undefined;
}

/** Build `?lesson=&course=` for links that should return to a lesson. */
export function lessonQuery(lessonId?: string | null, courseId?: string | null): string {
  const qs = new URLSearchParams();
  if (lessonId) qs.set("lesson", lessonId);
  if (courseId) qs.set("course", courseId);
  const s = qs.toString();
  return s ? `?${s}` : "";
}
