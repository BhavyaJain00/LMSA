/**
 * Adaptive bitrate logic for the HLS engine. Pure and DOM-free.
 *
 * Throughput is estimated with two exponentially weighted moving averages
 * (a fast one reacting within a few seconds and a slow one smoothing
 * spikes); the estimate is the lower of the two, so drops are acted on
 * quickly while recoveries are trusted slowly. `chooseLevel` combines that
 * estimate with the forward buffer and the player size:
 *  - never pick a rendition much larger than the player can show;
 *  - switch up only with headroom, a healthy buffer and after a hold time
 *    since the last switch (hysteresis, no flapping);
 *  - switch down as soon as the current rendition no longer fits, or at once
 *    to a much lower one when the buffer is about to run dry.
 */

/** Exponentially weighted moving average with a half-life measured in sample weight (seconds). */
export class Ewma {
  private estimate = 0;
  private totalWeight = 0;
  private readonly alpha: number;

  constructor(halfLife: number) {
    this.alpha = halfLife > 0 ? Math.exp(Math.log(0.5) / halfLife) : 0;
  }

  sample(weight: number, value: number): void {
    if (!(weight > 0) || !Number.isFinite(value)) return;
    const adjAlpha = Math.pow(this.alpha, weight);
    this.estimate = value * (1 - adjAlpha) + adjAlpha * this.estimate;
    this.totalWeight += weight;
  }

  /** Bias-corrected estimate (early samples are not pulled towards 0). */
  get value(): number {
    if (!this.totalWeight) return 0;
    const zeroFactor = 1 - Math.pow(this.alpha, this.totalWeight);
    return zeroFactor > 0 ? this.estimate / zeroFactor : this.estimate;
  }

  get weight(): number {
    return this.totalWeight;
  }
}

export interface BandwidthEstimatorOptions {
  /** Estimate (bits/s) used before enough samples arrived. */
  defaultEstimate: number;
  fastHalfLife?: number;
  slowHalfLife?: number;
  /** Downloads smaller than this (bytes) are dominated by latency and ignored. */
  minSampleBytes?: number;
  /** Sample weight (seconds) needed before the measured estimate replaces the default. */
  minTotalWeight?: number;
}

export class BandwidthEstimator {
  private readonly fast: Ewma;
  private readonly slow: Ewma;
  private readonly minBytes: number;
  private readonly minWeight: number;
  private defaultEstimate: number;
  private samples = 0;

  constructor(opts: BandwidthEstimatorOptions) {
    this.fast = new Ewma(opts.fastHalfLife ?? 3);
    this.slow = new Ewma(opts.slowHalfLife ?? 9);
    this.minBytes = opts.minSampleBytes ?? 16_000;
    this.minWeight = opts.minTotalWeight ?? 0.1;
    this.defaultEstimate = opts.defaultEstimate;
  }

  /** Record one download: `durationMs` from request start to the last byte. */
  sample(durationMs: number, bytes: number): void {
    if (bytes < this.minBytes || !(durationMs > 0)) return;
    const seconds = Math.max(durationMs, 1) / 1000;
    const bps = (8 * bytes) / seconds;
    this.fast.sample(seconds, bps);
    this.slow.sample(seconds, bps);
    this.samples++;
  }

  get sampleCount(): number {
    return this.samples;
  }

  /** Bits per second. */
  getEstimate(): number {
    if (this.fast.weight < this.minWeight) return this.defaultEstimate;
    return Math.min(this.fast.value, this.slow.value);
  }

  setDefault(estimate: number): void {
    if (estimate > 0) this.defaultEstimate = estimate;
  }
}

/* ------------------------------------------------------------------ */
/* Level choice                                                         */
/* ------------------------------------------------------------------ */

export interface AbrLevel {
  /** Peak bits per second (EXT-X-STREAM-INF BANDWIDTH). */
  bandwidth: number;
  height?: number;
}

export interface AbrInput {
  /** Playable levels (any order). */
  levels: readonly AbrLevel[];
  /** Index of the level currently being loaded, or -1 before the first choice. */
  current: number;
  /** Estimated throughput, bits/s. */
  estimate: number;
  /** Seconds buffered ahead of the playhead. */
  bufferAhead: number;
  /** Typical segment duration (EXT-X-TARGETDURATION). */
  segmentDuration: number;
  /** Seconds since the last level switch (Infinity if none yet). */
  sinceLastSwitch: number;
  /** Rendered player height in device pixels; levels far above it are skipped. */
  maxHeight?: number;
  /** Playback rate: faster playback needs proportionally more bandwidth. */
  playbackRate?: number;
  /** Data Saver: always the lowest level. */
  saveData?: boolean;
}

/** Share of the estimate a level may use when starting or switching up. */
export const UP_FACTOR = 0.7;
/** Share of the estimate the current level may use before switching down. */
export const DOWN_FACTOR = 0.85;
/** Seconds to hold a level before switching up again. */
export const UP_HOLD_SECONDS = 8;
/** With this much buffer the current level is kept even when the estimate dips slightly. */
export const COMFORT_BUFFER_SECONDS = 20;

function indicesByBandwidth(levels: readonly AbrLevel[]): number[] {
  return levels.map((_, i) => i).sort((a, b) => levels[a]!.bandwidth - levels[b]!.bandwidth);
}

