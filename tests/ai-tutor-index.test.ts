import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Course, Lesson } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { courseIndexStats, fitExcerpts, getCourseIndex, readableLessonIds, retrieveExcerpts, sourcesHash } from "@/lib/ai/course-index";
import { collectCourseSources, type CourseChunk } from "@/lib/ai/sources";
import { makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";

const learner = makeUser({ id: "usr_ai_learner" });
const instructor = makeUser({ id: "usr_ai_teacher", roles: ["student", "course_creator"] });

let course: Course;
let lessons: Lesson[];

beforeEach(async () => {
  const tree = makeCourseTree(
    [
      [
        { title: "Closures", blocks: [{ id: "m1", type: "markdown", content: "A closure remembers the variables of its outer scope." }] },
        { title: "Promises", blocks: [{ id: "m2", type: "markdown", content: "A promise settles later; use await to read its value." }] },
      ],
      [{ title: "Generators", availableFrom: "2099-01-01", blocks: [{ id: "m3", type: "markdown", content: "Generators yield values lazily with the yield keyword." }] }],
    ],
    { course: { title: "Async JavaScript", instructorIds: [instructor.id] } },
  );
  course = tree.course;
  lessons = tree.lessons;
  await resetDb({
    users: [learner, instructor],
    courses: [course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: [makeEnrollment({ userId: learner.id, courseId: course.id })],
  });
});

describe("ai tutor course index cache", () => {
  it("reuses the index until the content hash changes", async () => {
    const first = getCourseIndex(await getDb(), course.id);
    const again = getCourseIndex(await getDb(), course.id);
    assert.equal(again, first, "unchanged content must hit the cache");

    await mutate((db) => {
      const lesson = db.lessons.find((l) => l.id === lessons[0]!.id)!;
      lesson.blocks = [{ id: "m1", type: "markdown", content: "A closure keeps a live reference to outer variables." }];
    });
    const rebuilt = getCourseIndex(await getDb(), course.id);
    assert.notEqual(rebuilt.hash, first.hash);
    assert.ok(rebuilt.index.docs.some((d) => d.text.includes("live reference")));
  });

  it("changes the hash for transcript cue edits and outline renames", async () => {
    const db = await getDb();
    const base = sourcesHash(collectCourseSources(db, course.id));
    const renamed = structuredClone(db);
    renamed.lessons[1]!.title = "Promises and async/await";
    assert.notEqual(sourcesHash(collectCourseSources(renamed, course.id)), base);

    const withVideo = structuredClone(db);
    withVideo.lessons[0]!.blocks.push({ id: "v1", type: "video", src: "/v.mp4", transcriptId: "t1" });
    withVideo.transcripts.push({
      id: "t1",
      lessonId: lessons[0]!.id,
      blockId: "v1",
      language: "en",
      cues: [{ start: 1, end: 2, text: "hello" }],
      source: "upload",
      status: "ready",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const h1 = sourcesHash(collectCourseSources(withVideo, course.id));
    withVideo.transcripts[0]!.cues[0]!.start = 3;
    assert.notEqual(sourcesHash(collectCourseSources(withVideo, course.id)), h1, "cue timing is part of the hash");
  });

  it("reports index statistics", async () => {
    const stats = courseIndexStats(await getDb(), course.id);
    assert.equal(stats.lessons, 3);
    assert.ok(stats.chunks >= 4);
    assert.equal(stats.transcripts, 0);
  });
});

describe("ai tutor retrieval", () => {
  it("hides locked lessons from learners but not from course staff", async () => {
    const db = await getDb();
    const readable = readableLessonIds(db, course, learner)!;
    assert.ok(readable.has(lessons[0]!.id));
    assert.ok(!readable.has(lessons[2]!.id), "drip-locked lesson must not be readable");
    assert.equal(readableLessonIds(db, course, instructor), null);

    const forLearner = retrieveExcerpts(db, course, learner, "generators yield keyword");
    assert.ok(!forLearner.some((e) => e.chunk.lessonId === lessons[2]!.id), "locked content leaked to the learner");
    const forStaff = retrieveExcerpts(db, course, instructor, "generators yield keyword");
    assert.equal(forStaff[0]!.chunk.lessonId, lessons[2]!.id);
  });

  it("labels excerpts and ignores a locked current lesson", async () => {
    const db = await getDb();
    const hits = retrieveExcerpts(db, course, learner, "what does a closure remember", { currentLessonId: lessons[0]!.id });
    assert.equal(hits[0]!.chunk.lessonId, lessons[0]!.id);
    assert.equal(hits[0]!.label, 'Lesson "Closures"');

    const summary = retrieveExcerpts(db, course, learner, "summarize this lesson", { currentLessonId: lessons[2]!.id });
    assert.ok(!summary.some((e) => e.chunk.lessonId === lessons[2]!.id));
    const own = retrieveExcerpts(db, course, learner, "summarize this lesson", { currentLessonId: lessons[1]!.id });
    assert.ok(own.some((e) => e.chunk.lessonId === lessons[1]!.id), "summary requests use the lesson on screen");
  });
});

describe("ai tutor fitExcerpts", () => {
  const chunk = (id: string, words: number): CourseChunk => ({
    id,
    lessonId: "L",
    lessonTitle: "Lesson",
    title: "Lesson",
    kind: "lesson",
    text: Array.from({ length: words }, (_, i) => `word${i}.`).join(" "),
    order: 0,
  });

  it("keeps excerpts within the token budget and drops tiny leftovers", () => {
    const hits = [chunk("a", 400), chunk("b", 400), chunk("c", 400)].map((doc, i) => ({ doc, score: 3 - i }));
    const out = fitExcerpts(hits, 1200);
    const total = out.reduce((s, e) => s + Math.ceil(e.text.length / 4), 0);
    assert.ok(total <= 1200 + 10);
    assert.ok(out.length >= 2);
    assert.ok(out.at(-1)!.text.length <= hits[out.length - 1]!.doc.text.length);
    assert.equal(fitExcerpts(hits, 100).length, 0, "budgets under 120 tokens send nothing");
  });
});
