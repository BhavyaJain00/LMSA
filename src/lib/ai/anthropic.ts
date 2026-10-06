import "server-only";
import { createSseParser } from "./sse";
import { supportsDefaultFallback, supportsEffort } from "./models";

/**
 * Anthropic Messages API client for the AI tutor, written against the raw
 * HTTP API with `fetch` (the project ships no SDKs).
 *
 *  - Streaming (`stream: true`) with a hand-written SSE reader.
 *  - Low effort for fast, inexpensive tutoring replies on models that support
 *    it; thinking stays at the model default (adaptive where available).
 *  - Server-side refusal fallbacks (`fallbacks: "default"`) on the models that
 *    support them. When a fallback model takes over mid-stream the API keeps
 *    the partial answer and the fallback model continues it on the same
 *    stream (the `fallback` content block is only a boundary marker), so the
 *    streamed text stays valid; a final `refusal` stop reason means every
 *    model in the chain declined.
 *  - Typed errors with a retry-after hint; one automatic retry for overload,
 *    5xx and network failures before any output is streamed.
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Whole-request ceiling of the non-streaming connection test. */
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * Streaming limits. A long answer with adaptive thinking can take several
 * minutes, so a stream is not cut off by a wall clock while it is making
 * progress: it fails only when the API doesn't respond in time, when no data
 * (text, thinking or the API's ping events) arrives for a while, or at a
 * generous absolute ceiling.
 */
export const streamLimits = {
  /** Until the API answers the request (response headers). */
  connectTimeoutMs: 60_000,
  /** Longest gap between two pieces of the stream. */
  idleTimeoutMs: 90_000,
  /** Absolute ceiling for one answer. */
  maxDurationMs: 10 * 60_000,
};
/** Pause before the single automatic retry of a transient failure. */
const RETRY_PAUSE_MS = 800;
/** Longest Retry-After (seconds) that is waited out inside the request instead of being reported. */
const MAX_INLINE_RETRY_SECONDS = 5;

export type ProviderErrorKind =
  | "auth"
  | "permission"
  | "billing"
  | "not_found"
  | "too_large"
  | "bad_request"
  | "rate_limit"
  | "overloaded"
  | "server"
  | "network"
  | "timeout"
  | "aborted";

export class AiProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Seconds to wait before retrying, when the API said so (or a sensible default). */
  readonly retryAfter?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number, retryAfter?: number) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  /** Worth retrying later (as opposed to a configuration problem). */
  get transient(): boolean {
    return ["rate_limit", "overloaded", "server", "network", "timeout"].includes(this.kind);
  }
}

export interface ClaudeRequest {
  apiKey: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens: number;
  stream: boolean;
  /** Include the refusal-fallback opt-in (dropped automatically if the API rejects it). */
  fallbacks?: boolean;
}

/** Request headers and JSON body (pure; exported for tests). */
export function buildClaudeRequest(req: ClaudeRequest): { headers: Record<string, string>; body: Record<string, unknown> } {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": req.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  };
  if (req.stream) body.stream = true;
  if (supportsEffort(req.model)) body.output_config = { effort: "low" };
  if (req.fallbacks !== false && supportsDefaultFallback(req.model)) {
    headers["anthropic-beta"] = FALLBACK_BETA;
    body.fallbacks = "default";
  }
  return { headers, body };
}

