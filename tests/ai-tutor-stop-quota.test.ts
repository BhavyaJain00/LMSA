import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { aiEnv } from "@/lib/server-env";
import { AiProviderError, streamClaude, streamLimits, type ClaudeStreamEvent } from "@/lib/ai/anthropic";
import { learnerQuota } from "@/lib/ai/chat";
import { createSseParser } from "@/lib/ai/sse";
import type { ChatStreamEvent } from "@/lib/ai/types";
import { POST } from "@/app/api/ai/chat/route";
import { makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Stopping an answer and stalled streams: a request the API accepted keeps
 * counting against the daily limit even when the learner stops it before any
 * text arrived, a stream is cut off only when it stalls (not by a wall
 * clock), and a stalled answer keeps the part already shown.
 */

const env = aiEnv as { anthropicApiKey: string };
const realFetch = globalThis.fetch;
const savedLimits = { ...streamLimits };
const encoder = new TextEncoder();
const event = (payload: { type: string } & Record<string, unknown>) => encoder.encode(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
const messageStart = () => event({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 700, output_tokens: 1 } } });
const textDelta = (text: string) => event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });

let n = 0;
let learner: User;
let courseId = "";

/** A provider response that sends `chunks`, then stays open until the request is aborted. */
function hangingProvider(chunks: Uint8Array[]) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(c);
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )) as typeof fetch;
}

function request(message: string, signal?: AbortSignal): NextRequest {
  const url = new URL("/api/ai/chat", "https://lms.test");
  const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, message }), signal });
  return Object.assign(req, { nextUrl: url }) as unknown as NextRequest;
}

/** Read the SSE response until `until` appears in the raw text (or the stream ends). */
async function readUntil(res: Response, until?: string): Promise<{ text: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!until || !text.includes(until)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return { text, reader };
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
  for (;;) {
    const { done } = await reader.read().catch(() => ({ done: true }));
    if (done) break;
  }
}

function events(raw: string): ChatStreamEvent[] {
  const out: ChatStreamEvent[] = [];
  const parser = createSseParser(({ data }) => out.push(JSON.parse(data) as ChatStreamEvent));
  parser.push(raw);
  parser.end();
  return out;
}

