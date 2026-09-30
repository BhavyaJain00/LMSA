import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TranscriptCue } from "@/lib/types";
import { cueIndexAt, cueToHighlight } from "@/lib/transcripts/cues";
import { parseVtt, serializeVtt } from "@/lib/transcripts/format";
import {
  MAX_PANEL_MATCHES,
  findPanelMatches,
  firstMatchFrom,
  foldCues,
  lessonTimeHref,
  parseTimeParam,
  scrollTopFor,
  stepMatch,
} from "@/lib/transcripts/panel";

const CUES: TranscriptCue[] = [
  { start: 0, end: 3.5, text: "Welcome back. Today we write a loop." },
  { start: 3.5, end: 7, text: "The loop variable starts at zero,\nand the LOOP ends at ten." },
  { start: 9, end: 12, text: "Café owners call this a for-loop; naïve code repeats itself." },
  { start: 12, end: 15.25, text: "That is all for today." },
];

describe("player-hls: transcript panel — active cue", () => {
  it("finds the cue showing at a time", () => {
    assert.equal(cueIndexAt(CUES, 0), 0);
    assert.equal(cueIndexAt(CUES, 3.49), 0);
    assert.equal(cueIndexAt(CUES, 3.5), 1, "a cue ends where the next one starts");
    assert.equal(cueIndexAt(CUES, 8), -1, "nothing shows during a gap");
    assert.equal(cueIndexAt(CUES, 99), -1);
    assert.equal(cueIndexAt([], 1), -1);
  });

  it("keeps the last spoken line highlighted during gaps and after the end", () => {
    assert.equal(cueToHighlight(CUES, 8), 1, "the gap between 7 s and 9 s keeps cue 1");
    assert.equal(cueToHighlight(CUES, 9), 2);
    assert.equal(cueToHighlight(CUES, 600), 3);
    assert.equal(cueToHighlight([{ start: 5, end: 6 }], 2), -1, "before the first cue nothing is highlighted");
  });
});

describe("player-hls: transcript panel — search", () => {
  it("finds every occurrence, ignoring case, with offsets into the original text", () => {
    const { matches, truncated } = findPanelMatches(CUES, "loop");
    assert.equal(truncated, false);
    assert.deepEqual(
      matches.map((m) => m.cue),
      [0, 1, 1, 2],
    );
    for (const m of matches) assert.equal(CUES[m.cue]!.text.slice(m.start, m.end).toLowerCase(), "loop");
    assert.ok(matches[1]!.start < matches[2]!.start, "occurrences inside a cue are in reading order");
  });

  it("ignores accents in both the text and the query", () => {
    const plain = findPanelMatches(CUES, "cafe");
    assert.equal(plain.matches.length, 1);
    assert.equal(CUES[2]!.text.slice(plain.matches[0]!.start, plain.matches[0]!.end), "Café");
    assert.equal(findPanelMatches(CUES, "NAÏVE").matches.length, 1);
    assert.equal(findPanelMatches(CUES, "naive").matches.length, 1);
  });

  it("treats a line break inside a cue as a space", () => {
    const { matches } = findPanelMatches(CUES, "zero, and");
    assert.equal(matches.length, 1);
    assert.equal(CUES[1]!.text.slice(matches[0]!.start, matches[0]!.end), "zero,\nand");
  });

  it("needs at least two characters and tolerates surrounding spaces", () => {
    assert.deepEqual(findPanelMatches(CUES, "l"), { matches: [], truncated: false });
    assert.deepEqual(findPanelMatches(CUES, "   "), { matches: [], truncated: false });
    assert.equal(findPanelMatches(CUES, "  today ").matches.length, 2);
    assert.equal(findPanelMatches(CUES, "missing words").matches.length, 0);
  });

  it("accepts cached folded text and stops at the highlight limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 1, text: "la la la la" }));
    const folded = foldCues(many);
    assert.equal(findPanelMatches(many, "la", folded).matches.length, 120);
    const capped = findPanelMatches(many, "la", folded, 50);
    assert.equal(capped.matches.length, 50);
    assert.equal(capped.truncated, true);
    assert.ok(MAX_PANEL_MATCHES >= 500);
  });

  it("steps through matches and wraps around", () => {
    assert.equal(stepMatch(0, 3, 1), 1);
    assert.equal(stepMatch(2, 3, 1), 0);
    assert.equal(stepMatch(0, 3, -1), 2);
    assert.equal(stepMatch(-1, 3, 1), 0, "with nothing selected, next is the first match");
    assert.equal(stepMatch(-1, 3, -1), 2, "and previous is the last one");
    assert.equal(stepMatch(0, 0, 1), -1);
    assert.equal(stepMatch(0, 1, 1), 0);
  });

  it("starts a search at the line being spoken", () => {
    const { matches } = findPanelMatches(CUES, "loop");
    assert.equal(firstMatchFrom(matches, -1), 0, "before playback: the first match");
    assert.equal(firstMatchFrom(matches, 1), 1, "the first match in the current cue");
    assert.equal(firstMatchFrom(matches, 2), 3);
    assert.equal(firstMatchFrom(matches, 3), 0, "past the last match it wraps to the first");
    assert.equal(firstMatchFrom([], 0), -1);
  });
});