/**
 * Levels allowed by the player size: every level up to and including the
 * first one that is at least as tall as the player (so the picture is never
 * upscaled from far below), plus levels without a known height.
 */
export function levelsWithinCap(levels: readonly AbrLevel[], maxHeight: number | undefined): number[] {
  const sorted = indicesByBandwidth(levels);
  if (!maxHeight || !Number.isFinite(maxHeight) || maxHeight <= 0) return sorted;
  const heights = sorted.map((i) => levels[i]!.height).filter((h): h is number => !!h);
  const fitting = heights.filter((h) => h >= maxHeight * 0.9);
  const capHeight = fitting.length ? Math.min(...fitting) : Math.max(0, ...heights);
  const allowed = sorted.filter((i) => {
    const h = levels[i]!.height;
    return !h || h <= capHeight;
  });
  return allowed.length ? allowed : sorted.slice(0, 1);
}

/** Highest allowed level whose bandwidth fits in `budget`, else the lowest allowed. */
function highestFitting(levels: readonly AbrLevel[], allowed: number[], budget: number, rate: number): number {
  let pick = allowed[0]!;
  for (const i of allowed) if (levels[i]!.bandwidth * rate <= budget) pick = i;
  return pick;
}

/** Index of the level to load next. */
export function chooseLevel(input: AbrInput): number {
  const { levels } = input;
  if (!levels.length) return -1;
  if (levels.length === 1) return 0;
  const rate = Math.max(0.25, input.playbackRate ?? 1);
  const allowed = levelsWithinCap(levels, input.maxHeight);
  const lowest = allowed[0]!;
  if (input.saveData) return lowest;
  const estimate = Math.max(0, input.estimate);

  const current = input.current;
  if (current < 0 || current >= levels.length) return highestFitting(levels, allowed, estimate * UP_FACTOR, rate);

  // The player shrank (left fullscreen, docked): drop to the cap.
  if (!allowed.includes(current)) return highestFitting(levels, allowed, estimate * DOWN_FACTOR, rate);

  const currentCost = levels[current]!.bandwidth * rate;
  const seg = Math.max(1, input.segmentDuration);

  // About to stall: go straight to what the estimate comfortably sustains.
  if (input.bufferAhead < Math.min(seg, 4) && currentCost > estimate * 0.9) {
    return highestFitting(levels, allowed, estimate * 0.5, rate);
  }

  // The current level no longer fits: step down (unless a large buffer absorbs a small dip).
  if (currentCost > estimate * DOWN_FACTOR) {
    if (input.bufferAhead >= COMFORT_BUFFER_SECONDS && currentCost <= estimate) return current;
    return highestFitting(levels, allowed, estimate * DOWN_FACTOR, rate);
  }

  // Consider switching up: headroom, buffer and a hold time since the last switch.
  const candidate = highestFitting(levels, allowed, estimate * UP_FACTOR, rate);
  if (levels[candidate]!.bandwidth > levels[current]!.bandwidth) {
    const healthy = input.bufferAhead >= Math.min(10, 2 * seg);
    if (healthy && input.sinceLastSwitch >= UP_HOLD_SECONDS) return candidate;
  }
  return current;
}

/**
 * Initial estimate (bits/s) before any segment was measured: a saved
 * estimate from an earlier session, the Network Information API's
 * `downlink` (Mbit/s), or a conservative 1.5 Mbit/s.
 */
export function initialEstimate(saved: number | null | undefined, downlinkMbps: number | null | undefined): number {
  if (saved && Number.isFinite(saved) && saved > 50_000) return saved;
  if (downlinkMbps && Number.isFinite(downlinkMbps) && downlinkMbps > 0) return downlinkMbps * 1_000_000 * 0.8;
  return 1_500_000;
}

/**
 * Whether an in-flight segment download should be abandoned for a lower
 * level: it will take longer than the buffer lasts and a lower level would
 * arrive in time.
 */
export function shouldAbandonDownload(opts: {
  elapsedMs: number;
  loadedBytes: number;
  totalBytes: number | null;
  segmentDuration: number;
  bufferAhead: number;
  lowerLevelBandwidth: number | null;
  playbackRate?: number;
}): boolean {
  const { elapsedMs, loadedBytes, totalBytes, segmentDuration, bufferAhead, lowerLevelBandwidth } = opts;
  if (lowerLevelBandwidth === null || elapsedMs < 500) return false;
  const rate = Math.max(0.25, opts.playbackRate ?? 1);
  // Only when the download already takes longer than half the segment's play time.
  if (elapsedMs < (segmentDuration * 1000 * 0.5) / rate) return false;
  const seconds = elapsedMs / 1000;
  const bps = loadedBytes > 0 ? (loadedBytes * 8) / seconds : 0;
  if (!bps) return bufferAhead / rate < seconds;
  const expectedBytes = totalBytes && totalBytes > loadedBytes ? totalBytes : Math.max(loadedBytes * 1.5, 1);
  const remaining = ((expectedBytes - loadedBytes) * 8) / bps;
  const playable = bufferAhead / rate;
  if (remaining <= playable) return false;
  const lowerTime = (lowerLevelBandwidth * segmentDuration) / bps;
  return lowerTime < remaining && lowerTime < playable;
}