/** The route finishes its bookkeeping right after the stream closes. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(async () => {
  n++;
  // The daily ledger and the per-user limits live for the process: a fresh learner per test.
  learner = makeUser({ id: `usr_stop_${n}` });
  const tree = makeCourseTree([[{ title: "Closures", blocks: [{ id: "m", type: "markdown", content: "A closure remembers the variables of its outer scope." }] }]], {
    course: { id: `crs_stop_${n}`, aiTutorEnabled: true },
  });
  courseId = tree.course.id;
  await resetDb({
    users: [learner],
    courses: [tree.course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: [makeEnrollment({ userId: learner.id, courseId })],
    settings: { ai: { enabled: true, dailyMessageLimit: 3 } },
  });
  env.anthropicApiKey = "sk-ant-api03-stop-test";
  resetRequest();
  await createSession(learner.id);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  env.anthropicApiKey = "";
  Object.assign(streamLimits, savedLimits);
});

const remaining = async () => learnerQuota(await getDb(), learner.id, false).remaining;

describe("POST /api/ai/chat: stopping before the answer starts", () => {
  it("keeps charging a request the API accepted, even though the question is taken back", async () => {
    hangingProvider([messageStart()]);
    const abort = new AbortController();
    const res = await POST(request("What is a closure?", abort.signal));
    const { reader } = await readUntil(res, "event: citations");
    // Give the route time to receive the API's response.
    await settle();
    abort.abort();
    await drain(reader);
    await settle();

    const db = await getDb();
    assert.equal(db.aiMessages.length, 0, "the unanswered question is removed");
    assert.equal(db.aiConversations.length, 0);
    assert.equal(await remaining(), 2, "but it still counts against today's limit");
  });

  it("refunds a request stopped before the API accepted it", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as typeof fetch;
    const abort = new AbortController();
    const res = await POST(request("What is a closure?", abort.signal));
    const { reader } = await readUntil(res, "event: citations");
    abort.abort();
    await drain(reader);
    await settle();

    assert.equal((await getDb()).aiMessages.length, 0);
    assert.equal(await remaining(), 3);
  });
});

describe("POST /api/ai/chat: stalled streams", () => {
  it("keeps the part of the answer already shown, with a note, when the stream stalls", async () => {
    streamLimits.idleTimeoutMs = 60;
    hangingProvider([messageStart(), textDelta("A closure remembers its scope [1].")]);
    const res = await POST(request("What is a closure?"));
    const { text } = await readUntil(res);
    const list = events(text);
    assert.deepEqual(
      list.map((e) => e.type),
      ["start", "citations", "delta", "done"],
    );
    const done = list.find((e): e is Extract<ChatStreamEvent, { type: "done" }> => e.type === "done")!;
    assert.match(done.message.content, /^A closure remembers its scope \[1\]\.\n\n\*\(This answer was cut short because the AI service stopped responding/);
    await settle();
    const db = await getDb();
    assert.deepEqual(
      db.aiMessages.map((m) => m.role),
      ["user", "assistant"],
    );
    assert.equal(db.aiMessages[1]!.tokensIn, 700);
  });

  it("reports a stall before any text as a retryable failure and doesn't charge it", async () => {
    streamLimits.idleTimeoutMs = 60;
    hangingProvider([messageStart()]);
    const { text } = await readUntil(await POST(request("What is a closure?")));
    const failure = events(text).find((e): e is Extract<ChatStreamEvent, { type: "error" }> => e.type === "error")!;
    assert.equal(failure.code, "provider_error");
    assert.equal(failure.retryAfter, 5);
    await settle();
    assert.equal((await getDb()).aiMessages.length, 0);
    assert.equal(await remaining(), 3);
  });
});

describe("anthropic stream limits", () => {
  const REQUEST = { apiKey: "k", model: "claude-opus-5-5", system: "s", messages: [{ role: "user" as const, content: "q" }], maxTokens: 100 };

  it("is not cut off by a wall clock while data keeps arriving", async () => {
    // Pieces arrive every 30 ms for ~240 ms with a 100 ms idle limit.
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(messageStart());
            for (let i = 0; i < 8; i++) {
              await new Promise((resolve) => setTimeout(resolve, 30));
              controller.enqueue(textDelta(`${i}`));
            }
            controller.enqueue(event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } }));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    let accepted = 0;
    const seen: ClaudeStreamEvent[] = [];
    for await (const e of streamClaude(REQUEST, undefined, { idleTimeoutMs: 100, onAccepted: () => accepted++ })) seen.push(e);
    assert.equal(accepted, 1);
    assert.equal(
      seen
        .filter((e) => e.type === "text")
        .map((e) => (e as { text: string }).text)
        .join(""),
      "01234567",
    );
  });

  it("fails with a timeout when the stream goes quiet", async () => {
    hangingProvider([messageStart(), textDelta("Half")]);
    const seen: ClaudeStreamEvent[] = [];
    await assert.rejects(
      async () => {
        for await (const e of streamClaude(REQUEST, undefined, { idleTimeoutMs: 50 })) seen.push(e);
      },
      (err: unknown) => err instanceof AiProviderError && err.kind === "timeout" && err.transient,
    );
    assert.ok(seen.some((e) => e.type === "text"));
  });

  it("does not report acceptance for a rejected request", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401 })) as typeof fetch;
    let accepted = false;
    await assert.rejects(async () => {
      for await (const e of streamClaude(REQUEST, undefined, { onAccepted: () => (accepted = true) })) void e;
    });
    assert.equal(accepted, false);
  });
});
