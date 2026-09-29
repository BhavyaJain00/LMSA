import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Question } from "@/lib/types";
import { computeScore, gradeAnswer, recordQuizSubmission, startQuizAttempt } from "@/lib/data/quiz";
import { getDb } from "@/lib/db/store";
import { makeCourseTree, makeEnrollment, makeQuestion, makeQuiz, makeUser, resetDb } from "../helpers/db";

const single = makeQuestion({
  id: "q_single",
  type: "choices",
  options: [
    { id: "a", text: "A", isCorrect: false },
    { id: "b", text: "B", isCorrect: true },
  ],
});
const multi = makeQuestion({
  id: "q_multi",
  type: "choices",
  multiple: true,
  options: [
    { id: "x", text: "X", isCorrect: true },
    { id: "y", text: "Y", isCorrect: true },
    { id: "z", text: "Z", isCorrect: false },
  ],
});
const typed = makeQuestion({ id: "q_typed", type: "user_input", possibilities: ["Paris", "  City of   Light "] });
const open = makeQuestion({ id: "q_open", type: "open_ended" });

const plain = { enableNegativeMarking: false, marksToCut: 0 };
const negative = { enableNegativeMarking: true, marksToCut: 0.5 };

describe("gradeAnswer", () => {
  it("choices: correct only when the selected set equals the correct set", () => {
    assert.deepEqual(gradeAnswer(multi, ["y", "x"], 2, plain), { answer: ["y", "x"], answered: true, isCorrect: true, marks: 2, graded: true });
    assert.equal(gradeAnswer(multi, ["x"], 2, plain).isCorrect, false);
    assert.equal(gradeAnswer(multi, ["x", "y", "z"], 2, plain).isCorrect, false);
    assert.equal(gradeAnswer(multi, ["x", "y", "y", "unknown"], 2, plain).isCorrect, true);
  });

  it("single choice keeps only the first valid option", () => {
    assert.deepEqual(gradeAnswer(single, ["b", "a"], 1, plain).answer, ["b"]);
    assert.equal(gradeAnswer(single, ["b", "a"], 1, plain).isCorrect, true);
    assert.equal(gradeAnswer(single, ["forged"], 1, plain).answered, false);
  });

  it("user input: case-insensitive, whitespace-normalised match", () => {
    assert.equal(gradeAnswer(typed, ["  paris "], 1, plain).isCorrect, true);
    assert.equal(gradeAnswer(typed, ["city of light"], 1, plain).isCorrect, true);
    assert.equal(gradeAnswer(typed, ["Lyon"], 1, plain).isCorrect, false);
    assert.deepEqual(gradeAnswer(typed, [" "], 1, plain), { answer: [], answered: false, isCorrect: false, marks: 0, graded: true });
    assert.equal(gradeAnswer(typed, ["x".repeat(900)], 1, plain).answer[0]!.length, 500);
  });

  it("open-ended answers wait for manual grading (blank ones need none)", () => {
    assert.deepEqual(gradeAnswer(open, ["My essay"], 5, plain), { answer: ["My essay"], answered: true, isCorrect: false, marks: 0, graded: false });
    assert.deepEqual(gradeAnswer(open, ["   "], 5, plain), { answer: [], answered: false, isCorrect: false, marks: 0, graded: true });
  });

  it("negative marking costs marksToCut for wrong answers only", () => {
    assert.equal(gradeAnswer(single, ["a"], 1, negative).marks, -0.5);
    assert.equal(gradeAnswer(typed, ["Lyon"], 1, negative).marks, -0.5);
    assert.equal(gradeAnswer(single, [], 1, negative).marks, 0);
    assert.equal(gradeAnswer(single, ["b"], 1, negative).marks, 1);
    assert.equal(gradeAnswer(open, ["x"], 1, negative).marks, 0);
    assert.ok(gradeAnswer(single, ["a"], 1, { enableNegativeMarking: false, marksToCut: 3 }).marks === 0);
  });

  it("ignores non-string answers", () => {
    assert.equal(gradeAnswer(single, [1 as unknown as string, "b"], 1, plain).isCorrect, true);
    assert.equal(gradeAnswer(single, undefined, 1, plain).answered, false);
  });
});

describe("computeScore", () => {
  it("sums marks and never reports a negative percentage", () => {
    assert.deepEqual(computeScore([{ marks: 1, marksOutOf: 1 }, { marks: 2, marksOutOf: 2 }, { marks: 0, marksOutOf: 1 }]), { score: 3, scoreOutOf: 4, percentage: 75 });
    assert.deepEqual(computeScore([{ marks: -0.5, marksOutOf: 1 }, { marks: 0, marksOutOf: 1 }]), { score: -0.5, scoreOutOf: 2, percentage: 0 });
    assert.deepEqual(computeScore([{ marks: 1, marksOutOf: 3 }]), { score: 1, scoreOutOf: 3, percentage: 33.3 });
    assert.deepEqual(computeScore([]), { score: 0, scoreOutOf: 0, percentage: 0 });
  });
});

