import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Activity, AssignmentSubmission, Certificate, DiscussionReply, DiscussionTopic, ExerciseSubmission, PointsEntry } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import {
  awardLearningDayPoints,
  awardPoints,
  awardQuizPoints,
  certificatePointsRef,
  ensurePointsLedger,
  getLeaderboard,
  getLedgerStatus,
  recalculatePointsLedger,
  revokeCertificatePoints,
  syncAssignmentPassPoints,
} from "@/lib/services/points";
import { issueCertificate } from "@/lib/services/progress";
import { getCommunityHub } from "@/lib/data/community";
import {
  FIXED_NOW,
  makeBatch,
  makeCourseTree,
  makeEnrollment,
  makeQuiz,
  makeQuizSubmission,
  makeUser,
  resetDb,
  type Fixture,
} from "./helpers/db";

const settings = { email: { enabled: false } } as const;
const learner = makeUser({ id: "usr_learner", name: "Lena Learner" });
const friend = makeUser({ id: "usr_friend", name: "Fred Friend" });
const creator = makeUser({ id: "usr_creator", name: "Cara Creator", roles: ["course_creator"] });
const evaluator = makeUser({ id: "usr_eval", name: "Eve Evaluator", roles: ["batch_evaluator"] });

const tree = makeCourseTree([[{ id: "les_a1" }, { id: "les_a2" }]], { course: { id: "crs_pub", title: "Published", instructorIds: [creator.id], createdById: creator.id } });
const other = makeCourseTree([[{ id: "les_b1" }]], { course: { id: "crs_other", title: "Other course" } });
const hidden = makeCourseTree([[{ id: "les_h1" }]], { course: { id: "crs_hidden", title: "Draft", published: false } });

function base(extra: Fixture = {}): Fixture {
  return {
    users: [learner, friend, creator, evaluator],
    courses: [tree.course, other.course, hidden.course],
    chapters: [...tree.chapters, ...other.chapters, ...hidden.chapters],
    lessons: [...tree.lessons, ...other.lessons, ...hidden.lessons],
    enrollments: [
      makeEnrollment({ userId: learner.id, courseId: tree.course.id }),
      makeEnrollment({ userId: learner.id, courseId: hidden.course.id }),
      makeEnrollment({ userId: creator.id, courseId: tree.course.id }),
      makeEnrollment({ userId: evaluator.id, courseId: tree.course.id }),
    ],
    ...extra,
    settings: { ...settings, ...(extra.settings ?? {}) },
  };
}

async function entries(userId?: string): Promise<PointsEntry[]> {
  const db = await getDb();
  return db.points.filter((p) => !userId || p.userId === userId);
}