describe("player-hls: transcript panel — scrolling", () => {
  const view = { scrollTop: 300, height: 240, scrollHeight: 2000 };

  it("leaves a comfortably visible row alone", () => {
    assert.equal(scrollTopFor({ top: 380, height: 36 }, view), null);
  });

  it("brings a row that left the viewport a third of the way down", () => {
    assert.equal(scrollTopFor({ top: 900, height: 36 }, view), 820);
    assert.equal(scrollTopFor({ top: 120, height: 36 }, view), 40);
  });

  it("moves a row hugging an edge, where the next line would be cut off", () => {
    assert.equal(scrollTopFor({ top: 500, height: 36 }, view), 420, "bottom edge");
    assert.equal(scrollTopFor({ top: 310, height: 36 }, view), 230, "top edge");
  });

  it("clamps to the scrollable range and reports no-ops", () => {
    assert.equal(scrollTopFor({ top: 1990, height: 36 }, view), 1760);
    assert.equal(scrollTopFor({ top: 10, height: 36 }, { scrollTop: 0, height: 240, scrollHeight: 2000 }), null, "already at the top");
    assert.equal(scrollTopFor({ top: 10, height: 36 }, { scrollTop: 0, height: 0, scrollHeight: 0 }), null, "a collapsed list is never scrolled");
    assert.equal(scrollTopFor({ top: 100, height: 36 }, { scrollTop: 0, height: 240, scrollHeight: 180 }), null, "content shorter than the list");
  });
});

describe("player-hls: transcript panel — timestamp links", () => {
  it("parses seconds, clock and unit forms", () => {
    assert.equal(parseTimeParam("135"), 135);
    assert.equal(parseTimeParam("135.5"), 135.5);
    assert.equal(parseTimeParam("2:15"), 135);
    assert.equal(parseTimeParam("1:02:03"), 3723);
    assert.equal(parseTimeParam("2m15s"), 135);
    assert.equal(parseTimeParam("1h2m3s"), 3723);
    assert.equal(parseTimeParam("90s"), 90);
    assert.equal(parseTimeParam("1H"), 3600);
    assert.equal(parseTimeParam("0"), 0);
  });

  it("rejects anything else", () => {
    for (const bad of [null, undefined, "", " ", "abc", "-5", "1e3", "1:2:3:4", "5x", "m", "99999999"]) {
      assert.equal(parseTimeParam(bad), null, String(bad));
    }
  });

  it("builds lesson links that start a video at a time", () => {
    assert.equal(lessonTimeHref("/courses/py/learn/1-2", 135.9), "/courses/py/learn/1-2?t=135");
    assert.equal(lessonTimeHref("/courses/py/learn/1-2", 0, "blk_2"), "/courses/py/learn/1-2?t=0&block=blk_2");
    assert.equal(lessonTimeHref("/courses/py/learn/1-2", Number.NaN, "a b"), "/courses/py/learn/1-2?t=0&block=a%20b");
    assert.equal(parseTimeParam(new URL(`https://x.test${lessonTimeHref("/l", 3723)}`).searchParams.get("t")), 3723);
  });
});

describe("player-hls: captions generated from the transcript", () => {
  it("serializes cues as a WebVTT track a player reads back unchanged", () => {
    const cues: TranscriptCue[] = [
      { start: 0, end: 2.5, text: "if a < b && b > c" },
      { start: 2.5, end: 5, text: "Arrows --> are kept\non two lines" },
      { start: 3600.25, end: 3605, text: "One hour in" },
    ];
    const vtt = serializeVtt(cues, { language: "en" });
    assert.ok(vtt.startsWith("WEBVTT\nLanguage: en\n"));
    assert.ok(!/^.*-->.*-->/m.test(vtt), "cue text never looks like a second timing arrow");
    assert.ok(vtt.includes("01:00:00.250 --> 01:00:05.000"));
    const parsed = parseVtt(vtt);
    assert.deepEqual(parsed.skipped, []);
    assert.deepEqual(parsed.cues, cues);
  });

  it("produces a valid empty track for a transcript without cues", () => {
    assert.equal(serializeVtt([]), "WEBVTT\n");
    assert.deepEqual(parseVtt(serializeVtt([])).cues, []);
  });
});
