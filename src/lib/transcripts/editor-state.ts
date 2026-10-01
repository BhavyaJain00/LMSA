import type { TranscriptCue } from "@/lib/types";
import { MAX_CUES, MAX_CUE_TEXT, MIN_CUE_DURATION, MAX_CUE_TIME, cueIssues, mergeWithNext, sameCues, searchCues, type CueIssue } from "./cues";
import { parseTimestamp } from "./format";

/**
 * Pure state helpers of the transcript editor (client): undo/redo history
 * with coalesced typing, time-field parsing and formatting, cue edits that
 * keep raw text while typing (cleaning happens on save), bulk operations,
 * import modes, the filtered/paginated view and job status labels.
 */

const roundMs = (n: number) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------ */
/* History                                                              */
/* ------------------------------------------------------------------ */

/** Undo steps kept (older ones are dropped). */
export const HISTORY_LIMIT = 100;

export interface CueHistory {
  past: TranscriptCue[][];
  present: TranscriptCue[];
  future: TranscriptCue[][];
  /** Key of the last change: consecutive changes with the same key form one undo step (typing in one cue). */
  lastKey: string | null;
}

export function initHistory(cues: readonly TranscriptCue[]): CueHistory {
  return { past: [], present: [...cues], future: [], lastKey: null };
}

/**
 * Record `next` as the current cue list. With a `coalesceKey` equal to the
 * previous change's key, the change joins the previous undo step.
 */
export function commitCues(h: CueHistory, next: readonly TranscriptCue[], coalesceKey: string | null = null): CueHistory {
  if (sameCues(h.present, next)) return coalesceKey === h.lastKey ? h : { ...h, lastKey: coalesceKey };
  if (coalesceKey !== null && coalesceKey === h.lastKey && h.past.length) {
    return { past: h.past, present: [...next], future: [], lastKey: coalesceKey };
  }
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: [...next], future: [], lastKey: coalesceKey };
}

export function undoCues(h: CueHistory): CueHistory {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null };
}

export function redoCues(h: CueHistory): CueHistory {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), lastKey: null };
}

/* ------------------------------------------------------------------ */
/* Time fields                                                          */
/* ------------------------------------------------------------------ */

/**
 * Read a time typed in the editor: "1:02.5", "01:02:03,250", "62.5" or "62"
 * (seconds). Returns null when it is not a time or is out of range.
 */
export function parseTimeInput(value: string): number | null {
  const v = value.trim().replace(/\s+/g, "");
  if (!v) return null;
  let seconds: number;
  if (/^\d+(?:[.,]\d+)?$/.test(v)) seconds = Number(v.replace(",", "."));
  else {
    // parseTimestamp reads 1–3 fraction digits; longer fractions are rounded to milliseconds first.
    const trimmed = v.replace(/([.,])(\d{3})\d+$/, "$1$2");
    seconds = parseTimestamp(trimmed);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_CUE_TIME) return null;
  return roundMs(seconds);
}

