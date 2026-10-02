"use server";

import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, ExerciseLanguage, ExerciseSubmission, Lesson, ProgrammingExercise, TestCase, TestCaseResult } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { getLessonHref } from "@/lib/data/courses";
import { getAssessmentAccess, lessonSubmissionLockError } from "@/lib/data/lessons";
import { canManageAssessments, completeLessonFromAssessment, toExerciseSubmissionView } from "@/lib/data/assessments";
import { logActivity } from "@/lib/services/activity";
import { awardPoints } from "@/lib/services/points";
import { setFlash } from "@/lib/flash";
import { fd, uid } from "@/lib/utils";
import {
  MAX_CODE_LENGTH,
  MAX_TEST_CASES,
  NOT_RUNNABLE_RESULT_NOTE,
  TEST_TIMEOUT_MS,
  isRunnableLanguage,
  outputsMatch,
  type ClientTestResult,
  type ExerciseSubmissionView,
} from "@/components/assessments/shared";

const LANGUAGES: ExerciseLanguage[] = ["javascript", "typescript", "python", "go", "rust"];
const MAX_OUTPUT = 10000;

/* ------------------------------------------------------------------ */
/* Server-side sandbox                                                 */
/* ------------------------------------------------------------------ */

/**
 * Source of the sandbox worker. Every submission runs in a dedicated
 * worker thread (own event loop, memory limits, killable), and every test
 * case runs in a fresh `node:vm` context with a 3 s timeout that also covers
 * promise microtasks. Code generation from strings (eval / new Function) and
 * WebAssembly are disabled inside the context, only primitives cross the
 * boundary, and results are read back as plain data properties.
 *
 * TypeScript exercises are executed as JavaScript: nothing is stripped or
 * transpiled, so solutions must avoid type-only syntax.
 *
 * `node:vm` is not a security boundary against a determined attacker; the
 * worker thread with resource limits contains runaway or hostile code well
 * enough for a trusted-learner LMS. Use a process/container sandbox for
 * untrusted public deployments.
 */
const SANDBOX_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
process.on("unhandledRejection", function () {});
process.on("uncaughtException", function () {});

const keys = workerData.keys;
function readString(obj, key) {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && Object.prototype.hasOwnProperty.call(d, "value") && typeof d.value === "string" ? d.value : null;
}

const describe = keys.describe;
const prelude =
  "var console = { log: function () {}, info: function () {}, warn: function () {}, error: function () {}, debug: function () {}, table: function () {} };\n" +
  "function " + describe + "(e) { var n = e && e.name; var m = e && e.message; return (n && m) ? String(n) + ': ' + String(m) : String(m || e); }\n" +
  "try {\n";
const epilogue =
  "\n;(function () {\n" +
  "  " + keys.output + " = undefined; " + keys.error + " = undefined;\n" +
  "  if (typeof solve !== 'function') { " + keys.error + " = 'Define a function named solve(input) that returns the answer.'; return; }\n" +
  "  var r = solve(" + keys.input + ");\n" +
  "  if (r !== null && r !== undefined && typeof r.then === 'function') {\n" +
  "    r.then(function (v) { try { " + keys.output + " = (v === undefined || v === null) ? '' : String(v); } catch (e) { " + keys.error + " = 'Could not convert the result to text.'; } },\n" +
  "           function (e) { try { " + keys.error + " = " + describe + "(e); } catch (e2) { " + keys.error + " = 'Unknown error'; } });\n" +
  "  } else {\n" +
  "    " + keys.output + " = (r === undefined || r === null) ? '' : String(r);\n" +
  "  }\n" +
  "})();\n" +
  "} catch (__caught) { try { " + keys.error + " = " + describe + "(__caught); } catch (__again) { " + keys.error + " = 'Unknown error'; } }\n";

let script = null;
let compileError = null;
try {
  // Compile the learner's code on its own first so syntax errors point at their code, not the harness.
  new vm.Script(workerData.code, { filename: "solution.js" });
  script = new vm.Script(prelude + workerData.code + epilogue, { filename: "solution.js" });
} catch (err) {
  compileError = err && err.message ? (err.name ? String(err.name) + ": " : "") + String(err.message) : "SyntaxError";
}

