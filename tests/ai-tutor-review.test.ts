import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AiConversation, AiMessage, Course, User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { aiEnv } from "@/lib/server-env";
import { maskSecret } from "@/lib/ai/access";
import { UNKNOWN_ANSWER } from "@/lib/ai/prompt";
import { collectCourseSources } from "@/lib/ai/sources";
import {
  filterReviewRows,
  loadReviewConversation,
  parseReviewFilters,
  reviewRecipients,
  reviewRows,
  reviewRowsToTable,
  reviewTabCounts,
  toUsageRows,
} from "@/lib/ai/service";
import {
  approveAnswersAction,
  correctAnswerAction,
  getCourseAiTutorAction,
  rateAnswerAction,
  reopenAnswerAction,
  reportAnswerAction,
  saveAiSettingsAction,
  testAiConnectionAction,
} from "@/lib/actions/ai";
import { updateCourseSettingsAction } from "@/lib/actions/courses";
import { makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const env = aiEnv as { anthropicApiKey: string };
const NOW = Date.parse("2026-03-10T12:00:00.000Z");

const learner = makeUser({ id: "usr_rev_learner", name: "Lena Learner" });
const instructor = makeUser({ id: "usr_rev_teacher", name: "Ian Instructor", roles: ["student", "course_creator"] });
const otherCreator = makeUser({ id: "usr_rev_other", roles: ["student", "course_creator"] });
const moderator = makeUser({ id: "usr_rev_mod", roles: ["student", "moderator"] });
const admin = makeUser({ id: "usr_rev_admin", roles: ["student", "admin"] });

let courseA: Course;
let courseB: Course;
let lessonA: string;

const conversations: AiConversation[] = [];
const messages: AiMessage[] = [];

function conv(id: string, courseId: string, lessonId?: string): AiConversation {
  return { id, userId: learner.id, courseId, lessonId, title: `Conversation ${id}`, createdAt: "2026-03-01T10:00:00.000Z", updatedAt: "2026-03-09T10:00:00.000Z" };
}

function msg(id: string, conversationId: string, role: AiMessage["role"], content: string, createdAt: string, extra: Partial<AiMessage> = {}): AiMessage {
  return { id, conversationId, role, content, createdAt, ...extra };
}

async function as(user: User | null) {
  resetRequest();
  if (user) await createSession(user.id);
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

beforeEach(async () => {
  const a = makeCourseTree([[{ id: "les_rev_closures", title: "Closures", blocks: [{ id: "b1", type: "markdown", content: "A closure remembers its outer scope." }] }]], {
    course: { id: "crs_rev_a", slug: "closures-course", title: "Closures course", instructorIds: [instructor.id], aiTutorEnabled: true },
  });
  const b = makeCourseTree([[{ id: "les_rev_other", title: "Other lesson" }]], { course: { id: "crs_rev_b", slug: "other-course", title: "Other course", instructorIds: [otherCreator.id] } });
  courseA = a.course;
  courseB = b.course;
  lessonA = a.lessons[0]!.id;
  conversations.length = 0;
  messages.length = 0;
  conversations.push(conv("conv_a", courseA.id, lessonA), conv("conv_b", courseB.id));
  messages.push(
    msg("m_q1", "conv_a", "user", "What is a closure?", "2026-03-09T10:00:00.000Z"),
    msg("m_a1", "conv_a", "assistant", "A closure remembers its outer scope [1].", "2026-03-09T10:00:05.000Z", {
      helpful: true,
      tokensIn: 500,
      tokensOut: 40,
      citations: [{ lessonId: lessonA, title: "Closures", snippet: "A closure remembers…" }],
    }),
    msg("m_q2", "conv_a", "user", "How do I deploy to Mars?", "2026-03-09T10:01:00.000Z"),
    msg("m_a2", "conv_a", "assistant", UNKNOWN_ANSWER, "2026-03-09T10:01:05.000Z", { tokensIn: 300, tokensOut: 10 }),
    msg("m_q3", "conv_a", "user", "Is a closure a class?", "2026-01-01T10:00:00.000Z"),
    msg("m_a3", "conv_a", "assistant", "Yes, a closure is a class.", "2026-01-01T10:00:05.000Z", { helpful: false, flagged: true, reviewStatus: "pending" }),
    msg("m_qb", "conv_b", "user", "Other question", "2026-03-08T10:00:00.000Z"),
    msg("m_ab", "conv_b", "assistant", "Other answer", "2026-03-08T10:00:05.000Z"),
  );
  await resetDb({
    users: [learner, instructor, otherCreator, moderator, admin],
    courses: [courseA, courseB],
    chapters: [...a.chapters, ...b.chapters],
    lessons: [...a.lessons, ...b.lessons],
    enrollments: [makeEnrollment({ userId: learner.id, courseId: courseA.id }), makeEnrollment({ userId: learner.id, courseId: courseB.id })],
    aiConversations: conversations.map((c) => ({ ...c })),
    aiMessages: messages.map((m) => ({ ...m })),
    settings: { ai: { enabled: true, reviewQueue: true, dailyMessageLimit: 20 } },
  });
  env.anthropicApiKey = "";
});

describe("ai tutor review queue read model", () => {
  it("lists answers with their question, scoped to the courses the viewer manages", async () => {
    const db = await getDb();
    const mine = reviewRows(db, instructor);
    assert.deepEqual(
      mine.map((r) => r.id),
      ["m_a2", "m_a1", "m_a3"],
      "newest first, only course A",
    );
    assert.equal(mine.find((r) => r.id === "m_a1")!.question, "What is a closure?");
    assert.equal(mine.find((r) => r.id === "m_a2")!.unknown, true);
    assert.equal(mine[0]!.lessonTitle, "Closures");
    assert.equal(mine[0]!.learner?.name, "Lena Learner");
    assert.deepEqual(reviewRows(db, otherCreator).map((r) => r.id), ["m_ab"]);
    assert.equal(reviewRows(db, moderator).length, 4, "moderators review every course");
    assert.equal(reviewRows(db, learner).length, 0);
  });

  it("filters by tab, feedback, search and period and counts each tab", async () => {
    const rows = reviewRows(await getDb(), moderator);
    const ids = (filters: Parameters<typeof filterReviewRows>[1]) => filterReviewRows(rows, filters, NOW).map((r) => r.id);
    assert.deepEqual(ids({ tab: "flagged" }), ["m_a3"]);
    assert.deepEqual(ids({ tab: "gaps" }), ["m_a2"]);
    assert.deepEqual(ids({ tab: "recent", courseId: courseB.id }), ["m_ab"]);
    assert.deepEqual(ids({ tab: "recent", feedback: "up" }), ["m_a1"]);
    assert.deepEqual(ids({ tab: "recent", feedback: "down" }), ["m_a3"]);
    assert.deepEqual(ids({ tab: "recent", feedback: "none" }), ["m_a2", "m_ab"]);
    assert.deepEqual(ids({ tab: "recent", q: "MARS" }), ["m_a2"]);
    assert.deepEqual(ids({ tab: "recent", q: "lena" }).length, 4, "searches the learner's name");
    assert.deepEqual(ids({ tab: "recent", days: 7 }), ["m_a2", "m_a1", "m_ab"]);
    assert.deepEqual(reviewTabCounts(rows), { flagged: 1, gaps: 1, recent: 4, reviewed: 0 });
  });

  it("reads filters from the URL and ignores invalid values", () => {
    const params = new URLSearchParams("tab=gaps&course=crs_rev_a&feedback=down&q=closure&days=30");
    assert.deepEqual(parseReviewFilters((k) => params.get(k) ?? undefined), { tab: "gaps", courseId: "crs_rev_a", feedback: "down", q: "closure", days: 30 });
    const bad = new URLSearchParams("tab=all&feedback=meh&days=5");
    assert.deepEqual(parseReviewFilters((k) => bad.get(k) ?? undefined), { tab: "flagged", courseId: undefined, feedback: undefined, q: undefined, days: undefined });
  });

  it("exports rows as a table and as usage rows", async () => {
    const rows = reviewRows(await getDb(), instructor);
    const table = reviewRowsToTable(rows);
    assert.equal(table[0]![0], "Time (UTC)");
    assert.equal(table.length, 4);
    const flagged = table.find((r) => r[4] === "Is a closure a class?")!;
    assert.equal(flagged[6], "not helpful");
    assert.equal(flagged[7], "yes");
    assert.equal(flagged[9], "pending");
    const usage = toUsageRows(rows);
    assert.equal(usage[0]!.learnerId, learner.id);
    assert.equal(usage[0]!.lessonId, lessonA);
  });

  it("opens a full conversation only for the course's managers", async () => {
    const db = await getDb();
    assert.equal(loadReviewConversation(db, otherCreator, "conv_a"), null);
    assert.equal(loadReviewConversation(db, learner, "conv_a"), null);
    const view = loadReviewConversation(db, instructor, "conv_a")!;
    assert.equal(view.messages.length, 6);
    assert.equal(view.lessonTitle, "Closures");
    const answer = view.messages.find((m) => m.id === "m_a1")!;
    assert.equal(answer.citations[0]!.href, "/courses/closures-course/learn/1-1");
    assert.equal(answer.tokensIn, 500);
    assert.ok(loadReviewConversation(db, moderator, "conv_a"));
  });

  it("notifies the instructors, or moderators when a course has none", async () => {
    const db = await getDb();
    assert.deepEqual(reviewRecipients(db, courseA), [instructor.id]);
    assert.deepEqual(reviewRecipients(db, { ...courseA, instructorIds: [] }).sort(), [admin.id, moderator.id].sort());
  });
});

describe("ai tutor review actions", () => {
  it("lets only the course's managers approve answers", async () => {
    await as(otherCreator);
    const denied = await approveAnswersAction(["m_a1", "m_a3"]);
    assert.equal(denied.ok, false);
    await as(instructor);
    const result = await approveAnswersAction(["m_a1", "m_a3", "m_ab", "not valid id!"]);
    assert.ok(result.ok);
    assert.equal(result.data.count, 2, "the other course's answer is skipped");
    const db = await getDb();
    assert.equal(db.aiMessages.find((m) => m.id === "m_a3")!.reviewStatus, "approved");
    assert.equal(db.aiMessages.find((m) => m.id === "m_ab")!.reviewStatus, undefined);
    assert.ok(db.auditEvents.some((e) => e.action === "ai.review.approve" && e.actorId === instructor.id));
  });

  it("saves a correction, tells the learner and feeds it back to retrieval as a trusted clarification", async () => {
    await as(instructor);
    assert.equal((await correctAnswerAction("m_a3", "   ")).ok, false);
    const result = await correctAnswerAction("m_a3", "No. A closure is a function together with the variables it captured.");
    assert.ok(result.ok);
    const db = await getDb();
    const answer = db.aiMessages.find((m) => m.id === "m_a3")!;
    assert.equal(answer.reviewStatus, "corrected");
    assert.match(answer.instructorNote!, /function together with the variables/);
    const note = db.notifications.find((n) => n.userId === learner.id);
    assert.ok(note, "the learner is notified");
    assert.equal(note.link, "/courses/closures-course/ask?c=conv_a");
    const clarification = collectCourseSources(db, courseA.id).find((s) => s.kind === "clarification");
    assert.ok(clarification);
    assert.equal(clarification.trusted, true);
    assert.equal(clarification.lessonId, lessonA);
    assert.equal(clarification.title, "Closures › Instructor clarification");
    assert.ok(!collectCourseSources(db, courseB.id).some((s) => s.kind === "clarification"), "clarifications stay in their course");

    const reopened = await reopenAnswerAction("m_a3");
    assert.ok(reopened.ok);
    const after = (await getDb()).aiMessages.find((m) => m.id === "m_a3")!;
    assert.equal(after.reviewStatus, "pending", "a flagged answer goes back to the queue");
    assert.equal(after.instructorNote, undefined);
  });

  it("flags a thumbs-down for review and notifies the instructor", async () => {
    await as(learner);
    const result = await rateAnswerAction("m_a1", false);
    assert.ok(result.ok);
    assert.deepEqual(result.data, { helpful: false, flagged: true });
    let db = await getDb();
    assert.equal(db.aiMessages.find((m) => m.id === "m_a1")!.reviewStatus, "pending");
    const alert = db.notifications.find((n) => n.userId === instructor.id);
    assert.ok(alert);
    assert.equal(alert.link, "/admin/ai/conversations/conv_a?message=m_a1#m-m_a1");

    const undo = await rateAnswerAction("m_a1", true);
    assert.ok(undo.ok);
    db = await getDb();
    const m = db.aiMessages.find((x) => x.id === "m_a1")!;
    assert.equal(m.flagged, undefined, "changing the vote takes it out of the queue");
    assert.equal(m.reviewStatus, undefined);
  });

  it("accepts reports only for the learner's own answers with a known reason", async () => {
    await as(otherCreator);
    assert.equal((await reportAnswerAction("m_a1", "incorrect")).ok, false, "not their conversation");
    await as(learner);
    assert.equal((await reportAnswerAction("m_a1", "because")).ok, false);
    assert.ok((await reportAnswerAction("m_a1", "answers")).ok);
    const db = await getDb();
    assert.equal(db.aiMessages.find((m) => m.id === "m_a1")!.flagged, true);
    assert.ok(db.auditEvents.some((e) => e.action === "ai.message.report" && e.targetId === "m_a1" && e.meta?.reason === "answers"));
    assert.equal(loadReviewConversation(db, instructor, "conv_a")!.messages.find((m) => m.id === "m_a1")!.reportReason, "It gave away quiz or assignment answers");
  });
});

describe("ai tutor settings", () => {
  it("lets only admins save, and validates the model, limit and prompt", async () => {
    await as(moderator);
    assert.equal((await saveAiSettingsAction(null, form({ model: "claude-opus-5-5", dailyMessageLimit: "10" }))).ok, false);
    await as(admin);
    const bad = await saveAiSettingsAction(null, form({ model: "Not a model", dailyMessageLimit: "-1", systemPrompt: "x".repeat(10_000) }));
    assert.equal(bad.ok, false);
    assert.ok(bad.fieldErrors?.model && bad.fieldErrors.dailyMessageLimit && bad.fieldErrors.systemPrompt);
    const ok = await saveAiSettingsAction(null, form({ enabled: "on", model: "claude-sonnet-5-5", dailyMessageLimit: "", systemPrompt: "  Be brief.\r\n  " }));
    assert.ok(ok.ok);
    assert.match(ok.message ?? "", /ANTHROPIC_API_KEY/, "reminds the admin the key is missing");
    const db = await getDb();
    assert.deepEqual(db.settings.ai, { enabled: true, model: "claude-sonnet-5-5", dailyMessageLimit: 0, systemPrompt: "Be brief.", reviewQueue: false });
    assert.ok(db.auditEvents.some((e) => e.action === "settings.ai" && e.meta?.promptChanged === true));
  });

  it("tests the connection only for admins with a key configured", async () => {
    await as(instructor);
    assert.equal((await testAiConnectionAction("claude-opus-5-5")).ok, false);
    await as(admin);
    const missing = await testAiConnectionAction("claude-opus-5-5");
    assert.equal(missing.ok, false);
    assert.match(missing.ok ? "" : missing.error, /ANTHROPIC_API_KEY/);
  });

  it("masks the API key for display", () => {
    assert.equal(maskSecret(""), "");
    assert.equal(maskSecret("sk-ant-api03-abcdefghijklmnopWXYZ"), "sk-ant-api03-••••••••WXYZ");
    assert.equal(maskSecret("short"), "••••••••");
  });
});

describe("ai tutor per-course switch", () => {
  it("reports the course and site status to its managers only", async () => {
    await as(otherCreator);
    assert.equal((await getCourseAiTutorAction(courseA.id)).ok, false);
    await as(instructor);
    const state = await getCourseAiTutorAction(courseA.id);
    assert.ok(state.ok);
    assert.equal(state.data.enabled, true);
    assert.equal(state.data.siteEnabled, true);
    assert.equal(state.data.keyConfigured, false);
    assert.equal(state.data.canConfigureSite, false);
    assert.ok(state.data.index.chunks >= 1);
  });

  it("saves the switch with the course settings only when the form rendered it", async () => {
    await as(instructor);
    const base = { courseId: courseA.id, selfEnrollment: "on" };
    assert.ok((await updateCourseSettingsAction(null, form(base))).ok);
    assert.equal((await getDb()).courses.find((c) => c.id === courseA.id)!.aiTutorEnabled, true, "untouched without the marker");
    assert.ok((await updateCourseSettingsAction(null, form({ ...base, aiTutorField: "1" }))).ok);
    assert.equal((await getDb()).courses.find((c) => c.id === courseA.id)!.aiTutorEnabled, undefined, "switched off");
    assert.ok((await updateCourseSettingsAction(null, form({ ...base, aiTutorField: "1", aiTutorEnabled: "on" }))).ok);
    assert.equal((await getDb()).courses.find((c) => c.id === courseA.id)!.aiTutorEnabled, true);
  });
});
