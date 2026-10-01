import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LessonBlock, LessonVersion } from "@/lib/types";
import {
  CURRENT_VERSION_ID,
  VERSION_LIMITS,
  buildTimeline,
  describeChange,
  diffLessonContent,
  resolveTimelineState,
  sameContent,
  summarizeChange,
  versionsToPrune,
  type AssessmentNames,
} from "@/lib/teaching/version-shared";
import { collapseDiffRows, diffText, diffWords, diffLines, toDiffRows, type DiffRow } from "@/lib/teaching/text-diff";
import { saveLessonAction, renameLessonAction } from "@/lib/actions/lessons";
import { loadLessonHistoryAction, loadLessonVersionDiffAction, restoreLessonVersionAction, setLessonVersionNoteAction } from "@/lib/actions/versions";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { makeCourseTree, makeQuiz, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const md = (id: string, content: string): LessonBlock => ({ id, type: "markdown", content });
const NAMES: AssessmentNames = { quizzes: { quiz_a: "Basics" }, assignments: {}, exercises: {} };

function version(id: string, createdAt: string, blocks: LessonBlock[], extra: Partial<LessonVersion> = {}): LessonVersion {
  return { id, lessonId: "les_1", title: "Lesson", blocks, savedById: "usr_a", createdAt, ...extra };
}

describe("teaching-tools versions: comparing content", () => {
  it("treats key order, empty values and media-pipeline fields as no change", () => {
    const a: LessonBlock = { id: "v", type: "video", src: "/u/a.mp4", title: "Intro" };
    const b = { title: "Intro", src: "/u/a.mp4", type: "video", id: "v", hlsUrl: "/hls/v/master.m3u8", posterUrl: "" } as LessonBlock;
    assert.equal(sameContent({ title: "T", blocks: [a] }, { title: "T", blocks: [b], instructorNotes: "  " }), true);
    assert.equal(sameContent({ title: "T", blocks: [a] }, { title: "T", blocks: [{ ...a, title: "Outro" }] }), false);
    assert.equal(sameContent({ title: "T", blocks: [md("1", "x"), md("2", "y")] }, { title: "T", blocks: [md("2", "y"), md("1", "x")] }), false);
  });

  it("summarizes added, removed, edited and moved blocks", () => {
    // Blocks 2 and 3 keep their order (the LCS), 1 moves unchanged, 2 is edited, 4 goes and 5 arrives.
    const before = { title: "A", blocks: [md("1", "one"), md("2", "two"), md("3", "three"), md("4", "four")] };
    const after = { title: "B", blocks: [md("2", "two!"), md("3", "three"), md("1", "one"), md("5", "five")] };
    const summary = summarizeChange(before, after);
    assert.deepEqual(summary, { added: 1, removed: 1, changed: 1, moved: 1, title: true, notes: false });
    assert.equal(describeChange(summary), "1 block edited, 1 block added, 1 block removed, 1 block moved, title changed");
    assert.equal(describeChange(summarizeChange(before, before)), "No changes");
  });
});

describe("teaching-tools versions: retention", () => {
  it("keeps the newest 50 versions of a lesson", () => {
    const rows = Array.from({ length: 53 }, (_, i) => ({ id: `v${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), size: 10 }));
    assert.deepEqual(versionsToPrune(rows).sort(), ["v0", "v1", "v2"]);
    assert.equal(VERSION_LIMITS.perLesson, 50);
  });

  it("drops older versions over the size budget but always keeps the newest few", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, createdAt: `2026-01-0${i + 1}T00:00:00.000Z`, size: 100 }));
    const limits = { perLesson: 50, maxCharsPerLesson: 250, keepAlways: 4 };
    // Newest first: v5, v4 fit the budget; v3 and v2 pass it but are among the 4 always kept.
    assert.deepEqual(versionsToPrune(rows, limits).sort(), ["v0", "v1"]);
  });

  it("breaks timestamp ties by insertion order", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const rows = [
      { id: "first", createdAt: at, size: 1 },
      { id: "second", createdAt: at, size: 1 },
    ];
    assert.deepEqual(versionsToPrune(rows, { perLesson: 1, maxCharsPerLesson: 100, keepAlways: 1 }), ["first"]);
  });
});

describe("teaching-tools versions: timeline", () => {
  const lesson = { title: "Lesson", blocks: [md("1", "v3")], updatedAt: "2026-01-03T00:00:00.000Z" };
  const rows = [
    version("ver_b", "2026-01-02T00:00:00.000Z", [md("1", "v2")], { savedById: "usr_b", note: "Second pass" }),
    version("ver_a", "2026-01-01T00:00:00.000Z", [md("1", "v1")]),
  ];

  it("lists the live lesson first, each state described by the save that produced it", () => {
    const timeline = buildTimeline(lesson, rows);
    assert.deepEqual(
      timeline.map((e) => [e.id, e.metaId, e.savedById, e.note]),
      [
        [CURRENT_VERSION_ID, "ver_b", "usr_b", "Second pass"],
        ["ver_b", "ver_a", "usr_a", null],
        ["ver_a", null, null, null],
      ],
    );
    assert.equal(timeline[0]!.current, true);
    assert.equal(timeline[2]!.change, null);
    assert.equal(timeline[1]!.change!.changed, 1);
  });

  it("marks stored states equal to the live lesson", () => {
    const same = buildTimeline(lesson, [version("ver_x", "2026-01-01T00:00:00.000Z", [md("1", "v3")])]);
    assert.equal(same[1]!.sameAsCurrent, true);
  });

  it("resolves an entry and the state before it", () => {
    const resolved = resolveTimelineState(lesson, rows, "ver_b")!;
    assert.equal((resolved.content.blocks[0] as { content: string }).content, "v2");
    assert.equal((resolved.previous!.blocks[0] as { content: string }).content, "v1");
    assert.equal(resolveTimelineState(lesson, rows, "ver_a")!.previous, null);
    assert.equal(resolveTimelineState(lesson, rows, "missing"), null);
    assert.equal((resolveTimelineState(lesson, rows, CURRENT_VERSION_ID)!.content.blocks[0] as { content: string }).content, "v3");
  });
});

describe("teaching-tools versions: block-level diff", () => {
  it("gives text blocks a line diff and other blocks their changed settings", () => {
    const before = { title: "L", blocks: [md("1", "alpha\nbeta\ngamma"), { id: "q", type: "quiz", quizId: "quiz_a" } as LessonBlock, md("gone", "bye")] };
    const after = { title: "L", blocks: [md("1", "alpha\nBETA\ngamma"), { id: "q", type: "quiz", quizId: "quiz_deleted" } as LessonBlock, md("new", "hi")] };
    const diff = diffLessonContent(before, after, NAMES);
    assert.equal(diff.identical, false);
    const byId = new Map(diff.blocks.map((b) => [b.id, b]));
    const text = byId.get("1")!;
    assert.equal(text.status, "changed");
    assert.equal(text.text!.added, 1);
    assert.equal(text.text!.removed, 1);
    const quiz = byId.get("q")!;
    assert.deepEqual(quiz.fields, [{ label: "Quiz", before: "Basics", after: "Deleted quiz" }]);
    assert.equal(quiz.label, "Quiz");
    assert.equal(byId.get("gone")!.status, "removed");
    assert.equal(byId.get("new")!.status, "added");
    assert.equal(byId.get("new")!.afterPosition, 3);
  });

  it("reports identical content and notes changes", () => {
    const content = { title: "L", blocks: [md("1", "x")], instructorNotes: "old tip" };
    assert.equal(diffLessonContent(content, content, NAMES).identical, true);
    const notes = diffLessonContent(content, { ...content, instructorNotes: "new tip" }, NAMES);
    assert.equal(notes.summary.notes, true);
    assert.equal(notes.notes!.rows[0]!.kind, "change");
  });
});

describe("teaching-tools text diff: words and side-by-side rows", () => {
  it("highlights the changed words of a similar line", () => {
    const words = diffWords("the quick brown fox", "the quick red fox")!;
    assert.deepEqual(
      words.left.filter((s) => s.changed).map((s) => s.text),
      ["brown"],
    );
    assert.deepEqual(
      words.right.filter((s) => s.changed).map((s) => s.text),
      ["red"],
    );
    assert.equal(diffWords("completely different", "nothing shared here"), null);
  });

  it("pairs removed and added lines and keeps one-sided leftovers", () => {
    const rows = toDiffRows(diffLines("a\nb\nc", "a\nB\nX\nc").ops);
    assert.deepEqual(
      rows.map((r) => r.kind),
      ["equal", "change", "add", "equal"],
    );
    const change = rows[1] as Extract<DiffRow, { kind: "change" }>;
    assert.equal(change.left.line, 2);
    assert.equal(change.right.line, 2);
  });

  it("collapses long unchanged stretches but never hides a single line", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const changed = [...lines];
    changed[6] = "changed";
    const collapsed = collapseDiffRows(toDiffRows(diffLines(lines.join("\n"), changed.join("\n")).ops), 2);
    assert.deepEqual(
      collapsed.map((r) => (r.kind === "skip" ? `skip${r.count}` : r.kind)),
      ["skip4", "equal", "equal", "change", "equal", "equal", "skip3"],
    );
    const one = collapseDiffRows(toDiffRows(diffLines("a\nb\nc\nd", "a\nb\nc\nD").ops), 2);
    assert.deepEqual(
      one.map((r) => r.kind),
      ["equal", "equal", "equal", "change"],
    );
  });

  it("counts added and removed lines", () => {
    const diff = diffText("a\nb", "a\nc\nd");
    assert.equal(diff.added, 2);
    assert.equal(diff.removed, 1);
    assert.equal(diff.coarse, false);
  });
});

/* ------------------------------------------------------------------ */
/* Through the store and the server actions                            */
/* ------------------------------------------------------------------ */

const author = makeUser({ id: "usr_author", name: "Ada Author", roles: ["course_creator"] });
const outsider = makeUser({ id: "usr_outsider", roles: ["course_creator"] });
const tree = makeCourseTree([[{ id: "les_main", title: "Variables", blocks: [md("blk_1", "First draft")] }]], {
  course: { id: "crs_hist", instructorIds: [author.id], createdById: author.id, published: true },
});
const quiz = makeQuiz({ id: "quiz_keep", title: "Check", courseId: tree.course.id });

function saveForm(title: string, blocks: LessonBlock[], notes = ""): FormData {
  const data = new FormData();
  data.set("lessonId", "les_main");
  data.set("title", title);
  data.set("slug", "variables");
  data.set("instructorNotes", notes);
  data.set("blocks", JSON.stringify(blocks));
  return data;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

describe("teaching-tools versions: saving and restoring", () => {
  beforeEach(async () => {
    await resetDb({ users: [author, outsider], courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons, quizzes: [quiz], settings: { email: { enabled: false } } });
    await signIn(author.id);
  });

  it("snapshots the lesson before each save that changes it", async () => {
    assert.equal((await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Second draft")]))).ok, true);
    let db = await getDb();
    assert.equal(db.lessonVersions.length, 1);
    assert.equal((db.lessonVersions[0]!.blocks[0] as { content: string }).content, "First draft");
    assert.equal(db.lessonVersions[0]!.savedById, author.id);

    // Same content again: nothing new is kept.
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Second draft")]));
    db = await getDb();
    assert.equal(db.lessonVersions.length, 1);

    assert.equal((await renameLessonAction("les_main", "Variables and types")).ok, true);
    db = await getDb();
    assert.equal(db.lessonVersions.length, 2);
    assert.equal(db.lessonVersions[1]!.title, "Variables");
  });

  it("never keeps more than 50 versions of a lesson", async () => {
    for (let i = 0; i < 53; i++) await saveLessonAction(null, saveForm("Variables", [md("blk_1", `Draft ${i}`)]));
    const db = await getDb();
    assert.equal(db.lessonVersions.filter((v) => v.lessonId === "les_main").length, 50);
    const history = await loadLessonHistoryAction("les_main");
    assert.ok(history.ok);
    assert.equal(history.data.entries.length, 51);
  });

  it("restores a version after keeping the current content, and audits it", async () => {
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Second draft"), { id: "blk_q", type: "quiz", quizId: quiz.id }], "Tip"));
    await saveLessonAction(null, saveForm("Variables!", [md("blk_1", "Third draft")]));
    const history = await loadLessonHistoryAction("les_main");
    assert.ok(history.ok);
    const target = history.data.entries[1]!; // the state with the quiz block
    assert.equal(target.blockCount, 2);

    const diff = await loadLessonVersionDiffAction("les_main", target.id, "current");
    assert.ok(diff.ok && diff.data);
    assert.equal(diff.data.summary.title, true);

    const res = await restoreLessonVersionAction("les_main", target.id);
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(res.data.title, "Variables");
    assert.equal(res.data.blocks.length, 2);
    assert.equal(res.data.instructorNotes, "Tip");

    const db = await getDb();
    const lesson = db.lessons.find((l) => l.id === "les_main")!;
    assert.equal((lesson.blocks[0] as { content: string }).content, "Second draft");
    assert.equal(db.lessonVersions.length, 3);
    const kept = db.lessonVersions[2]!;
    assert.equal((kept.blocks[0] as { content: string }).content, "Third draft");
    assert.match(kept.note ?? "", /^Restored the version from /);
    assert.ok(db.auditEvents.some((e) => e.action === "lesson.version_restore" && e.targetId === "les_main"));

    // Restoring the same content again changes nothing.
    const again = await restoreLessonVersionAction("les_main", target.id);
    assert.equal(again.ok, false);
  });

  it("leaves out assessment blocks whose target was deleted", async () => {
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "With quiz"), { id: "blk_q", type: "quiz", quizId: quiz.id }]));
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Plain")]));
    const versionWithQuiz = (await getDb()).lessonVersions[1]!;
    const { mutate } = await import("@/lib/db/store");
    await mutate((db) => {
      db.quizzes = [];
    });
    const res = await restoreLessonVersionAction("les_main", versionWithQuiz.id);
    assert.ok(res.ok);
    assert.equal(res.data.skippedBlocks, 1);
    assert.deepEqual(
      res.data.blocks.map((b) => b.type),
      ["markdown"],
    );
  });

  it("labels versions with notes", async () => {
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Second draft")]));
    const versionId = (await getDb()).lessonVersions[0]!.id;
    const res = await setLessonVersionNoteAction("les_main", versionId, "  Before   the rewrite ");
    assert.ok(res.ok);
    assert.equal(res.data.note, "Before the rewrite");
    assert.equal((await getDb()).lessonVersions[0]!.note, "Before the rewrite");
    assert.equal((await setLessonVersionNoteAction("les_main", versionId, "")).ok, true);
    assert.equal((await getDb()).lessonVersions[0]!.note, undefined);
  });

  it("is only for people who can edit the lesson", async () => {
    await saveLessonAction(null, saveForm("Variables", [md("blk_1", "Second draft")]));
    const versionId = (await getDb()).lessonVersions[0]!.id;
    await signIn(outsider.id);
    assert.equal((await loadLessonHistoryAction("les_main")).ok, false);
    assert.equal((await restoreLessonVersionAction("les_main", versionId)).ok, false);
    assert.equal((await setLessonVersionNoteAction("les_main", versionId, "x")).ok, false);
  });
});
