import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TranscriptParseError,
  cleanCueText,
  clockLabel,
  detectFormat,
  formatTimestamp,
  parseCaptionFile,
  parseSrt,
  parseTimestamp,
  parseTimingLine,
  parseVtt,
  serializeSrt,
  serializeText,
  serializeTranscript,
  serializeVtt,
  transcriptFileName,
} from "@/lib/transcripts/format";
import { normalizeCues } from "@/lib/transcripts/cues";
import type { TranscriptCue } from "@/lib/types";

const CUES: TranscriptCue[] = [
  { start: 0, end: 2.5, text: "Welcome to the course." },
  { start: 2.5, end: 6.04, text: "Today we cover loops\nand conditions." },
  { start: 3725.007, end: 3727, text: "Use a < b && c > d --> carefully." },
];

describe("timestamps", () => {
  it("parses hour, minute-only, comma and short fractions", () => {
    assert.equal(parseTimestamp("01:02:03.456"), 3723.456);
    assert.equal(parseTimestamp("02:03.456"), 123.456);
    assert.equal(parseTimestamp("01:02:03,456"), 3723.456);
    assert.equal(parseTimestamp("2:03"), 123);
    assert.equal(parseTimestamp("00:00:01.5"), 1.5);
    assert.equal(parseTimestamp("00:00:01.05"), 1.05);
  });

  it("rejects out-of-range or malformed values", () => {
    assert.ok(Number.isNaN(parseTimestamp("00:00:61.000")));
    assert.ok(Number.isNaN(parseTimestamp("01:75:00.000")));
    assert.ok(Number.isNaN(parseTimestamp("abc")));
    assert.ok(Number.isNaN(parseTimestamp("")));
  });

  it("formats with hours and the requested separator", () => {
    assert.equal(formatTimestamp(0), "00:00:00.000");
    assert.equal(formatTimestamp(3723.456), "01:02:03.456");
    assert.equal(formatTimestamp(3723.456, ","), "01:02:03,456");
    assert.equal(formatTimestamp(-4), "00:00:00.000");
    assert.equal(formatTimestamp(Number.NaN), "00:00:00.000");
    assert.equal(formatTimestamp(59.9996), "00:01:00.000");
  });

  it("reads timing lines with cue settings", () => {
    assert.deepEqual(parseTimingLine("00:01.000 --> 00:04.250 align:start position:10%"), { start: 1, end: 4.25 });
    assert.deepEqual(parseTimingLine("00:00:01,000-->00:00:02,000"), { start: 1, end: 2 });
    assert.equal(parseTimingLine("00:01.000 -> 00:02.000"), null);
  });

  it("labels clock times for plain text", () => {
    assert.equal(clockLabel(5), "0:05");
    assert.equal(clockLabel(125.9), "2:05");
    assert.equal(clockLabel(3725), "1:02:05");
  });
});

describe("cue text cleaning", () => {
  it("strips markup, keeps speakers and decodes entities", () => {
    assert.equal(cleanCueText("<v Anna>Hello <i>there</i></v>"), "Anna: Hello there");
    assert.equal(cleanCueText("<c.yellow>Tom &amp; Jerry</c> &lt;3"), "Tom & Jerry <3");
    assert.equal(cleanCueText("{\\an8}Top line"), "Top line");
    assert.equal(cleanCueText("one <00:00:01.000>two"), "one two");
    assert.equal(cleanCueText("  a  \n\n  b  "), "a\nb");
    assert.equal(cleanCueText("&#x41;&#66;&unknown;"), "AB&unknown;");
  });
});

describe("WebVTT", () => {
  it("parses ids, settings, NOTE/STYLE blocks, BOM and CRLF", () => {
    const file =
      "﻿WEBVTT - lesson captions\r\nKind: captions\r\n\r\nSTYLE\r\n::cue { color: lime }\r\n\r\nNOTE written by hand\r\n\r\nintro\r\n00:00.000 --> 00:02.000 line:0\r\n<v Sam>Hi\r\n\r\n00:00:02.000 --> 00:00:04.500\r\nSecond line\r\nwraps\r\n";
    const { cues, skipped } = parseVtt(file);
    assert.deepEqual(cues, [
      { start: 0, end: 2, text: "Sam: Hi" },
      { start: 2, end: 4.5, text: "Second line\nwraps" },
    ]);
    assert.deepEqual(skipped, []);
  });

  it("accepts a cue directly under the header", () => {
    const { cues } = parseVtt("WEBVTT\n00:01.000 --> 00:02.000\nTight file\n");
    assert.deepEqual(cues, [{ start: 1, end: 2, text: "Tight file" }]);
  });

  it("reports unreadable blocks by line number and skips empty cues", () => {
    const { cues, skipped } = parseVtt("WEBVTT\n\n00:01.000 --> 00:99.000\nbad\n\n00:03.000 --> 00:04.000\n<i></i>\n\n00:05.000 --> 00:06.000\nok\n");
    assert.deepEqual(cues, [{ start: 5, end: 6, text: "ok" }]);
    assert.deepEqual(skipped, [3]);
  });

  it("refuses files without the WEBVTT signature", () => {
    assert.throws(() => parseVtt("1\n00:00:01,000 --> 00:00:02,000\nhi\n"), TranscriptParseError);
  });

  it("writes a Language header only for valid tags", () => {
    assert.ok(serializeVtt(CUES, { language: "pt-BR" }).startsWith("WEBVTT\nLanguage: pt-BR\n\n1\n"));
    assert.ok(serializeVtt(CUES, { language: "x\nEvil: 1" }).startsWith("WEBVTT\n\n1\n"));
    assert.equal(serializeVtt([]), "WEBVTT\n");
  });

  it("escapes markup and arrows so text survives a round trip", () => {
    const vtt = serializeVtt(CUES);
    assert.ok(vtt.includes("Use a &lt; b &amp;&amp; c &gt; d --&gt; carefully."));
    assert.ok(vtt.includes("01:02:05.007 --> 01:02:07.000"));
    assert.deepEqual(parseVtt(vtt).cues, CUES);
  });
});

