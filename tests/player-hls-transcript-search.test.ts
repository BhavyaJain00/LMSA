import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Lesson, LessonBlock, Transcript, TranscriptCue, User } from "@/lib/types";
import { foldText } from "@/lib/transcripts/cues";
import { isTranscriptVisible, readTranscriptFor } from "@/lib/transcripts/data";
import { findTranscriptHits, normalizeQuery, rankTranscriptHits, searchTranscripts } from "@/lib/transcripts/search";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";

const fold = (lines: string[]) => lines.map((l) => foldText(l));

describe("player-hls: transcript search — matching", () => {
  it("normalizes the query and rejects ones that are too short", () => {
    assert.equal(normalizeQuery("  Loop   Variable "), "loop variable");
    assert.equal(normalizeQuery("CAFÉ"), "cafe");
    assert.equal(normalizeQuery("a"), null);
    assert.equal(normalizeQuery("   "), null);
    assert.equal(normalizeQuery("x".repeat(500))!.length, 100);
  });

  it("finds a phrase that runs from one caption into the next", () => {
    const folded = fold(["so we declare the loop", "variable before the body", "and the loop variable again", "done"]);
    assert.deepEqual(findTranscriptHits(folded, "loop variable"), [
      { index: 0, spans: true },
      { index: 2, spans: false },
    ]);
    assert.deepEqual(findTranscriptHits(folded, "loop"), [
      { index: 0, spans: false },
      { index: 2, spans: false },
    ]);
  });

  it("does not count a phrase twice when the next caption holds it entirely", () => {
    const folded = fold(["first we talk", "about the loop variable", "at length"]);
    assert.deepEqual(findTranscriptHits(folded, "loop variable"), [{ index: 1, spans: false }]);
    assert.deepEqual(findTranscriptHits(fold(["the loop", ""]), "loop variable"), []);
    assert.deepEqual(findTranscriptHits(fold(["variable loop", "variable"]), "loop variable"), [{ index: 0, spans: true }]);
  });

  it("ranks transcripts by matching lines and keeps the first hits of each", () => {
    const ranked = rankTranscriptHits(
      [
        { key: "one", folded: fold(["a loop", "nothing", "nothing"]) },
        { key: "many", folded: fold(["loop", "loop", "loop", "loop"]) },
        { key: "none", folded: fold(["nothing here"]) },
        { key: "two", folded: fold(["loop", "x", "LOOP".toLowerCase()]) },
      ],
      "Loop",
      { matchesPerLesson: 2 },
    );
    assert.deepEqual(
      ranked.map((r) => [r.key, r.total, r.hits.map((h) => h.index)]),
      [
        ["many", 4, [0, 1]],
        ["two", 2, [0, 2]],
        ["one", 1, [0]],
      ],
    );
    assert.equal(rankTranscriptHits([{ key: "one", folded: fold(["a loop"]) }], "l", { matchesPerLesson: 3 }).length, 0);
    assert.equal(rankTranscriptHits(ranked.map((r) => ({ key: r.key, folded: fold(["loop"]) })), "loop", { matchesPerLesson: 1, limit: 2 }).length, 2);
  });
});

/* ------------------------------------------------------------------ */
/* Access-aware search over the real store                              */
/* ------------------------------------------------------------------ */

const cue = (start: number, text: string): TranscriptCue => ({ start, end: start + 4, text });

