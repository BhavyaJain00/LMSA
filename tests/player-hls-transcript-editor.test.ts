import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LIMIT,
  clampPage,
  closeSmallGaps,
  combineImported,
  commitCues,
  formatTimeInput,
  initHistory,
  insertCueAt,
  isConsecutive,
  issuesByCue,
  jobProgress,
  jobStageLabel,
  mergeRange,
  pageCount,
  pageOfPosition,
  parseOffsetInput,
  parseTimeInput,
  redoCues,
  removeCues,
  scaleCues,
  setCueText,
  setCueTimes,
  summarizeCues,
  undoCues,
  visibleCueIndices,
} from "@/lib/transcripts/editor-state";
import { MAX_CUES, cueIssues } from "@/lib/transcripts/cues";
import { cuesToTuples, languageLabel, LANGUAGE_PATTERN, MAX_SAVE_BYTES, savePayloadBytes } from "@/lib/transcripts/editor-shared";
import type { TranscriptCue } from "@/lib/types";

const CUES: TranscriptCue[] = [
  { start: 0, end: 2, text: "Hello and welcome" },
  { start: 2.3, end: 4, text: "to the lesson" },
  { start: 5, end: 8, text: "Let us begin" },
];

describe("history", () => {
  it("undoes and redoes cue changes", () => {
    let h = initHistory(CUES);
    h = commitCues(h, removeCues(CUES, [0]));
    h = commitCues(h, removeCues(h.present, [0]));
    assert.equal(h.present.length, 1);
    h = undoCues(h);
    assert.equal(h.present.length, 2);
    h = undoCues(h);
    assert.deepEqual(h.present, CUES);
    assert.equal(undoCues(h), h);
    h = redoCues(h);
    assert.equal(h.present.length, 2);
    h = commitCues(h, CUES);
    assert.equal(h.future.length, 0, "a new edit clears redo");
  });

  it("coalesces typing in one caption into one undo step", () => {
    let h = initHistory(CUES);
    h = commitCues(h, setCueText(h.present, 0, "H"), "text:0");
    h = commitCues(h, setCueText(h.present, 0, "Hi"), "text:0");
    h = commitCues(h, setCueText(h.present, 0, "Hi!"), "text:0");
    assert.equal(h.past.length, 1);
    h = commitCues(h, setCueText(h.present, 1, "x"), "text:1");
    assert.equal(h.past.length, 2);
    assert.deepEqual(undoCues(undoCues(h)).present, CUES);
  });

  it("ignores no-op commits and caps its length", () => {
    const h0 = initHistory(CUES);
    assert.equal(commitCues(h0, [...CUES]).past.length, 0);
    let h = h0;
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = commitCues(h, [{ start: i, end: i + 1, text: `v${i}` }]);
    assert.equal(h.past.length, HISTORY_LIMIT);
  });
});

describe("time inputs", () => {
  it("reads seconds and clock forms", () => {
    assert.equal(parseTimeInput("62"), 62);
    assert.equal(parseTimeInput("62,5"), 62.5);
    assert.equal(parseTimeInput("1:02.5"), 62.5);
    assert.equal(parseTimeInput("01:02:03,250"), 3723.25);
    assert.equal(parseTimeInput(" 0:01.123456 "), 1.123);
  });

  it("rejects junk, negatives and times past a day", () => {
    assert.equal(parseTimeInput(""), null);
    assert.equal(parseTimeInput("abc"), null);
    assert.equal(parseTimeInput("-1"), null);
    assert.equal(parseTimeInput("1:75"), null);
    assert.equal(parseTimeInput("100000"), null);
  });

  it("formats editor times and round-trips them", () => {
    assert.equal(formatTimeInput(62.5), "1:02.500");
    assert.equal(formatTimeInput(3723.25), "1:02:03.250");
    assert.equal(formatTimeInput(-3), "0:00.000");
    for (const t of [0, 1.001, 59.999, 61.5, 3599.999, 7322.042]) assert.equal(parseTimeInput(formatTimeInput(t)), t);
  });

  it("reads signed offsets", () => {
    assert.equal(parseOffsetInput("+1.5"), 1.5);
    assert.equal(parseOffsetInput("-0:02.250"), -2.25);
    assert.equal(parseOffsetInput("2"), 2);
    assert.equal(parseOffsetInput("- 3"), -3);
    assert.equal(parseOffsetInput("+"), null);
    assert.equal(parseOffsetInput("x"), null);
  });
});

