import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LessonBlock, VideoWatch } from "@/lib/types";
import { completeLesson, getCompletionRequirements, issueCertificate, recalculateCourseProgress, setLessonStatus } from "@/lib/services/progress";
import { getCourseProgress } from "@/lib/data/courses";
import { getDb } from "@/lib/db/store";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makeQuizSubmission, makeUser, resetDb } from "../helpers/db";

const learner = makeUser({ id: "usr_progress", name: "Pat" });
const video: LessonBlock = { id: "blk_video", type: "video", src: "/uploads/videos/v.mp4", duration: 100 };
const tree = makeCourseTree(
  [
    [
      { id: "les_read" },
      { id: "les_video", blocks: [video] },
      { id: "les_quiz", blocks: [{ id: "blk_quiz", type: "quiz", quizId: "quiz_p" }] },
    ],
    [
      { id: "les_assign", blocks: [{ id: "blk_asg", type: "assignment", assignmentId: "asg_p" }] },
      { id: "les_code", blocks: [{ id: "blk_ex", type: "exercise", exerciseId: "ex_p" }] },
    ],
  ],
  { course: { id: "crs_progress", title: "Progress 101", enableCertification: true } },
);
const lesson = (id: string) => tree.lessons.find((l) => l.id === id)!;

function watch(completed: boolean): VideoWatch {
  return { id: "vw_1", userId: learner.id, courseId: tree.course.id, lessonId: "les_video", blockId: "blk_video", source: video.type === "video" ? video.src : "", watchSeconds: 90, lastPositionSeconds: 90, maxPositionSeconds: 90, durationSeconds: 100, completed, updatedAt: FIXED_NOW };
}

async function setup(extra: Parameters<typeof resetDb>[0] = {}) {
  await resetDb({
    users: [learner],
    courses: [tree.course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
    ...extra,
    settings: { email: { enabled: false }, gamification: { enabled: false }, learning: { lessonDwellTimeSeconds: 30 }, ...(extra.settings ?? {}) },
  });
}

describe("completion requirements (store)", () => {
  beforeEach(() => setup());

  it("requires the dwell time on reading lessons", async () => {
    const short = await getCompletionRequirements(learner, lesson("les_read"), 10);
    assert.equal(short.allMet, false);
    assert.deepEqual(short.missing, ["Spend at least 30 seconds on the lesson"]);
    assert.equal((await getCompletionRequirements(learner, lesson("les_read"), 30)).allMet, true);
  });

  it("requires the video to be watched when enforced", async () => {
    const missing = await getCompletionRequirements(learner, lesson("les_video"), 0);
    assert.deepEqual(missing.missing, ["Watch at least 90% of the video"]);
    await setup({ videoWatches: [watch(true)] });
    assert.equal((await getCompletionRequirements(learner, lesson("les_video"), 0)).allMet, true);
    await setup({ videoWatches: [watch(false)], settings: { learning: { enforceVideoCompletion: false } } });
    assert.equal((await getCompletionRequirements(learner, lesson("les_video"), 0)).allMet, true);
  });

  it("requires a passed quiz, a submitted assignment and a passed exercise", async () => {
    assert.deepEqual((await getCompletionRequirements(learner, lesson("les_quiz"), 0)).missing, ["Pass the quiz"]);
    await setup({ quizSubmissions: [makeQuizSubmission({ quizId: "quiz_p", userId: learner.id, passed: false })] });
    assert.equal((await getCompletionRequirements(learner, lesson("les_quiz"), 0)).quizPassed, false);
    await setup({ quizSubmissions: [makeQuizSubmission({ quizId: "quiz_p", userId: learner.id, passed: true })] });
    assert.equal((await getCompletionRequirements(learner, lesson("les_quiz"), 0)).allMet, true);

    assert.ok((await getCompletionRequirements(learner, lesson("les_assign"), 60)).missing.includes("Submit the assignment"));
    assert.ok((await getCompletionRequirements(learner, lesson("les_code"), 60)).missing.includes("Pass all test cases in the exercise"));
  });
});

describe("lesson status and course progress (store)", () => {
  beforeEach(() => setup());

  it("marks partial progress when requirements are missing", async () => {
    const result = await completeLesson(learner, lesson("les_read"), 5);
    assert.equal(result.completed, false);
    const row = (await getDb()).progress.find((p) => p.lessonId === "les_read");
    assert.equal(row?.status, "partial");
    assert.equal((await getDb()).enrollments[0]!.currentLessonId, "les_read");
  });

  it("completes lessons, never downgrades them and updates the course percentage", async () => {
    assert.equal((await completeLesson(learner, lesson("les_read"), 45)).completed, true);
    assert.equal(await setLessonStatus(learner, lesson("les_read"), "partial"), "complete");
    const progress = await getCourseProgress(learner.id, tree.course.id);
    assert.deepEqual([progress.completedLessons, progress.totalLessons, progress.percent, progress.completed], [1, 5, 20, false]);
    assert.equal((await getDb()).enrollments[0]!.progress, 20);
  });

  it("finishing the course completes the enrollment once and issues one certificate", async () => {
    for (const l of tree.lessons) await setLessonStatus(learner, l, "complete");
    const db = await getDb();
    const enrollment = db.enrollments[0]!;
    assert.equal(enrollment.progress, 100);
    assert.ok(enrollment.completedAt);
    assert.equal(db.certificates.filter((c) => c.userId === learner.id).length, 1);
    assert.ok(db.notifications.some((n) => n.subject === "You completed Progress 101!"));
    assert.equal(await recalculateCourseProgress(learner, tree.course.id), 100);
    assert.equal((await getDb()).notifications.filter((n) => n.subject === "You completed Progress 101!").length, 1);
    const again = await issueCertificate(learner, tree.course);
    assert.equal((await getDb()).certificates.length, 1);
    assert.match(again.code, /^LL-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });
});
