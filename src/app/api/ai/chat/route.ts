import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db/store";
import { recordError } from "@/lib/errors/record";
import { readLimitedText } from "@/lib/media/body";
import { isCrossSite } from "@/lib/media/upload-http";
import { aiEnv } from "@/lib/server-env";
import { courseTutorAccess, unavailableMessage } from "@/lib/ai/access";
import { AiProviderError, streamClaude } from "@/lib/ai/anthropic";
import { excerptCitations, learnerQuota, parseChatRequest, rollbackUserTurn, saveAssistantTurn, saveUserTurn, toQuotaView } from "@/lib/ai/chat";
import { readableLessonIds, retrieveExcerpts } from "@/lib/ai/course-index";
import { buildMessages, buildSystemPrompt, retrievalQuery, type HistoryMessage } from "@/lib/ai/prompt";
import { citationViews, conversationMessages, lessonLinks, toConversationSummary, toMessageView } from "@/lib/ai/service";
import { encodeSse } from "@/lib/ai/sse";
import type { AiErrorCode, ChatStreamEvent } from "@/lib/ai/types";

/**
 * AI tutor chat: `POST /api/ai/chat` with JSON
 * `{ courseId, conversationId?, lessonId?, message }`.
 *
 * Checks (in order): signed in, same site, JSON body ≤ 16 KB, valid input,
 * the tutor is enabled for the site and the course and the key is configured,
 * the viewer is enrolled or manages the course, per-user rate limits (per
 * minute and per hour), the daily message limit, one answer at a time per
 * user and a site-wide cap on answers being written. Then it streams the
 * answer as Server-Sent Events (`start`, `citations`, `delta`, then `done` or
 * `error`, with comment lines as keep-alives while the model is thinking) and
 * stores the exchange with its token usage. A question that gets no answer
 * because of a provider failure is removed again and doesn't count against
 * the daily limit. A question the learner stops before any text arrived is
 * removed too, but still counts once the API accepted it (it is billed).
 *
 * Only this learner's own conversation and course material are sent to the
 * model; locked lessons (drip, order, scheduled) are excluded for learners.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
/** Room for adaptive thinking plus a concise answer. */
const MAX_OUTPUT_TOKENS = 16_000;
const RATE_RULE = { limit: 8, windowMs: 60_000 };
/** Backstop for sites without a daily limit and for course staff, who are exempt from it. */
const HOURLY_RULE = { limit: 120, windowMs: 60 * 60_000 };
/** Comment lines sent while no text is flowing, so proxies keep the connection open. */
const KEEP_ALIVE_MS = 15_000;
/** Answers streamed at once across the site; more would only run into the API's own rate limits. */
const MAX_CONCURRENT_ANSWERS = 24;

const g = globalThis as unknown as { __llAiChatLimiter?: SlidingWindowRateLimiter; __llAiChatInFlight?: Set<string> };
const limiter: SlidingWindowRateLimiter = (g.__llAiChatLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));
const inFlight: Set<string> = (g.__llAiChatInFlight ??= new Set());

function fail(status: number, code: AiErrorCode, message: string, retryAfter?: number, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return NextResponse.json({ ok: false, code, error: message, ...(retryAfter ? { retryAfter } : {}), ...extra }, { status, headers });
}

/** Learner-safe wording for provider failures; managers also see the provider's message. */
function describeProviderError(err: AiProviderError, manager: boolean): { code: AiErrorCode; message: string; retryAfter?: number } {
  const detail = manager ? ` (Anthropic API: ${err.message})` : "";
  switch (err.kind) {
    case "rate_limit":
      return { code: "rate_limited", message: "The AI tutor is answering a lot of questions right now. Please try again shortly.", retryAfter: err.retryAfter };
    case "overloaded":
      return { code: "overloaded", message: "The AI service is busy at the moment. Please try again shortly.", retryAfter: err.retryAfter };
    case "server":
    case "network":
    case "timeout":
      return { code: "provider_error", message: "The AI tutor couldn't answer this time. Please try again.", retryAfter: err.retryAfter ?? 5 };
    case "too_large":
      return { code: "invalid_input", message: "This conversation has grown too long. Start a new conversation and ask again." };
    default:
      return { code: "provider_error", message: `The AI tutor isn't set up correctly, so it can't answer right now. The course team has been told.${detail}` };
  }
}

