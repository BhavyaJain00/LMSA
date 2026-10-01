import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CUES,
  MAX_CUE_TEXT,
  cueIndexAt,
  cueIssues,
  cueToHighlight,
  insertCueAfter,
  mergePartSegments,
  mergeWithNext,
  normalizeCues,
  sameCues,
  segmentsToCues,
  shiftCues,
  splitCue,
} from "@/lib/transcripts/cues";
import type { TranscriptCue } from "@/lib/types";

const CUES: TranscriptCue[] = [
  { start: 0, end: 2, text: "Hello and welcome" },
  { start: 2, end: 4, text: "to the lesson" },
  { start: 5, end: 8, text: "Let us begin" },
];

describe("normalizeCues", () => {
  it("rounds, clamps, cleans, drops empties and sorts stably", () => {
    const out = normalizeCues([
      { start: 5.12345, end: 6, text: "  second\r\n\r\n  line  " },
      { start: -1, end: -0.5, text: "clamped" },
      { start: 1, end: 2, text: "   " },
      { start: "x", end: 2, text: "bad time" },
      null,
      { start: 5.12345, end: 7, text: "same start, later" },
      { start: 2, end: 3, text: "ctrl\u0007 chars" },
    ]);
    assert.deepEqual(out, [
      { start: 0, end: 0.1, text: "clamped" },
      { start: 2, end: 3, text: "ctrl chars" },
      { start: 5.123, end: 6, text: "second\nline" },
      { start: 5.123, end: 7, text: "same start, later" },
    ]);
  });

  it("caps text length and cue count", () => {
    assert.equal(normalizeCues([{ start: 0, end: 1, text: "a".repeat(MAX_CUE_TEXT + 50) }])[0]!.text.length, MAX_CUE_TEXT);
    const many = Array.from({ length: MAX_CUES + 5 }, (_, i) => ({ start: i, end: i + 1, text: `c${i}` }));
    assert.equal(normalizeCues(many).length, MAX_CUES);
  });
});

describe("cue lookup", () => {
  it("finds the cue showing at a time, or -1 in gaps", () => {
    assert.equal(cueIndexAt(CUES, 0), 0);
    assert.equal(cueIndexAt(CUES, 1.99), 0);
    assert.equal(cueIndexAt(CUES, 2), 1);
    assert.equal(cueIndexAt(CUES, 4.5), -1);
    assert.equal(cueIndexAt(CUES, 9), -1);
    assert.equal(cueIndexAt([], 1), -1);
  });

  it("keeps the last cue highlighted through a gap", () => {
    assert.equal(cueToHighlight(CUES, 4.5), 1);
    assert.equal(cueToHighlight(CUES, 20), 2);
    assert.equal(cueToHighlight([{ start: 3, end: 4 }], 1), -1);
  });
});

describe("cueIssues", () => {
  it("flags overlaps, captions too fast to read and long captions", () => {
    const issues = cueIssues([
      { start: 0, end: 3, text: "overlaps" },
      { start: 2.5, end: 3, text: "this is far too long to read" },
      { start: 4, end: 30, text: "x".repeat(170) },
      { start: 30, end: 33, text: "fine" },
    ]);
    assert.deepEqual(
      issues.map((i) => [i.index, i.kind]),
      [
        [0, "overlap"],
        [1, "short"],
        [2, "long"],
      ],
    );
    assert.deepEqual(cueIssues(CUES), []);
  });
});

describe("splitCue", () => {
  it("splits at the word nearest the middle with proportional timing", () => {
    const out = splitCue([{ start: 10, end: 14, text: "one two three four" }], 0);
    assert.deepEqual(out, [
      // 7 of 17 characters on the left → 10 + 4 × 7/17.
      { start: 10, end: 11.647, text: "one two" },
      { start: 11.647, end: 14, text: "three four" },
    ]);
  });

  it("uses the given cursor offset and playhead", () => {
    const out = splitCue(CUES, 0, { textOffset: 5, at: 0.5 });
    assert.deepEqual(out.slice(0, 2), [
      { start: 0, end: 0.5, text: "Hello" },
      { start: 0.5, end: 2, text: "and welcome" },
    ]);
    assert.equal(out.length, 4);
  });

  it("ignores a playhead outside the cue and clamps near its edges", () => {
    const outside = splitCue(CUES, 0, { textOffset: 5, at: 7 });
    assert.ok(outside[0]!.end > 0 && outside[0]!.end < 2);
    const edge = splitCue(CUES, 0, { textOffset: 5, at: 0.05 });
    assert.ok(edge[0]!.end >= 0.1);
  });

  it("leaves single words, missing indices and very short cues unchanged", () => {
    const single = [{ start: 0, end: 2, text: "Hello" }];
    assert.deepEqual(splitCue(single, 0), single);
    assert.deepEqual(splitCue(CUES, 9), CUES);
    const tiny = [{ start: 0, end: 0.15, text: "a b" }];
    assert.deepEqual(splitCue(tiny, 0), tiny);
  });
});

describe("mergeWithNext", () => {
  it("joins text and spans both cues", () => {
    assert.deepEqual(mergeWithNext(CUES, 0), [{ start: 0, end: 4, text: "Hello and welcome to the lesson" }, CUES[2]]);
  });

  it("does nothing on the last cue", () => {
    assert.deepEqual(mergeWithNext(CUES, 2), CUES);
  });

  it("split then merge restores the original cue", () => {
    const cue = { start: 3, end: 9, text: "a sentence long enough to split" };
    assert.deepEqual(mergeWithNext(splitCue([cue], 0), 0), [cue]);
  });
});

