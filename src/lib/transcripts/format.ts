import type { TranscriptCue } from "@/lib/types";

/**
 * WebVTT / SubRip parsing and serialization for transcripts. Pure and
 * DOM-free: used by the transcript editor (import/export), the learner panel
 * (downloads, caption track) and the server (API downloads, validation).
 *
 * Parsing is lenient the way players are: cue identifiers, cue settings,
 * NOTE/STYLE/REGION blocks, BOMs, CRLF line endings, "," or "." before the
 * milliseconds and hours-less timestamps are all accepted; markup (<v Anna>,
 * <i>, <c.yellow>, inline timestamps, SSA overrides like {\an8}) is removed
 * and entities are decoded so cues store plain text.
 */

export type TranscriptFormat = "vtt" | "srt" | "txt";

export interface ParseResult {
  cues: TranscriptCue[];
  /** Blocks that could not be read (1-based line numbers of their first line). */
  skipped: number[];
}

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

/** Largest caption file accepted for import (characters). */
export const MAX_IMPORT_CHARS = 4 * 1024 * 1024;

const TIMESTAMP = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?`;
const TIMING_LINE = new RegExp(String.raw`^\s*${TIMESTAMP}\s*-->\s*${TIMESTAMP}(?:\s+.*)?$`);

function msOf(fraction: string | undefined): number {
  if (!fraction) return 0;
  // "5" = 500 ms, "05" = 50 ms, "005" = 5 ms
  return Number(fraction.padEnd(3, "0")) / 1000;
}

function secondsOf(h: string | undefined, m: string, s: string, f: string | undefined): number | null {
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes > 59 && h !== undefined) return null;
  if (seconds > 59) return null;
  return Number(h ?? 0) * 3600 + minutes * 60 + seconds + msOf(f);
}

/** Parse "01:02:03.456", "02:03.456", "01:02:03,456" or "2:03" into seconds (NaN when invalid). */
export function parseTimestamp(input: string): number {
  const m = new RegExp(`^\\s*${TIMESTAMP}\\s*$`).exec(input);
  if (!m) return NaN;
  const value = secondsOf(m[1], m[2]!, m[3]!, m[4]);
  return value === null ? NaN : value;
}

/** Parse a timing line ("00:01.000 --> 00:04.000 align:start") into start/end seconds. */
export function parseTimingLine(line: string): { start: number; end: number } | null {
  const m = TIMING_LINE.exec(line);
  if (!m) return null;
  const start = secondsOf(m[1], m[2]!, m[3]!, m[4]);
  const end = secondsOf(m[5], m[6]!, m[7]!, m[8]);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * Format seconds as a caption timestamp: "00:01:02.345" (VTT) or
 * "00:01:02,345" (SRT). Hours are always written (valid in both formats).
 */
export function formatTimestamp(seconds: number, separator: "." | "," = "."): string {
  const totalMs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms, 3)}`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Remove caption markup and decode entities; `<v Anna>` becomes "Anna: ". */