describe("quiz attempts (store)", () => {
  const learner = makeUser({ id: "usr_quiz" });
  const author = makeUser({ id: "usr_author", roles: ["course_creator"] });
  const tree = makeCourseTree([[{ id: "les_quiz", blocks: [{ id: "blk_q", type: "quiz", quizId: "quiz_1" }] }]], { course: { id: "crs_quiz", instructorIds: [author.id] } });
  const questions: Question[] = [single, multi, typed, open];

  async function setup(quizOverrides: Parameters<typeof makeQuiz>[0] = {}, withOpen = false) {
    const quiz = makeQuiz({
      id: "quiz_1",
      title: "Checkpoint",
      courseId: tree.course.id,
      authorId: author.id,
      passingPercentage: 60,
      questions: (withOpen ? questions : questions.slice(0, 3)).map((q) => ({ questionId: q.id, marks: q.id === "q_multi" ? 2 : 1 })),
      ...quizOverrides,
    });
    await resetDb({
      users: [learner, author],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      questions,
      quizzes: [quiz],
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
      settings: { email: { enabled: false }, gamification: { enabled: false } },
    });
  }

  async function attempt(answers: Record<string, string[]>) {
    const started = await startQuizAttempt(learner, "quiz_1");
    assert.ok(started.ok, started.ok ? "" : started.error);
    return recordQuizSubmission(learner, { quizId: "quiz_1", lessonId: "les_quiz", attemptToken: started.data.token, answers, violationCount: 0, submissionReason: "manual" });
  }

  beforeEach(() => setup());

  it("grades a passing attempt, stores it and completes the lesson", async () => {
    const result = await attempt({ q_single: ["b"], q_multi: ["x", "y"], q_typed: ["paris"] });
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.data.submission.score, 4);
    assert.equal(result.data.submission.percentage, 100);
    assert.equal(result.data.submission.passed, true);
    assert.equal(result.data.lessonCompleted, true);
    const db = await getDb();
    assert.equal(db.quizSubmissions.length, 1);
    assert.equal(db.progress.find((p) => p.lessonId === "les_quiz")?.status, "complete");
  });

  it("fails below the passing percentage", async () => {
    const result = await attempt({ q_single: ["a"], q_multi: ["x"], q_typed: ["Paris"] });
    assert.ok(result.ok);
    assert.equal(result.data.submission.percentage, 25);
    assert.equal(result.data.submission.passed, false);
    assert.equal(result.data.lessonCompleted, false);
  });

  it("applies negative marking without a negative percentage", async () => {
    await setup({ enableNegativeMarking: true, marksToCut: 1 });
    const result = await attempt({ q_single: ["a"], q_multi: ["z"], q_typed: ["Lyon"] });
    assert.ok(result.ok);
    assert.equal(result.data.submission.score, -3);
    assert.equal(result.data.submission.percentage, 0);
  });

  it("keeps attempts with open-ended answers pending and not passed", async () => {
    await setup({}, true);
    const result = await attempt({ q_single: ["b"], q_multi: ["x", "y"], q_typed: ["paris"], q_open: ["An essay"] });
    assert.ok(result.ok);
    assert.equal(result.data.submission.pendingGrading, true);
    assert.equal(result.data.submission.passed, false);
    const db = await getDb();
    assert.ok(db.notifications.some((n) => n.userId === author.id && n.link?.startsWith("/admin/quizzes/submissions/")));
  });

  it("enforces the attempt limit and rejects forged or replayed attempt tokens", async () => {
    await setup({ maxAttempts: 1 });
    const started = await startQuizAttempt(learner, "quiz_1");
    assert.ok(started.ok);
    const forged = `${started.data.token.slice(0, -2)}${started.data.token.endsWith("AA") ? "BB" : "AA"}`;
    const bad = await recordQuizSubmission(learner, { quizId: "quiz_1", attemptToken: forged, answers: {}, violationCount: 0, submissionReason: "manual" });
    assert.equal(bad.ok, false);
    const good = await recordQuizSubmission(learner, { quizId: "quiz_1", attemptToken: started.data.token, answers: { q_single: ["b"] }, violationCount: 0, submissionReason: "manual" });
    assert.ok(good.ok);
    const replay = await recordQuizSubmission(learner, { quizId: "quiz_1", attemptToken: started.data.token, answers: { q_single: ["b"] }, violationCount: 0, submissionReason: "manual" });
    assert.equal(replay.ok, false);
    const again = await startQuizAttempt(learner, "quiz_1");
    assert.ok(!again.ok && /maximum number of attempts/.test(again.error));
    assert.equal((await getDb()).quizSubmissions.length, 1);
  });

  it("refuses learners who are not enrolled", async () => {
    const stranger = makeUser({ id: "usr_stranger" });
    const db = await getDb();
    db.users.push(stranger);
    const started = await startQuizAttempt(stranger, "quiz_1");
    assert.equal(started.ok, false);
  });
});