describe("shiftCues", () => {
  it("moves every cue and clamps at zero", () => {
    assert.deepEqual(shiftCues(CUES, 1.5).map((c) => [c.start, c.end]), [
      [1.5, 3.5],
      [3.5, 5.5],
      [6.5, 9.5],
    ]);
    const early = shiftCues(CUES, -3);
    assert.deepEqual(early[0], { start: 0, end: 0.1, text: "Hello and welcome" });
    assert.deepEqual(early[1], { start: 0, end: 1, text: "to the lesson" });
  });

  it("moves only a range and re-sorts", () => {
    const out = shiftCues(CUES, 10, { from: 0, to: 0 });
    assert.deepEqual(out.map((c) => c.text), ["to the lesson", "Let us begin", "Hello and welcome"]);
  });

  it("ignores zero and non-finite offsets", () => {
    assert.deepEqual(shiftCues(CUES, 0), CUES);
    assert.deepEqual(shiftCues(CUES, Number.NaN), CUES);
  });
});

describe("insertCueAfter and sameCues", () => {
  it("fills the gap before the next cue", () => {
    const out = insertCueAfter(CUES, 1, "");
    assert.deepEqual(out[2], { start: 4, end: 5, text: "" });
    assert.deepEqual(insertCueAfter([], -1)[0], { start: 0, end: 2, text: "New caption" });
  });

  it("compares cue lists by value", () => {
    assert.ok(sameCues(CUES, CUES.map((c) => ({ ...c }))));
    assert.ok(!sameCues(CUES, CUES.slice(1)));
    assert.ok(!sameCues(CUES, [{ ...CUES[0]!, text: "x" }, CUES[1]!, CUES[2]!]));
  });
});

describe("speech-to-text segments", () => {
  it("offsets parts and trims segments to their part's length", () => {
    const merged = mergePartSegments([
      { offset: 0, duration: 600, segments: [{ start: 0, end: 4, text: "first" }, { start: 598, end: 605, text: "runs past the part" }] },
      {
        offset: 600,
        duration: 300,
        segments: [
          { start: 0.5, end: 3, text: "second part", words: [{ start: 0.5, end: 1, word: "second" }, { start: 1, end: 3, word: "part" }] },
          { start: 400, end: 401, text: "beyond the part" },
          { start: 10, end: 11, text: "   " },
        ],
      },
    ]);
    assert.deepEqual(merged, [
      { start: 0, end: 4, text: "first" },
      { start: 598, end: 600, text: "runs past the part" },
      {
        start: 600.5,
        end: 603,
        text: "second part",
        words: [
          { start: 600.5, end: 601, word: "second" },
          { start: 601, end: 603, word: "part" },
        ],
      },
    ]);
  });

  it("drops words repeated across parts and trims small overlaps", () => {
    const merged = mergePartSegments([
      { offset: 0, segments: [{ start: 598, end: 603, text: "tail of part one" }] },
      {
        offset: 600,
        segments: [
          { start: 0, end: 2, text: "of part one" },
          { start: 2.5, end: 5, text: "fresh words" },
        ],
      },
    ]);
    assert.deepEqual(merged, [
      { start: 598, end: 603, text: "tail of part one" },
      { start: 603, end: 605, text: "fresh words" },
    ]);
  });

  it("keeps short segments as one cue", () => {
    assert.deepEqual(segmentsToCues([{ start: 1, end: 3, text: "  Short  one " }]), [{ start: 1, end: 3, text: "Short one" }]);
  });

  it("splits long segments by characters and duration, timed proportionally", () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const cues = segmentsToCues([{ start: 0, end: 20, text }]);
    assert.ok(cues.length >= 3);
    for (const c of cues) {
      assert.ok(c.text.length <= 84, `cue too long: ${c.text.length}`);
      assert.ok(c.end - c.start <= 7.5);
    }
    assert.equal(cues.map((c) => c.text).join(" "), text);
    assert.equal(cues[0]!.start, 0);
    assert.ok(Math.abs(cues[cues.length - 1]!.end - 20) < 0.5);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i]!.start >= cues[i - 1]!.end - 1e-9);
  });

  it("uses word timestamps when they cover the segment", () => {
    const words = Array.from({ length: 30 }, (_, i) => ({ start: 100 + i, end: 100 + i + 0.8, word: `w${i}` }));
    const cues = segmentsToCues([{ start: 100, end: 130, text: words.map((w) => w.word).join(" "), words }], { maxChars: 30, maxDuration: 8 });
    assert.ok(cues.length > 1);
    assert.equal(cues[0]!.start, 100);
    // Every cue boundary falls on a word boundary.
    for (const c of cues) assert.ok(words.some((w) => w.start === c.start));
  });

  it("removes overlaps between consecutive cues", () => {
    const cues = segmentsToCues([
      { start: 0, end: 3, text: "first" },
      { start: 2, end: 4, text: "second" },
    ]);
    assert.deepEqual(cues, [
      { start: 0, end: 2, text: "first" },
      { start: 2, end: 4, text: "second" },
    ]);
  });
});