describe("points: idempotency and self-dealing", () => {
  beforeEach(async () => {
    await resetDb(base());
  });

  it("awards a lesson once, and nothing for courses the member manages or unpublished courses", async () => {
    assert.ok(await awardPoints(learner.id, "lesson_complete", { refId: "les_a1" }));
    assert.equal(await awardPoints(learner.id, "lesson_complete", { refId: "les_a1" }), null);
    assert.equal(await awardPoints(creator.id, "lesson_complete", { refId: "les_a1" }), null, "course manager");
    assert.equal(await awardPoints(creator.id, "course_complete", { refId: tree.course.id }), null, "course manager");
    assert.equal(await awardPoints(learner.id, "lesson_complete", { refId: "les_h1" }), null, "unpublished course");
    const mine = await entries(learner.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.courseId, tree.course.id);
    assert.equal((await entries(creator.id)).length, 0);
  });

  it("gives no quiz points to the quiz author, but pays learners", async () => {
    const quiz = makeQuiz({ id: "quiz_own", authorId: creator.id, passingPercentage: 0 });
    await mutate((d) => {
      d.quizzes.push(quiz);
      d.quizSubmissions.push(makeQuizSubmission({ id: "qs_creator", quizId: quiz.id, userId: creator.id }));
      d.quizSubmissions.push(makeQuizSubmission({ id: "qs_learner", quizId: quiz.id, userId: learner.id }));
    });
    await awardQuizPoints("qs_creator");
    await awardQuizPoints("qs_learner");
    assert.equal((await entries(creator.id)).length, 0);
    assert.deepEqual((await entries(learner.id)).map((p) => p.reason).sort(), ["quiz_pass", "quiz_perfect"]);
  });

  it("gives staff no exercise or assignment points and never pays a self-graded pass", async () => {
    await mutate((d) => {
      d.exercises.push({ id: "exr_1", title: "Sum", problemStatement: "x", language: "javascript", testCases: [], authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
      d.assignments.push({ id: "asg_1", title: "Essay", question: "x", type: "text", showAnswer: false, gradeAssignment: true, enableScheduling: false, authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
    });
    assert.equal(await awardPoints(evaluator.id, "exercise_pass", { refId: "exr_1" }), null);
    assert.equal(await awardPoints(creator.id, "assignment_submit", { refId: "asg_1" }), null);
    assert.equal(await awardPoints(learner.id, "assignment_pass", { refId: "asg_1", grantedBy: learner.id }), null);
    assert.ok(await awardPoints(learner.id, "exercise_pass", { refId: "exr_1" }));
  });

  it("does not count learning days spent only in one's own course", async () => {
    await awardLearningDayPoints(creator.id, "lesson_view", "les_a1", "2026-01-10");
    assert.equal((await entries(creator.id)).length, 0);
    await awardLearningDayPoints(creator.id, "lesson_view", "les_b1", "2026-01-10");
    assert.equal((await entries(creator.id)).length, 1);
    await awardLearningDayPoints(learner.id, "login", undefined, "2026-01-10");
    assert.equal((await entries(learner.id)).length, 0);
  });
});

describe("points: course attribution", () => {
  beforeEach(async () => {
    await resetDb(base());
    await mutate((d) => {
      d.exercises.push({ id: "exr_c", title: "In course", problemStatement: "x", language: "javascript", testCases: [], courseId: tree.course.id, authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
      d.exercises.push({ id: "exr_free", title: "Standalone", problemStatement: "x", language: "javascript", testCases: [], authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
      const lesson = d.lessons.find((l) => l.id === "les_a2")!;
      lesson.blocks = [...lesson.blocks, { id: "blk_ex", type: "exercise", exerciseId: "exr_free" }];
    });
  });

  it("ignores a course the client names when the content does not belong to it", async () => {
    const entry = await awardPoints(learner.id, "exercise_pass", { refId: "exr_c", courseId: other.course.id });
    assert.equal(entry?.courseId, tree.course.id);
    const board = await getLeaderboard({ viewer: learner, period: "all", courseId: other.course.id });
    assert.equal(board.rows.length, 0);
  });

  it("uses the verified lesson placement, and no course when the member is not enrolled", async () => {
    const entry = await awardPoints(learner.id, "exercise_pass", { refId: "exr_free", lessonId: "les_b1" });
    assert.equal(entry?.courseId, tree.course.id, "les_b1 does not embed the exercise, so the real placement is used");
    await resetDb(base({ enrollments: [] }));
    await mutate((d) => {
      d.exercises.push({ id: "exr_free", title: "Standalone", problemStatement: "x", language: "javascript", testCases: [], authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
    });
    const orphan = await awardPoints(learner.id, "exercise_pass", { refId: "exr_free", courseId: tree.course.id });
    assert.ok(orphan);
    assert.equal(orphan.courseId, undefined);
  });
});

describe("points: certificates", () => {
  beforeEach(async () => {
    await resetDb(base());
  });

  it("pays once per course however often a certificate is revoked and re-issued", async () => {
    const course = tree.course;
    const first = await issueCertificate(learner, course);
    assert.equal(certificatePointsRef(first), `course:${course.id}`);
    await mutate((d) => {
      d.certificates = d.certificates.filter((c) => c.id !== first.id);
    });
    await revokeCertificatePoints(first);
    assert.equal((await entries(learner.id)).filter((p) => p.reason === "certificate").length, 0, "revocation takes the points back");
    await issueCertificate(learner, course);
    await issueCertificate(learner, course);
    const certs = (await entries(learner.id)).filter((p) => p.reason === "certificate");
    assert.equal(certs.length, 1);
    assert.equal(certs[0]!.points, 50);
  });

  it("never creates two certificates for concurrent requests", async () => {
    const results = await Promise.all([issueCertificate(learner, tree.course), issueCertificate(learner, tree.course), issueCertificate(learner, tree.course)]);
    const db = await getDb();
    assert.equal(db.certificates.filter((c) => c.userId === learner.id).length, 1);
    assert.equal(new Set(results.map((c) => c.id)).size, 1);
    assert.equal(db.points.filter((p) => p.reason === "certificate").length, 1);
  });

  it("pays nothing for a certificate issued to oneself or in a managed course", async () => {
    // The history backfill cannot know who issued a certificate, so build the ledger first and test the live award.
    await ensurePointsLedger();
    await issueCertificate(evaluator, tree.course, { issuedById: evaluator.id });
    await issueCertificate(creator, tree.course);
    assert.equal((await entries()).filter((p) => p.reason === "certificate").length, 0);
  });
});

describe("points: assignment regrades", () => {
  const submission: AssignmentSubmission = {
    id: "asub_1",
    assignmentId: "asg_1",
    assignmentTitle: "Essay",
    userId: learner.id,
    type: "text",
    answer: "hi",
    status: "pass",
    submittedAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };

  beforeEach(async () => {
    await resetDb(base({ assignmentSubmissions: [structuredClone(submission)] }));
  });

  it("follows the stored grade, whatever order concurrent regrades finish in", async () => {
    await syncAssignmentPassPoints(submission.id, evaluator.id);
    assert.equal((await entries(learner.id)).filter((p) => p.reason === "assignment_pass").length, 1);
    // Two graders: the stored grade ends as "fail"; both syncs run afterwards in any order.
    await mutate((d) => {
      d.assignmentSubmissions[0]!.status = "fail";
    });
    await Promise.all([syncAssignmentPassPoints(submission.id, evaluator.id), syncAssignmentPassPoints(submission.id, creator.id)]);
    assert.equal((await entries(learner.id)).filter((p) => p.reason === "assignment_pass").length, 0);
  });
});

describe("points: backfill", () => {
  it("fills a large history without overflowing the stack and marks the ledger as built", async () => {
    const users = Array.from({ length: 1300 }, (_, i) => makeUser({ id: `usr_bf${i}` }));
    const activities: Activity[] = [];
    for (const u of users) {
      for (let d = 0; d < 100; d++) {
        const date = new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10);
        activities.push({ id: `act_${u.id}_${d}`, userId: u.id, date, type: "lesson_view", createdAt: `${date}T10:00:00.000Z` });
      }
    }
    await resetDb({ users, activities, settings });
    await ensurePointsLedger();
    const db = await getDb();
    assert.equal(db.points.length, 130_000);
    assert.ok(db.settings.gamification.ledgerBuiltAt);
    assert.equal((await getLedgerStatus()).built, true);
  });

  it("does not let a live award mark a failed backfill as done, and merges without doubling", async () => {
    await resetDb(
      base({
        progress: [
          { id: "prg_1", userId: learner.id, courseId: tree.course.id, chapterId: tree.chapters[0]!.id, lessonId: "les_a1", status: "complete", dwellSeconds: 60, completedAt: FIXED_NOW, updatedAt: FIXED_NOW },
        ],
        exerciseSubmissions: [{ id: "esub_1", exerciseId: "exr_x", exerciseTitle: "X", userId: learner.id, code: "", status: "passed", testResults: [], submittedAt: FIXED_NOW }],
        exercises: [{ id: "exr_x", title: "X", problemStatement: "x", language: "javascript", testCases: [], authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
      }),
    );
    // Corrupt data makes the history build throw.
    await mutate((d) => {
      (d.lessons[1] as unknown as { blocks: unknown }).blocks = null;
    });
    await ensurePointsLedger();
    let status = await getLedgerStatus();
    assert.equal(status.built, false);
    assert.ok(status.error);
    // A live award still works and does not mark the ledger as built.
    assert.ok(await awardPoints(learner.id, "lesson_complete", { refId: "les_a1" }));
    assert.equal((await getDb()).settings.gamification.ledgerBuiltAt, undefined);
    // Data fixed: the retry merges history without doubling the live award.
    await mutate((d) => {
      d.lessons[1]!.blocks = [];
    });
    (globalThis as unknown as { __llPointsBackfill: { retryAt: number } }).__llPointsBackfill.retryAt = 0;
    await ensurePointsLedger();
    status = await getLedgerStatus();
    assert.equal(status.built, true);
    const mine = await entries(learner.id);
    assert.equal(mine.filter((p) => p.reason === "lesson_complete").length, 1);
    assert.equal(mine.filter((p) => p.reason === "exercise_pass").length, 1);
  });

  it("moves legacy certificate entries to the course key and drops duplicates and revoked ones", async () => {
    const cert: Certificate = { id: "cert_live", code: "LL-1", userId: learner.id, courseId: tree.course.id, issueDate: "2026-01-02", published: true };
    const legacy = (id: string, refId: string): PointsEntry => ({ id, userId: learner.id, points: 50, reason: "certificate", refId, createdAt: FIXED_NOW });
    await resetDb(base({ certificates: [cert], points: [legacy("p1", "cert_revoked_1"), legacy("p2", "cert_revoked_2"), legacy("p3", cert.id)] }));
    await ensurePointsLedger();
    const certs = (await entries(learner.id)).filter((p) => p.reason === "certificate");
    assert.equal(certs.length, 1);
    assert.equal(certs[0]!.refId, `course:${tree.course.id}`);
  });

  it("never dates backfilled entries in the future", async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await resetDb(base({ certificates: [{ id: "cert_f", code: "LL-F", userId: learner.id, courseId: tree.course.id, issueDate: future, published: true }] }));
    await ensurePointsLedger();
    const cert = (await entries(learner.id)).find((p) => p.reason === "certificate");
    assert.ok(cert);
    assert.ok(Date.parse(cert.createdAt) <= Date.now());
  });

  it("keeps a solved exercise on recalculation after a later failing attempt", async () => {
    const sub: ExerciseSubmission = { id: "esub_2", exerciseId: "exr_y", exerciseTitle: "Y", userId: learner.id, code: "", status: "passed", testResults: [], submittedAt: FIXED_NOW };
    await resetDb(base({ exerciseSubmissions: [sub], exercises: [{ id: "exr_y", title: "Y", problemStatement: "x", language: "javascript", testCases: [], authorId: creator.id, createdAt: FIXED_NOW, updatedAt: FIXED_NOW }] }));
    await ensurePointsLedger();
    await mutate((d) => {
      d.exerciseSubmissions[0]!.status = "failed";
    });
    await recalculatePointsLedger();
    assert.equal((await entries(learner.id)).filter((p) => p.reason === "exercise_pass").length, 1);
  });
});

describe("leaderboard: staff exclusion", () => {
  it("leaves every staff role out of the rankings when excludeStaff is on", async () => {
    await resetDb(base());
    await awardPoints(learner.id, "manual", { points: 10, note: "x" });
    for (const u of [creator, evaluator]) await awardPoints(u.id, "manual", { points: 100, note: "x" });
    const board = await getLeaderboard({ viewer: evaluator, period: "all" });
    assert.deepEqual(
      board.rows.map((r) => r.member.id),
      [learner.id],
    );
    assert.equal(board.viewer.status, "excluded");
  });
});

describe("community hub", () => {
  it("counts only visible threads for contributor points and hides batch topics while Batches is off", async () => {
    const now = new Date().toISOString();
    const batch = makeBatch({ id: "bat_x", title: "Secret cohort" });
    const topics: DiscussionTopic[] = [
      { id: "top_lesson", refType: "lesson", refId: "les_a1", courseId: tree.course.id, authorId: learner.id, title: "Visible question", createdAt: now, updatedAt: now },
      { id: "top_other", refType: "lesson", refId: "les_b1", courseId: other.course.id, authorId: learner.id, title: "Hidden question", createdAt: now, updatedAt: now },
      { id: "top_batch", refType: "batch", refId: batch.id, authorId: learner.id, title: "Batch question", createdAt: now, updatedAt: now },
    ];
    const reply = (id: string, topicId: string, authorId: string, at: string): DiscussionReply => ({ id, topicId, authorId, content: "text", createdAt: at, updatedAt: at });
    const later = new Date(Date.now() + 1000).toISOString();
    const replies = [
      reply("r_open1", "top_lesson", learner.id, now),
      reply("r_friend1", "top_lesson", friend.id, later),
      reply("r_open2", "top_other", learner.id, now),
      reply("r_friend2", "top_other", friend.id, later),
    ];
    await resetDb(
      base({
        batches: [batch],
        batchEnrollments: [{ id: "be_1", batchId: batch.id, userId: learner.id, enrolledAt: FIXED_NOW } as never],
        enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id }), makeEnrollment({ userId: friend.id, courseId: tree.course.id }), makeEnrollment({ userId: friend.id, courseId: other.course.id })],
        discussionTopics: topics,
        discussionReplies: replies,
        settings: { ...settings, features: { batches: false } },
      }),
    );
    await ensurePointsLedger();
    const friendPoints = (await entries(friend.id)).filter((p) => p.reason === "discussion_reply");
    assert.equal(friendPoints.length, 2, "friend earned points in both courses");
    const hub = await getCommunityHub(learner);
    assert.deepEqual(hub.topics.map((t) => t.id), ["top_lesson"]);
    assert.equal(hub.spaces.batches, 0);
    const top = hub.contributors.find((c) => c.member.id === friend.id);
    assert.equal(top?.points, 5, "only the visible reply counts");
  });
});
