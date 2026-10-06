"use client";

import { outputsMatch, TEST_TIMEOUT_MS, type RunnerTestCase, type TestResultView } from "./shared";
import { BLOCKED_MESSAGE, RUNNER_FRAME_URL, RUNNER_WORKER_URL } from "./js-runner-source";

/**
 * In-browser JavaScript test runner.
 *
 * Each test case runs in a brand-new Web Worker, so learner code never
 * touches the page DOM and an infinite loop is stopped by terminating the
 * worker after the time limit. Inside the worker the code is evaluated with
 * `new Function`, `solve(input)` is called with the test input string, and
 * the returned value (awaited if it is a promise) is coerced to a string and
 * trimmed before comparison.
 *
 * Two modes:
 * - direct: the worker is loaded from RUNNER_WORKER_URL. It shares the
 *   page's origin, which is fine for code the viewer wrote themselves (the
 *   learner's own editor).
 * - isolated: for code the viewer did NOT write (reviewing a submission),
 *   the workers are created inside a hidden `<iframe sandbox="allow-scripts">`
 *   loaded from RUNNER_FRAME_URL. That document has an opaque origin, so the
 *   code cannot make same-origin requests with the viewer's cookies (admin
 *   pages, server actions, uploads).
 *
 * Both documents are served with their own Content Security Policy, the only
 * one on the site that allows `new Function` (see `js-runner-source.ts`).
 *
 * Hidden tests sent to learners carry no input or expected output
 * (`serverOnly`); they are reported as "checked on submit" and graded by the
 * server sandbox.
 */
interface WorkerReply {
  ok: boolean;
  output?: string;
  error?: string;
  logs: string[];
  durationMs: number;
}

/** Replies come from code we do not trust: keep only well-typed fields. */
function normalizeReply(raw: unknown, fallbackMs: number): WorkerReply {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const logs = Array.isArray(r.logs)
    ? r.logs
        .filter((l): l is string => typeof l === "string")
        .slice(0, 100)
        .map((l) => l.slice(0, 2000))
    : [];
  const durationMs = typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? Math.max(0, Math.round(r.durationMs)) : fallbackMs;
  if (r.ok === true) return { ok: true, output: typeof r.output === "string" ? r.output.slice(0, 10000) : "", logs, durationMs };
  return { ok: false, error: typeof r.error === "string" ? r.error.slice(0, 2000) : "The code could not be executed.", logs, durationMs };
}

type RunOne = (code: string, input: string, timeoutMs: number, signal?: AbortSignal) => Promise<WorkerReply>;

/* ------------------------------------------------------------------ */
/* Direct mode: same-origin worker script                              */
/* ------------------------------------------------------------------ */

function directRunner(url: string): RunOne {
  return (code, input, timeoutMs, signal) =>
    new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(url);
      } catch {
        resolve({ ok: false, error: BLOCKED_MESSAGE, logs: [], durationMs: 0 });
        return;
      }
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      let done = false;
      const finish = (reply: WorkerReply) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        resolve(reply);
      };
      const onAbort = () => finish({ ok: false, error: "Run cancelled.", logs: [], durationMs: elapsed() });
      const timer = window.setTimeout(
        () => finish({ ok: false, error: `Execution timed out after ${timeoutMs / 1000}s.`, logs: [], durationMs: timeoutMs }),
        timeoutMs,
      );
      signal?.addEventListener("abort", onAbort);
      worker.onmessage = (event: MessageEvent<unknown>) => finish(normalizeReply(event.data, elapsed()));
      worker.onerror = (event) => {
        event.preventDefault();
        finish({ ok: false, error: event.message || "The code could not be executed.", logs: [], durationMs: elapsed() });
      };
      worker.postMessage({ code, input });
    });
}

/* ------------------------------------------------------------------ */
/* Isolated mode: workers live in an opaque-origin sandboxed iframe    */
/* ------------------------------------------------------------------ */

interface IsolatedHost {
  run: RunOne;
  dispose: () => void;
}