export function cleanCueText(raw: string): string {
  return decodeEntities(
    raw
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/<v(?:\.[^\s>]*)?\s+([^>]+)>/gi, (_, speaker: string) => `${speaker.trim()}: `)
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/<\d[\d:.]*>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeNewlines(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function blocksOf(text: string): { lines: string[]; firstLine: number }[] {
  const all = normalizeNewlines(text).split("\n");
  const blocks: { lines: string[]; firstLine: number }[] = [];
  let current: string[] = [];
  let first = 0;
  all.forEach((line, i) => {
    if (line.trim() === "") {
      if (current.length) blocks.push({ lines: current, firstLine: first + 1 });
      current = [];
      return;
    }
    if (!current.length) first = i;
    current.push(line);
  });
  if (current.length) blocks.push({ lines: current, firstLine: first + 1 });
  return blocks;
}

/** Cue blocks shared by both formats: optional id line, timing line, text lines. */
function parseCueBlocks(blocks: { lines: string[]; firstLine: number }[]): ParseResult {
  const cues: TranscriptCue[] = [];
  const skipped: number[] = [];
  for (const block of blocks) {
    const timingAt = block.lines.findIndex((l) => l.includes("-->"));
    // An id line (or SRT counter) may precede the timing; anything more is not a cue.
    if (timingAt < 0 || timingAt > 1) {
      skipped.push(block.firstLine);
      continue;
    }
    const timing = parseTimingLine(block.lines[timingAt]!);
    if (!timing) {
      skipped.push(block.firstLine + timingAt);
      continue;
    }
    const text = cleanCueText(block.lines.slice(timingAt + 1).join("\n"));
    if (!text) continue;
    cues.push({ start: timing.start, end: timing.end, text });
  }
  return { cues, skipped };
}

/** Parse a WebVTT file. Throws `TranscriptParseError` when it is not WebVTT at all. */
export function parseVtt(text: string): ParseResult {
  if (text.length > MAX_IMPORT_CHARS) throw new TranscriptParseError("The caption file is too large.");
  const blocks = blocksOf(text);
  const header = blocks[0]?.lines[0]?.trim() ?? "";
  if (!/^WEBVTT(?:[ \t].*)?$/.test(header)) throw new TranscriptParseError('This is not a WebVTT file (it must start with "WEBVTT").');
  // The header block (WEBVTT + metadata lines), NOTE/STYLE/REGION blocks carry no cues.
  const cueBlocks = blocks.slice(1).filter((b) => !/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(b.lines[0]!.trim()));
  // Cues directly under the header without a blank line are allowed by lenient players.
  const headerRest = blocks[0]!.lines.slice(1);
  const headerTiming = headerRest.findIndex((l) => l.includes("-->"));
  if (headerTiming >= 0) cueBlocks.unshift({ lines: headerRest.slice(Math.max(0, headerTiming - 1)), firstLine: blocks[0]!.firstLine + 1 });
  return parseCueBlocks(cueBlocks);
}

/** Parse a SubRip (.srt) file. */
export function parseSrt(text: string): ParseResult {
  if (text.length > MAX_IMPORT_CHARS) throw new TranscriptParseError("The caption file is too large.");
  return parseCueBlocks(blocksOf(text));
}

/** Detect the format from the file name, else the content. */
export function detectFormat(text: string, fileName?: string): "vtt" | "srt" | null {
  const ext = fileName?.toLowerCase().split(".").pop();
  if (ext === "vtt") return "vtt";
  if (ext === "srt") return "srt";
  const start = normalizeNewlines(text).trimStart();
  if (start.startsWith("WEBVTT")) return "vtt";
  if (/^\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(start)) return "srt";
  if (/-->/.test(start)) return "srt";
  return null;
}

/** Parse a caption file of either format. */
export function parseCaptionFile(text: string, fileName?: string): ParseResult & { format: "vtt" | "srt" } {
  const format = detectFormat(text, fileName);
  if (!format) throw new TranscriptParseError("Choose a WebVTT (.vtt) or SubRip (.srt) caption file.");
  const result = format === "vtt" ? parseVtt(text) : parseSrt(text);
  if (!result.cues.length) throw new TranscriptParseError("No captions were found in this file.");
  return { ...result, format };
}

/* ------------------------------------------------------------------ */
/* Serialization                                                        */
/* ------------------------------------------------------------------ */

/** Cue text is plain; escape what WebVTT would read as markup or a timing arrow. */
function escapeVttText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** SRT has no escaping; keep lines non-empty so a cue never ends early. */
function srtText(text: string): string {
  return text
    .replace(/-->/g, "->")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** Serialize cues as WebVTT (with an optional `Language:` header). */
export function serializeVtt(cues: readonly TranscriptCue[], opts: { language?: string } = {}): string {
  const header = opts.language && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(opts.language) ? `WEBVTT\nLanguage: ${opts.language}\n` : "WEBVTT\n";
  const body = cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${escapeVttText(c.text) || "&nbsp;"}`).join("\n\n");
  return body ? `${header}\n${body}\n` : header;
}

/** Serialize cues as SubRip. */
export function serializeSrt(cues: readonly TranscriptCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ",")} --> ${formatTimestamp(c.end, ",")}\n${srtText(c.text) || " "}`).join("\n\n") + (cues.length ? "\n" : "");
}

/** Clock label used in plain-text transcripts: "1:02:03" / "2:03". */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Plain text: one paragraph per cue, optionally prefixed with "[m:ss]". */
export function serializeText(cues: readonly TranscriptCue[], opts: { timestamps?: boolean; title?: string } = {}): string {
  const lines = cues.map((c) => {
    const text = c.text.replace(/\s*\n\s*/g, " ").trim();
    return opts.timestamps ? `[${clockLabel(c.start)}] ${text}` : text;
  });
  const head = opts.title ? `${opts.title}\n${"=".repeat(Math.min(80, opts.title.length))}\n\n` : "";
  return `${head}${lines.join("\n")}\n`;
}

/** Serialize in the requested download format. */
export function serializeTranscript(cues: readonly TranscriptCue[], format: TranscriptFormat, opts: { language?: string; title?: string } = {}): string {
  if (format === "vtt") return serializeVtt(cues, opts);
  if (format === "srt") return serializeSrt(cues);
  return serializeText(cues, { timestamps: true, title: opts.title });
}

export const TRANSCRIPT_CONTENT_TYPES: Record<TranscriptFormat, string> = {
  vtt: "text/vtt; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** A safe download file name: "intro-to-python-transcript.vtt". */
export function transcriptFileName(title: string, format: TranscriptFormat): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lesson";
  return `${base}-transcript.${format}`;
}
