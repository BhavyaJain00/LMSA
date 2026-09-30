import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Course } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { excerptCitations, learnerQuota, parseChatRequest, rollbackUserTurn, saveAssistantTurn, saveUserTurn, toQuotaView } from "@/lib/ai/chat";
import type { RetrievedExcerpt } from "@/lib/ai/course-index";
import { MAX_QUESTION_CHARS } from "@/lib/ai/prompt";
import type { CourseChunk } from "@/lib/ai/sources";
import { makeCourse, makeUser, resetDb } from "./helpers/db";

describe("ai tutor chat request validation", () => {
  const valid = { courseId: "crs_1", message: "What is a closure?" };

  it("accepts a question with optional conversation and lesson", () => {
    assert.deepEqual(parseChatRequest(valid), { ok: true, value: { courseId: "crs_1", conversationId: null, lessonId: null, message: "What is a closure?" } });
    assert.deepEqual(parseChatRequest({ ...valid, conversationId: "aic_9", lessonId: "les_2", extra: "ignored" }), {
      ok: true,
      value: { courseId: "crs_1", conversationId: "aic_9", lessonId: "les_2", message: "What is a closure?" },
    });
    assert.deepEqual(parseChatRequest({ ...valid, conversationId: null, lessonId: null }).ok, true);
  });

  it("trims the question and strips NUL characters", () => {
    const parsed = parseChatRequest({ ...valid, message: "  why\u0000 though?\n " });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.message, "why though?");
  });

  it("rejects malformed bodies", () => {
    for (const raw of [null, undefined, "text", 42, []]) assert.equal(parseChatRequest(raw).ok, false);
    assert.equal(parseChatRequest({ message: "hi" }).ok, false, "course is required");
    assert.equal(parseChatRequest({ ...valid, courseId: "../etc/passwd" }).ok, false);
    assert.equal(parseChatRequest({ ...valid, courseId: "x".repeat(65) }).ok, false);
    assert.equal(parseChatRequest({ ...valid, conversationId: 12 }).ok, false);
    assert.equal(parseChatRequest({ ...valid, conversationId: "a b" }).ok, false);
    assert.equal(parseChatRequest({ ...valid, lessonId: { $ne: "" } }).ok, false);
  });

  it("requires a question within the length limit", () => {
    for (const message of ["", "   ", "\u0000", 5, null, ["hi"]]) {
      const parsed = parseChatRequest({ ...valid, message });
      assert.equal(parsed.ok, false, JSON.stringify(message));
    }
    assert.equal(parseChatRequest({ ...valid, message: "x".repeat(MAX_QUESTION_CHARS) }).ok, true);
    const tooLong = parseChatRequest({ ...valid, message: "x".repeat(MAX_QUESTION_CHARS + 1) });
    assert.ok(!tooLong.ok);
    assert.match(tooLong.error, /2,000 characters/);
  });
});

describe("ai tutor stored citations", () => {
  const course = makeCourse({ title: "Async JavaScript" });
  const chunk = (overrides: Partial<CourseChunk>): CourseChunk => ({ id: "c", lessonId: "les_1", lessonTitle: "Closures", title: "Closures", kind: "lesson", text: "", order: 0, ...overrides });
  const excerpt = (overrides: Partial<CourseChunk>, text: string): RetrievedExcerpt => ({ chunk: chunk(overrides), score: 1, label: "label", text });

  it("keeps prompt order, lesson ids and video timestamps", () => {
    const citations = excerptCitations(
      [
        excerpt({}, "A closure\n  remembers   its scope."),
        excerpt({ kind: "transcript", lessonId: "les_2", lessonTitle: "Promises", seconds: 135 }, "so a promise settles later"),
        excerpt({ kind: "overview", lessonId: "" }, "This course covers async code."),
        excerpt({ kind: "clarification" }, "Closures capture variables, not values."),
      ],
      course,
    );
    assert.deepEqual(
      citations.map((c) => [c.lessonId, c.title, c.seconds]),
      [
        ["les_1", "Closures", undefined],
        ["les_2", "Promises", 135],
        ["", "Async JavaScript · overview", undefined],
        ["les_1", "Instructor clarification · Closures", undefined],
      ],
    );
    assert.equal(citations[0]!.snippet, "A closure remembers its scope.");
    assert.ok(!("seconds" in citations[0]!), "no timestamp key for text passages");
  });

  it("stores a short snippet, not the whole passage", () => {
    const [citation] = excerptCitations([excerpt({}, "word ".repeat(2000))], course);
    assert.ok(citation!.snippet.length < 400);
  });
});