describe("cue edits", () => {
  it("keeps typed text raw but capped", () => {
    assert.equal(setCueText(CUES, 1, "  spaced  ")[1]!.text, "  spaced  ");
    assert.equal(setCueText(CUES, 1, "a".repeat(1000))[1]!.text.length, 600);
    assert.deepEqual(setCueText(CUES, 9, "x"), CUES);
  });

  it("validates and re-sorts timing edits", () => {
    const moved = setCueTimes(CUES, 0, { start: 6, end: 7 });
    assert.ok(moved.ok);
    if (moved.ok) {
      assert.equal(moved.index, 2);
      assert.deepEqual(moved.cues.map((c) => c.text), ["to the lesson", "Let us begin", "Hello and welcome"]);
    }
    assert.deepEqual(setCueTimes(CUES, 0, { end: 0.05 }), { ok: false, error: "The end must come after the start." });
    assert.equal(setCueTimes(CUES, 0, { start: -1 }).ok, false);
    assert.equal(setCueTimes(CUES, 7, { start: 1 }).ok, false);
    assert.ok(setCueTimes(CUES, 0, { end: 0.1 }).ok);
  });

  it("inserts at the playhead, filling up to the next caption", () => {
    const gap = insertCueAt(CUES, 4.2);
    assert.equal(gap.index, 2);
    assert.deepEqual(gap.cues[2], { start: 4.2, end: 5, text: "" });
    const end = insertCueAt(CUES, 10, "tail");
    assert.equal(end.index, 3);
    assert.deepEqual(end.cues[3], { start: 10, end: 12, text: "tail" });
    assert.equal(insertCueAt([], Number.NaN).cues[0]!.start, 0);
  });

  it("merges a consecutive range and detects runs", () => {
    assert.deepEqual(mergeRange(CUES, 0, 2), [{ start: 0, end: 8, text: "Hello and welcome to the lesson Let us begin" }]);
    assert.deepEqual(mergeRange(CUES, 2, 1), [CUES[0], { start: 2.3, end: 8, text: "to the lesson Let us begin" }]);
    assert.ok(isConsecutive([3, 1, 2]));
    assert.ok(!isConsecutive([1, 3]));
    assert.ok(!isConsecutive([4]));
  });

  it("closes short gaps and trims overlaps", () => {
    const out = closeSmallGaps([...CUES, { start: 7.5, end: 9, text: "overlapping" }]);
    assert.deepEqual(out.map((c) => c.end), [2.3, 4, 7.5, 9]);
    assert.equal(CUES[0]!.end, 2, "input untouched");
  });

  it("scales timings for frame-rate fixes", () => {
    assert.deepEqual(scaleCues(CUES, 2).map((c) => [c.start, c.end]), [
      [0, 4],
      [4.6, 8],
      [10, 16],
    ]);
    assert.deepEqual(scaleCues(CUES, 0), CUES);
    assert.deepEqual(scaleCues(CUES, Number.NaN), CUES);
  });
});

describe("import", () => {
  const imported = [
    { start: 1, end: 2, text: "imported A" },
    { start: 4.5, end: 4.9, text: "imported B" },
  ];

  it("replaces or appends in time order with an offset", () => {
    assert.deepEqual(combineImported(CUES, imported, "replace"), { cues: imported, dropped: 0 });
    const appended = combineImported(CUES, imported, "append", 1);
    assert.deepEqual(appended.cues.map((c) => c.text), ["Hello and welcome", "imported A", "to the lesson", "Let us begin", "imported B"]);
    assert.deepEqual(appended.cues[1], { start: 2, end: 3, text: "imported A" });
    const negative = combineImported([], imported, "replace", -3);
    assert.deepEqual(negative.cues[0], { start: 0, end: 0.1, text: "imported A" });
  });

  it("caps at the cue limit and counts what was dropped", () => {
    const many = Array.from({ length: MAX_CUES }, (_, i) => ({ start: i, end: i + 0.5, text: `c${i}` }));
    const res = combineImported(CUES, many, "append");
    assert.equal(res.cues.length, MAX_CUES);
    assert.equal(res.dropped, CUES.length);
  });
});

