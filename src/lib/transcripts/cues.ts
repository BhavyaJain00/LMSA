import type { TranscriptCue } from "@/lib/types";

/**
 * Pure cue operations shared by the transcript editor, the learner panel,
 * the server actions and automatic transcription: normalization and
 * validation, split / merge / shift, the cue at a playback time, text search
 * and turning speech-to-text segments into caption-sized cues.
 */

/** Most cues a transcript may hold (a 4-hour video at ~2 s per cue). */
export const MAX_CUES = 8000;
/** Longest cue text kept (characters). */
export const MAX_CUE_TEXT = 600;
/** Shortest cue kept (seconds). */
export const MIN_CUE_DURATION = 0.1;
/** Latest time a cue may end (24 h). */
export const MAX_CUE_TIME = 24 * 3600;

const roundMs = (n: number) => Math.round(n * 1000) / 1000;

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CUE_TEXT);
}

/**
 * Canonical cue list: finite times rounded to milliseconds, start ≥ 0,
 * end > start, text cleaned, empty cues dropped, sorted by start (stable),
 * capped at `MAX_CUES`.
 */
export function normalizeCues(input: readonly unknown[]): TranscriptCue[] {
  const out: TranscriptCue[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const start = Number(r.start);
    const end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = typeof r.text === "string" ? cleanText(r.text) : "";
    if (!text) continue;
    const s = roundMs(Math.min(Math.max(0, start), MAX_CUE_TIME));
    const e = roundMs(Math.min(Math.max(end, s + MIN_CUE_DURATION), MAX_CUE_TIME + MIN_CUE_DURATION));
    out.push({ start: s, end: e, text });
  }
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.start - b.c.start || a.i - b.i)
    .map(({ c }) => c)
    .slice(0, MAX_CUES);
}

export type CueIssueKind = "overlap" | "long" | "short" | "gap";

export interface CueIssue {
  index: number;
  kind: CueIssueKind;
  message: string;
}

/**
 * Soft problems worth flagging in the editor (none of them block saving):
 * overlapping cues, cues too short to read or too long to fit on screen.
 */
export function cueIssues(cues: readonly TranscriptCue[]): CueIssue[] {
  const issues: CueIssue[] = [];
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    if (next && next.start < c.end - 0.01) issues.push({ index: i, kind: "overlap", message: "Overlaps the next cue." });
    const duration = c.end - c.start;
    const chars = c.text.replace(/\s+/g, " ").length;
    if (duration < 0.7 && chars > 12) issues.push({ index: i, kind: "short", message: "On screen too briefly to read." });
    else if (chars / Math.max(duration, 0.1) > 25) issues.push({ index: i, kind: "short", message: "Too much text for its duration." });
    if (chars > 160) issues.push({ index: i, kind: "long", message: "Long cue: consider splitting it." });
  });
  return issues;
}

/** Index of the cue showing at `time` (the latest one that started), or -1. Binary search; `cues` sorted by start. */
export function cueIndexAt(cues: readonly Pick<TranscriptCue, "start" | "end">[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return -1;
  return time < cues[found]!.end ? found : -1;
}

/**
 * The cue to highlight in a transcript panel at `time`: the showing cue, or
 * during a gap the one that played last (so the highlight doesn't flicker).
 */
export function cueToHighlight(cues: readonly Pick<TranscriptCue, "start" | "end">[], time: number): number {
  const showing = cueIndexAt(cues, time);
  if (showing >= 0) return showing;
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= time) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return last;
}

/**
 * Split cue `index` in two. The text is cut at `textOffset` (default: the
 * word boundary nearest the middle) and the time at `at` (default:
 * proportionally to the text on each side). Returns the list unchanged when
 * the cue cannot be split (single word, or no time to divide).
 */