describe("ai tutor exchange persistence", () => {
  let n = 0;
  let course: Course;
  let userId: string;
  let otherId: string;

  beforeEach(async () => {
    n++;
    course = makeCourse({ id: `crs_aichat_${n}`, aiTutorEnabled: true });
    // The daily ledger lives for the whole process, so every test gets its own learners.
    const learner = makeUser({ id: `usr_aichat_${n}` });
    const other = makeUser({ id: `usr_aichat_other_${n}` });
    userId = learner.id;
    otherId = other.id;
    await resetDb({ users: [learner, other], courses: [course], settings: { ai: { enabled: true, dailyMessageLimit: 3 } } });
  });

  const ask = (message: string, conversationId: string | null = null, lessonId: string | null = null) => saveUserTurn({ userId, courseId: course.id, conversationId, lessonId, message });

  it("creates a titled conversation with the first question", async () => {
    const turn = await ask("How do closures keep their variables alive after the outer function returns?", null, "les_7");
    assert.ok(turn);
    assert.equal(turn.createdConversation, true);
    const db = await getDb();
    assert.deepEqual(db.aiConversations.map((c) => [c.id, c.userId, c.courseId, c.lessonId]), [[turn.conversation.id, userId, course.id, "les_7"]]);
    assert.ok(turn.conversation.title.length <= 61 && turn.conversation.title.startsWith("How do closures"));
    assert.deepEqual(db.aiMessages.map((m) => [m.conversationId, m.role, m.content]), [[turn.conversation.id, "user", turn.userMessage.content]]);
  });

  it("appends to an existing conversation and stores the answer with token usage", async () => {
    const first = await ask("What is a closure?");
    assert.ok(first);
    await saveAssistantTurn(first, { content: "A function plus its scope [1].", citations: [{ lessonId: "les_1", title: "Closures", snippet: "A closure…" }], tokensIn: 812, tokensOut: 64 });
    const second = await ask("Show an example", first.conversation.id);
    assert.ok(second);
    assert.equal(second.createdConversation, false);
    assert.equal(second.conversation.id, first.conversation.id);

    const db = await getDb();
    assert.equal(db.aiConversations.length, 1);
    assert.deepEqual(db.aiMessages.map((m) => m.role), ["user", "assistant", "user"]);
    const answer = db.aiMessages[1]!;
    assert.equal(answer.tokensIn, 812);
    assert.equal(answer.tokensOut, 64);
    assert.equal(answer.citations?.[0]?.lessonId, "les_1");
    assert.equal(db.aiConversations[0]!.title, "What is a closure?", "the title stays the first question");
  });

  it("refuses to write into someone else's conversation or another course", async () => {
    const mine = await ask("Mine");
    assert.ok(mine);
    assert.equal(await saveUserTurn({ userId: otherId, courseId: course.id, conversationId: mine.conversation.id, lessonId: null, message: "Let me in" }), null);
    assert.equal(await saveUserTurn({ userId, courseId: "crs_elsewhere", conversationId: mine.conversation.id, lessonId: null, message: "Wrong course" }), null);
    assert.equal(await ask("Gone", "aic_missing"), null);
    assert.equal((await getDb()).aiMessages.length, 1);
  });

  it("rolls back a question that got no answer, and its brand-new conversation", async () => {
    const turn = await ask("Will this fail?");
    assert.ok(turn);
    await rollbackUserTurn(turn);
    const db = await getDb();
    assert.equal(db.aiMessages.length, 0);
    assert.equal(db.aiConversations.length, 0);
    assert.equal(learnerQuota(db, userId, false).used, 0, "a failed question doesn't count");
  });

  it("keeps an established conversation when a later question is rolled back", async () => {
    const first = await ask("First");
    assert.ok(first);
    await saveAssistantTurn(first, { content: "Answer", citations: [] });
    const second = await ask("Second", first.conversation.id);
    assert.ok(second);
    await rollbackUserTurn(second);
    const db = await getDb();
    assert.equal(db.aiConversations.length, 1);
    assert.deepEqual(db.aiMessages.map((m) => m.content), ["First", "Answer"]);
    assert.equal(learnerQuota(db, userId, false).used, 1);
  });

  it("drops an answer whose conversation was deleted while it was being written", async () => {
    const turn = await ask("Delete me meanwhile");
    assert.ok(turn);
    await mutate((db) => {
      db.aiConversations = [];
      db.aiMessages = [];
    });
    await saveAssistantTurn(turn, { content: "Too late", citations: [] });
    assert.equal((await getDb()).aiMessages.length, 0);
  });

  it("counts today's questions per learner across courses and blocks at the limit", async () => {
    assert.deepEqual(toQuotaView(learnerQuota(await getDb(), userId, false)), { limit: 3, remaining: 3, resetsAt: learnerQuota(await getDb(), userId, false).resetsAt });
    await ask("One");
    await saveUserTurn({ userId, courseId: "crs_another", conversationId: null, lessonId: null, message: "Two" });
    assert.equal(learnerQuota(await getDb(), userId, false).remaining, 1);
    await ask("Three");
    const quota = learnerQuota(await getDb(), userId, false);
    assert.equal(quota.exceeded, true);
    assert.equal(quota.remaining, 0);
    assert.equal(learnerQuota(await getDb(), otherId, false).used, 0, "other learners are unaffected");
  });

  it("does not hand the quota back when conversations are deleted", async () => {
    await ask("One");
    await ask("Two");
    await mutate((db) => {
      db.aiConversations = [];
      db.aiMessages = [];
    });
    assert.equal(learnerQuota(await getDb(), userId, false).used, 2);
  });

  it("exempts course staff and honours an unlimited setting", async () => {
    await ask("One");
    await ask("Two");
    await ask("Three");
    const staff = learnerQuota(await getDb(), userId, true);
    assert.equal(staff.exceeded, false);
    assert.equal(staff.remaining, null);

    await mutate((db) => {
      db.settings.ai.dailyMessageLimit = 0;
    });
    const unlimited = learnerQuota(await getDb(), userId, false);
    assert.equal(unlimited.exceeded, false);
    assert.equal(unlimited.limit, 0);
  });
});