function transcriptOf(lesson: Lesson, blockId: string, cues: TranscriptCue[], overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: `trn_${blockId}`,
    lessonId: lesson.id,
    blockId,
    language: "en",
    cues,
    source: "manual",
    status: "ready",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

const video = (id: string, transcript = true): LessonBlock => ({ id, type: "video", src: `/uploads/videos/${id}.mp4`, ...(transcript ? { transcriptId: `trn_${id}` } : {}) });

const instructor = makeUser({ id: "usr_ts_instructor", roles: ["course_creator"] });
const moderator = makeUser({ id: "usr_ts_moderator", roles: ["moderator"] });
const learner = makeUser({ id: "usr_ts_learner" });
const visitor = makeUser({ id: "usr_ts_visitor" });
const member = makeUser({ id: "usr_ts_member" });

const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

/** A published course: a free preview, an ordinary lesson with two videos, a lesson scheduled for later. */
const main = makeCourseTree(
  [
    [
      { id: "les_ts_preview", title: "Preview", includeInPreview: true, blocks: [video("blk_ts_preview")] },
      { id: "les_ts_open", title: "Loops", blocks: [video("blk_ts_first"), video("blk_ts_second")] },
    ],
    [{ id: "les_ts_later", title: "Later", availableFrom: future, blocks: [video("blk_ts_later")] }],
  ],
  { course: { id: "crs_ts_main", slug: "ts-main", title: "Python basics", instructorIds: [instructor.id] } },
);
/** A draft course only its managers can open. */
const draft = makeCourseTree([[{ id: "les_ts_draft", title: "Draft", includeInPreview: true, blocks: [video("blk_ts_draft")] }]], {
  course: { id: "crs_ts_draft", slug: "ts-draft", title: "Unreleased", published: false },
});
/** A paid course the member joined through a membership that is no longer running. */
const paid = makeCourseTree([[{ id: "les_ts_paid", title: "Paid lesson", blocks: [video("blk_ts_paid")] }]], {
  course: { id: "crs_ts_paid", slug: "ts-paid", title: "Members only", paidCourse: true, price: 4900 },
});
const planOrder = makePayment({ id: "pay_ts_plan", userId: member.id, itemId: "plan_ts", itemType: "plan", status: "paid" });

const lessonById = (id: string) => [...main.lessons, ...draft.lessons, ...paid.lessons].find((l) => l.id === id)!;

const transcripts: Transcript[] = [
  transcriptOf(lessonById("les_ts_preview"), "blk_ts_preview", [cue(0, "Welcome to the course"), cue(12, "A loop repeats work")]),
  transcriptOf(lessonById("les_ts_open"), "blk_ts_first", [cue(0, "The loop variable"), cue(30, "Every loop needs an exit"), cue(95.6, "A nested loop")]),
  transcriptOf(lessonById("les_ts_open"), "blk_ts_second", [cue(8, "Here we declare the loop"), cue(12, "variable before the body")]),
  transcriptOf(lessonById("les_ts_later"), "blk_ts_later", [cue(3, "This loop is scheduled for later")]),
  transcriptOf(lessonById("les_ts_draft"), "blk_ts_draft", [cue(1, "A loop nobody has seen yet")]),
  transcriptOf(lessonById("les_ts_paid"), "blk_ts_paid", [cue(2, "The members only loop")]),
  // Left behind by a replaced video: the block points at another transcript.
  transcriptOf(lessonById("les_ts_open"), "blk_ts_first", [cue(0, "loop loop loop from the old video")], { id: "trn_orphan" }),
];

async function seed(extra: { transcripts?: Transcript[]; allowGuestAccess?: boolean } = {}) {
  await resetDb({
    users: [instructor, moderator, learner, visitor, member],
    courses: [main.course, draft.course, paid.course],
    chapters: [...main.chapters, ...draft.chapters, ...paid.chapters],
    lessons: [...main.lessons, ...draft.lessons, ...paid.lessons],
    enrollments: [
      makeEnrollment({ userId: learner.id, courseId: main.course.id }),
      makeEnrollment({ userId: member.id, courseId: paid.course.id, paymentId: planOrder.id }),
    ],
    payments: [planOrder],
    transcripts: extra.transcripts ?? transcripts,
    settings: { learning: { allowGuestAccess: extra.allowGuestAccess ?? true } },
  });
}

const lessonIds = async (viewer: User | null, query = "loop", opts = {}) => (await searchTranscripts(query, viewer, opts)).map((r) => `${r.lessonId}/${r.blockId}`);

describe("player-hls: transcript search — access", () => {
  beforeEach(() => seed());

  it("shows guests and visitors free previews only", async () => {
    assert.deepEqual(await lessonIds(null), ["les_ts_preview/blk_ts_preview"]);
    assert.deepEqual(await lessonIds(visitor), ["les_ts_preview/blk_ts_preview"]);
  });

  it("shows nothing to guests when guest access is off", async () => {
    await seed({ allowGuestAccess: false });
    assert.deepEqual(await lessonIds(null), []);
    assert.deepEqual(await lessonIds(learner), ["les_ts_open/blk_ts_first", "les_ts_preview/blk_ts_preview", "les_ts_open/blk_ts_second"]);
  });

  it("shows enrolled learners their open lessons, best match first, never a scheduled one", async () => {
    const results = await searchTranscripts("loop", learner);
    assert.deepEqual(
      results.map((r) => [r.lessonId, r.blockId, r.totalMatches]),
      [
        ["les_ts_open", "blk_ts_first", 3],
        ["les_ts_preview", "blk_ts_preview", 1],
        ["les_ts_open", "blk_ts_second", 1],
      ],
    );
    assert.ok(results.every((r) => r.courseId === main.course.id && r.courseTitle === "Python basics"));
    assert.equal(results[0]!.lessonTitle, "Loops");
  });

  it("never returns a transcript the block no longer points at, a failed one or an empty one", async () => {
    const results = await searchTranscripts("old video", moderator);
    assert.deepEqual(results, []);
    const failed = transcripts.map((t) => (t.id === "trn_blk_ts_preview" ? { ...t, status: "failed" as const } : t.id === "trn_blk_ts_second" ? { ...t, cues: [] } : t));
    await seed({ transcripts: failed });
    assert.deepEqual(await lessonIds(learner), ["les_ts_open/blk_ts_first"]);
  });

  it("lets course managers search scheduled lessons, and moderators drafts too", async () => {
    assert.deepEqual((await lessonIds(instructor)).sort(), ["les_ts_later/blk_ts_later", "les_ts_open/blk_ts_first", "les_ts_open/blk_ts_second", "les_ts_preview/blk_ts_preview"]);
    const all = await lessonIds(moderator);
    assert.ok(all.includes("les_ts_draft/blk_ts_draft"));
    assert.ok(all.includes("les_ts_paid/blk_ts_paid"));
    assert.equal(all.length, 6);
    assert.deepEqual(await lessonIds(moderator, "loop", { courseId: draft.course.id }), ["les_ts_draft/blk_ts_draft"]);
  });

  it("hides a membership course once the membership stopped, exactly like the lesson page", async () => {
    assert.deepEqual(await lessonIds(member, "members only"), []);
    const read = await readTranscriptFor(member, "les_ts_paid", "blk_ts_paid");
    assert.equal(read.ok, false, "the transcript API refuses the same lesson");
  });

  it("links every match to its timestamp, naming the video when it is not the lesson's first", async () => {
    const results = await searchTranscripts("loop", learner, { matchesPerLesson: 2 });
    const first = results.find((r) => r.blockId === "blk_ts_first")!;
    assert.equal(first.href, "/courses/ts-main/learn/1-2?t=0");
    assert.deepEqual(
      first.matches.map((m) => [m.start, m.href]),
      [
        [0, "/courses/ts-main/learn/1-2?t=0"],
        [30, "/courses/ts-main/learn/1-2?t=30"],
      ],
    );
    assert.equal(first.totalMatches, 3, "the total counts lines beyond the ones returned");
    const second = results.find((r) => r.blockId === "blk_ts_second")!;
    assert.equal(second.href, "/courses/ts-main/learn/1-2?t=8&block=blk_ts_second");
  });

  it("returns highlighted excerpts, including a phrase split across two captions", async () => {
    const [hit] = await searchTranscripts("Loop Variable", learner, { courseId: main.course.id, matchesPerLesson: 5 });
    assert.equal(hit!.blockId, "blk_ts_first");
    const spanning = (await searchTranscripts("loop variable", learner)).find((r) => r.blockId === "blk_ts_second")!;
    assert.equal(spanning.matches.length, 1);
    const match = spanning.matches[0]!;
    assert.equal(match.start, 8, "the match starts in the first of the two captions");
    assert.equal(match.ranges.length, 1);
    const [from, to] = match.ranges[0]!;
    assert.equal(match.snippet.slice(from, to), "loop variable");
  });

  it("applies the limits and ignores queries that are too short", async () => {
    assert.equal((await searchTranscripts("loop", moderator, { limit: 2 })).length, 2);
    assert.equal((await searchTranscripts("loop", moderator, { limit: 0 })).length, 1, "limits are clamped to at least one");
    assert.deepEqual(await searchTranscripts("l", moderator), []);
    assert.deepEqual(await searchTranscripts("", moderator), []);
    assert.deepEqual(await searchTranscripts("zebra", moderator), []);
  });
});

describe("player-hls: transcript access for the panel", () => {
  beforeEach(() => seed());

  it("follows the video's own rule: previews for everyone, the rest for enrolled learners and managers", async () => {
    assert.equal((await readTranscriptFor(null, "les_ts_preview", "blk_ts_preview")).ok, true);
    const guest = await readTranscriptFor(null, "les_ts_open", "blk_ts_first");
    assert.deepEqual([guest.ok, !guest.ok && guest.status], [false, 401]);
    const outsider = await readTranscriptFor(visitor, "les_ts_open", "blk_ts_first");
    assert.deepEqual([outsider.ok, !outsider.ok && outsider.status], [false, 403]);
    const scheduled = await readTranscriptFor(learner, "les_ts_later", "blk_ts_later");
    assert.equal(scheduled.ok, false, "a scheduled lesson's transcript waits for its release");
    assert.equal((await readTranscriptFor(instructor, "les_ts_later", "blk_ts_later")).ok, true);

    const mine = await readTranscriptFor(learner, "les_ts_open", "blk_ts_first");
    assert.ok(mine.ok);
    assert.equal(mine.transcript?.id, "trn_blk_ts_first", "the transcript the block points at, not the orphan");
  });

  it("answers 404 for unknown lessons and blocks that are not videos", async () => {
    const missing = await readTranscriptFor(learner, "les_nope", "blk_ts_first");
    assert.deepEqual([missing.ok, !missing.ok && missing.status], [false, 404]);
    const wrongBlock = await readTranscriptFor(learner, "les_ts_open", "blk_nope");
    assert.deepEqual([wrongBlock.ok, !wrongBlock.ok && wrongBlock.status], [false, 404]);
  });

  it("shows learners only transcripts that have captions and did not fail", () => {
    const base = transcripts[0]!;
    assert.equal(isTranscriptVisible(base), true);
    assert.equal(isTranscriptVisible({ ...base, status: "processing" }), true, "a regeneration keeps the previous captions visible");
    assert.equal(isTranscriptVisible({ ...base, status: "failed" }), false);
    assert.equal(isTranscriptVisible({ ...base, cues: [] }), false);
    assert.equal(isTranscriptVisible(null), false);
  });
});
