import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { AiConversation, AiMessage, Course, Lesson, User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import type { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { getDb, mutate } from "@/lib/db/store";
import { aiEnv } from "@/lib/server-env";
import { UNKNOWN_ANSWER } from "@/lib/ai/prompt";
import { createSseParser } from "@/lib/ai/sse";
import type { ChatStreamEvent } from "@/lib/ai/types";
import { POST } from "@/app/api/ai/chat/route";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makeUser, resetDb, type SettingsPatch } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const TEST_KEY = "sk-ant-api03-route-test-key";
const env = aiEnv as { anthropicApiKey: string };
const realFetch = globalThis.fetch;

interface ProviderCall {
  headers: Record<string, string>;
  body: { model: string; system: string; max_tokens: number; stream?: boolean; messages: { role: string; content: string }[] };
}

let calls: ProviderCall[] = [];
let n = 0;
let learner: User;
let outsider: User;
let instructor: User;
let course: Course;
let lessons: Lesson[];

const event = (payload: { type: string } & Record<string, unknown>) => `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;

/** Body of a streamed Messages API reply. */
function answerStream(text: string, options: { stop?: string; input?: number; output?: number } = {}): string {
  const half = Math.ceil(text.length / 2);
  return [
    event({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: options.input ?? 640, output_tokens: 1 } } }),
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ...(text ? [event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, half) } }), event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(half) } })] : []),
    event({ type: "content_block_stop", index: 0 }),
    event({ type: "message_delta", delta: { stop_reason: options.stop ?? "end_turn" }, usage: { output_tokens: options.output ?? 58 } }),
    event({ type: "message_stop" }),
  ].join("");
}

const sse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
const apiError = (status: number, type: string, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "content-type": "application/json", ...headers } });

/** Answer Anthropic API calls from a queue; any other request fails the test. */
function provider(responses: (Response | ((init: RequestInit) => Response))[]) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    calls.push({ headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) as ProviderCall["body"] });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request to the AI service");
    return typeof next === "function" ? next(init ?? {}) : next;
  }) as typeof fetch;
}

async function as(user: User | null) {
  resetRequest();
  if (user) await createSession(user.id);
}

function request(body: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal; raw?: string } = {}): NextRequest {
  const url = new URL("/api/ai/chat", "https://lms.test");
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.raw ?? JSON.stringify(body),
    signal: init.signal,
  });
  return Object.assign(req, { nextUrl: url }) as unknown as NextRequest;
}

async function readEvents(res: Response): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  const parser = createSseParser(({ data }) => events.push(JSON.parse(data) as ChatStreamEvent));
  parser.push(await res.text());
  parser.end();
  return events;
}

async function ask(message: string, extra: Record<string, unknown> = {}): Promise<{ res: Response; events: ChatStreamEvent[] }> {
  const res = await POST(request({ courseId: course.id, message, ...extra }));
  const stream = (res.headers.get("content-type") ?? "").startsWith("text/event-stream");
  return { res, events: stream ? await readEvents(res) : [] };
}

const errorBody = async (res: Response) => (await res.json()) as { ok: boolean; code: string; error: string; retryAfter?: number; resetsAt?: string; quota?: { remaining: number | null } };
const find = <T extends ChatStreamEvent["type"]>(events: ChatStreamEvent[], type: T) => events.find((e): e is Extract<ChatStreamEvent, { type: T }> => e.type === type);

async function seed(options: { settings?: SettingsPatch["ai"]; course?: Partial<Course>; conversations?: AiConversation[]; messages?: AiMessage[] } = {}) {
  n++;
  // Rate limits, the daily ledger and the one-answer-at-a-time guard are per user and live for the process.
  learner = makeUser({ id: `usr_air_learner_${n}`, name: "Lena Learner", email: `lena${n}@example.com` });
  outsider = makeUser({ id: `usr_air_outsider_${n}` });
  instructor = makeUser({ id: `usr_air_teacher_${n}`, roles: ["student", "course_creator"] });
  const tree = makeCourseTree(
    [
      [
        { id: `les_air_closures_${n}`, title: "Closures", blocks: [{ id: "m1", type: "markdown", content: "## Lexical scope\n\nA closure remembers the variables of its outer scope even after that function returned." }] },
        { id: `les_air_promises_${n}`, title: "Promises", blocks: [{ id: "m2", type: "markdown", content: "A promise settles later; use await to read its value." }] },
      ],
      [{ id: `les_air_generators_${n}`, title: "Generators", availableFrom: "2099-01-01", blocks: [{ id: "m3", type: "markdown", content: "Generators yield values lazily with the yield keyword. ZEBRA-LOCKED-CONTENT" }] }],
    ],
    { course: { id: `crs_air_${n}`, slug: `async-js-${n}`, title: "Async JavaScript", instructorIds: [instructor.id], aiTutorEnabled: true, ...(options.course ?? {}) } },
  );
  course = tree.course;
  lessons = tree.lessons;
  await resetDb({
    users: [learner, outsider, instructor],
    courses: [course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: [makeEnrollment({ userId: learner.id, courseId: course.id })],
    aiConversations: options.conversations ?? [],
    aiMessages: options.messages ?? [],
    settings: { ai: { enabled: true, dailyMessageLimit: 3, systemPrompt: "Always be encouraging.", ...(options.settings ?? {}) } },
  });
  env.anthropicApiKey = TEST_KEY;
  await as(learner);
}

beforeEach(async () => {
  provider([]);
  await seed();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  env.anthropicApiKey = "";
});

describe("POST /api/ai/chat: who may ask", () => {
  it("requires a signed-in user", async () => {
    await as(null);
    const { res } = await ask("What is a closure?");
    assert.equal(res.status, 401);
    assert.equal((await errorBody(res)).code, "unauthorized");
    assert.equal(calls.length, 0);
  });

  it("refuses requests sent from another site", async () => {
    const res = await POST(request({ courseId: course.id, message: "hi" }, { headers: { origin: "https://evil.example" } }));
    assert.equal(res.status, 403);
    const sameSite = await POST(request({ courseId: course.id, message: "" }, { headers: { origin: "https://lms.test" } }));
    assert.equal(sameSite.status, 400, "the site's own origin gets as far as input validation");
  });

  it("validates the body before doing any work", async () => {
    const notJson = await POST(request(null, { headers: { "content-type": "text/plain" }, raw: "hello" }));
    assert.equal(notJson.status, 415);
    assert.equal((await POST(request(null, { raw: "{broken" }))).status, 400);
    assert.equal((await ask("   ")).res.status, 400);
    const long = await ask("x".repeat(2001));
    assert.equal(long.res.status, 400);
    assert.equal((await errorBody(long.res)).code, "invalid_input");
    assert.equal((await POST(request(null, { raw: JSON.stringify({ courseId: course.id, message: "x".repeat(20_000) }) }))).status, 413);
    assert.equal((await POST(request({ courseId: "crs_missing", message: "hi" }))).status, 404);
    assert.equal(calls.length, 0);
    assert.equal((await getDb()).aiMessages.length, 0);
  });

  it("is unavailable until the site switch, the key and the course switch are all on", async () => {
    const expectOff = async () => {
      const { res } = await ask("What is a closure?");
      assert.equal(res.status, 503);
      const body = await errorBody(res);
      assert.equal(body.code, "not_configured");
      assert.ok(!body.error.includes("ANTHROPIC"), "learners never see setup details");
    };
    await seed({ settings: { enabled: false } });
    await expectOff();
    await seed();
    env.anthropicApiKey = "";
    await expectOff();
    await seed({ course: { aiTutorEnabled: false } });
    await expectOff();
    assert.equal(calls.length, 0);
  });

  it("answers enrolled learners and the course's staff only", async () => {
    await as(outsider);
    const denied = await ask("What is a closure?");
    assert.equal(denied.res.status, 403);
    assert.match((await errorBody(denied.res)).error, /Enroll/);

    provider([sse(answerStream("Staff preview answer [1]."))]);
    await as(instructor);
    const staff = await ask("What is a closure?");
    assert.equal(staff.res.status, 200);
    assert.equal(find(staff.events, "done")?.message.content, "Staff preview answer [1].");
    assert.equal(find(staff.events, "done")?.quota.limit, 0, "staff have no daily limit");
  });

  it("hides unpublished courses from learners", async () => {
    await seed({ course: { published: false } });
    const { res } = await ask("What is a closure?");
    assert.equal(res.status, 403);
  });
});

describe("POST /api/ai/chat: streaming and storage", () => {
  it("streams start, citations, text and done, and stores the exchange with token usage", async () => {
    provider([sse(answerStream("A closure remembers the variables of its outer scope [1].", { input: 712, output: 41 }))]);
    const { res, events } = await ask("What is a closure?", { lessonId: lessons[0]!.id });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual([...new Set(events.map((e) => e.type))], ["start", "citations", "delta", "done"]);

    const start = find(events, "start")!;
    assert.equal(start.conversation.title, "What is a closure?");
    assert.equal(start.conversation.lessonTitle, "Closures");
    assert.equal(start.userMessage.content, "What is a closure?");
    assert.deepEqual([start.quota.limit, start.quota.remaining], [3, 2]);

    const citations = find(events, "citations")!.citations;
    assert.equal(citations[0]!.n, 1);
    assert.equal(citations[0]!.title, "Closures");
    assert.equal(citations[0]!.href, `/courses/${course.slug}/learn/1-1`);

    assert.equal(events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join(""), "A closure remembers the variables of its outer scope [1].");
    const done = find(events, "done")!;
    assert.equal(done.message.role, "assistant");
    assert.equal(done.message.citations.length, citations.length);
    assert.equal(done.quota.remaining, 2);

    const db = await getDb();
    assert.deepEqual(db.aiConversations.map((c) => [c.userId, c.courseId, c.lessonId]), [[learner.id, course.id, lessons[0]!.id]]);
    assert.deepEqual(db.aiMessages.map((m) => m.role), ["user", "assistant"]);
    const answer = db.aiMessages[1]!;
    assert.equal(answer.id, done.message.id);
    assert.equal(answer.tokensIn, 712);
    assert.equal(answer.tokensOut, 41);
    assert.equal(answer.citations?.[0]?.lessonId, lessons[0]!.id);
  });

  it("sends the grounded prompt: settings model, system rules, excerpts and the question", async () => {
    await mutate((db) => {
      db.settings.ai.model = "claude-sonnet-5-5";
    });
    provider([sse(answerStream("Answer [1]."))]);
    await ask("What is a closure?", { lessonId: lessons[0]!.id });
    assert.equal(calls.length, 1);
    const { headers, body } = calls[0]!;
    assert.equal(headers["x-api-key"], TEST_KEY);
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.stream, true);
    assert.ok(body.system.includes("Async JavaScript"));
    assert.ok(body.system.includes(UNKNOWN_ANSWER));
    assert.ok(body.system.includes("Always be encouraging."));
    assert.equal(body.messages.length, 1);
    const turn = body.messages[0]!.content;
    assert.ok(turn.includes("A closure remembers the variables of its outer scope"));
    assert.ok(turn.includes("<current_lesson>Closures</current_lesson>"));
    assert.ok(turn.includes("What is a closure?"));
  });

  it("never sends other learners' conversations, personal data or locked lessons", async () => {
    const theirs: AiConversation = { id: "aic_air_theirs", userId: outsider.id, courseId: course.id, title: "ZEBRA-OTHER-LEARNER-TITLE", createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
    const theirMessages: AiMessage[] = [
      { id: "aim_air_q", conversationId: theirs.id, role: "user", content: "ZEBRA-OTHER-LEARNER-QUESTION about closures", createdAt: FIXED_NOW },
      { id: "aim_air_a", conversationId: theirs.id, role: "assistant", content: "ZEBRA-OTHER-LEARNER-ANSWER about closures", createdAt: FIXED_NOW },
    ];
    await mutate((db) => {
      db.aiConversations.push(theirs);
      db.aiMessages.push(...theirMessages);
    });
    provider([sse(answerStream("Answer [1]."))]);
    // Asking from the locked lesson doesn't unlock its content either.
    const { events } = await ask("closures generators yield keyword", { lessonId: lessons[2]!.id });
    const sent = JSON.stringify(calls[0]!.body);
    assert.ok(!sent.includes("ZEBRA"), "no other learner's messages and no locked lesson text");
    assert.ok(!sent.includes(learner.email) && !sent.includes(learner.name) && !sent.includes(learner.id), "no personal data about the asker");
    assert.ok(!find(events, "citations")!.citations.some((c) => c.title === "Generators"));
    const mine = (await getDb()).aiConversations.find((c) => c.userId === learner.id);
    assert.ok(mine && mine.lessonId === undefined, "a locked lesson is not recorded as the context");
  });

  it("lets course staff ask about lessons learners can't open yet", async () => {
    await as(instructor);
    provider([sse(answerStream("Generators are lazy [1]."))]);
    await ask("How do generators yield values lazily?");
    assert.ok(calls[0]!.body.messages[0]!.content.includes("Generators yield values lazily"));
  });

  it("continues a conversation with its history and keeps its lesson", async () => {
    provider([sse(answerStream("A closure is a function with its scope [1].")), sse(answerStream("Here is an example [1]."))]);
    const first = await ask("What is a closure?", { lessonId: lessons[0]!.id });
    const conversationId = find(first.events, "start")!.conversation.id;
    const second = await ask("Show an example", { conversationId });
    assert.equal(find(second.events, "start")!.conversation.id, conversationId);
    assert.equal(find(second.events, "start")!.conversation.messageCount, 3);

    const messages = calls[1]!.body.messages;
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(messages[0]!.content, "What is a closure?");
    assert.equal(messages[1]!.content, "A closure is a function with its scope [1].");
    assert.ok(messages[2]!.content.includes("<current_lesson>Closures</current_lesson>"), "the conversation's lesson stays the context");
    assert.ok(messages[2]!.content.includes("A closure remembers"), "a short follow-up is retrieved with the previous question");

    const db = await getDb();
    assert.equal(db.aiConversations.length, 1);
    assert.deepEqual(db.aiMessages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  });

  it("refuses to continue someone else's conversation", async () => {
    provider([sse(answerStream("Mine [1]."))]);
    const mine = await ask("What is a closure?");
    const conversationId = find(mine.events, "start")!.conversation.id;
    await mutate((db) => {
      db.enrollments.push(makeEnrollment({ userId: outsider.id, courseId: course.id }));
    });
    await as(outsider);
    const { res } = await ask("Let me read this", { conversationId });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 1);
    assert.equal((await getDb()).aiMessages.length, 2);
  });

  it("stores a plain message when every model declines, and notes answers cut short", async () => {
    provider([sse(answerStream("I can", { stop: "refusal" })), sse(answerStream("A very long explanation", { stop: "max_tokens" }))]);
    const refused = await ask("Something the model declines");
    assert.match(find(refused.events, "done")!.message.content, /can't help with that request/);
    const cut = await ask("Explain everything");
    assert.match(find(cut.events, "done")!.message.content, /^A very long explanation\n\n\*\(This answer was cut short/);
  });

  it("marks answers that say the course doesn't cover the question", async () => {
    provider([sse(answerStream(`${UNKNOWN_ANSWER} Ask your instructor.`))]);
    const { events } = await ask("What is the airspeed of a swallow?");
    assert.equal(find(events, "done")!.message.unknown, true);
  });
});

describe("POST /api/ai/chat: limits", () => {
  const limiter = () => (globalThis as unknown as { __llAiChatLimiter: SlidingWindowRateLimiter }).__llAiChatLimiter;

  it("enforces the daily message limit for learners, with a reset time", async () => {
    provider([1, 2, 3].map((i) => sse(answerStream(`Answer ${i} [1].`))));
    for (let i = 0; i < 3; i++) assert.equal((await ask(`Question ${i} about closures`)).res.status, 200);
    const { res } = await ask("One more about closures");
    assert.equal(res.status, 429);
    const body = await errorBody(res);
    assert.equal(body.code, "quota");
    assert.match(body.error, /all 3 AI tutor questions/);
    assert.equal(body.quota?.remaining, 0);
    assert.ok(body.resetsAt && Date.parse(body.resetsAt) > Date.now());
    const retryAfter = Number(res.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 86_400);
    assert.equal(calls.length, 3, "the model is not called once the limit is reached");
    assert.equal((await getDb()).aiMessages.length, 6);
  });

  it("does not limit learners when the daily limit is 0", async () => {
    await seed({ settings: { dailyMessageLimit: 0 } });
    provider([1, 2, 3, 4].map((i) => sse(answerStream(`Answer ${i} [1].`))));
    for (let i = 0; i < 4; i++) assert.equal((await ask(`Question ${i} about closures`)).res.status, 200);
  });

  it("rate limits bursts per user with a Retry-After", async () => {
    await seed({ settings: { dailyMessageLimit: 0 } });
    provider(Array.from({ length: 8 }, (_, i) => sse(answerStream(`Answer ${i} [1].`))));
    for (let i = 0; i < 8; i++) assert.equal((await ask(`Question ${i} about closures`)).res.status, 200);
    const { res } = await ask("Ninth in a minute");
    assert.equal(res.status, 429);
    const body = await errorBody(res);
    assert.equal(body.code, "rate_limited");
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
    assert.equal(body.retryAfter, Number(res.headers.get("retry-after")));
    assert.equal(calls.length, 8);

    // Another learner is not affected.
    await mutate((db) => {
      db.enrollments.push(makeEnrollment({ userId: outsider.id, courseId: course.id }));
    });
    await as(outsider);
    provider([sse(answerStream("Fine [1]."))]);
    assert.equal((await ask("A question about closures")).res.status, 200);
  });

  it("caps questions per hour even without a daily limit", async () => {
    await seed({ settings: { dailyMessageLimit: 0 } });
    const now = Date.now();
    for (let i = 0; i < 120; i++) limiter().hit(`ai-chat-hour:${learner.id}`, { limit: 120, windowMs: 60 * 60_000 }, now - 30 * 60_000);
    const { res } = await ask("One more about closures");
    assert.equal(res.status, 429);
    assert.match((await errorBody(res)).error, /last hour/);
    const retryAfter = Number(res.headers.get("retry-after"));
    assert.ok(retryAfter > 25 * 60 && retryAfter <= 30 * 60);
  });

  it("answers one question at a time per user", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const encoder = new TextEncoder();
    provider([
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              await held;
              controller.enqueue(encoder.encode(answerStream("Slow answer [1].")));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    ]);
    const first = await POST(request({ courseId: course.id, message: "A slow question about closures" }));
    assert.equal(first.status, 200);
    const busy = await ask("An impatient second question");
    assert.equal(busy.res.status, 409);
    assert.equal((await errorBody(busy.res)).code, "busy");
    release();
    assert.equal(find(await readEvents(first), "done")?.message.content, "Slow answer [1].");

    provider([sse(answerStream("Next [1]."))]);
    assert.equal((await ask("Now it is free again, closures?")).res.status, 200);
  });
});

describe("POST /api/ai/chat: provider failures", () => {
  /** The admin error log is written without holding up the response. */
  const loggedErrors = async (expected: number) => {
    for (let i = 0; i < 50 && (await getDb()).errorEvents.length < expected; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    return (await getDb()).errorEvents;
  };

  const expectNothingStored = async () => {
    const db = await getDb();
    assert.equal(db.aiMessages.length, 0, "the unanswered question is removed");
    assert.equal(db.aiConversations.length, 0, "and so is the conversation it created");
  };

  it("hides an invalid key from learners, alerts admins and doesn't charge the quota", async () => {
    provider([apiError(401, "authentication_error", "invalid x-api-key")]);
    const { res, events } = await ask("What is a closure?");
    assert.equal(res.status, 200, "the failure arrives on the stream");
    assert.deepEqual(events.map((e) => e.type), ["start", "citations", "error"]);
    const error = find(events, "error")!;
    assert.equal(error.code, "provider_error");
    assert.match(error.message, /isn't set up correctly/);
    assert.ok(!error.message.includes("x-api-key") && !error.message.includes(TEST_KEY));
    assert.equal(error.retryAfter, undefined);
    await expectNothingStored();

    const logged = await loggedErrors(1);
    assert.equal(logged.length, 1);
    assert.match(logged[0]!.message, /AI tutor: the Anthropic API rejected the request \(auth, HTTP 401\)/);
    assert.ok(!JSON.stringify(logged).includes(TEST_KEY));

    provider([sse(answerStream("Works now [1]."))]);
    const retry = await ask("What is a closure?");
    assert.equal(find(retry.events, "done")!.quota.remaining, 2, "only the answered question counts");
  });

  it("shows course staff the provider's message", async () => {
    await as(instructor);
    provider([apiError(404, "not_found_error", "model: claude-nope")]);
    const { events } = await ask("What is a closure?");
    assert.match(find(events, "error")!.message, /Anthropic API: model: claude-nope/);
  });

  it("passes on rate limits and overload with a retry time, without alerting admins", async () => {
    provider([apiError(429, "rate_limit_error", "Too many requests", { "retry-after": "37" })]);
    const limited = find((await ask("What is a closure?")).events, "error")!;
    assert.deepEqual([limited.code, limited.retryAfter], ["rate_limited", 37]);
    assert.match(limited.message, /try again shortly/i);

    provider([apiError(529, "overloaded_error", "Overloaded", { "retry-after": "20" })]);
    const overloaded = find((await ask("What is a closure?")).events, "error")!;
    assert.deepEqual([overloaded.code, overloaded.retryAfter], ["overloaded", 20]);

    await expectNothingStored();
    assert.equal((await loggedErrors(0)).length, 0);
  });

  it("treats an empty answer and a broken stream as retryable failures", async () => {
    provider([sse(answerStream(""))]);
    const empty = find((await ask("What is a closure?")).events, "error")!;
    assert.equal(empty.code, "provider_error");
    assert.equal(empty.retryAfter, 5);

    provider([sse(`${event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half" } })}${event({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}`)]);
    const broken = await ask("What is a closure?");
    assert.deepEqual(broken.events.map((e) => e.type), ["start", "citations", "delta", "error"]);
    assert.equal(find(broken.events, "error")!.code, "overloaded");
    await expectNothingStored();
  });

  it("keeps the partial answer when the learner stops it", async () => {
    const abort = new AbortController();
    const encoder = new TextEncoder();
    provider([
      (init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(event({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 500 } } })));
              controller.enqueue(encoder.encode(event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A closure is" } })));
              init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
            },
          }),
          { status: 200 },
        ),
    ]);
    const res = await POST(request({ courseId: course.id, message: "What is a closure?" }, { signal: abort.signal }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes("A closure is")) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
    abort.abort();
    for (;;) {
      const { done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
    }

    const db = await getDb();
    assert.deepEqual(db.aiMessages.map((m) => [m.role, m.content]), [
      ["user", "What is a closure?"],
      ["assistant", "A closure is"],
    ]);
    assert.equal(db.aiMessages[1]!.tokensIn, 500);

    provider([sse(answerStream("And next [1]."))]);
    assert.equal((await ask("Next question about closures")).res.status, 200, "the user is free to ask again");
  });
});
