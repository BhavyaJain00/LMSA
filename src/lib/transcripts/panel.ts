import type { Transcript, TranscriptCue } from "@/lib/types";
import { parseTime } from "@/lib/utils";
import { MAX_CUE_TIME, foldText, matchRanges } from "./cues";

/**
 * Pure logic of the learner transcript panel (client-safe): the wire shape of
 * a transcript, in-transcript search with match navigation, where to scroll
 * the cue list, and `?t=` deep links into a video.
 */

/** Shortest text searched, in the panel and across lessons. */
export const MIN_QUERY_LENGTH = 2;
/** Longest text searched. */
export const MAX_QUERY_LENGTH = 100;

/** What a viewer receives of a transcript. */
export interface TranscriptView {
  id: string;
  language: string;
  source: Transcript["source"];
  updatedAt: string;
  cues: TranscriptCue[];
}

/** Body of `GET /api/transcripts/<lessonId>/<blockId>`. */
export interface TranscriptPayload {
  ok: true;
  /** Null when the video has no transcript (yet). */
  transcript: TranscriptView | null;
  /** Course managers only: a transcript is being generated and has no captions yet. */
  pending: boolean;
  courseId: string;
  /** Course managers only: the transcript editor of this video. */
  editHref: string | null;
}

/* ------------------------------------------------------------------ */
/* Search inside one transcript                                         */
/* ------------------------------------------------------------------ */

/** One occurrence of the searched text: characters [start, end) of cue `cue`. */
export interface PanelMatch {
  cue: number;
  start: number;
  end: number;
}

/** Most occurrences highlighted at once (a two-letter search in a long video can hit thousands). */
export const MAX_PANEL_MATCHES = 1000;

/** Folded text of each cue, computed once per transcript so typing only scans strings. */
export function foldCues(cues: readonly Pick<TranscriptCue, "text">[]): string[] {
  return cues.map((c) => foldText(c.text.replace(/\s+/g, " ")));
}

/**
 * Every occurrence of `query` in the transcript, in playback order, ignoring
 * case and accents. Queries shorter than `MIN_QUERY_LENGTH` match nothing.
 * `truncated` is set when more than `limit` occurrences exist.
 */
export function findPanelMatches(
  cues: readonly Pick<TranscriptCue, "text">[],
  query: string,
  folded: readonly string[] = foldCues(cues),
  limit: number = MAX_PANEL_MATCHES,
): { matches: PanelMatch[]; truncated: boolean } {
  const q = foldText(query.trim().slice(0, MAX_QUERY_LENGTH)).replace(/\s+/g, " ");
  const matches: PanelMatch[] = [];
  if (q.length < MIN_QUERY_LENGTH) return { matches, truncated: false };
  for (let i = 0; i < cues.length; i++) {
    if (!folded[i]?.includes(q)) continue;
    for (const [start, end] of matchRanges(cues[i]!.text, query)) {
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({ cue: i, start, end });
    }
  }
  return { matches, truncated: false };
}

/** The match `delta` steps from `current`, wrapping around; -1 when there are none. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  const from = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (((from + delta) % total) + total) % total;
}

/**
 * The match a new search starts on: the first one at or after cue
 * `fromCue` (where the video is), else the first match of the transcript.
 */
export function firstMatchFrom(matches: readonly Pick<PanelMatch, "cue">[], fromCue: number): number {
  if (!matches.length) return -1;
  const at = matches.findIndex((m) => m.cue >= fromCue);
  return at < 0 ? 0 : at;
}

/* ------------------------------------------------------------------ */
/* Scrolling the cue list                                               */
/* ------------------------------------------------------------------ */

export interface ScrollViewport {
  scrollTop: number;
  /** Visible height of the list. */
  height: number;
  /** Full height of its content. */
  scrollHeight: number;
}

/**
 * Where to scroll the list so the row at `top` (relative to the content) is
 * comfortable to read, or null when it already is. A row is left alone while
 * it sits fully inside the viewport minus a margin, so the list does not
 * move on every cue; once it leaves, it is placed a third of the way down
 * with the lines that follow below it.
 */
export function scrollTopFor(row: { top: number; height: number }, view: ScrollViewport): number | null {
  if (view.height <= 0) return null;
  const margin = Math.min(48, view.height / 4);
  const bottom = row.top + row.height;
  const comfortable = row.top >= view.scrollTop + margin && bottom <= view.scrollTop + view.height - margin;
  if (comfortable) return null;
  const max = Math.max(0, view.scrollHeight - view.height);
  const target = Math.min(max, Math.max(0, Math.round(row.top - view.height / 3)));
  return Math.abs(target - view.scrollTop) < 1 ? null : target;
}

/* ------------------------------------------------------------------ */
/* Deep links                                                           */
/* ------------------------------------------------------------------ */

/**
 * Seconds from a `?t=` value: "135", "2:15", "1:02:03" or "1h2m3s" / "2m15s"
 * / "90s". Null when missing or invalid.
 */
export function parseTimeParam(raw: string | null | undefined): number | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  let seconds: number;
  const parts = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(value);
  if (parts && (parts[1] || parts[2] || parts[3])) {
    seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  } else {
    seconds = parseTime(value);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_CUE_TIME) return null;
  return seconds;
}

/**
 * Link to a lesson that starts a video at `seconds`. `blockId` is added only
 * for a video that is not the lesson's first one (the first is the default
 * target of `?t=`).
 */
export function lessonTimeHref(lessonHref: string, seconds: number, blockId?: string | null): string {
  const t = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${lessonHref}?t=${t}${blockId ? `&block=${encodeURIComponent(blockId)}` : ""}`;
}
