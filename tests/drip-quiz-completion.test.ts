import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Question, QuizSubmission } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { getLessonAccess } from "@/lib/data/lessons";
import { getQuizAccess, gradeSubmission, recordQuizSubmission, startQuizAttempt } from "@/lib/data/quiz";
import { makeBatch, makeCourseTree, makeEnrollment, makeQuestion, makeQuiz, makeQuizSubmission, makeUser, resetDb } from "./helpers/db";

/**
 * Drip review, finding 1 (major): a passing quiz attempt must not complete a
 * lesson the learner can't open yet. Taking the quiz can be allowed through
 * another route (here: a batch that lists the quiz as an assessment), but the
 * lesson named by the client only counts while it is open to the learner —
 * also when an instructor grades the attempt later. Finding 2: quizzes in a
 * free-preview lesson follow the preview's `availableFrom` date and the
 * guest-access setting.
 */

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const dateKey = (n: number) => daysFromNow(n).slice(0, 10);

const learner = makeUser({ id: "usr_drip_learner" });
const admin = makeUser({ id: "usr_drip_admin", roles: ["admin"] });
const visitor = makeUser({ id: "usr_drip_visitor" });

const choice: Question = makeQuestion({
  id: "qst_choice",
  type: "choices",
  options: [
    { id: "opt_yes", text: "Yes", isCorrect: true },
    { id: "opt_no", text: "No", isCorrect: false },
  ],
});
const essay: Question = makeQuestion({ id: "qst_essay", type: "open_ended" });

// Q: only in the scheduled lesson 2.1, but listed by the learner's batch. QOpen: in the open lesson 1.1.
// QG (open-ended, graded by hand): in 1.2 (open) and 2.1 (scheduled).
const quiz = makeQuiz({ id: "quiz_batch", title: "Batch quiz", questions: [{ questionId: choice.id, marks: 1 }], totalMarks: 1 });
const quizOpen = makeQuiz({ id: "quiz_open", title: "Open quiz", questions: [{ questionId: choice.id, marks: 1 }], totalMarks: 1 });
const quizGraded = makeQuiz({ id: "quiz_graded", title: "Essay", questions: [{ questionId: essay.id, marks: 1 }], totalMarks: 1 });

const tree = makeCourseTree(
  [
    [{ id: "les_open", blocks: [{ id: "b1", type: "quiz", quizId: quizOpen.id }] }, { id: "les_open_graded", blocks: [{ id: "b2", type: "quiz", quizId: quizGraded.id }] }],
    [
      {
        id: "les_scheduled",
        blocks: [
          { id: "b3", type: "quiz", quizId: quiz.id },
          { id: "b4", type: "quiz", quizId: quizGraded.id },
        ],
      },
    ],
  ],
  { course: { id: "crs_drip_quiz", slug: "drip-quiz" }, chapters: [{}, { dripDays: 14 }] },
);

const batch = makeBatch({ id: "bat_drip", courseIds: [tree.course.id], assessments: [{ id: "ba_1", type: "quiz", refId: quiz.id }] });

async function seed() {
  await resetDb({
    users: [learner, admin, visitor],
    courses: [tree.course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    questions: [choice, essay],
    quizzes: [quiz, quizOpen, quizGraded],
    batches: [batch],
    batchEnrollments: [{ id: "ben_drip", batchId: batch.id, userId: learner.id, confirmationEmailSent: true, enrolledAt: daysFromNow(-2) }],
    // A self-enrollment two days ago: chapter 2 (14 drip days) opens in 12 days.
    enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id, enrolledAt: daysFromNow(-2) })],
  });
}

async function passQuiz(quizId: string, lessonId: string) {
  const started = await startQuizAttempt(learner, quizId);
  assert.ok(started.ok, started.ok ? "" : started.error);
  return recordQuizSubmission(learner, {
    quizId,
    lessonId,
    attemptToken: started.data.token,
    answers: { [choice.id]: ["opt_yes"] },
    violationCount: 0,
    submissionReason: "manual",
  });
}

async function progressOf(lessonId: string) {
  return (await getDb()).progress.find((p) => p.userId === learner.id && p.lessonId === lessonId);
}

