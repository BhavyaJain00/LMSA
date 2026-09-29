/**
 * Retention analytics for lesson videos (pure functions, shared by the
 * progress API, the analytics pages and tests).
 *
 * Every VideoWatch keeps `bins`: 100 counters, one per 1% of the video. Each
 * heartbeat reports the ranges played since the previous heartbeat; every bin
 * whose midpoint lies inside those ranges grows by exactly one "viewing
 * pass". Because heartbeat ranges are contiguous and half-open, continuous
 * playback counts each bin once, while rewatching a section counts again.
 */

export const RETENTION_BINS = 100;
/** Most ranges accepted from one heartbeat. */
export const MAX_HEARTBEAT_RANGES = 64;

/** [start, end) in seconds. */
export type WatchRange = [number, number];

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate ranges reported by a client: numbers only, clamped to the video,
 * zero-length ranges dropped, overlapping/adjacent ranges merged, sorted.
 */
export function sanitizeRanges(raw: unknown, duration: number, maxRanges = MAX_HEARTBEAT_RANGES): WatchRange[] {
  if (!Array.isArray(raw) || !(duration > 0)) return [];
  const ranges: WatchRange[] = [];
  for (const item of raw.slice(0, maxRanges)) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [a, b] = item as unknown[];
    if (!isNum(a) || !isNum(b)) continue;
    const start = Math.max(0, Math.min(a, duration));
    const end = Math.max(0, Math.min(b, duration));
    if (end - start <= 0) continue;
    ranges.push([start, end]);
  }
  return mergeRanges(ranges);
}

