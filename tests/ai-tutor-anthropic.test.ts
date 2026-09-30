import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AiProviderError,
  ANTHROPIC_API_URL,
  buildClaudeRequest,
  classifyProviderError,
  interpretStreamPayload,
  parseRetryAfter,
  pingClaude,
  streamClaude,
  type ClaudeStreamEvent,
} from "@/lib/ai/anthropic";
import { createSseParser, encodeSse, type SseMessage } from "@/lib/ai/sse";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Replace `fetch` with a queue of canned responses and record what was sent. */
function stubFetch(responses: (Response | Error | (() => Response))[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return calls;
}

/** An SSE response body delivered in the given byte chunks. */
function sseResponse(chunks: (string | Uint8Array)[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" }, ...init });
}

function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json", ...headers } });
}

const event = (payload: { type: string } & Record<string, unknown>) => `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;

const ANSWER_STREAM = [
  event({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 40, cache_read_input_tokens: 10, output_tokens: 1 } } }),
  event({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
  event({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } }),
  event({ type: "content_block_stop", index: 0 }),
  event({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
  event({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "A closure " } }),
  event({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "remembers — é [1]." } }),
  event({ type: "content_block_stop", index: 1 }),
  event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 27 } }),
  event({ type: "message_stop" }),
].join("");

const REQUEST = { apiKey: "sk-ant-api03-test", model: "claude-opus-5-5", system: "You are a tutor.", messages: [{ role: "user" as const, content: "What is a closure?" }], maxTokens: 16_000 };

async function collect(stream: AsyncGenerator<ClaudeStreamEvent>): Promise<ClaudeStreamEvent[]> {
  const events: ClaudeStreamEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

const textOf = (events: ClaudeStreamEvent[]) => events.map((e) => (e.type === "text" ? e.text : "")).join("");

describe("sse codec", () => {
  const parse = (chunks: string[]): SseMessage[] => {
    const out: SseMessage[] = [];
    const parser = createSseParser((m) => out.push(m));
    for (const c of chunks) parser.push(c);
    parser.end();
    return out;
  };

  it("parses events split at arbitrary points and every line ending", () => {
    const text = "event: a\ndata: 1\n\n: comment\r\nevent: b\r\ndata: {\"x\":\r\ndata: 2}\r\n\r\ndata: plain\r\rdata:no-space\n\n";
    const expected = [
      { event: "a", data: "1" },
      { event: "b", data: '{"x":\n2}' },
      { event: "message", data: "plain" },
      { event: "message", data: "no-space" },
    ];
    assert.deepEqual(parse([text]), expected);
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      assert.deepEqual(parse(chunks), expected, `chunk size ${size}`);
    }
  });

  it("flushes an unterminated final event and ignores events without data", () => {
    assert.deepEqual(parse(["event: only-name\n\n", "event: last\ndata: tail"]), [{ event: "last", data: "tail" }]);
  });

  it("round-trips its own encoder, including newlines inside JSON strings", () => {
    const payload = { type: "delta", text: "line 1\nline 2 — ✓" };
    const [message] = parse([encodeSse("delta", payload)]);
    assert.equal(message!.event, "delta");
    assert.deepEqual(JSON.parse(message!.data), payload);
  });
});

describe("anthropic request", () => {
  it("sends the documented headers and body, with low effort and the refusal fallback opt-in", () => {
    const { headers, body } = buildClaudeRequest({ ...REQUEST, stream: true });
    assert.equal(headers["x-api-key"], REQUEST.apiKey);
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers["anthropic-beta"], "server-side-fallback-2026-07-01");
    assert.deepEqual(body, {
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      system: REQUEST.system,
      messages: REQUEST.messages,
      stream: true,
      output_config: { effort: "low" },
      fallbacks: "default",
    });
    assert.ok(!JSON.stringify(body).includes(REQUEST.apiKey), "the key travels in a header only");
  });

  it("never sends parameters current models reject", () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5"]) {
      const { body } = buildClaudeRequest({ ...REQUEST, model, stream: true });
      for (const key of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) assert.ok(!(key in body), `${model}: ${key}`);
    }
  });

  it("leaves out effort and fallbacks where the model doesn't take them", () => {
    const haiku = buildClaudeRequest({ ...REQUEST, model: "claude-haiku-4-5", stream: false });
    assert.ok(!("output_config" in haiku.body));
    assert.ok(!("fallbacks" in haiku.body));
    assert.ok(!("anthropic-beta" in haiku.headers));
    assert.ok(!("stream" in haiku.body));

    const sonnet5 = buildClaudeRequest({ ...REQUEST, model: "claude-sonnet-5", stream: true });
    assert.deepEqual(sonnet5.body.output_config, { effort: "low" });
    assert.ok(!("fallbacks" in sonnet5.body));

    const optedOut = buildClaudeRequest({ ...REQUEST, stream: true, fallbacks: false });
    assert.ok(!("fallbacks" in optedOut.body));
    assert.ok(!("anthropic-beta" in optedOut.headers));
  });
});

describe("anthropic errors", () => {
  it("reads Retry-After as seconds or a date", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    assert.equal(parseRetryAfter("12"), 12);
    assert.equal(parseRetryAfter("1.2"), 2);
    assert.equal(parseRetryAfter("0"), 0);
    assert.equal(parseRetryAfter("Tue, 10 Mar 2026 12:00:30 GMT", now), 30);
    assert.equal(parseRetryAfter("Tue, 10 Mar 2026 11:00:00 GMT", now), 0, "a date in the past means now");
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("soon"), undefined);
  });

  it("classifies every documented error", () => {
    const cases: [number, string, AiProviderError["kind"], boolean][] = [
      [400, "invalid_request_error", "bad_request", false],
      [401, "authentication_error", "auth", false],
      [402, "billing_error", "billing", false],
      [403, "permission_error", "permission", false],
      [404, "not_found_error", "not_found", false],
      [413, "request_too_large", "too_large", false],
      [429, "rate_limit_error", "rate_limit", true],
      [500, "api_error", "server", true],
      [503, "api_error", "server", true],
      [529, "overloaded_error", "overloaded", true],
    ];
    for (const [status, type, kind, transient] of cases) {
      const err = classifyProviderError(status, JSON.stringify({ type: "error", error: { type, message: `${type} happened` } }), null);
      assert.equal(err.kind, kind, `${status} ${type}`);
      assert.equal(err.transient, transient, `${status} transient`);
      assert.equal(err.status, status);
      assert.equal(err.message, `${type} happened`);
      assert.equal(err.retryAfter !== undefined, transient, "transient errors always carry a retry hint");
    }
  });

  it("prefers the API's Retry-After and survives non-JSON bodies", () => {
    assert.equal(classifyProviderError(429, "{}", "42").retryAfter, 42);
    assert.equal(classifyProviderError(529, "{}", null).retryAfter, 15);
    const gateway = classifyProviderError(502, "<html>Bad gateway</html>", null);
    assert.equal(gateway.kind, "server");
    assert.ok(gateway.message.includes("Bad gateway"));
    assert.equal(classifyProviderError(418, "", null).message, "HTTP 418");
  });
});

describe("anthropic stream events", () => {
  it("adds cached tokens to the input count and reports the serving model", () => {
    assert.deepEqual(interpretStreamPayload({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 1 } } }), [
      { type: "usage", inputTokens: 1005, outputTokens: 1, model: "claude-opus-5-5" },
    ]);
  });

  it("emits text only for text deltas", () => {
    assert.deepEqual(interpretStreamPayload({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }), [{ type: "text", text: "hi" }]);
    assert.deepEqual(interpretStreamPayload({ type: "content_block_delta", delta: { type: "thinking_delta" } }), []);
    assert.deepEqual(interpretStreamPayload({ type: "content_block_delta", delta: { type: "signature_delta" } }), []);
    assert.deepEqual(interpretStreamPayload({ type: "content_block_start", content_block: { type: "text" } }), []);
    assert.deepEqual(interpretStreamPayload({ type: "ping" }), []);
    assert.deepEqual(interpretStreamPayload({ type: "message_stop" }), []);
  });

  it("marks a fallback boundary and reports the stop reason with final usage", () => {
    assert.deepEqual(interpretStreamPayload({ type: "content_block_start", content_block: { type: "fallback" } }), [{ type: "fallback" }]);
    assert.deepEqual(interpretStreamPayload({ type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 9 } }), [
      { type: "usage", inputTokens: undefined, outputTokens: 9 },
      { type: "stop", reason: "refusal" },
    ]);
  });

  it("turns an in-stream error event into a typed error", () => {
    const thrown = (type: string) => {
      try {
        interpretStreamPayload({ type: "error", error: { type, message: "busy" } });
      } catch (err) {
        return err as AiProviderError;
      }
      throw new Error("expected an error");
    };
    assert.equal(thrown("overloaded_error").kind, "overloaded");
    assert.equal(thrown("rate_limit_error").kind, "rate_limit");
    assert.equal(thrown("api_error").kind, "server");
    assert.ok(thrown("overloaded_error") instanceof AiProviderError);
  });
});

describe("anthropic streaming client", () => {
  it("streams text, usage and the stop reason", async () => {
    const calls = stubFetch([sseResponse([ANSWER_STREAM])]);
    const events = await collect(streamClaude(REQUEST));
    assert.equal(textOf(events), "A closure remembers — é [1].");
    assert.deepEqual(events.at(-1), { type: "stop", reason: "end_turn" });
    assert.deepEqual(events[0], { type: "usage", inputTokens: 50, outputTokens: 1, model: "claude-opus-5-5" });
    assert.ok(events.some((e) => e.type === "usage" && e.outputTokens === 27));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, ANTHROPIC_API_URL);
    assert.equal(calls[0]!.body.stream, true);
  });

  it("reassembles events and multi-byte characters split across network chunks", async () => {
    const bytes = new TextEncoder().encode(ANSWER_STREAM);
    for (const size of [1, 3, 17]) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      stubFetch([sseResponse(chunks)]);
      assert.equal(textOf(await collect(streamClaude(REQUEST))), "A closure remembers — é [1].", `chunk size ${size}`);
    }
  });

  it("keeps the partial answer and continues when a fallback model takes over", async () => {
    stubFetch([
      sseResponse([
        event({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 10 } } }),
        event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Part one. " } }),
        event({ type: "content_block_start", index: 1, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } } }),
        event({ type: "content_block_stop", index: 1 }),
        event({ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Part two." } }),
        event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } }),
      ]),
    ]);
    const events = await collect(streamClaude(REQUEST));
    assert.equal(textOf(events), "Part one. Part two.");
    assert.equal(events.filter((e) => e.type === "fallback").length, 1);
  });

  it("raises a typed error for an overload reported mid-stream, after the text already sent", async () => {
    stubFetch([
      sseResponse([
        event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half an ans" } }),
        event({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      ]),
    ]);
    const seen: ClaudeStreamEvent[] = [];
    await assert.rejects(
      async () => {
        for await (const e of streamClaude(REQUEST)) seen.push(e);
      },
      (err: unknown) => err instanceof AiProviderError && err.kind === "overloaded" && err.transient,
    );
    assert.equal(textOf(seen), "Half an ans");
  });

  it("reports a rejected key without retrying", async () => {
    const calls = stubFetch([apiError(401, "authentication_error", "invalid x-api-key")]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "auth" && !err.transient && err.status === 401);
    assert.equal(calls.length, 1);
  });

  it("passes a rate limit on with the API's Retry-After instead of retrying", async () => {
    const calls = stubFetch([apiError(429, "rate_limit_error", "Too many requests", { "retry-after": "37" })]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "rate_limit" && err.retryAfter === 37);
    assert.equal(calls.length, 1);
  });

  it("drops the fallback opt-in and retries when the account doesn't have the beta", async () => {
    const calls = stubFetch([apiError(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."), sseResponse([ANSWER_STREAM])]);
    assert.equal(textOf(await collect(streamClaude(REQUEST))), "A closure remembers — é [1].");
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.body.fallbacks, "default");
    assert.ok(!("fallbacks" in calls[1]!.body));
    assert.ok(!("anthropic-beta" in calls[1]!.headers));
  });

  it("does not hide other invalid-request errors behind a retry", async () => {
    const calls = stubFetch([apiError(400, "invalid_request_error", "max_tokens: 99999999 > 128000")]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "bad_request");
    assert.equal(calls.length, 1);
  });

  it("retries an overload once, then gives up with a retry hint", async () => {
    const recovered = stubFetch([apiError(529, "overloaded_error", "Overloaded"), sseResponse([ANSWER_STREAM])]);
    assert.equal(textOf(await collect(streamClaude(REQUEST))), "A closure remembers — é [1].");
    assert.equal(recovered.length, 2);

    const stillDown = stubFetch([apiError(529, "overloaded_error", "Overloaded"), apiError(529, "overloaded_error", "Overloaded")]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "overloaded" && err.retryAfter === 15);
    assert.equal(stillDown.length, 2);
  });

  it("does not wait out a long Retry-After inside the request", async () => {
    const calls = stubFetch([apiError(503, "api_error", "Service unavailable", { "retry-after": "60" })]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "server" && err.retryAfter === 60);
    assert.equal(calls.length, 1);
  });

  it("retries a network failure once and then reports it", async () => {
    const calls = stubFetch([new TypeError("fetch failed"), new TypeError("fetch failed")]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "network" && err.transient);
    assert.equal(calls.length, 2);
  });

  it("stops quietly when the caller aborts", async () => {
    const abort = new AbortController();
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as typeof fetch;
    const pending = collect(streamClaude(REQUEST, abort.signal));
    abort.abort();
    await assert.rejects(pending, (err: unknown) => err instanceof AiProviderError && err.kind === "aborted" && !err.transient);
  });

  it("treats an unreadable stream as a provider error", async () => {
    stubFetch([sseResponse(["event: content_block_delta\ndata: {not json\n\n"])]);
    await assert.rejects(collect(streamClaude(REQUEST)), (err: unknown) => err instanceof AiProviderError && err.kind === "server");
  });
});

describe("anthropic connection test", () => {
  it("sends a small non-streaming request and returns the model's reply", async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "" }, { type: "text", text: " OK " }], stop_reason: "end_turn" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const result = await pingClaude("sk-ant-api03-test", "claude-opus-5-5");
    assert.equal(result.reply, "OK");
    assert.equal(result.model, "claude-opus-5-5");
    assert.ok(result.latencyMs >= 0);
    assert.ok(!("stream" in calls[0]!.body));
    assert.equal(calls[0]!.headers["x-api-key"], "sk-ant-api03-test");
  });

  it("surfaces an unknown model as not found", async () => {
    stubFetch([apiError(404, "not_found_error", "model: claude-nope")]);
    await assert.rejects(pingClaude("sk-ant-api03-test", "claude-nope"), (err: unknown) => err instanceof AiProviderError && err.kind === "not_found");
  });
});
