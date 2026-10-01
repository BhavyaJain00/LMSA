import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, LessonBlock, ProgrammingExercise, Transcript } from "@/lib/types";
import { copyCourseGraph, copyTitle, countGraph, uniqueCopyTitle, COURSE_TITLE_MAX, type CourseGraph } from "@/lib/teaching/course-copy";
import { duplicateCourseAction, getDuplicatePreviewAction } from "@/lib/actions/course-tools";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makeQuestion, makeQuiz, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

function assignment(id: string, courseId: string): Assignment {
  return {
    id,
    title: "Essay",
    question: "Write it",
    type: "text",
    courseId,
    enableScheduling: true,
    scheduleStart: FIXED_NOW,
    authorId: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    peerReview: { enabled: true, reviewsPerSubmission: 2, excluded: [["a", "b"]] } as unknown as Assignment["peerReview"],
  } as Assignment;
}

function exercise(id: string, courseId: string): ProgrammingExercise {
  return {
    id,
    title: "Sum",
    problemStatement: "Add",
    language: "python",
    courseId,
    testCases: [{ id: "tc_1", input: "1 2", expectedOutput: "3" }],
    authorId: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  } as ProgrammingExercise;
}

/** A course whose lessons use a quiz (block + in-video marker), an assignment, an exercise and a transcript. */
function buildGraph(): CourseGraph {
  const question = makeQuestion({ id: "qst_1" });
  const quiz = makeQuiz({ id: "quiz_1", questions: [{ questionId: "qst_1", marks: 1 }], enableScheduling: true, scheduleStart: FIXED_NOW });
  const blocks: LessonBlock[] = [
    { id: "blk_md", type: "markdown", content: "Hello" },
    { id: "blk_vid", type: "video", src: "/uploads/v.mp4", hlsUrl: "/hls/x/master.m3u8", transcriptId: "trn_1", quizMarkers: [{ quizId: "quiz_1", time: 10 }] } as LessonBlock,
    { id: "blk_quiz", type: "quiz", quizId: "quiz_1" },
    { id: "blk_asg", type: "assignment", assignmentId: "asg_1" },
    { id: "blk_ex", type: "exercise", exerciseId: "ex_1" },
  ];
  const tree = makeCourseTree([[{ id: "les_1", blocks, publishAt: "2030-01-01T00:00:00.000Z" }, { id: "les_2" }], [{ id: "les_3" }]], {
    course: { id: "crs_src", slug: "intro", title: "Intro", published: true, featured: true, publishedOn: "2026-01-01", salesPage: { countdownEndsAt: FIXED_NOW } as never },
  });
  const transcript = { id: "trn_1", lessonId: "les_1", blockId: "blk_vid", status: "ready", cues: [], createdAt: FIXED_NOW, updatedAt: FIXED_NOW } as unknown as Transcript;
  return {
    course: tree.course,
    chapters: tree.chapters,
    lessons: tree.lessons,
    quizzes: [{ ...quiz, lessonId: "les_1", courseId: tree.course.id }],
    questions: [question],
    assignments: [assignment("asg_1", tree.course.id)],
    exercises: [exercise("ex_1", tree.course.id)],
    transcripts: [transcript],
  };
}

describe("teaching-tools course copy: titles", () => {
  it("prefixes and numbers copy titles without exceeding the limit", () => {
    assert.equal(copyTitle("  Intro "), "Copy of Intro");
    assert.equal(uniqueCopyTitle("Intro", ["Intro"]), "Copy of Intro");
    assert.equal(uniqueCopyTitle("Intro", ["copy of intro", "Copy of Intro (2)"]), "Copy of Intro (3)");
    const long = "x".repeat(200);
    assert.ok(copyTitle(long).length <= COURSE_TITLE_MAX);
    assert.ok(uniqueCopyTitle(long, [copyTitle(long)]).length <= COURSE_TITLE_MAX);
    assert.ok(uniqueCopyTitle(long, [copyTitle(long)]).endsWith(" (2)"));
  });
});

