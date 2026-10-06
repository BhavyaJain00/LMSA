import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AiClarification, AiConversation, AiMessage, Database, MembershipPlan, Subscription, User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { defaultSettings } from "@/lib/db/defaults";
import { aiEnv } from "@/lib/server-env";
import { courseTutorAccess, unavailableMessage } from "@/lib/ai/access";
import { linkCitations, neutralizeAnswerMarkdown } from "@/lib/ai/citations";
import { detachedClarifications } from "@/lib/ai/service";
import { buildCourseChunks, collectCourseSources, quizExplanationsAllowed } from "@/lib/ai/sources";
import {
  approveAnswersAction,
  clearCourseConversationsAction,
  correctAnswerAction,
  deleteClarificationAction,
  deleteConversationAction,
  reopenAnswerAction,
  reportAnswerAction,
} from "@/lib/actions/ai";
import { FIXED_NOW, makeCourse, makeCourseTree, makeEnrollment, makePayment, makeQuestion, makeQuiz, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Fixes from the AI tutor review: quiz explanations that gave answers away,
 * scheduled lesson titles in the overview, clarifications that vanished with
 * the learner's conversation, reports that undid a correction, lapsed
 * enrollments that kept the tutor, and model output that could load remote
 * images.
 */

type SourceDb = Parameters<typeof collectCourseSources>[0];

/* ------------------------------------------------------------------ */
/* Quiz explanations                                                    */
/* ------------------------------------------------------------------ */

const CORRECT_EXPLANATION = "Yes — 42 is returned because the inner function adds 40 to 2.";
const WRONG_EXPLANATION = "Not quite. Closures keep a live reference to the outer variables.";
const SINGLE_WRONG_EXPLANATION = "Not quite. var is function-scoped, so the loop prints 3 three times.";

function quizCourse(quizOverrides: Parameters<typeof makeQuiz>[0] = {}, where: "block" | "marker" = "block"): { db: SourceDb; courseId: string } {
  const multi = makeQuestion({
    text: "Which statements about closures are true?",
    multiple: true,
    options: [
      { id: "m1", text: "They return 42", isCorrect: true, explanation: CORRECT_EXPLANATION },
      { id: "m2", text: "They copy variables", isCorrect: false, explanation: WRONG_EXPLANATION },
    ],
  });
  const single = makeQuestion({
    text: "What does the loop print?",
    options: [
      { id: "s1", text: "0 1 2", isCorrect: false, explanation: SINGLE_WRONG_EXPLANATION },
      { id: "s2", text: "3 3 3", isCorrect: true, explanation: "Right, 3 three times." },
    ],
  });
  const quiz = makeQuiz({ title: "Closure check", questions: [{ questionId: multi.id, marks: 1 }, { questionId: single.id, marks: 1 }], ...quizOverrides });
  const tree = makeCourseTree([[{ title: "Closures" }]]);
  tree.lessons[0]!.blocks =
    where === "block"
      ? [{ id: "q", type: "quiz", quizId: quiz.id }]
      : [{ id: "v", type: "video", src: "/v.mp4", quizMarkers: [{ id: "mk", seconds: 10, quizId: quiz.id }] } as never];
  return {
    db: { courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons, quizzes: [quiz], questions: [multi, single], transcripts: [], aiConversations: [], aiMessages: [] },
    courseId: tree.course.id,
  };
}

const quizText = (db: SourceDb, courseId: string) =>
  buildCourseChunks(db, courseId)
    .filter((c) => c.kind === "quiz")
    .map((c) => c.text)
    .join("\n");

describe("ai tutor sources: quiz explanations never give answers away", () => {
  it("uses only wrong-option explanations of multiple-answer questions", () => {
    const { db, courseId } = quizCourse();
    const text = quizText(db, courseId);
    assert.ok(text.includes("Closures keep a live reference to the outer variables."));
    assert.ok(!text.includes("42 is returned"), "a correct option's explanation states the answer");
    assert.ok(!text.includes("prints 3 three times"), "single-answer questions are skipped entirely");
  });

  it("reads nothing from quizzes that hide answers, proctored exams or scheduled quizzes", () => {
    for (const overrides of [{ showAnswers: false }, { enableProctoring: true }, { enableScheduling: true }]) {
      const { db, courseId } = quizCourse(overrides);
      assert.equal(quizText(db, courseId), "", JSON.stringify(overrides));
      const { db: markerDb, courseId: markerCourse } = quizCourse(overrides, "marker");
      assert.equal(quizText(markerDb, markerCourse), "", `video marker ${JSON.stringify(overrides)}`);
    }
    assert.equal(quizExplanationsAllowed({ showAnswers: true, enableProctoring: false, enableScheduling: false }), true);
    assert.equal(quizExplanationsAllowed({ showAnswers: false, enableProctoring: false, enableScheduling: false }), false);
  });
});

/* ------------------------------------------------------------------ */
/* Overview                                                             */
/* ------------------------------------------------------------------ */

describe("ai tutor sources: course overview", () => {
  it("names scheduled lessons only once they are published", () => {
    const tree = makeCourseTree([[{ title: "Released lesson" }, { title: "Secret upcoming lesson", publishAt: "2026-06-01T00:00:00.000Z" }]]);
    const db: SourceDb = { courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons, quizzes: [], questions: [], transcripts: [], aiConversations: [], aiMessages: [] };
    const overview = (now: number) => collectCourseSources(db, tree.course.id, now).find((s) => s.kind === "overview")!.text;
    const before = overview(Date.parse("2026-05-01T00:00:00.000Z"));
    assert.ok(before.includes("Released lesson"));
    assert.ok(!before.includes("Secret upcoming lesson"));
    assert.ok(overview(Date.parse("2026-06-02T00:00:00.000Z")).includes("1.2 Secret upcoming lesson"), "numbering stays the same once it is out");
  });
});

/* ------------------------------------------------------------------ */
/* Stored clarifications (pure)                                         */
/* ------------------------------------------------------------------ */

describe("ai tutor sources: instructor clarifications", () => {
  function clarificationDb(extra: { clarifications?: AiClarification[]; conversations?: AiConversation[]; messages?: AiMessage[] } = {}) {
    const tree = makeCourseTree([[{ id: "les_cl_1", title: "Closures" }]], { course: { id: "crs_cl" } });
    const db: SourceDb = {
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      quizzes: [],
      questions: [],
      transcripts: [],
      aiConversations: extra.conversations ?? [],
      aiMessages: extra.messages ?? [],
      aiClarifications: extra.clarifications ?? [],
    };
    return db;
  }
  const clarification = (overrides: Partial<AiClarification> = {}): AiClarification => ({
    id: "aicl_1",
    courseId: "crs_cl",
    lessonId: "les_cl_1",
    text: "Closures keep references, not copies.",
    messageId: "aim_gone",
    authorId: "usr_teacher",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  });

  it("indexes stored clarifications without needing the learner's conversation", () => {
    const chunks = buildCourseChunks(clarificationDb({ clarifications: [clarification()] }), "crs_cl").filter((c) => c.kind === "clarification");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.lessonId, "les_cl_1");
    assert.equal(chunks[0]!.trusted, true);
    assert.equal(chunks[0]!.text, "Closures keep references, not copies.");
  });

  it("falls back to the whole course when the lesson is gone, and ignores other courses", () => {
    const db = clarificationDb({ clarifications: [clarification({ lessonId: "les_deleted" }), clarification({ id: "aicl_2", courseId: "crs_other", text: "Other course" })] });
    const chunks = buildCourseChunks(db, "crs_cl").filter((c) => c.kind === "clarification");
    assert.deepEqual(
      chunks.map((c) => [c.lessonId, c.text]),
      [["", "Closures keep references, not copies."]],
    );
  });

  it("still reads corrections stored only on the answer, once", () => {
    const conversation: AiConversation = { id: "aic_cl", userId: "usr_l", courseId: "crs_cl", lessonId: "les_cl_1", title: "Q", createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
    const legacy: AiMessage = { id: "aim_legacy", conversationId: "aic_cl", role: "assistant", content: "Wrong", reviewStatus: "corrected", instructorNote: "Legacy note", createdAt: FIXED_NOW };
    const current: AiMessage = { id: "aim_current", conversationId: "aic_cl", role: "assistant", content: "Wrong too", reviewStatus: "corrected", instructorNote: "Current note", createdAt: FIXED_NOW };
    const db = clarificationDb({ conversations: [conversation], messages: [legacy, current], clarifications: [clarification({ messageId: "aim_current", text: "Current note" })] });
    const texts = buildCourseChunks(db, "crs_cl")
      .filter((c) => c.kind === "clarification")
      .map((c) => c.text)
      .sort();
    assert.deepEqual(texts, ["Current note", "Legacy note"]);
  });
});

/* ------------------------------------------------------------------ */
/* Answer rendering                                                     */
/* ------------------------------------------------------------------ */

describe("ai tutor answer markdown", () => {
  it("never renders images, whatever their URL", () => {
    assert.equal(neutralizeAnswerMarkdown("See ![chart](https://attacker.test/x?q=secret) here"), "See chart here");
    assert.equal(neutralizeAnswerMarkdown("![](/api/me)"), "");
    assert.equal(neutralizeAnswerMarkdown('![a "b"](https://x.test/i.png "title")'), 'a "b"');
  });

  it("turns links that leave the site into visible, unclickable addresses", () => {
    assert.equal(neutralizeAnswerMarkdown("Read [the docs](https://evil.test/login) now"), "Read the docs (`https://evil.test/login`) now");
    assert.equal(neutralizeAnswerMarkdown("[https://a.test/x](https://a.test/x)"), "`https://a.test/x`");
    assert.equal(neutralizeAnswerMarkdown("[x](//evil.test/p)"), "x (`//evil.test/p`)");
    assert.equal(neutralizeAnswerMarkdown("[x](javascript:alert(1))"), "x (`javascript:alert(1`))");
    assert.equal(neutralizeAnswerMarkdown("Visit https://evil.test/a?b=c."), "Visit `https://evil.test/a?b=c`.");
  });

  it("keeps links within the site, code and citation links", () => {
    assert.equal(neutralizeAnswerMarkdown("Open [the lesson](/courses/js/learn/1-1)."), "Open [the lesson](/courses/js/learn/1-1).");
    const code = "```md\n![img](https://x.test/a.png)\n```\nand `https://x.test` inline";
    assert.equal(neutralizeAnswerMarkdown(code), code);
    const linked = linkCitations(neutralizeAnswerMarkdown("Closures remember [1]."), [{ n: 1, href: "/courses/js/learn/1-1", title: "Closures" }]);
    assert.equal(linked, 'Closures remember [(1)](/courses/js/learn/1-1 "Closures").');
  });

  it("removes images nested in links", () => {
    const out = neutralizeAnswerMarkdown("[![logo](https://evil.test/l.png)](https://evil.test)");
    assert.ok(!/!\[[^\]]*\]\(/.test(out), out);
    assert.ok(!/\]\(https?:/.test(out), out);
  });
});

/* ------------------------------------------------------------------ */
/* Access                                                               */
/* ------------------------------------------------------------------ */

describe("ai tutor access with a lapsed enrollment", () => {
  const env = aiEnv as { anthropicApiKey: string };
  const DAY = 86_400_000;
  const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

  function snapshot(subscriptionStatus: Subscription["status"], periodEnd: string) {
    const course = makeCourse({ id: "crs_paid_ai", paidCourse: true, price: 5000, aiTutorEnabled: true });
    const plan: MembershipPlan = {
      id: "plan_ai",
      slug: "all",
      name: "All access",
      description: "",
      interval: "month",
      price: 1900,
      currency: "USD",
      trialDays: 0,
      access: { type: "all" },
      active: true,
      features: [],
      createdAt: at(-60),
      updatedAt: at(-60),
    };
    const subscription: Subscription = {
      id: "sub_ai",
      userId: "usr_ai_member",
      planId: plan.id,
      status: subscriptionStatus,
      currentPeriodStart: at(-40),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      gateway: "manual",
      createdAt: at(-40),
      updatedAt: at(-40),
    };
    const payment = makePayment({ id: "pay_ai_plan", userId: "usr_ai_member", itemType: "plan", itemId: plan.id, planId: plan.id, subscriptionId: subscription.id, status: "paid", paidAt: at(-40), gateway: "manual" });
    const settings = defaultSettings();
    settings.ai = { ...settings.ai, enabled: true };
    const db = {
      settings,
      courses: [course],
      enrollments: [makeEnrollment({ userId: "usr_ai_member", courseId: course.id, paymentId: payment.id })],
      payments: [payment],
      subscriptions: [subscription],
      plans: [plan],
      batches: [],
      batchEnrollments: [],
      bundles: [],
    } as unknown as Database;
    return { db, course };
  }

  it("closes the tutor when the membership that opened the course has lapsed", () => {
    env.anthropicApiKey = "sk-ant-api03-access-test";
    try {
      const member = { id: "usr_ai_member", roles: ["student" as const] };
      const running = snapshot("active", at(20));
      assert.equal(courseTutorAccess(running.db, running.course, member).ok, true);

      const lapsed = snapshot("expired", at(-10));
      const access = courseTutorAccess(lapsed.db, lapsed.course, member);
      assert.equal(access.ok, false);
      assert.equal(!access.ok && access.reason, "access_ended");
      assert.match(unavailableMessage("access_ended"), /access to this course has ended/);

      const stranger = courseTutorAccess(lapsed.db, lapsed.course, { id: "usr_nobody", roles: ["student"] });
      assert.equal(!stranger.ok && stranger.reason, "not_enrolled");
    } finally {
      env.anthropicApiKey = "";
    }
  });
});

/* ------------------------------------------------------------------ */
/* Review actions                                                       */
/* ------------------------------------------------------------------ */

describe("ai tutor review actions keep clarifications", () => {
  const learner = makeUser({ id: "usr_fix_learner", name: "Lena" });
  const instructor = makeUser({ id: "usr_fix_teacher", name: "Ian Instructor", roles: ["student", "course_creator"] });
  const otherCreator = makeUser({ id: "usr_fix_other", roles: ["student", "course_creator"] });
  let courseId = "";
  let lessonId = "";

  async function as(user: User) {
    resetRequest();
    await createSession(user.id);
  }

  beforeEach(async () => {
    const tree = makeCourseTree([[{ id: "les_fix_1", title: "Closures", blocks: [{ id: "b", type: "markdown", content: "A closure remembers its scope." }] }]], {
      course: { id: "crs_fix", slug: "fix-course", title: "Fix course", instructorIds: [instructor.id], aiTutorEnabled: true },
    });
    courseId = tree.course.id;
    lessonId = tree.lessons[0]!.id;
    await resetDb({
      users: [learner, instructor, otherCreator],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      enrollments: [makeEnrollment({ userId: learner.id, courseId })],
      aiConversations: [{ id: "aic_fix", userId: learner.id, courseId, lessonId, title: "Closures?", createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
      aiMessages: [
        { id: "aim_fix_q", conversationId: "aic_fix", role: "user", content: "Do closures copy variables?", createdAt: FIXED_NOW },
        { id: "aim_fix_a", conversationId: "aic_fix", role: "assistant", content: "Yes, closures copy variables.", createdAt: "2026-01-15T12:00:05.000Z" },
      ],
      settings: { ai: { enabled: true, reviewQueue: true } },
    });
  });

  const clarificationTexts = async () =>
    collectCourseSources(await getDb(), courseId)
      .filter((s) => s.kind === "clarification")
      .map((s) => s.text);

  it("stores the correction on its own, so deleting the conversation keeps it", async () => {
    await as(instructor);
    assert.equal((await correctAnswerAction("aim_fix_a", "Closures keep a live reference; they don't copy.")).ok, true);
    let db = await getDb();
    assert.equal(db.aiClarifications.length, 1);
    assert.deepEqual(
      { courseId: db.aiClarifications[0]!.courseId, lessonId: db.aiClarifications[0]!.lessonId, messageId: db.aiClarifications[0]!.messageId, authorId: db.aiClarifications[0]!.authorId },
      { courseId, lessonId, messageId: "aim_fix_a", authorId: instructor.id },
    );
    assert.deepEqual(await clarificationTexts(), ["Closures keep a live reference; they don't copy."], "indexed once");

    // Editing updates the same clarification.
    assert.equal((await correctAnswerAction("aim_fix_a", "Closures keep live references.")).ok, true);
    db = await getDb();
    assert.equal(db.aiClarifications.length, 1);
    assert.deepEqual(await clarificationTexts(), ["Closures keep live references."]);

    await as(learner);
    assert.equal((await deleteConversationAction("aic_fix")).ok, true);
    db = await getDb();
    assert.equal(db.aiMessages.length, 0);
    assert.equal(db.aiClarifications.length, 1, "the learner's delete keeps the course knowledge");
    assert.deepEqual(await clarificationTexts(), ["Closures keep live references."]);

    // Staff see it among the clarifications whose conversation is gone, and can remove it.
    assert.deepEqual(
      detachedClarifications(db, instructor).map((c) => [c.text, c.lessonTitle, c.authorName]),
      [["Closures keep live references.", "Closures", "Ian Instructor"]],
    );
    assert.deepEqual(detachedClarifications(db, otherCreator), []);
    await as(otherCreator);
    assert.equal((await deleteClarificationAction(db.aiClarifications[0]!.id)).ok, false);
    await as(instructor);
    assert.equal((await deleteClarificationAction((await getDb()).aiClarifications[0]!.id)).ok, true);
    assert.deepEqual(await clarificationTexts(), []);
  });

  it("keeps the clarification when the learner clears all their conversations", async () => {
    await as(instructor);
    await correctAnswerAction("aim_fix_a", "Closures keep references.");
    await as(learner);
    assert.equal((await clearCourseConversationsAction(courseId)).ok, true);
    assert.deepEqual(await clarificationTexts(), ["Closures keep references."]);
  });

  it("removes the clarification when the answer is approved or reopened instead", async () => {
    await as(instructor);
    await correctAnswerAction("aim_fix_a", "First note.");
    assert.equal((await approveAnswersAction(["aim_fix_a"])).ok, true);
    assert.equal((await getDb()).aiClarifications.length, 0);
    assert.deepEqual(await clarificationTexts(), []);

    await correctAnswerAction("aim_fix_a", "Second note.");
    assert.equal((await reopenAnswerAction("aim_fix_a")).ok, true);
    assert.equal((await getDb()).aiClarifications.length, 0);
    assert.deepEqual(await clarificationTexts(), []);
  });

  it("removing a clarification whose answer still exists clears the correction too", async () => {
    await as(instructor);
    await correctAnswerAction("aim_fix_a", "Note.");
    const id = (await getDb()).aiClarifications[0]!.id;
    assert.equal((await deleteClarificationAction(id)).ok, true);
    const answer = (await getDb()).aiMessages.find((m) => m.id === "aim_fix_a")!;
    assert.equal(answer.instructorNote, undefined);
    assert.equal(answer.reviewStatus, undefined);
    assert.deepEqual(await clarificationTexts(), [], "the legacy fallback doesn't bring it back");
  });

  it("a report on a corrected answer flags it but keeps the correction", async () => {
    await as(instructor);
    await correctAnswerAction("aim_fix_a", "Closures keep references.");
    await as(learner);
    assert.equal((await reportAnswerAction("aim_fix_a", "incorrect")).ok, true);
    const answer = (await getDb()).aiMessages.find((m) => m.id === "aim_fix_a")!;
    assert.equal(answer.flagged, true);
    assert.equal(answer.reviewStatus, "corrected");
    assert.equal(answer.instructorNote, "Closures keep references.");
    assert.deepEqual(await clarificationTexts(), ["Closures keep references."]);
  });

  it("a report on an unreviewed answer still sends it to the queue", async () => {
    await as(learner);
    assert.equal((await reportAnswerAction("aim_fix_a", "incorrect")).ok, true);
    assert.equal((await getDb()).aiMessages.find((m) => m.id === "aim_fix_a")!.reviewStatus, "pending");
  });
});