/** Parse a Retry-After header (seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  return undefined;
}

/** Map an HTTP error response of the Messages API to a typed error (pure; exported for tests). */
export function classifyProviderError(status: number, bodyText: string, retryAfterHeader: string | null): AiProviderError {
  let type = "";
  let message = "";
  try {
    const parsed = JSON.parse(bodyText) as { error?: { type?: string; message?: string } };
    type = parsed.error?.type ?? "";
    message = parsed.error?.message ?? "";
  } catch {
    message = bodyText.slice(0, 300);
  }
  const retryAfter = parseRetryAfter(retryAfterHeader);
  const text = message || `HTTP ${status}`;
  if (status === 401 || type === "authentication_error") return new AiProviderError("auth", text, status);
  if (status === 402 || type === "billing_error") return new AiProviderError("billing", text, status);
  if (status === 403 || type === "permission_error") return new AiProviderError("permission", text, status);
  if (status === 404 || type === "not_found_error") return new AiProviderError("not_found", text, status);
  if (status === 413 || type === "request_too_large") return new AiProviderError("too_large", text, status);
  if (status === 429 || type === "rate_limit_error") return new AiProviderError("rate_limit", text, status, retryAfter ?? 20);
  if (status === 529 || type === "overloaded_error") return new AiProviderError("overloaded", text, status, retryAfter ?? 15);
  if (status >= 500 || type === "api_error") return new AiProviderError("server", text, status, retryAfter ?? 10);
  return new AiProviderError("bad_request", text, status);
}

/** A 400 caused by the optional fallback opt-in (beta not enabled for the account). */
function rejectsFallbackOptIn(err: AiProviderError): boolean {
  return err.kind === "bad_request" && /anthropic-beta|fallback/i.test(err.message);
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortError(signal: AbortSignal, err: unknown): AiProviderError {
  const reason = signal.reason as { name?: string } | undefined;
  if (reason?.name === "TimeoutError") return new AiProviderError("timeout", "The AI service took too long to answer.", undefined, 5);
  return new AiProviderError("aborted", err instanceof Error ? err.message : "Request cancelled");
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** POST with one retry for transient failures and one without the fallback opt-in if it's rejected. */
async function send(req: ClaudeRequest, signal: AbortSignal): Promise<Response> {
  let fallbacks = req.fallbacks !== false;
  let transientRetries = 1;
  for (;;) {
    const { headers, body } = buildClaudeRequest({ ...req, fallbacks });
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, { method: "POST", headers, body: JSON.stringify(body), signal, cache: "no-store" });
    } catch (err) {
      if (signal.aborted) throw abortError(signal, err);
      if (transientRetries-- > 0) {
        try {
          await sleep(RETRY_PAUSE_MS, signal);
        } catch (aborted) {
          throw abortError(signal, aborted);
        }
        continue;
      }
      throw new AiProviderError("network", "Could not reach the AI service.", undefined, 10);
    }
    if (res.ok) return res;
    const retryAfterHeader = res.headers.get("retry-after");
    const error = classifyProviderError(res.status, await res.text().catch(() => ""), retryAfterHeader);
    if (fallbacks && rejectsFallbackOptIn(error)) {
      fallbacks = false;
      continue;
    }
    // Overload and 5xx: try once more straight away, unless the API asks for a longer wait than a learner should sit through.
    const wait = parseRetryAfter(retryAfterHeader) ?? 1;
    if ((error.kind === "overloaded" || error.kind === "server") && wait <= MAX_INLINE_RETRY_SECONDS && transientRetries-- > 0) {
      try {
        await sleep(Math.max(RETRY_PAUSE_MS, wait * 1000), signal);
      } catch (err) {
        throw abortError(signal, err);
      }
      continue;
    }
    throw error;
  }
}

export type ClaudeStreamEvent =
  | { type: "text"; text: string }
  /** A fallback model took over and continues the answer. */
  | { type: "fallback" }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; model?: string }
  | { type: "stop"; reason: string | null };