describe("teaching-tools course copy: id remapping", () => {
  const source = buildGraph();
  const snapshot = JSON.stringify(source);
  const copy = copyCourseGraph(source, { actorId: "usr_me", now: "2026-10-01T00:00:00.000Z", takenSlugs: ["intro", "intro-copy"] });

  it("never reuses an id of the original and leaves the original untouched", () => {
    assert.equal(JSON.stringify(source), snapshot);
    const oldIds = new Set([source.course.id, ...source.chapters.map((c) => c.id), ...source.lessons.map((l) => l.id), ...source.lessons.flatMap((l) => l.blocks.map((b) => b.id)), "quiz_1", "qst_1", "asg_1", "ex_1", "trn_1"]);
    const newIds = [copy.course.id, ...copy.chapters.map((c) => c.id), ...copy.lessons.map((l) => l.id), ...copy.lessons.flatMap((l) => l.blocks.map((b) => b.id)), ...copy.quizzes.map((q) => q.id), ...copy.questions.map((q) => q.id), ...copy.assignments.map((a) => a.id), ...copy.exercises.map((e) => e.id), ...copy.transcripts.map((t) => t.id)];
    for (const id of newIds) assert.equal(oldIds.has(id), false, `${id} was reused`);
    assert.equal(new Set(newIds).size, newIds.length);
  });

  it("points every reference at the copies", () => {
    const lesson = copy.lessons.find((l) => l.id === copy.idMap.lessons.get("les_1"))!;
    assert.equal(lesson.courseId, copy.course.id);
    assert.equal(lesson.chapterId, copy.idMap.chapters.get(source.lessons[0]!.chapterId));
    const byType = new Map(lesson.blocks.map((b) => [b.type, b]));
    const quizId = copy.idMap.quizzes.get("quiz_1")!;
    assert.equal((byType.get("quiz") as { quizId: string }).quizId, quizId);
    assert.equal((byType.get("assignment") as { assignmentId: string }).assignmentId, copy.idMap.assignments.get("asg_1"));
    assert.equal((byType.get("exercise") as { exerciseId: string }).exerciseId, copy.idMap.exercises.get("ex_1"));
    const video = byType.get("video") as Extract<LessonBlock, { type: "video" }>;
    assert.equal(video.quizMarkers![0]!.quizId, quizId);
    assert.equal(video.transcriptId, copy.idMap.transcripts.get("trn_1"));
    assert.equal(video.hlsUrl, undefined, "converted streams belong to the original");
    const quiz = copy.quizzes[0]!;
    assert.equal(quiz.courseId, copy.course.id);
    assert.equal(quiz.lessonId, lesson.id);
    assert.equal(quiz.questions[0]!.questionId, copy.idMap.questions.get("qst_1"));
    assert.equal(copy.transcripts[0]!.blockId, video.id);
    assert.equal(copy.transcripts[0]!.lessonId, lesson.id);
    assert.notEqual(copy.exercises[0]!.testCases[0]!.id, "tc_1");
  });

  it("starts the copy as an unpublished draft with a unique slug and no one-off schedules", () => {
    assert.equal(copy.course.title, "Copy of Intro");
    assert.equal(copy.course.slug, "intro-copy-2");
    assert.equal(copy.course.published, false);
    assert.equal(copy.course.featured, false);
    assert.equal(copy.course.status, "in_progress");
    assert.equal(copy.course.createdById, "usr_me");
    assert.equal(copy.course.publishedOn, undefined);
    assert.equal(copy.course.salesPage?.countdownEndsAt, undefined);
    assert.ok(copy.lessons.every((l) => l.publishAt === undefined));
    assert.equal(copy.quizzes[0]!.enableScheduling, false);
    assert.equal(copy.assignments[0]!.enableScheduling, false);
    assert.equal((copy.assignments[0]!.peerReview as { excluded?: unknown }).excluded, undefined);
    assert.equal(copy.assignments[0]!.authorId, "usr_me");
  });

  it("counts what it copies", () => {
    assert.deepEqual(countGraph(source), { chapters: 2, lessons: 3, blocks: 7, quizzes: 1, questions: 1, assignments: 1, exercises: 1, transcripts: 1 });
  });
});

describe("teaching-tools course copy: duplicateCourseAction", () => {
  const graph = buildGraph();
  const owner = makeUser({ id: "usr_owner", roles: ["student", "course_creator"] });
  const other = makeUser({ id: "usr_other", roles: ["student", "course_creator"] });
  const learner = makeUser({ id: "usr_learner" });

  async function signIn(userId: string) {
    resetRequest();
    await createSession(userId);
  }

  beforeEach(async () => {
    await resetDb({
      users: [owner, other, learner],
      courses: [{ ...graph.course, instructorIds: [owner.id], createdById: owner.id }],
      chapters: graph.chapters,
      lessons: graph.lessons,
      quizzes: graph.quizzes,
      questions: graph.questions,
      assignments: graph.assignments,
      exercises: graph.exercises,
      transcripts: graph.transcripts,
      enrollments: [makeEnrollment({ userId: learner.id, courseId: graph.course.id })],
      settings: { email: { enabled: false } },
    });
  });

  it("copies the course for its instructor, without learners, and audits it", async () => {
    await signIn(owner.id);
    const preview = await getDuplicatePreviewAction(graph.course.id);
    assert.ok(preview.ok);
    assert.equal(preview.data.suggestedTitle, "Copy of Intro");
    assert.equal(preview.data.enrollments, 1);

    const res = await duplicateCourseAction(graph.course.id);
    assert.ok(res.ok, res.ok ? "" : res.error);
    const db = await getDb();
    const created = db.courses.find((c) => c.id === res.data.id)!;
    assert.equal(created.published, false);
    assert.equal(created.slug, "intro-copy");
    assert.equal(db.lessons.filter((l) => l.courseId === created.id).length, 3);
    assert.equal(db.quizzes.filter((q) => q.courseId === created.id).length, 1);
    assert.equal(db.enrollments.filter((e) => e.courseId === created.id).length, 0);
    assert.ok(db.auditEvents.some((a) => a.action === "course.duplicate" && a.targetId === created.id));

    const again = await duplicateCourseAction(graph.course.id);
    assert.ok(again.ok);
    const second = (await getDb()).courses.find((c) => c.id === again.data.id)!;
    assert.equal(second.title, "Copy of Intro (2)");
    assert.equal(second.slug, "intro-copy-2");
  });

  it("uses a custom title and rejects other instructors and learners", async () => {
    await signIn(owner.id);
    const res = await duplicateCourseAction(graph.course.id, { title: "  Intro   2027 " });
    assert.ok(res.ok);
    assert.equal((await getDb()).courses.find((c) => c.id === res.data.id)!.title, "Intro 2027");

    await signIn(other.id);
    assert.equal((await duplicateCourseAction(graph.course.id)).ok, false);
    await signIn(learner.id);
    assert.equal((await duplicateCourseAction(graph.course.id)).ok, false);
    assert.equal((await getDb()).courses.length, 2);
  });
});