export function splitCue(cues: readonly TranscriptCue[], index: number, opts: { at?: number; textOffset?: number } = {}): TranscriptCue[] {
  const cue = cues[index];
  if (!cue) return [...cues];
  const text = cue.text;
  let cut = opts.textOffset;
  if (cut === undefined || cut <= 0 || cut >= text.length) {
    const mid = text.length / 2;
    let best = -1;
    for (let i = 1; i < text.length; i++) {
      if (/\s/.test(text[i]!) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    cut = best;
  }
  if (cut === undefined || cut <= 0) return [...cues];
  const first = text.slice(0, cut).trim();
  const second = text.slice(cut).trim();
  if (!first || !second) return [...cues];
  const duration = cue.end - cue.start;
  if (duration < 2 * MIN_CUE_DURATION) return [...cues];
  let at = opts.at;
  if (at === undefined || !(at > cue.start + MIN_CUE_DURATION && at < cue.end - MIN_CUE_DURATION)) {
    at = cue.start + duration * (first.length / (first.length + second.length));
  }
  at = roundMs(Math.min(Math.max(at, cue.start + MIN_CUE_DURATION), cue.end - MIN_CUE_DURATION));
  const out = [...cues];
  out.splice(index, 1, { start: cue.start, end: at, text: first }, { start: at, end: cue.end, text: second });
  return out;
}

/** Merge cue `index` with the one after it (text joined with a space). */
export function mergeWithNext(cues: readonly TranscriptCue[], index: number): TranscriptCue[] {
  const a = cues[index];
  const b = cues[index + 1];
  if (!a || !b) return [...cues];
  const joined = `${a.text.trimEnd()} ${b.text.trimStart()}`.slice(0, MAX_CUE_TEXT);
  const out = [...cues];
  out.splice(index, 2, { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), text: joined });
  return out;
}

/**
 * Move cues by `offset` seconds: all of them, or those with indices in
 * [from, to]. Times are clamped at 0; a cue pushed entirely before 0 keeps
 * the minimum duration. Order is restored afterwards.
 */
export function shiftCues(cues: readonly TranscriptCue[], offset: number, range: { from?: number; to?: number } = {}): TranscriptCue[] {
  if (!Number.isFinite(offset) || offset === 0) return [...cues];
  const from = Math.max(0, range.from ?? 0);
  const to = Math.min(cues.length - 1, range.to ?? cues.length - 1);
  const shifted = cues.map((c, i) => {
    if (i < from || i > to) return c;
    const start = roundMs(Math.max(0, c.start + offset));
    const end = roundMs(Math.max(start + MIN_CUE_DURATION, c.end + offset));
    return { ...c, start, end };
  });
  return normalizeCues(shifted);
}

/** Insert an empty-text-safe cue after `index` (or at the start when -1), filling the gap before the next cue. */
export function insertCueAfter(cues: readonly TranscriptCue[], index: number, text = "New caption", duration = 2): TranscriptCue[] {
  const prev = index >= 0 ? cues[index] : undefined;
  const next = cues[index + 1];
  const start = roundMs(prev ? prev.end : 0);
  let end = start + duration;
  if (next && next.start > start + MIN_CUE_DURATION) end = Math.min(end, next.start);
  const out = [...cues];
  out.splice(index + 1, 0, { start, end: roundMs(Math.max(end, start + MIN_CUE_DURATION)), text });
  return out;
}

/** Whether two cue lists are identical (dirty checks in the editor). */
export function sameCues(a: readonly TranscriptCue[], b: readonly TranscriptCue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.start !== y.start || x.end !== y.end || x.text !== y.text) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Search                                                               */
/* ------------------------------------------------------------------ */

/** Lower-case, accent-free form used for matching (same length mapping is not needed). */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Character ranges of `query` in `text`, ignoring case and accents. The
 * text is folded per character so offsets stay valid for highlighting in the
 * original string.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = foldText(query.trim()).replace(/\s+/g, " ");
  if (!q) return [];
  // Fold character by character and keep the source index of each folded char.
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const f = foldText(/\s/.test(ch) ? " " : ch);
    for (let k = 0; k < f.length; k++) {
      folded += f[k];
      map.push(i);
    }
  }
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(q, from);
    if (at < 0) break;
    const start = map[at]!;
    const end = map[at + q.length - 1]! + 1;
    ranges.push([start, end]);
    from = at + q.length;
  }
  return ranges;
}

/** Indices of cues containing `query` (in order). */
export function searchCues(cues: readonly Pick<TranscriptCue, "text">[], query: string): number[] {
  const q = foldText(query.trim()).replace(/\s+/g, " ");
  if (!q) return [];
  const hits: number[] = [];
  cues.forEach((c, i) => {
    if (foldText(c.text.replace(/\s+/g, " ")).includes(q)) hits.push(i);
  });
  return hits;
}

/** A short excerpt around the first match: "…the loop variable is…". */
export function snippetAround(text: string, query: string, radius = 60): { text: string; ranges: [number, number][] } {
  const flat = text.replace(/\s+/g, " ").trim();
  const ranges = matchRanges(flat, query);
  if (!ranges.length) return { text: flat.length > radius * 2 ? `${flat.slice(0, radius * 2).trimEnd()}…` : flat, ranges: [] };
  const [s, e] = ranges[0]!;
  let from = Math.max(0, s - radius);
  let to = Math.min(flat.length, e + radius);
  // Cut at word boundaries.
  if (from > 0) {
    const space = flat.indexOf(" ", from);
    if (space >= 0 && space < s) from = space + 1;
  }
  if (to < flat.length) {
    const space = flat.lastIndexOf(" ", to);
    if (space > e) to = space;
  }
  const prefix = from > 0 ? "…" : "";
  const suffix = to < flat.length ? "…" : "";
  const body = flat.slice(from, to);
  const shifted = matchRanges(body, query).map(([a, b]) => [a + prefix.length, b + prefix.length] as [number, number]);
  return { text: `${prefix}${body}${suffix}`, ranges: shifted };
}

/** Plain text of a transcript (paragraph per cue). */
export function cuesToPlainText(cues: readonly Pick<TranscriptCue, "text">[]): string {
  return cues.map((c) => c.text.replace(/\s*\n\s*/g, " ")).join("\n");
}