const REFUSAL_TEXT = "I can't help with that request. Try asking about the course material in a different way.";
const CUT_SHORT_NOTE = "*(This answer was cut short. Ask a narrower question for the rest.)*";
const STALLED_NOTE = "*(This answer was cut short because the AI service stopped responding. Ask again for the rest.)*";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail(401, "unauthorized", "Sign in to ask the AI tutor.");
  if (isCrossSite(req)) return fail(403, "forbidden", "Questions can only be sent from this site.");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "invalid_input", "Send the question as JSON.");

  const read = await readLimitedText(req, MAX_BODY_BYTES);
  if (!read.ok) return fail(read.status, "invalid_input", read.status === 413 ? "Your question is too long." : "Invalid request.");
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return fail(400, "invalid_input", "Invalid request.");
  }
  const parsed = parseChatRequest(raw);
  if (!parsed.ok) return fail(400, "invalid_input", parsed.error);
  const input = parsed.value;

  const db = await getDb();
  const course = db.courses.find((c) => c.id === input.courseId);
  if (!course) return fail(404, "forbidden", "This course is not available.");
  const access = courseTutorAccess(db, course, user);
  if (!access.ok) {
    const notConfigured = access.reason === "site_disabled" || access.reason === "no_key" || access.reason === "course_disabled";
    return fail(notConfigured ? 503 : 403, notConfigured ? "not_configured" : "forbidden", unavailableMessage(access.reason));
  }

  const hourly = limiter.check(`ai-chat-hour:${user.id}`, HOURLY_RULE);
  if (!hourly.ok) {
    const seconds = Math.max(1, Math.ceil(hourly.retryAfterMs / 1000));
    const minutes = Math.ceil(seconds / 60);
    return fail(429, "rate_limited", `You've asked a lot of questions in the last hour. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`, seconds);
  }
  const rate = limiter.hit(`ai-chat:${user.id}`, RATE_RULE);
  if (!rate.ok) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return fail(429, "rate_limited", `You're asking questions very quickly. Wait ${seconds} seconds and try again.`, seconds);
  }
  const quota = learnerQuota(db, user.id, access.manager);
  if (quota.exceeded) {
    const untilReset = Math.max(1, Math.ceil((Date.parse(quota.resetsAt) - Date.now()) / 1000));
    return fail(429, "quota", `You've used all ${quota.limit} AI tutor questions for today. The limit resets at midnight UTC.`, untilReset, { resetsAt: quota.resetsAt, quota: toQuotaView(quota) });
  }

  // The lesson context must belong to the course and be open to the viewer.
  let lessonId = input.lessonId;
  if (lessonId) {
    const lesson = db.lessons.find((l) => l.id === lessonId && l.courseId === course.id);
    const readable = readableLessonIds(db, course, user);
    if (!lesson || (readable && !readable.has(lesson.id))) lessonId = null;
  }
  if (input.conversationId) {
    const existing = db.aiConversations.find((c) => c.id === input.conversationId);
    if (!existing || existing.userId !== user.id || existing.courseId !== course.id) return fail(404, "forbidden", "This conversation no longer exists.");
    lessonId = lessonId ?? existing.lessonId ?? null;
  }

  if (inFlight.has(user.id)) return fail(409, "busy", "The tutor is still answering your previous question.", 3);
  if (inFlight.size >= MAX_CONCURRENT_ANSWERS) return fail(503, "overloaded", "The AI tutor is helping a lot of learners right now. Please try again in a moment.", 10);
  inFlight.add(user.id);
  limiter.hit(`ai-chat-hour:${user.id}`, HOURLY_RULE);

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      inFlight.delete(user.id);
    }
  };

  try {
    const history: HistoryMessage[] = input.conversationId
      ? conversationMessages(db, input.conversationId).map((m) => ({ role: m.role, content: m.content, instructorNote: m.instructorNote }))
      : [];
    const lessonTitle = lessonId ? (db.lessons.find((l) => l.id === lessonId)?.title ?? null) : null;
    const excerpts = retrieveExcerpts(db, course, user, retrievalQuery(input.message, history), { currentLessonId: lessonId });
    const citations = excerptCitations(excerpts, course);
    const system = buildSystemPrompt({ siteName: db.settings.brand.name, courseTitle: course.title, addition: db.settings.ai.systemPrompt });
    const messages = buildMessages(
      history,
      input.message,
      excerpts.map((e) => ({ label: e.label, text: e.text })),
      lessonTitle,
    );
    const model = db.settings.ai.model;

    const turn = await saveUserTurn({ userId: user.id, courseId: course.id, conversationId: input.conversationId, lessonId, message: input.message });
    if (!turn) {
      release();
      return fail(404, "forbidden", "This conversation no longer exists.");
    }

    const links = lessonLinks(db, course);
    const abort = new AbortController();
    const onClientGone = () => abort.abort();
    req.signal.addEventListener("abort", onClientGone, { once: true });
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: ChatStreamEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(encodeSse(event.type, event)));
          } catch {
            open = false;
          }
        };

        const messageCount = conversationMessages(await getDb(), turn.conversation.id).length;
        send({
          type: "start",
          conversation: toConversationSummary(turn.conversation, messageCount, links),
          userMessage: toMessageView(turn.userMessage, links),
          quota: toQuotaView(learnerQuota(await getDb(), user.id, access.manager)),
        });
        send({ type: "citations", citations: citationViews(citations, links) });

        const keepAlive = setInterval(() => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            open = false;
          }
        }, KEEP_ALIVE_MS);

        let text = "";
        let tokensIn = 0;
        let tokensOut = 0;
        let stopReason: string | null = null;
        /** The API accepted the request: from here on it is billed, answered or not. */
        let accepted = false;
        const onAccepted = () => {
          accepted = true;
        };
        try {
          for await (const event of streamClaude({ apiKey: aiEnv.anthropicApiKey, model, system, messages, maxTokens: MAX_OUTPUT_TOKENS }, abort.signal, { onAccepted })) {
            if (event.type === "text") {
              text += event.text;
              send({ type: "delta", text: event.text });
            } else if (event.type === "usage") {
              if (event.inputTokens) tokensIn = Math.max(tokensIn, event.inputTokens);
              if (event.outputTokens) tokensOut = Math.max(tokensOut, event.outputTokens);
            } else if (event.type === "stop") {
              stopReason = event.reason;
            }
          }

          let content = text.trim();
          if (stopReason === "refusal") content = REFUSAL_TEXT;
          else if (stopReason === "max_tokens" && content) content = `${content}\n\n${CUT_SHORT_NOTE}`;
          if (!content) throw new AiProviderError("server", "The AI service returned an empty answer.", undefined, 5);

          const saved = await saveAssistantTurn(turn, { content, citations, tokensIn, tokensOut });
          send({ type: "done", message: toMessageView(saved, links), quota: toQuotaView(learnerQuota(await getDb(), user.id, access.manager)) });
        } catch (err) {
          const clientGone = abort.signal.aborted;
          const partial = text.trim();
          const stalled = !clientGone && err instanceof AiProviderError && err.kind === "timeout";
          if (clientGone && partial) {
            // The learner pressed Stop or left: keep what they already read.
            await saveAssistantTurn(turn, { content: partial, citations, tokensIn, tokensOut }).catch(() => undefined);
          } else if (clientGone) {
            // Stopped before any text arrived: the question is taken back, but once the API accepted
            // the request it is billed, so it keeps counting against the daily limit.
            await rollbackUserTurn(turn, { keepCharge: accepted }).catch(() => undefined);
          } else if (stalled && partial) {
            // The stream stalled after part of the answer was shown: keep that part instead of discarding it.
            const saved = await saveAssistantTurn(turn, { content: `${partial}\n\n${STALLED_NOTE}`, citations, tokensIn, tokensOut }).catch(() => null);
            if (saved) send({ type: "done", message: toMessageView(saved, links), quota: toQuotaView(learnerQuota(await getDb(), user.id, access.manager)) });
            else {
              await rollbackUserTurn(turn).catch(() => undefined);
              send({ type: "error", code: "provider_error", message: "The AI tutor couldn't answer this time. Please try again.", retryAfter: 5 });
            }
          } else {
            await rollbackUserTurn(turn).catch(() => undefined);
            if (err instanceof AiProviderError) {
              // Setup problems (bad key, billing, unknown model) go to the admin error log, which alerts administrators.
              if (!err.transient && err.kind !== "aborted" && err.kind !== "too_large") {
                void recordError({ message: `AI tutor: the Anthropic API rejected the request (${err.kind}${err.status ? `, HTTP ${err.status}` : ""}): ${err.message}`, path: "/api/ai/chat", method: "POST", userId: user.id });
              }
              send({ type: "error", ...describeProviderError(err, access.manager) });
            } else {
              void recordError({ message: `AI tutor: unexpected error while answering: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : undefined, path: "/api/ai/chat", method: "POST", userId: user.id });
              send({ type: "error", code: "provider_error", message: "The AI tutor couldn't answer this time. Please try again.", retryAfter: 5 });
            }
          }
        } finally {
          clearInterval(keepAlive);
          req.signal.removeEventListener("abort", onClientGone);
          release();
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    release();
    throw err;
  }
}