/** Time shown in an editor field: "1:02.500", or "1:01:02.500" past an hour. */
export function formatTimeInput(seconds: number): string {
  const totalMs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = String(totalMs % 1000).padStart(3, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}.${ms}` : `${m}:${ss}.${ms}`;
}

/** Read a signed offset such as "+1.5", "-0:02.250" or "2". */
export function parseOffsetInput(value: string): number | null {
  const v = value.trim();
  const m = /^([+-])?\s*(.+)$/.exec(v);
  if (!m) return null;
  const magnitude = parseTimeInput(m[2]!);
  if (magnitude === null) return null;
  return m[1] === "-" ? -magnitude : magnitude;
}

/* ------------------------------------------------------------------ */
/* Cue edits                                                            */
/* ------------------------------------------------------------------ */

/** Stable sort by start time (the editor keeps cues in playback order). */
export function sortCues(cues: readonly TranscriptCue[]): TranscriptCue[] {
  return cues
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.start - b.c.start || a.i - b.i)
    .map(({ c }) => c);
}

/** Replace a cue's text as typed (cleaned only when saved). */
export function setCueText(cues: readonly TranscriptCue[], index: number, text: string): TranscriptCue[] {
  const cue = cues[index];
  if (!cue) return [...cues];
  const out = [...cues];
  out[index] = { ...cue, text: text.slice(0, MAX_CUE_TEXT) };
  return out;
}

export type SetTimesResult = { ok: true; cues: TranscriptCue[]; index: number } | { ok: false; error: string };

/**
 * Change a cue's start and/or end. The end must come at least
 * `MIN_CUE_DURATION` after the start. The list is re-sorted; `index` is
 * where the cue ended up.
 */
export function setCueTimes(cues: readonly TranscriptCue[], index: number, times: { start?: number; end?: number }): SetTimesResult {
  const cue = cues[index];
  if (!cue) return { ok: false, error: "This caption no longer exists." };
  const start = roundMs(times.start ?? cue.start);
  const end = roundMs(times.end ?? cue.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > MAX_CUE_TIME + MIN_CUE_DURATION) return { ok: false, error: "Enter a time such as 1:02.500." };
  if (end < start + MIN_CUE_DURATION - 1e-9) return { ok: false, error: "The end must come after the start." };
  const updated = { ...cue, start, end };
  const out = [...cues];
  out[index] = updated;
  const sorted = sortCues(out);
  return { ok: true, cues: sorted, index: sorted.indexOf(updated) };
}

/** Remove the cues at the given indices. */
export function removeCues(cues: readonly TranscriptCue[], indices: Iterable<number>): TranscriptCue[] {
  const drop = new Set(indices);
  return cues.filter((_, i) => !drop.has(i));
}

/** Merge the consecutive cues `from`..`to` (inclusive) into one. */
export function mergeRange(cues: readonly TranscriptCue[], from: number, to: number): TranscriptCue[] {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(cues.length - 1, Math.max(from, to));
  let out = [...cues];
  for (let i = a; i < b; i++) out = mergeWithNext(out, a);
  return out;
}

/** Whether a set of indices is one consecutive run (bulk merge needs that). */
export function isConsecutive(indices: readonly number[]): boolean {
  if (indices.length < 2) return false;
  const sorted = [...indices].sort((x, y) => x - y);
  return sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
}

/** Close every gap shorter than `maxGap` seconds by extending the earlier cue, and trim overlaps. */
export function closeSmallGaps(cues: readonly TranscriptCue[], maxGap = 0.5): TranscriptCue[] {
  const out = cues.map((c) => ({ ...c }));
  for (let i = 0; i < out.length - 1; i++) {
    const cue = out[i]!;
    const next = out[i + 1]!;
    const gap = next.start - cue.end;
    if ((gap > 0 && gap <= maxGap) || (gap < 0 && next.start >= cue.start + MIN_CUE_DURATION)) cue.end = roundMs(next.start);
  }
  return out;
}

/** Scale every time by `factor` (fixes captions made for a different frame rate, e.g. 25 / 23.976). */
export function scaleCues(cues: readonly TranscriptCue[], factor: number): TranscriptCue[] {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return [...cues];
  return cues.map((c) => {
    const start = roundMs(Math.min(c.start * factor, MAX_CUE_TIME));
    return { ...c, start, end: roundMs(Math.max(start + MIN_CUE_DURATION, Math.min(c.end * factor, MAX_CUE_TIME + MIN_CUE_DURATION))) };
  });
}

/* ------------------------------------------------------------------ */
/* Import                                                               */
/* ------------------------------------------------------------------ */

export type ImportMode = "replace" | "append";

/**
 * Combine imported cues with the current ones: replace them, or add them
 * (sorted into place, optionally moved by `offset` seconds). Capped at
 * `MAX_CUES`; `dropped` counts the cues that did not fit.
 */
export function combineImported(current: readonly TranscriptCue[], imported: readonly TranscriptCue[], mode: ImportMode, offset = 0): { cues: TranscriptCue[]; dropped: number } {
  const moved = offset
    ? imported.map((c) => ({ ...c, start: roundMs(Math.max(0, c.start + offset)), end: roundMs(Math.max(Math.max(0, c.start + offset) + MIN_CUE_DURATION, c.end + offset)) }))
    : [...imported];
  const all = mode === "replace" ? moved : sortCues([...current, ...moved]);
  return { cues: all.slice(0, MAX_CUES), dropped: Math.max(0, all.length - MAX_CUES) };
}

/* ------------------------------------------------------------------ */
/* View: filters and pages                                              */
/* ------------------------------------------------------------------ */

export const PAGE_SIZE = 50;

export type CueFilter = "all" | "issues" | "empty";

/** Indices of the cues shown for a text query and filter (in order). */
export function visibleCueIndices(cues: readonly TranscriptCue[], query: string, filter: CueFilter, issues: readonly CueIssue[] = []): number[] {
  let indices = query.trim() ? searchCues(cues, query) : cues.map((_, i) => i);
  if (filter === "issues") {
    const flagged = new Set(issues.map((x) => x.index));
    indices = indices.filter((i) => flagged.has(i));
  } else if (filter === "empty") {
    indices = indices.filter((i) => !cues[i]!.text.trim());
  }
  return indices;
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Page (0-based) holding position `position` of the visible list. */
export function pageOfPosition(position: number, pageSize = PAGE_SIZE): number {
  return position < 0 ? 0 : Math.floor(position / pageSize);
}

/** Clamp a page number into range. */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(0, Math.floor(page)), pageCount(total, pageSize) - 1);
}

/* ------------------------------------------------------------------ */
/* Summary and checks                                                   */
/* ------------------------------------------------------------------ */

export interface CueSummary {
  count: number;
  words: number;
  /** End of the last cue (seconds). */
  end: number;
  empty: number;
  issues: number;
}

export function summarizeCues(cues: readonly TranscriptCue[], issues: readonly CueIssue[] = cueIssues(cues)): CueSummary {
  let words = 0;
  let empty = 0;
  let end = 0;
  for (const c of cues) {
    const t = c.text.trim();
    if (!t) empty++;
    else words += t.split(/\s+/).length;
    if (c.end > end) end = c.end;
  }
  return { count: cues.length, words, end, empty, issues: new Set(issues.map((i) => i.index)).size };
}

/** Issues grouped by cue index, for the row badges. */
export function issuesByCue(issues: readonly CueIssue[]): Map<number, CueIssue[]> {
  const map = new Map<number, CueIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.index);
    if (list) list.push(issue);
    else map.set(issue.index, [issue]);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Automatic generation status                                          */
/* ------------------------------------------------------------------ */

export interface JobStateLike {
  stage: "queued" | "extracting" | "transcribing" | "saving";
  part?: number;
  parts?: number;
}

/** Human label of a generation job's stage. */
export function jobStageLabel(job: JobStateLike): string {
  switch (job.stage) {
    case "queued":
      return "Waiting for other transcripts to finish…";
    case "extracting":
      return "Extracting the audio track…";
    case "transcribing":
      return job.parts && job.parts > 1 && job.part ? `Transcribing part ${job.part} of ${job.parts}…` : "Transcribing the audio…";
    case "saving":
      return "Saving the captions…";
  }
}

/** Rough share of the job done (0–1), for a progress bar. */
export function jobProgress(job: JobStateLike): number {
  switch (job.stage) {
    case "queued":
      return 0;
    case "extracting":
      return 0.05;
    case "transcribing": {
      const parts = Math.max(1, job.parts ?? 1);
      const done = Math.max(0, (job.part ?? 1) - 1);
      return 0.1 + 0.85 * (done / parts);
    }
    case "saving":
      return 0.97;
  }
}
