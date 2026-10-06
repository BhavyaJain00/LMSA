/**
 * Sources of the in-browser JavaScript exercise runner, served as their own
 * documents by `/api/exercise-runner/worker` and `/api/exercise-runner/frame`.
 *
 * They are separate responses (not Blob URLs or `srcdoc` created by the page)
 * because evaluating learner code needs `new Function`, and a worker or a
 * frame created by the page would inherit the page's Content Security Policy.
 * Served from their own URLs they get their own narrow policy (see
 * `runnerHeaders` in next.config.ts), so the rest of the site can forbid eval.
 *
 * No imports and no "use client": the route handlers and the client runner both use it.
 */

/** Same-origin worker that runs the viewer's own code. */
export const RUNNER_WORKER_URL = "/api/exercise-runner/worker";
/** Document loaded into a `sandbox="allow-scripts"` frame (opaque origin) to run code the viewer did not write. */
export const RUNNER_FRAME_URL = "/api/exercise-runner/frame";

export const WORKER_SOURCE = `
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

export const BLOCKED_MESSAGE = "Your browser blocked the code runner (Web Workers are unavailable).";

/**
 * Document loaded into the sandboxed iframe (from RUNNER_FRAME_URL). It receives one `run` message
 * per test, runs it in a fresh worker (Blob URL first, `data:` URL as a
 * fallback; both have an opaque origin here) and posts the reply back.
 */
export const ISOLATED_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
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