describe("SubRip", () => {
  it("parses counters, comma times and multi-line text", () => {
    const { cues } = parseSrt("1\n00:00:01,000 --> 00:00:03,200\nFirst\nline two\n\n2\n00:00:03,200 --> 00:00:05,000\n<b>Bold</b>\n");
    assert.deepEqual(cues, [
      { start: 1, end: 3.2, text: "First\nline two" },
      { start: 3.2, end: 5, text: "Bold" },
    ]);
  });

  it("round-trips through serializeSrt (arrows in text are defused)", () => {
    const srt = serializeSrt(CUES);
    assert.ok(srt.startsWith("1\n00:00:00,000 --> 00:00:02,500\nWelcome to the course.\n\n2\n"));
    assert.ok(srt.includes("d -> carefully."));
    const back = parseSrt(srt).cues;
    assert.deepEqual(back.slice(0, 2), CUES.slice(0, 2));
    assert.equal(back[2]!.start, CUES[2]!.start);
    assert.equal(back[2]!.end, CUES[2]!.end);
    assert.equal(serializeSrt([]), "");
  });

  it("VTT → SRT → VTT keeps every cue after normalization", () => {
    const viaSrt = parseSrt(serializeSrt(parseVtt(serializeVtt(CUES.slice(0, 2))).cues)).cues;
    assert.deepEqual(normalizeCues(viaSrt), CUES.slice(0, 2));
  });
});

describe("format detection and import", () => {
  it("prefers the file extension, then sniffs the content", () => {
    assert.equal(detectFormat("anything", "Lesson.VTT"), "vtt");
    assert.equal(detectFormat("WEBVTT", "captions.srt"), "srt");
    assert.equal(detectFormat("﻿  WEBVTT\n"), "vtt");
    assert.equal(detectFormat("1\n00:00:01,000 --> 00:00:02,000\nx"), "srt");
    assert.equal(detectFormat("00:01.000 --> 00:02.000\nx"), "srt");
    assert.equal(detectFormat("just words"), null);
  });

  it("parseCaptionFile reports the format and refuses empty or unknown files", () => {
    const parsed = parseCaptionFile(serializeVtt(CUES), "a.vtt");
    assert.equal(parsed.format, "vtt");
    assert.equal(parsed.cues.length, 3);
    assert.throws(() => parseCaptionFile("hello"), /WebVTT|SubRip/);
    assert.throws(() => parseCaptionFile("WEBVTT\n\nNOTE nothing\n"), /No captions/);
  });
});

describe("plain text and downloads", () => {
  it("writes one timestamped paragraph per cue under an optional title", () => {
    assert.equal(serializeText(CUES.slice(0, 2)), "Welcome to the course.\nToday we cover loops and conditions.\n");
    assert.equal(serializeText(CUES.slice(0, 2), { timestamps: true, title: "Intro" }), "Intro\n=====\n\n[0:00] Welcome to the course.\n[0:02] Today we cover loops and conditions.\n");
    assert.ok(serializeTranscript(CUES, "txt", { title: "T" }).includes("[1:02:05]"));
    assert.ok(serializeTranscript(CUES, "srt").includes(","));
    assert.ok(serializeTranscript(CUES, "vtt").startsWith("WEBVTT"));
  });

  it("builds safe file names", () => {
    assert.equal(transcriptFileName("Intro to Python: Loops & Ifs!", "vtt"), "intro-to-python-loops-ifs-transcript.vtt");
    assert.equal(transcriptFileName("Café déjà vu", "srt"), "cafe-deja-vu-transcript.srt");
    assert.equal(transcriptFileName("../../", "txt"), "lesson-transcript.txt");
    assert.ok(transcriptFileName("x".repeat(200), "vtt").length <= 60 + "-transcript.vtt".length);
  });
});