/* ------------------------------------------------------------------ */
/* Speech-to-text segments → caption cues                               */
/* ------------------------------------------------------------------ */

export interface TimedWord {
  start: number;
  end: number;
  word: string;
}

export interface TimedSegment {
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
}

export interface CaptionLayout {
  /** Most characters in one cue (two lines of ~42). */
  maxChars: number;
  /** Longest a cue stays on screen (seconds). */
  maxDuration: number;
}

export const DEFAULT_CAPTION_LAYOUT: CaptionLayout = { maxChars: 84, maxDuration: 7 };

/**
 * Offset the segments of each audio part by where that part starts and join
 * them. Speech-to-text APIs sometimes return a trailing segment that runs
 * past the end of its part or repeat the last words at the start of the next
 * part; segments starting before the previous one ended by more than half
 * their length are dropped.
 */
export function mergePartSegments(parts: readonly { offset: number; duration?: number; segments: readonly TimedSegment[] }[]): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (const part of parts) {
    for (const seg of part.segments) {
      if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end) || !seg.text?.trim()) continue;
      let start = part.offset + Math.max(0, seg.start);
      let end = part.offset + Math.max(seg.start, seg.end);
      if (part.duration && part.duration > 0) {
        const limit = part.offset + part.duration;
        if (start >= limit) continue;
        end = Math.min(end, limit);
      }
      const prev = out[out.length - 1];
      if (prev && start < prev.end) {
        const overlap = prev.end - start;
        if (overlap > (end - start) / 2) continue;
        start = prev.end;
      }
      if (end - start < 0.05) continue;
      const words = seg.words
        ?.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.word.trim())
        .map((w) => ({ start: part.offset + w.start, end: part.offset + Math.max(w.start, w.end), word: w.word }));
      out.push({ start: roundMs(start), end: roundMs(end), text: seg.text.trim(), ...(words?.length ? { words } : {}) });
    }
  }
  return out;
}

/** Split a long segment into word groups by character budget, timing each from word timestamps or proportionally. */
function splitSegment(seg: TimedSegment, layout: CaptionLayout): TranscriptCue[] {
  const text = seg.text.replace(/\s+/g, " ").trim();
  const duration = seg.end - seg.start;
  if (text.length <= layout.maxChars && duration <= layout.maxDuration) return [{ start: seg.start, end: seg.end, text }];

  const tokens = text.split(" ");
  const pieces = Math.max(Math.ceil(text.length / layout.maxChars), Math.ceil(duration / layout.maxDuration), 1);
  const target = text.length / pieces;
  const groups: string[][] = [];
  let current: string[] = [];
  let len = 0;
  for (const token of tokens) {
    const add = (current.length ? 1 : 0) + token.length;
    // Close the group at the budget, preferring sentence ends past 60 % of it.
    const sentenceEnd = current.length > 0 && /[.!?;:]$/.test(current[current.length - 1]!) && len >= target * 0.6;
    if (current.length && (len + add > Math.min(layout.maxChars, target * 1.25) || sentenceEnd)) {
      groups.push(current);
      current = [];
      len = 0;
    }
    current.push(token);
    len += (current.length > 1 ? 1 : 0) + token.length;
  }
  if (current.length) groups.push(current);

  const words = seg.words && seg.words.length >= tokens.length * 0.8 ? seg.words : null;
  const cues: TranscriptCue[] = [];
  let consumed = 0;
  let wordIndex = 0;
  for (const group of groups) {
    const groupText = group.join(" ");
    let start: number;
    let end: number;
    if (words) {
      const first = words[Math.min(wordIndex, words.length - 1)]!;
      const last = words[Math.min(wordIndex + group.length - 1, words.length - 1)]!;
      start = first.start;
      end = last.end;
      wordIndex += group.length;
    } else {
      start = seg.start + duration * (consumed / text.length);
      consumed += groupText.length + 1;
      end = seg.start + duration * Math.min(1, consumed / text.length);
    }
    cues.push({ start: roundMs(start), end: roundMs(Math.max(end, start + MIN_CUE_DURATION)), text: groupText });
  }
  return cues;
}

/** Caption-sized cues from speech-to-text segments. */
export function segmentsToCues(segments: readonly TimedSegment[], layout: CaptionLayout = DEFAULT_CAPTION_LAYOUT): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const seg of segments) {
    if (!seg.text?.trim()) continue;
    cues.push(...splitSegment(seg, layout));
  }
  // Word timestamps can overlap slightly across groups: keep cues in order and non-overlapping.
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!;
    const cue = cues[i]!;
    if (cue.start < prev.end) {
      if (cue.start > prev.start + MIN_CUE_DURATION) prev.end = cue.start;
      else cue.start = prev.end;
      if (cue.end < cue.start + MIN_CUE_DURATION) cue.end = roundMs(cue.start + MIN_CUE_DURATION);
    }
  }
  return normalizeCues(cues);
}
