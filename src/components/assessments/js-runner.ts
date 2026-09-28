"use client";

import { hashOutput, outputsMatch, TEST_TIMEOUT_MS, type RunnerTestCase, type TestResultView } from "./shared";

/**
 * In-browser JavaScript test runner.
 *
 * Each test case runs in a brand-new Web Worker created from a Blob URL, so
 * learner code never touches the page (no DOM, cookies or storage) and an
 * infinite loop is stopped by terminating the worker after the time limit.
 * Inside the worker the code is evaluated with `new Function`, `solve(input)`
 * is called with the test input string, and the returned value (awaited if
 * it is a promise) is coerced to a string and trimmed before comparison.
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

interface WorkerReply {
  ok: boolean;
  output?: string;
  error?: string;
  logs: string[];
  durationMs: number;
}

function runOne(url: string, code: string, input: string, timeoutMs: number, signal?: AbortSignal): Promise<WorkerReply> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch {
      resolve({ ok: false, error: "Your browser blocked the code runner (Web Workers are unavailable).", logs: [], durationMs: 0 });
      return;
    }
    const started = performance.now();
    let done = false;
    const finish = (reply: WorkerReply) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(reply);
    };
    const onAbort = () => finish({ ok: false, error: "Run cancelled.", logs: [], durationMs: Math.round(performance.now() - started) });
    const timer = window.setTimeout(
      () => finish({ ok: false, error: `Execution timed out after ${timeoutMs / 1000}s.`, logs: [], durationMs: timeoutMs }),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ ok: false, error: event.message || "The code could not be executed.", logs: [], durationMs: Math.round(performance.now() - started) });
    };
    worker.postMessage({ code, input });
  });
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called after each test finishes (for progressive rendering). */
  onResult?: (result: TestResultView, done: number, total: number) => void;
}

/** Run every test case against `code` in isolated workers. */
export async function runTestsInBrowser(code: string, tests: RunnerTestCase[], opts: RunOptions = {}): Promise<TestResultView[]> {
  const timeoutMs = opts.timeoutMs ?? TEST_TIMEOUT_MS;
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const results: TestResultView[] = [];
  try {
    for (const test of tests) {
      if (opts.signal?.aborted) break;
      const reply = await runOne(url, code, test.input, timeoutMs, opts.signal);
      const actual = reply.output ?? "";
      let passed = false;
      if (reply.ok) {
        passed = test.expectedHash !== undefined ? hashOutput(actual) === test.expectedHash : outputsMatch(actual, test.expectedOutput ?? "");
      }
      const result: TestResultView = {
        testCaseId: test.id,
        index: test.index,
        hidden: test.hidden,
        passed,
        input: test.input,
        expectedOutput: test.expectedOutput,
        actualOutput: reply.ok ? actual : undefined,
        error: reply.ok ? undefined : reply.error,
        logs: reply.logs,
        durationMs: reply.durationMs,
      };
      results.push(result);
      opts.onResult?.(result, results.length, tests.length);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return results;
}