function createIsolatedHost(): Promise<IsolatedHost | null> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // allow-scripts WITHOUT allow-same-origin: the frame gets an opaque origin.
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.title = "Code runner";
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;";
    frame.src = RUNNER_FRAME_URL;

    let seq = 0;
    let ready = false;
    const pending = new Map<number, (raw: unknown) => void>();

    const post = (msg: unknown) => frame.contentWindow?.postMessage(msg, "*");

    const run: RunOne = (code, input, timeoutMs, signal) =>
      new Promise((resolveRun) => {
        const id = ++seq;
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        let done = false;
        const finish = (reply: WorkerReply) => {
          if (done) return;
          done = true;
          pending.delete(id);
          window.clearTimeout(watchdog);
          signal?.removeEventListener("abort", onAbort);
          resolveRun(reply);
        };
        const onAbort = () => {
          post({ type: "cancel" });
          finish({ ok: false, error: "Run cancelled.", logs: [], durationMs: elapsed() });
        };
        // The frame enforces the per-test limit; this only guards against a frame that stopped answering.
        const watchdog = window.setTimeout(() => {
          post({ type: "cancel" });
          finish({ ok: false, error: `Execution timed out after ${timeoutMs / 1000}s.`, logs: [], durationMs: timeoutMs });
        }, timeoutMs + 2000);
        signal?.addEventListener("abort", onAbort);
        pending.set(id, (raw) => finish(normalizeReply(raw, elapsed())));
        post({ type: "run", id, code, input, timeoutMs });
      });

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: unknown; id?: unknown; reply?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "ready" && !ready) {
        ready = true;
        window.clearTimeout(readyTimer);
        resolve({ run, dispose });
      } else if (data.type === "result" && typeof data.id === "number") {
        pending.get(data.id)?.(data.reply);
      }
    };

    const dispose = () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("message", onMessage);
      for (const cb of [...pending.values()]) cb({ ok: false, error: "Run cancelled." });
      pending.clear();
      frame.remove();
    };

    const readyTimer = window.setTimeout(() => {
      if (ready) return;
      dispose();
      resolve(null);
    }, 5000);

    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Run inside an opaque-origin sandboxed iframe. Required whenever the code
   * was not written by the current viewer.
   */
  isolated?: boolean;
  /** Called after each test finishes (for progressive rendering). */
  onResult?: (result: TestResultView, done: number, total: number) => void;
}

/** Run every test case against `code` in fresh workers. */
export async function runTestsInBrowser(code: string, tests: RunnerTestCase[], opts: RunOptions = {}): Promise<TestResultView[]> {
  const timeoutMs = opts.timeoutMs ?? TEST_TIMEOUT_MS;
  let runOne: RunOne;
  let cleanup: () => void;
  if (opts.isolated) {
    const host = await createIsolatedHost();
    if (host) {
      runOne = host.run;
      cleanup = host.dispose;
    } else {
      runOne = async () => ({ ok: false, error: "The isolated code runner could not start in this browser.", logs: [], durationMs: 0 });
      cleanup = () => undefined;
    }
  } else {
    runOne = directRunner(RUNNER_WORKER_URL);
    cleanup = () => undefined;
  }

  const results: TestResultView[] = [];
  try {
    for (const test of tests) {
      if (opts.signal?.aborted) break;
      let result: TestResultView;
      if (test.serverOnly || test.input === undefined) {
        // Hidden test whose data never reaches the browser: the server grades it on submit.
        result = { testCaseId: test.id, index: test.index, hidden: test.hidden, passed: false, pending: true };
      } else {
        const reply = await runOne(code, test.input, timeoutMs, opts.signal);
        const actual = reply.output ?? "";
        result = {
          testCaseId: test.id,
          index: test.index,
          hidden: test.hidden,
          passed: reply.ok && outputsMatch(actual, test.expectedOutput ?? ""),
          input: test.input,
          expectedOutput: test.expectedOutput,
          actualOutput: reply.ok ? actual : undefined,
          error: reply.ok ? undefined : reply.error,
          logs: reply.logs,
          durationMs: reply.durationMs,
        };
      }
      results.push(result);
      opts.onResult?.(result, results.length, tests.length);
    }
  } finally {
    cleanup();
  }
  return results;
}