interface StreamPayload {
  type?: string;
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
  content_block?: { type?: string };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/** Translate one parsed stream payload into zero or more events (pure; exported for tests). */
export function interpretStreamPayload(payload: StreamPayload): ClaudeStreamEvent[] {
  switch (payload.type) {
    case "message_start": {
      const u = payload.message?.usage;
      const input = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
      return [{ type: "usage", inputTokens: input || undefined, outputTokens: u?.output_tokens, model: payload.message?.model }];
    }
    case "content_block_start":
      return payload.content_block?.type === "fallback" ? [{ type: "fallback" }] : [];
    case "content_block_delta":
      return payload.delta?.type === "text_delta" && payload.delta.text ? [{ type: "text", text: payload.delta.text }] : [];
    case "message_delta": {
      const events: ClaudeStreamEvent[] = [];
      if (payload.usage) events.push({ type: "usage", inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens });
      events.push({ type: "stop", reason: payload.delta?.stop_reason ?? null });
      return events;
    }
    case "error": {
      const type = payload.error?.type ?? "api_error";
      const status = type === "overloaded_error" ? 529 : type === "rate_limit_error" ? 429 : 500;
      throw classifyProviderError(status, JSON.stringify(payload), null);
    }
    default:
      return [];
  }
}

export interface StreamOptions {
  /**
   * Called once the API has accepted the request (2xx response), i.e. from
   * the moment the request is billed even if no text ever arrives.
   */
  onAccepted?: () => void;
  /** Overrides of `streamLimits` for this request. */
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
}

/** An abort signal that fires a `TimeoutError` when `arm`ed time runs out; re-arming restarts the clock. */
function idleTimer(): { signal: AbortSignal; arm: (ms: number) => void; clear: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    signal: controller.signal,
    arm(ms) {
      clear();
      timer = setTimeout(() => controller.abort(new DOMException("The AI service stopped responding.", "TimeoutError")), ms);
      timer.unref?.();
    },
    clear,
  };
}

/** Stream a reply. Throws `AiProviderError` on failure (before or during the stream). */
export async function* streamClaude(req: Omit<ClaudeRequest, "stream">, signal?: AbortSignal, options: StreamOptions = {}): AsyncGenerator<ClaudeStreamEvent> {
  const idle = idleTimer();
  const signals = [idle.signal, AbortSignal.timeout(options.maxDurationMs ?? streamLimits.maxDurationMs)];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);
  idle.arm(options.connectTimeoutMs ?? streamLimits.connectTimeoutMs);
  let res: Response;
  try {
    res = await send({ ...req, stream: true }, combined);
  } catch (err) {
    idle.clear();
    throw err;
  }
  options.onAccepted?.();
  const idleMs = options.idleTimeoutMs ?? streamLimits.idleTimeoutMs;
  idle.arm(idleMs);
  if (!res.body) {
    idle.clear();
    throw new AiProviderError("server", "The AI service returned an empty response.", res.status, 10);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const pending: ClaudeStreamEvent[] = [];
  let failure: unknown = null;
  const parser = createSseParser(({ data }) => {
    if (failure) return;
    try {
      pending.push(...interpretStreamPayload(JSON.parse(data) as StreamPayload));
    } catch (err) {
      failure = err instanceof AiProviderError ? err : new AiProviderError("server", "The AI service sent an unreadable response.", undefined, 10);
    }
  });
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (combined.aborted) throw abortError(combined, err);
        throw new AiProviderError("network", "The connection to the AI service was interrupted.", undefined, 5);
      }
      // Any data (including the API's ping events while the model thinks) shows the stream is alive.
      if (!chunk.done) idle.arm(idleMs);
      if (chunk.done) {
        parser.push(decoder.decode());
        parser.end();
      } else {
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      // Text that arrived before an error in the same network chunk is still delivered first.
      while (pending.length) yield pending.shift()!;
      if (failure) throw failure;
      if (chunk.done) return;
    }
  } finally {
    idle.clear();
    reader.releaseLock();
    if (!combined.aborted) void res.body.cancel().catch(() => undefined);
  }
}

/** Send a tiny request to check the key and model (Settings → Test connection). */
export async function pingClaude(apiKey: string, model: string): Promise<{ model: string; latencyMs: number; reply: string }> {
  const started = Date.now();
  const signal = withTimeout(undefined);
  const res = await send(
    { apiKey, model, system: "You are a connectivity check. Reply with the single word OK.", messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 512, stream: false },
    signal,
  );
  const json = (await res.json().catch(() => ({}))) as { model?: string; content?: { type: string; text?: string }[] };
  const reply = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  return { model: json.model ?? model, latencyMs: Date.now() - started, reply };
}
