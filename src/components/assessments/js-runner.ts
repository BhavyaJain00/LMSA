"use client";

import { outputsMatch, TEST_TIMEOUT_MS, type RunnerTestCase, type TestResultView } from "./shared";

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
 * - direct: the worker is created from a Blob URL by this page. The worker
 *   shares the page's origin, which is fine for code the viewer wrote
 *   themselves (the learner's own editor).
 * - isolated: for code the viewer did NOT write (reviewing a submission),
 *   the workers are created inside a hidden `<iframe sandbox="allow-scripts">`.
 *   That document has an opaque origin, so the code cannot make same-origin
 *   requests with the viewer's cookies (admin pages, server actions, uploads).
 *
 * Hidden tests sent to learners carry no input or expected output
 * (`serverOnly`); they are reported as "checked on submit" and graded by the
 * server sandbox.
 */
const WORKER_SOURCE = `
"use strict";
function fmt(v) {
  try {
    if (typeof v === "string") return v;
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]";
    if (typeof v === "bigint") return v.toString() + "n";
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}
function describe(e) {
  try {
    var n = e && e.name;
    var m = e && e.message;
    return n && m ? String(n) + ": " + String(m) : String(m || e);
  } catch (e2) {
    return "Unknown error";
  }
}
self.onmessage = async function (event) {
  var data = event.data || {};
  var logs = [];
  var push = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]));
    if (logs.length < 100) logs.push(parts.join(" ").slice(0, 2000));
  };
  var sandboxConsole = { log: push, info: push, warn: push, error: push, debug: push, table: push };
  var started = Date.now();
  try {
    var factory = new Function("console", data.code + "\\n;return typeof solve === 'function' ? solve : undefined;");
    var solve = factory(sandboxConsole);
    if (typeof solve !== "function") throw new Error("Define a function named solve(input) that returns the answer.");
    var result = solve(data.input);
    if (result !== null && result !== undefined && typeof result.then === "function") result = await result;
    var output = result === undefined || result === null ? "" : String(result);
    self.postMessage({ ok: true, output: output.slice(0, 10000), logs: logs, durationMs: Date.now() - started });
  } catch (err) {
    self.postMessage({ ok: false, error: describe(err), logs: logs, durationMs: Date.now() - started });
  }
};
`;

const BLOCKED_MESSAGE = "Your browser blocked the code runner (Web Workers are unavailable).";

/**
 * Document loaded into the sandboxed iframe. It receives one `run` message
 * per test, runs it in a fresh worker (Blob URL first, `data:` URL as a
 * fallback; both have an opaque origin here) and posts the reply back.
 */
const ISOLATED_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  var SRC = ${JSON.stringify(WORKER_SOURCE).replace(/</g, "\\u003c")};
  var blobUrl = null;
  try { blobUrl = URL.createObjectURL(new Blob([SRC], { type: "text/javascript" })); } catch (e) { blobUrl = null; }
  function makeWorker() {
    if (blobUrl) { try { return new Worker(blobUrl); } catch (e) { /* fall through */ } }
    return new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(SRC));
  }
  var current = null;
  function send(msg) { parent.postMessage(msg, "*"); }
  window.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var d = ev.data || {};
    if (d.type === "cancel") { if (current) { try { current.terminate(); } catch (e) {} current = null; } return; }
    if (d.type !== "run") return;
    var w;
    try { w = makeWorker(); } catch (e) {
      send({ type: "result", id: d.id, reply: { ok: false, error: ${JSON.stringify(BLOCKED_MESSAGE)}, logs: [], durationMs: 0 } });
      return;
    }
    current = w;
    var started = Date.now();
    var done = false;
    var timer = 0;
    function fin(r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { w.terminate(); } catch (e) {}
      if (current === w) current = null;
      send({ type: "result", id: d.id, reply: r });
    }
    timer = setTimeout(function () {
      fin({ ok: false, error: "Execution timed out after " + d.timeoutMs / 1000 + "s.", logs: [], durationMs: d.timeoutMs });
    }, d.timeoutMs);
    w.onmessage = function (e) { fin(e.data); };
    w.onerror = function (e) { e.preventDefault(); fin({ ok: false, error: e.message || "The code could not be executed.", logs: [], durationMs: Date.now() - started }); };
    w.postMessage({ code: d.code, input: d.input });
  });
  send({ type: "ready" });
})();
</script></body></html>`;

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
/* Direct mode: Blob URL worker created by this page                   */
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
    frame.srcdoc = ISOLATED_DOCUMENT;

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
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    runOne = directRunner(url);
    cleanup = () => URL.revokeObjectURL(url);
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