describe("recordQuizSubmission and locked lessons", () => {
  beforeEach(seed);

  it("records a passing attempt without completing a drip-locked lesson named by the client", async () => {
    assert.equal((await getLessonAccess(learner, "les_scheduled"))?.lock?.reason, "drip");
    assert.equal((await getQuizAccess(learner, quiz)).ok, true, "the batch lists the quiz, so it can be taken");

    const result = await passQuiz(quiz.id, "les_scheduled");
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.data.submission.passed, true);
    assert.equal(result.data.lessonCompleted, false);

    const stored = (await getDb()).quizSubmissions.find((s) => s.id === result.data.submission.id);
    assert.equal(stored?.lessonId, undefined, "the locked lesson is not attached to the attempt");
    assert.equal(await progressOf("les_scheduled"), undefined, "no progress row (not even partial) for the locked lesson");
    const access = await getLessonAccess(learner, "les_scheduled");
    assert.equal(access?.canView, false);
    assert.equal(access?.lock?.reason, "drip");
  });

  it("still completes an open lesson", async () => {
    const result = await passQuiz(quizOpen.id, "les_open");
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.data.lessonCompleted, true);
    assert.equal((await progressOf("les_open"))?.status, "complete");
    const stored = (await getDb()).quizSubmissions.find((s) => s.id === result.data.submission.id);
    assert.equal(stored?.lessonId, "les_open");
  });
});

describe("gradeSubmission and locked lessons", () => {
  beforeEach(seed);

  function pendingEssay(id: string, lessonId: string): QuizSubmission {
    return makeQuizSubmission({
      id,
      quizId: quizGraded.id,
      quizTitle: quizGraded.title,
      userId: learner.id,
      courseId: tree.course.id,
      lessonId,
      results: [
        { questionId: essay.id, questionText: essay.text, questionType: "open_ended", answer: ["My essay"], isCorrect: false, marks: 0, marksOutOf: 1, graded: false },
      ],
      score: 0,
      scoreOutOf: 1,
      percentage: 0,
      passed: false,
      pendingGrading: true,
    });
  }

  async function addSubmission(submission: QuizSubmission) {
    const db = await getDb();
    db.quizSubmissions.push(submission);
  }

  it("does not complete a lesson the learner can't open when a passing grade is given", async () => {
    await addSubmission(pendingEssay("qsub_locked", "les_scheduled"));
    const graded = await gradeSubmission(admin, { submissionId: "qsub_locked", marks: { [essay.id]: 1 } });
    assert.ok(graded.ok, graded.ok ? "" : graded.error);
    assert.equal(graded.data.passed, true);
    assert.equal(await progressOf("les_scheduled"), undefined);
    assert.equal((await getLessonAccess(learner, "les_scheduled"))?.canView, false);
  });

  it("completes the lesson when it is open to the learner", async () => {
    await addSubmission(pendingEssay("qsub_open", "les_open_graded"));
    const graded = await gradeSubmission(admin, { submissionId: "qsub_open", marks: { [essay.id]: 1 } });
    assert.ok(graded.ok, graded.ok ? "" : graded.error);
    assert.equal((await progressOf("les_open_graded"))?.status, "complete");
  });
});

describe("getQuizAccess for free-preview lessons", () => {
  const previewQuiz = makeQuiz({ id: "quiz_preview", title: "Preview quiz", questions: [{ questionId: choice.id, marks: 1 }], totalMarks: 1 });

  async function seedPreview(availableFrom: string | undefined, allowGuestAccess = true) {
    const preview = makeCourseTree([[{ id: "les_preview", includeInPreview: true, availableFrom, blocks: [{ id: "bp", type: "quiz", quizId: previewQuiz.id }] }]], {
      course: { id: "crs_preview", slug: "preview-course" },
    });
    await resetDb({
      users: [visitor],
      courses: [preview.course],
      chapters: preview.chapters,
      lessons: preview.lessons,
      questions: [choice],
      quizzes: [previewQuiz],
      settings: { learning: { allowGuestAccess } },
    });
  }

  it("keeps a preview scheduled for a later date closed, questions included", async () => {
    await seedPreview(dateKey(30));
    const access = await getQuizAccess(visitor, previewQuiz);
    assert.equal(access.ok, false);
    assert.equal(access.ok ? null : access.reason, "locked");
    const started = await startQuizAttempt(visitor, previewQuiz.id);
    assert.equal(started.ok, false, "no questions are issued before the release date");
  });

  it("opens the preview quiz once the date has passed", async () => {
    await seedPreview(dateKey(-1));
    assert.deepEqual(await getQuizAccess(visitor, previewQuiz), { ok: true, manage: false });
    assert.equal((await startQuizAttempt(visitor, previewQuiz.id)).ok, true);
  });

  it("follows the guest-access setting like the lesson player", async () => {
    await seedPreview(undefined, false);
    const access = await getQuizAccess(visitor, previewQuiz);
    assert.equal(access.ok, false);
    assert.equal(access.ok ? null : access.reason, "forbidden");
  });
});