/** Union of ranges, sorted by start. */
export function mergeRanges(ranges: WatchRange[]): WatchRange[] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: WatchRange[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function totalLength(ranges: WatchRange[]): number {
  return ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/**
 * Limit the total length of (merged) ranges to `maxSeconds`, keeping the
 * earliest parts. Protects the counters against inflated reports.
 */
export function capRanges(ranges: WatchRange[], maxSeconds: number): WatchRange[] {
  if (!(maxSeconds > 0)) return [];
  const out: WatchRange[] = [];
  let left = maxSeconds;
  for (const [a, b] of ranges) {
    if (left <= 0) break;
    const len = b - a;
    if (len <= left) {
      out.push([a, b]);
      left -= len;
    } else {
      out.push([a, a + left]);
      left = 0;
    }
  }
  return out;
}

/** A fresh zeroed bins array (or a copy normalized to RETENTION_BINS entries). */
export function normalizeBins(bins: readonly number[] | undefined): number[] {
  const out = new Array<number>(RETENTION_BINS).fill(0);
  if (!bins) return out;
  for (let i = 0; i < RETENTION_BINS; i++) {
    const v = bins[i];
    out[i] = isNum(v) && v > 0 ? Math.floor(v) : 0;
  }
  return out;
}

/** Indexes of the bins whose midpoint falls inside the (merged) ranges. */
export function binsCovered(ranges: WatchRange[], duration: number): number[] {
  if (!(duration > 0) || !ranges.length) return [];
  const width = duration / RETENTION_BINS;
  const covered: number[] = [];
  for (const [a, b] of ranges) {
    // midpoint m_i = (i + 0.5) * width; covered when a <= m_i < b
    const first = Math.max(0, Math.ceil(a / width - 0.5));
    const last = Math.min(RETENTION_BINS - 1, Math.ceil(b / width - 0.5) - 1);
    for (let i = first; i <= last; i++) covered.push(i);
  }
  return Array.from(new Set(covered)).sort((x, y) => x - y);
}

/**
 * Add one viewing pass to every bin covered by `ranges`. Each bin grows by at
 * most one per call, so a single heartbeat can never add more than the range
 * it reported. `maxBins` caps how many bins one call may count (the earliest
 * covered bins win), so many tiny ranges around bin midpoints cannot credit
 * more of the video than the time the heartbeat could really cover.
 */
export function applyRangesToBins(bins: readonly number[] | undefined, ranges: WatchRange[], duration: number, maxBins: number = RETENTION_BINS): number[] {
  const next = normalizeBins(bins);
  const limit = Math.max(0, Math.floor(maxBins));
  for (const i of binsCovered(mergeRanges(ranges), duration).slice(0, limit)) next[i] = (next[i] ?? 0) + 1;
  return next;
}

/** Estimated bins for a legacy watch without bins: one pass from 0 to the furthest point. */
export function estimateBinsFromMax(maxPosition: number, duration: number): number[] {
  if (!(duration > 0) || !(maxPosition > 0)) return normalizeBins(undefined);
  return applyRangesToBins(undefined, [[0, Math.min(maxPosition, duration)]], duration);
}

/** Share (0-100) of the video a viewer has seen at least once. */
export function coveragePercent(bins: readonly number[] | undefined): number {
  if (!bins) return 0;
  let seen = 0;
  for (let i = 0; i < RETENTION_BINS; i++) if ((bins[i] ?? 0) > 0) seen++;
  return Math.round((seen / RETENTION_BINS) * 100);
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                          */
/* ------------------------------------------------------------------ */

export interface RetentionInput {
  bins?: number[];
  maxPositionSeconds: number;
  durationSeconds: number;
}

export interface RetentionSummary {
  /** 100 points: % of viewers who watched each 1% of the video. */
  retention: number[];
  /** 100 points: average viewing passes per viewer over each 1% (rewatches > 1). */
  passes: number[];
  viewers: number;
  /** Some viewers had no bins yet (watched before analytics existed): their curve is estimated from the furthest point. */
  estimated: boolean;
}

export function summarizeRetention(watches: RetentionInput[], fallbackDuration = 0): RetentionSummary {
  const viewers = watches.length;
  const reached = new Array<number>(RETENTION_BINS).fill(0);
  const passes = new Array<number>(RETENTION_BINS).fill(0);
  let estimated = false;
  for (const w of watches) {
    let bins: number[];
    if (w.bins && w.bins.some((v) => v > 0)) bins = normalizeBins(w.bins);
    else {
      estimated = estimated || w.maxPositionSeconds > 0;
      bins = estimateBinsFromMax(w.maxPositionSeconds, w.durationSeconds || fallbackDuration);
    }
    for (let i = 0; i < RETENTION_BINS; i++) {
      const v = bins[i] ?? 0;
      if (v > 0) reached[i] = (reached[i] ?? 0) + 1;
      passes[i] = (passes[i] ?? 0) + v;
    }
  }
  return {
    retention: reached.map((n) => (viewers ? Math.round((n / viewers) * 1000) / 10 : 0)),
    passes: passes.map((n) => (viewers ? Math.round((n / viewers) * 100) / 100 : 0)),
    viewers,
    estimated,
  };
}

export interface DropOffHotspot {
  /** First bin of the drop (0-99). */
  bin: number;
  /** Seconds into the video where the drop starts. */
  time: number;
  /** Retention before and after the drop (0-100). */
  from: number;
  to: number;
  /** Percentage points lost. */
  drop: number;
}

/**
 * The steepest drops in audience retention, measured over a short window so
 * noise from single bins is ignored. The last few percent (the natural end
 * of a video) are excluded. Returns at most `limit` non-overlapping drops of
 * at least `minDrop` percentage points, steepest first.
 */
export function findDropOffs(retention: number[], duration: number, opts: { window?: number; minDrop?: number; limit?: number; ignoreTail?: number } = {}): DropOffHotspot[] {
  const window = opts.window ?? 3;
  const minDrop = opts.minDrop ?? 5;
  const limit = opts.limit ?? 3;
  const tail = opts.ignoreTail ?? 3;
  const end = Math.max(0, retention.length - tail);
  const candidates: DropOffHotspot[] = [];
  for (let i = 0; i + window < end + 1 && i + window < retention.length; i++) {
    const from = retention[i] ?? 0;
    const to = retention[i + window] ?? 0;
    const drop = Math.round((from - to) * 10) / 10;
    if (drop >= minDrop) candidates.push({ bin: i, time: (i / RETENTION_BINS) * duration, from, to, drop });
  }
  candidates.sort((a, b) => b.drop - a.drop || a.bin - b.bin);
  const picked: DropOffHotspot[] = [];
  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (picked.some((p) => Math.abs(p.bin - c.bin) <= window * 2)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.bin - b.bin);
}

export interface RewatchHotspot {
  bin: number;
  time: number;
  /** Average passes per viewer who reached this point. */
  passesPerViewer: number;
}

/** Sections viewers replay the most (passes per reaching viewer well above 1). */
export function findRewatchHotspots(summary: RetentionSummary, duration: number, opts: { threshold?: number; limit?: number } = {}): RewatchHotspot[] {
  const threshold = opts.threshold ?? 1.3;
  const limit = opts.limit ?? 3;
  const scored: RewatchHotspot[] = [];
  for (let i = 0; i < RETENTION_BINS; i++) {
    const reachedShare = (summary.retention[i] ?? 0) / 100;
    if (reachedShare <= 0) continue;
    const perViewer = (summary.passes[i] ?? 0) / reachedShare;
    if (perViewer >= threshold) scored.push({ bin: i, time: (i / RETENTION_BINS) * duration, passesPerViewer: Math.round(perViewer * 10) / 10 });
  }
  scored.sort((a, b) => b.passesPerViewer - a.passesPerViewer || a.bin - b.bin);
  const picked: RewatchHotspot[] = [];
  for (const s of scored) {
    if (picked.length >= limit) break;
    if (picked.some((p) => Math.abs(p.bin - s.bin) <= 4)) continue;
    picked.push(s);
  }
  return picked.sort((a, b) => a.bin - b.bin);
}
