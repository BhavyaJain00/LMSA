/**
 * Buffer and segment bookkeeping for the HLS engine. Pure and DOM-free.
 */

import type { MediaSegment } from "./playlist";

export interface TimeRange {
  start: number;
  end: number;
}

/** Copy a `TimeRanges` object into plain ranges. */
export function toRanges(ranges: { length: number; start(i: number): number; end(i: number): number } | null | undefined): TimeRange[] {
  const out: TimeRange[] = [];
  if (!ranges) return out;
  for (let i = 0; i < ranges.length; i++) out.push({ start: ranges.start(i), end: ranges.end(i) });
  return out;
}

export interface BufferInfo {
  /** Start of the contiguous buffered range around `time` (or `time` when unbuffered). */
  start: number;
  /** End of that range (or `time` when unbuffered). */
  end: number;
  /** Seconds buffered ahead of `time`. */
  ahead: number;
  /** Whether `time` lies inside (or within `maxHole` of) a buffered range. */
  buffered: boolean;
}

/**
 * The contiguous buffer around `time`. Gaps shorter than `maxHole` (audio
 * priming, rounding between segments) are treated as continuous.
 */
export function bufferInfo(ranges: readonly TimeRange[], time: number, maxHole = 0.5): BufferInfo {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= maxHole) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  for (const r of merged) {
    if (time >= r.start - maxHole && time <= r.end) {
      return { start: Math.min(r.start, time), end: r.end, ahead: Math.max(0, r.end - time), buffered: true };
    }
  }
  return { start: time, end: time, ahead: 0, buffered: false };
}

/** Total seconds buffered behind `time`. */
export function backBufferLength(ranges: readonly TimeRange[], time: number): number {
  let total = 0;
  for (const r of ranges) if (r.start < time) total += Math.min(r.end, time) - r.start;
  return total;
}

/**
 * Index of the segment playing at `time` (binary search on start times).
 * Times before the first segment map to 0, times after the end to the last.
 */
export function segmentIndexAt(segments: readonly Pick<MediaSegment, "start" | "duration">[], time: number): number {
  if (!segments.length) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  if (time <= segments[0]!.start) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.start <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The next segment to download so that the buffer continues at `bufferEnd`.
 * `last` is the segment appended most recently (same timeline): when the
 * lookup lands on it again (the media was slightly shorter than its EXTINF
 * claims) the one after it is used, so no segment is downloaded twice in a row.
 * Returns `segments.length` when everything up to the end is buffered.
 */
export function nextSegmentIndex(segments: readonly Pick<MediaSegment, "start" | "duration">[], bufferEnd: number, last: number | null, tolerance = 0.25): number {
  if (!segments.length) return 0;
  const lastSeg = segments[segments.length - 1]!;
  if (bufferEnd >= lastSeg.start + lastSeg.duration - tolerance) return segments.length;
  let idx = segmentIndexAt(segments, bufferEnd + tolerance);
  if (last !== null && idx === last) idx = last + 1;
  return idx;
}

/**
 * The segment to load next for a track. With data buffered around the
 * playhead, loading continues where that buffer ends (`nextSegmentIndex`);
 * with nothing buffered there (start, seek into an empty region) it is the
 * segment containing the playhead itself, so playback never waits for a hole
 * to be jumped. Returns `segments.length` when nothing is left to load.
 */
export function segmentToLoad(
  segments: readonly Pick<MediaSegment, "start" | "duration">[],
  playhead: number,
  buffer: Pick<BufferInfo, "buffered" | "end">,
  last: number | null,
  tolerance = 0.25,
): number {
  if (!segments.length) return 0;
  if (buffer.buffered) return nextSegmentIndex(segments, buffer.end, last, tolerance);
  const lastSeg = segments[segments.length - 1]!;
  if (playhead >= lastSeg.start + lastSeg.duration - tolerance) return segments.length;
  return segmentIndexAt(segments, Math.max(0, playhead));
}

/**
 * Buffered ranges far ahead of the playhead that are not connected to the
 * buffer around it (left behind by a backward seek). They are removed so
 * they cannot fill the SourceBuffer quota; data within `keepAhead` seconds
 * stays because loading will reach it soon.
 */
export function detachedForwardRanges(ranges: readonly TimeRange[], time: number, keepAhead: number, maxHole = 0.5): TimeRange[] {
  const around = bufferInfo(ranges, time, maxHole);
  const limit = Math.max(around.end, time) + keepAhead;
  return ranges.filter((r) => r.end > r.start && r.start > around.end + maxHole && r.start > limit).map((r) => ({ start: r.start, end: r.end }));
}

/**
 * Back-buffer eviction: the range to remove so that at most `keep` seconds
 * stay behind `time`. Null when nothing (or less than `minChunk` seconds)
 * needs removing.
 */
export function evictionRange(ranges: readonly TimeRange[], time: number, keep: number, minChunk = 5): TimeRange | null {
  const first = [...ranges].sort((a, b) => a.start - b.start)[0];
  if (!first) return null;
  const cutoff = time - keep;
  if (cutoff - first.start < minChunk) return null;
  return { start: first.start, end: cutoff };
}

/**
 * Where a forward flush for a quality change should start: the end of the
 * segment containing `time` + `margin` (so the current segment keeps
 * playing), or null when nothing lies ahead of it in the buffer.
 */
export function forwardFlushStart(segments: readonly Pick<MediaSegment, "start" | "duration">[], time: number, bufferEnd: number, margin = 1): number | null {
  if (!segments.length) return null;
  const seg = segments[segmentIndexAt(segments, time + margin)]!;
  const from = seg.start + seg.duration;
  return from < bufferEnd - 0.1 ? from : null;
}

/** Exponential backoff with ±20 % jitter: 0.5 s, 1 s, 2 s, 4 s… capped at `maxMs`. */
export function retryDelayMs(attempt: number, baseMs = 500, maxMs = 8000, random: () => number = Math.random): number {
  const raw = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(raw * jitter);
}