describe("view", () => {
  const list: TranscriptCue[] = [
    { start: 0, end: 3, text: "Café overlaps" },
    { start: 2, end: 4, text: "" },
    { start: 5, end: 6, text: "plain" },
  ];

  it("filters by text, issues and empty captions", () => {
    const issues = cueIssues(list);
    assert.deepEqual(visibleCueIndices(list, "", "all"), [0, 1, 2]);
    assert.deepEqual(visibleCueIndices(list, "cafe", "all"), [0]);
    assert.deepEqual(visibleCueIndices(list, "", "issues", issues), [0]);
    assert.deepEqual(visibleCueIndices(list, "", "empty"), [1]);
    assert.deepEqual(visibleCueIndices(list, "plain", "empty"), []);
  });

  it("pages the visible list", () => {
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(101), 3);
    assert.equal(pageOfPosition(49), 0);
    assert.equal(pageOfPosition(50), 1);
    assert.equal(pageOfPosition(-1), 0);
    assert.equal(clampPage(9, 101), 2);
    assert.equal(clampPage(-2, 10), 0);
    assert.equal(clampPage(1.7, 120), 1);
  });

  it("summarizes counts, words and issues", () => {
    const issues = cueIssues(list);
    assert.deepEqual(summarizeCues(list, issues), { count: 3, words: 3, end: 6, empty: 1, issues: 1 });
    assert.deepEqual([...issuesByCue([...issues, { index: 0, kind: "long", message: "x" }]).keys()], [0]);
    assert.equal(issuesByCue([...issues, { index: 0, kind: "long", message: "x" }]).get(0)!.length, 2);
  });
});

describe("generation status", () => {
  it("labels each stage", () => {
    assert.equal(jobStageLabel({ stage: "queued" }), "Waiting for other transcripts to finish…");
    assert.equal(jobStageLabel({ stage: "transcribing", part: 2, parts: 3 }), "Transcribing part 2 of 3…");
    assert.equal(jobStageLabel({ stage: "transcribing", part: 1, parts: 1 }), "Transcribing the audio…");
  });

  it("reports monotonic progress", () => {
    const steps = [
      jobProgress({ stage: "queued" }),
      jobProgress({ stage: "extracting" }),
      jobProgress({ stage: "transcribing", part: 1, parts: 3 }),
      jobProgress({ stage: "transcribing", part: 3, parts: 3 }),
      jobProgress({ stage: "saving" }),
    ];
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! > steps[i - 1]!);
    assert.ok(steps[steps.length - 1]! < 1);
  });
});

describe("editor-shared", () => {
  it("validates language tags", () => {
    for (const ok of ["en", "pt-BR", "zh-Hant-TW", "fil"]) assert.ok(LANGUAGE_PATTERN.test(ok), ok);
    for (const bad of ["", "EN", "english", "en_US", "e"]) assert.ok(!LANGUAGE_PATTERN.test(bad), bad);
  });

  it("labels languages", () => {
    assert.equal(languageLabel("hi"), "Hindi");
    assert.equal(languageLabel("pt-BR"), "Portuguese (pt-BR)");
    assert.equal(languageLabel("nl"), "Dutch");
    assert.equal(languageLabel("qqq"), "qqq");
  });

  it("measures the compact save payload", () => {
    assert.deepEqual(cuesToTuples(CUES.slice(0, 1)), [[0, 2, "Hello and welcome"]]);
    assert.equal(savePayloadBytes([{ start: 0, end: 1, text: "é" }]), JSON.stringify([[0, 1, "é"]]).length + 1);
    const big = Array.from({ length: MAX_CUES }, (_, i) => ({ start: i, end: i + 1, text: "x".repeat(150) }));
    assert.ok(savePayloadBytes(big) > MAX_SAVE_BYTES);
  });
});