for (const test of workerData.tests) {
  const started = Date.now();
  if (compileError) {
    parentPort.postMessage({ type: "result", id: test.id, error: compileError, durationMs: 0 });
    continue;
  }
  const sandbox = Object.create(null);
  sandbox[keys.input] = test.input;
  let output = null;
  let error = null;
  try {
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
    script.runInContext(context, { timeout: workerData.timeoutMs });
    output = readString(sandbox, keys.output);
    error = readString(sandbox, keys.error);
    if (output === null && error === null) error = "solve() did not produce a result (a returned promise never resolved).";
  } catch (err) {
    const message = err && typeof err.message === "string" ? err.message : "";
    error = /timed out/i.test(message) ? "Execution timed out after " + workerData.timeoutMs / 1000 + "s." : message || "The code could not be executed.";
  }
  parentPort.postMessage({
    type: "result",
    id: test.id,
    output: output === null ? undefined : output.slice(0, ${MAX_OUTPUT}),
    error: error === null ? undefined : String(error).slice(0, 2000),
    durationMs: Date.now() - started,
  });
}
parentPort.postMessage({ type: "done" });
`;

interface SandboxOutcome {
  output?: string;
  error?: string;
}

function runInSandbox(code: string, tests: { id: string; input: string }[]): Promise<Map<string, SandboxOutcome>> {
  const outcomes = new Map<string, SandboxOutcome>();
  if (!tests.length) return Promise.resolve(outcomes);
  const token = randomBytes(6).toString("hex");
  const keys = { input: `__in_${token}`, output: `__out_${token}`, error: `__err_${token}`, describe: `__describe_${token}` };

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    let hardTimer: NodeJS.Timeout | null = null;
    const finish = (fallbackError: string) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      for (const t of tests) if (!outcomes.has(t.id)) outcomes.set(t.id, { error: fallbackError });
      if (worker) void worker.terminate().catch(() => undefined);
      resolve(outcomes);
    };
    try {
      worker = new Worker(SANDBOX_SOURCE, {
        eval: true,
        workerData: { code, tests, keys, timeoutMs: TEST_TIMEOUT_MS },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 24, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      });
    } catch {
      finish("The code runner could not start. Please try again.");
      return;
    }
    hardTimer = setTimeout(() => finish(`Execution timed out after ${TEST_TIMEOUT_MS / 1000}s.`), tests.length * (TEST_TIMEOUT_MS + 500) + 5000);
    worker.on("message", (msg: { type: string; id?: string; output?: string; error?: string }) => {
      if (msg?.type === "result" && typeof msg.id === "string") {
        outcomes.set(msg.id, {
          output: typeof msg.output === "string" ? msg.output : undefined,
          error: typeof msg.error === "string" ? msg.error : undefined,
        });
      } else if (msg?.type === "done") {
        finish("The test did not run.");
      }
    });
    worker.on("error", (err: Error & { code?: string }) => {
      finish(err?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "Memory limit exceeded." : "The code crashed the runner.");
    });
    worker.on("exit", () => finish("The code stopped the runner unexpectedly."));
  });
}

async function gradeOnServer(exercise: ProgrammingExercise, code: string): Promise<TestCaseResult[]> {
  const outcomes = await runInSandbox(
    code,
    exercise.testCases.map((t) => ({ id: t.id, input: t.input })),
  );
  return exercise.testCases.map((t) => {
    const outcome = outcomes.get(t.id) ?? { error: "The test did not run." };
    const actual = outcome.output ?? "";
    const passed = outcome.error === undefined && outcome.output !== undefined && outputsMatch(actual, t.expectedOutput);
    return {
      testCaseId: t.id,
      input: t.input,
      expectedOutput: t.expectedOutput,
      actualOutput: actual,
      passed,
      error: outcome.error,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Sandbox throttle                                                    */
/* ------------------------------------------------------------------ */

/**
 * Each server check can keep a worker thread busy for a long time (up to
 * 50 tests x 3 s). Allow one check per user at a time and a small number of
 * checks server-wide, so parallel submissions cannot exhaust the CPU.
 */
const MAX_CONCURRENT_SANDBOX_RUNS = 4;
const activeSandboxRuns = new Set<string>();

/* ------------------------------------------------------------------ */
/* Learner: submit                                                     */
/* ------------------------------------------------------------------ */

export interface SubmitExerciseInput {
  exerciseId: string;
  code: string;
  results?: ClientTestResult[];
  lessonId?: string | null;
  courseId?: string | null;
}

function sanitizeClientResults(input: unknown, tests: TestCase[]): ClientTestResult[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set(tests.map((t) => t.id));
  const out: ClientTestResult[] = [];
  for (const raw of input.slice(0, MAX_TEST_CASES)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.testCaseId !== "string" || !ids.has(r.testCaseId)) continue;
    out.push({
      testCaseId: r.testCaseId,
      passed: r.passed === true,
      actualOutput: typeof r.actualOutput === "string" ? r.actualOutput.slice(0, MAX_OUTPUT) : "",
      error: typeof r.error === "string" ? r.error.slice(0, 2000) : undefined,
    });
  }
  return out;
}

export async function submitExerciseAction(
  input: SubmitExerciseInput,
): Promise<ActionResult<{ submission: ExerciseSubmissionView; mismatch: boolean; lessonCompleted: boolean; runnable: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to submit your solution." };
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid submission." };

  const db = await getDb();
  if (!db.settings.features.programmingExercises && !canManageAssessments(user)) {
    return { ok: false, error: "Programming exercises are turned off on this site." };
  }
  const exercise = db.exercises.find((e) => e.id === input.exerciseId);
  if (!exercise) return { ok: false, error: "This exercise no longer exists." };
  // Whatever lesson the client names: an exercise that lives only in lessons still locked for this
  // learner (drip schedule, enforced order, prerequisites) takes no submissions.
  if (!canManageAssessments(user)) {
    const gate = await getAssessmentAccess(user, "exercise", exercise.id);
    if (!gate.ok) return { ok: false, error: gate.message };
  }

  // Only trust a lesson id if that lesson actually embeds this exercise.
  let lesson: Lesson | undefined;
  if (typeof input.lessonId === "string" && input.lessonId) {
    lesson = db.lessons.find((l) => l.id === input.lessonId && l.blocks.some((b) => b.type === "exercise" && b.exerciseId === exercise.id));
  }
  // A lesson that is still locked for this learner (drip, order, prerequisites) can't take submissions.
  if (lesson && !canManageAssessments(user)) {
    const locked = await lessonSubmissionLockError(user, lesson.id, "exercise");
    if (locked) return { ok: false, error: locked };
  }

  const code = typeof input.code === "string" ? input.code.replace(/\r\n?/g, "\n") : "";
  if (!code.trim()) return { ok: false, error: "Write some code before submitting." };
  if (code.length > MAX_CODE_LENGTH) return { ok: false, error: `Your code is too long (max ${MAX_CODE_LENGTH.toLocaleString("en-US")} characters).` };

  const clientResults = sanitizeClientResults(input.results, exercise.testCases);
  const runnable = isRunnableLanguage(exercise.language);

  let results: TestCaseResult[];
  if (runnable) {
    if (activeSandboxRuns.has(user.id)) return { ok: false, error: "Your previous submission is still being checked. Please wait for it to finish." };
    if (activeSandboxRuns.size >= MAX_CONCURRENT_SANDBOX_RUNS) return { ok: false, error: "The code checker is busy right now. Please try again in a moment." };
    activeSandboxRuns.add(user.id);
    try {
      results = await gradeOnServer(exercise, code);
    } finally {
      activeSandboxRuns.delete(user.id);
    }
  } else {
    results = exercise.testCases.map((t) => ({
      testCaseId: t.id,
      input: t.input,
      expectedOutput: t.expectedOutput,
      actualOutput: "",
      passed: false,
      error: NOT_RUNNABLE_RESULT_NOTE,
    }));
  }
  const mismatch =
    runnable && clientResults.length > 0 && clientResults.some((c) => results.find((r) => r.testCaseId === c.testCaseId)?.passed !== c.passed);
  const status: ExerciseSubmission["status"] = runnable && results.length > 0 && results.every((r) => r.passed) ? "passed" : "failed";

  const courseId =
    lesson?.courseId ?? (input.courseId && db.courses.some((c) => c.id === input.courseId) ? input.courseId : undefined) ?? exercise.courseId;

  const now = new Date().toISOString();
  const saved = await mutate((d) => {
    const existing = d.exerciseSubmissions
      .filter((s) => s.userId === user.id && s.exerciseId === exercise.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    if (existing) {
      existing.code = code;
      existing.status = status;
      existing.testResults = results;
      existing.exerciseTitle = exercise.title;
      existing.submittedAt = now;
      if (!existing.lessonId && lesson) existing.lessonId = lesson.id;
      if (!existing.courseId && courseId) existing.courseId = courseId;
      return { ...existing };
    }
    const row: ExerciseSubmission = {
      id: uid("esub"),
      exerciseId: exercise.id,
      exerciseTitle: exercise.title,
      userId: user.id,
      courseId,
      lessonId: lesson?.id,
      code,
      status,
      testResults: results,
      submittedAt: now,
    };
    d.exerciseSubmissions.push(row);
    return { ...row };
  });

  await logActivity(user.id, "exercise_submit", exercise.id);
  if (status === "passed") await awardPoints(user.id, "exercise_pass", { refId: exercise.id, lessonId: saved.lessonId });
  // A passing submission from a lesson completes that lesson (when its other requirements are met).
  let lessonCompleted = false;
  const completionLesson = lesson ?? (saved.lessonId ? db.lessons.find((l) => l.id === saved.lessonId) : undefined);
  if (status === "passed" && completionLesson) {
    const outcome = await completeLessonFromAssessment(user, completionLesson);
    lessonCompleted = outcome.completed;
  }

  revalidatePath(`/exercises/${exercise.id}`);
  revalidatePath(`/exercises/submissions/${saved.id}`);
  revalidatePath("/exercises/submissions");
  revalidatePath("/admin/exercises");
  revalidatePath("/admin/exercises/submissions");
  if (saved.lessonId) {
    const href = await getLessonHref(saved.lessonId);
    if (href) revalidatePath(href);
  }

  return {
    ok: true,
    data: {
      submission: toExerciseSubmissionView(saved, exercise, { revealHidden: canManageAssessments(user) }),
      mismatch,
      lessonCompleted,
      runnable,
    },
    message: "Submission saved!",
  };
}

/* ------------------------------------------------------------------ */
/* Admin: create / update / delete                                     */
/* ------------------------------------------------------------------ */

interface RawTestCase {
  id?: unknown;
  input?: unknown;
  expectedOutput?: unknown;
  hidden?: unknown;
}

export async function saveExerciseAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "Your role can't manage programming exercises." };

  const id = fd(formData, "id");
  const title = fd(formData, "title").replace(/\s+/g, " ");
  const language = fd(formData, "language") as ExerciseLanguage;
  const courseId = fd(formData, "courseId");
  const problemStatement = fd(formData, "problemStatement");
  const starterCode = ((formData.get("starterCode") as string | null) ?? "").replace(/\r\n?/g, "\n");

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Title is required.";
  else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
  if (!LANGUAGES.includes(language)) fieldErrors.language = "Choose a language.";
  if (!problemStatement) fieldErrors.problemStatement = "Problem statement is required.";
  if (starterCode.length > MAX_CODE_LENGTH) fieldErrors.starterCode = "Starter code is too long.";

  let parsed: RawTestCase[] = [];
  try {
    const raw = JSON.parse(fd(formData, "testCases") || "[]") as unknown;
    parsed = Array.isArray(raw) ? (raw as RawTestCase[]) : [];
  } catch {
    fieldErrors.testCases = "Test cases could not be read. Please try again.";
  }
  const testCases: TestCase[] = [];
  parsed.forEach((t, i) => {
    const inputValue = typeof t.input === "string" ? t.input.replace(/\r\n?/g, "\n") : "";
    const expected = typeof t.expectedOutput === "string" ? t.expectedOutput.replace(/\r\n?/g, "\n") : "";
    if (!expected.trim()) {
      fieldErrors.testCases ??= `Expected output is required for test ${i + 1}.`;
      return;
    }
    if (inputValue.length > MAX_OUTPUT || expected.length > MAX_OUTPUT) {
      fieldErrors.testCases ??= `Test ${i + 1} is too long.`;
      return;
    }
    const tid = typeof t.id === "string" && /^[a-z0-9_]{1,40}$/i.test(t.id) ? t.id : uid("tc");
    testCases.push({ id: tid, input: inputValue, expectedOutput: expected, hidden: t.hidden === true ? true : undefined });
  });
  if (!fieldErrors.testCases && testCases.length === 0) fieldErrors.testCases = "At least one test case is required for the programming exercise.";
  if (testCases.length > MAX_TEST_CASES) fieldErrors.testCases = `Add at most ${MAX_TEST_CASES} test cases.`;
  // De-duplicate ids.
  const seen = new Set<string>();
  for (const t of testCases) {
    if (seen.has(t.id)) t.id = uid("tc");
    seen.add(t.id);
  }

  const db = await getDb();
  if (courseId && !db.courses.some((c) => c.id === courseId)) fieldErrors.courseId = "That course no longer exists.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const now = new Date().toISOString();
  let savedId = id;
  if (id) {
    if (!db.exercises.some((e) => e.id === id)) return { ok: false, error: "This exercise no longer exists." };
    await mutate((d) => {
      const row = d.exercises.find((e) => e.id === id);
      if (!row) return;
      row.title = title;
      row.language = language;
      row.courseId = courseId || undefined;
      row.problemStatement = problemStatement;
      row.starterCode = starterCode || undefined;
      row.testCases = testCases;
      row.updatedAt = now;
      for (const s of d.exerciseSubmissions) if (s.exerciseId === id) s.exerciseTitle = title;
    });
  } else {
    const exercise: ProgrammingExercise = {
      id: uid("exr"),
      title,
      problemStatement,
      language,
      starterCode: starterCode || undefined,
      testCases,
      courseId: courseId || undefined,
      authorId: user.id,
      createdAt: now,
      updatedAt: now,
    };
    savedId = exercise.id;
    await mutate((d) => {
      d.exercises.push(exercise);
    });
  }

  revalidatePath("/admin/exercises");
  revalidatePath(`/exercises/${savedId}`);
  await setFlash(id ? "Programming Exercise updated successfully" : "Programming Exercise created successfully");
  redirect("/admin/exercises");
}

export async function deleteExercisesAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canManageAssessments(user)) return { ok: false, error: "Your role can't manage programming exercises." };
  const set = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  if (!set.size) return { ok: false, error: "Select at least one exercise." };
  const count = await mutate((d) => {
    const before = d.exercises.length;
    d.exercises = d.exercises.filter((e) => !set.has(e.id));
    d.exerciseSubmissions = d.exerciseSubmissions.filter((s) => !set.has(s.exerciseId));
    return before - d.exercises.length;
  });
  revalidatePath("/admin/exercises");
  revalidatePath("/admin/exercises/submissions");
  revalidatePath("/exercises/submissions");
  for (const id of set) revalidatePath(`/exercises/${id}`);
  return { ok: true, data: { count }, message: count === 1 ? "Exercise deleted successfully" : `${count} exercises deleted successfully` };
}

export async function deleteExerciseSubmissionsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!isModerator(user)) return { ok: false, error: "Only moderators can delete submissions." };
  const set = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  if (!set.size) return { ok: false, error: "Select at least one submission." };
  const removed = await mutate((d) => {
    const gone = d.exerciseSubmissions.filter((s) => set.has(s.id));
    d.exerciseSubmissions = d.exerciseSubmissions.filter((s) => !set.has(s.id));
    return gone;
  });
  revalidatePath("/admin/exercises/submissions");
  revalidatePath("/exercises/submissions");
  for (const s of removed) revalidatePath(`/exercises/${s.exerciseId}`);
  return { ok: true, data: { count: removed.length }, message: "Submissions deleted successfully" };
}
