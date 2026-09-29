import type { VideoWatch } from "@/lib/types";
import { MAX_PLAYBACK_RATE } from "./playback";
import { RETENTION_BINS, applyRangesToBins, capRanges, coveragePercent, sanitizeRanges, totalLength } from "./retention";

/**
 * Server-side accounting for video heartbeats (`POST /api/video-progress`).
 *
 * Nothing the client reports is taken at face value. Every increase is
 * bounded by the real time that passed on the server since the watch row
 * was last updated: at most `elapsed × MAX_PLAYBACK_RATE` of video (2× is the
 * fastest speed the player offers) plus a small slack that itself never
 * exceeds the elapsed time, so a flood of requests earns nothing extra.
 *
 *  - watch time grows by at most that budget (and 120 s per heartbeat);
 *  - the furthest point reached grows by at most that budget and never past
 *    the duration; with anti-skip on, the resume point never passes it;
 *  - retention ranges are capped by the budget, and one heartbeat can count
 *    no more bins than that budget covers;
 *  - the duration is the block's known duration when set (a client cannot
 *    shrink the video), otherwise the first reported one, which can only
 *    drift by ±5% afterwards;
 *  - completion is derived from what was watched: the share of the video's
 *    1% bins seen at least once reaches the threshold, or both the furthest
 *    point and the watch time reach it. `ended` alone completes nothing.
 *
 * Legitimate playback (heartbeats every ~10 s, 2× speed, pauses, seeking
 * back to rewatch) always fits inside these bounds.
 *
 * Pure module so it can be unit tested.
 */

/** Longest watch time one heartbeat may add. */
export const MAX_DELTA_SECONDS = 120;
/** Elapsed time credited to one heartbeat at most (an idle row does not bank hours of credit). */
export const MAX_ELAPSED_SECONDS = 120;
/** Elapsed time credited to the first heartbeat of a new row (the player sends one right after playback starts). */
export const NEW_ROW_ELAPSED_SECONDS = 15;
/** Slack for timer and network jitter, never more than the elapsed time itself. */
export const SLACK_SECONDS = 2;
/** Extra retention range allowed per heartbeat (range rounding, end-of-video extension). */
export const RANGE_SLACK_SECONDS = 3;
/** With anti-skip on, the resume point may be at most this far past the furthest point reached. */
export const POSITION_SLACK_SECONDS = 2;
/** A reported duration may differ this much from the stored one (re-encoded renditions). */
export const DURATION_TOLERANCE = 0.05;
/** Durations above this are not plausible lesson videos. */
export const MAX_VIDEO_SECONDS = 24 * 60 * 60;
/** With `ended`, a furthest point this close to the end snaps to the end. */
const END_TOLERANCE_SECONDS = 3;

export interface HeartbeatInput {
  position: number | null;
  watchedDelta: number | null;
  maxPosition: number | null;
  duration: number | null;
  ended: boolean;
  /** Raw `ranges` from the body ([start, end) pairs), validated here. */
  ranges: unknown;
}

export interface HeartbeatContext {
  /** Server time of this heartbeat (epoch ms). */
  nowMs: number;
  /** The row was created by this heartbeat. */
  isNew: boolean;
  /** `duration` of the video block, when known (trusted: set by the course editor). */
  blockDuration?: number;
  /** Completion threshold in percent (1-100). */
  thresholdPercent: number;
  /** Settings → Learning → prevent skipping videos. */
  preventSkipping: boolean;
}

export interface HeartbeatOutcome {
  /** Seconds of real time this heartbeat was credited with. */
  elapsed: number;
  /** Watch time actually added. */
  watchedAdded: number;
  /** Bins counted by this heartbeat. */
  binsCounted: number;
  duration: number;
  completed: boolean;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The duration to account against: block duration when known, else the stored one (±5% drift), else the report. */
export function resolveDuration(stored: number, reported: number | null, blockDuration?: number): number {
  if (finite(blockDuration) && blockDuration > 0) return blockDuration;
  const plausible = finite(reported) && reported > 0 && reported <= MAX_VIDEO_SECONDS ? reported : null;
  if (!(stored > 0)) return plausible ?? 0;
  if (plausible === null) return stored;
  return Math.abs(plausible - stored) <= stored * DURATION_TOLERANCE ? plausible : stored;
}

/** Real seconds since the row's last update that this heartbeat may account for. */
export function creditedElapsed(row: Pick<VideoWatch, "updatedAt">, nowMs: number, isNew: boolean): number {
  if (isNew) return NEW_ROW_ELAPSED_SECONDS;
  const last = Date.parse(row.updatedAt);
  if (!Number.isFinite(last)) return NEW_ROW_ELAPSED_SECONDS;
  return Math.min(Math.max(0, (nowMs - last) / 1000), MAX_ELAPSED_SECONDS);
}

/** Apply one heartbeat to a watch row (mutates `row`, including `updatedAt`). */
export function applyHeartbeat(row: VideoWatch, input: HeartbeatInput, ctx: HeartbeatContext): HeartbeatOutcome {
  const elapsed = creditedElapsed(row, ctx.nowMs, ctx.isNew);
  const slack = Math.min(SLACK_SECONDS, elapsed);
  // Video seconds that could really have been played since the last update.
  const budget = elapsed * MAX_PLAYBACK_RATE + slack;

  const duration = resolveDuration(row.durationSeconds, input.duration, ctx.blockDuration);
  if (duration > 0) row.durationSeconds = duration;

  // Watch time
  const delta = finite(input.watchedDelta) ? Math.min(Math.max(0, input.watchedDelta), MAX_DELTA_SECONDS, budget) : 0;
  row.watchSeconds += delta;

  // Furthest point reached: grows no faster than playback could.
  if (finite(input.maxPosition)) {
    let cap = row.maxPositionSeconds + budget;
    if (duration > 0) cap = Math.min(cap, duration);
    const next = Math.min(Math.max(0, input.maxPosition), cap);
    if (next > row.maxPositionSeconds) row.maxPositionSeconds = next;
  }
  if (input.ended && duration > 0 && duration - row.maxPositionSeconds <= END_TOLERANCE_SECONDS) row.maxPositionSeconds = duration;
  if (duration > 0 && row.maxPositionSeconds > duration) row.maxPositionSeconds = duration;

  // Resume point
  if (finite(input.position)) {
    let position = Math.max(0, input.position);
    if (duration > 0) position = Math.min(position, duration);
    if (ctx.preventSkipping) position = Math.min(position, row.maxPositionSeconds + POSITION_SLACK_SECONDS);
    row.lastPositionSeconds = position;
  }

  // Retention: ranges and counted bins limited to what the elapsed time allows.
  let binsCounted = 0;
  if (duration > 0 && input.ranges !== undefined) {
    const ranges = sanitizeRanges(input.ranges, duration);
    const allowed = Math.min(delta * 1.25, elapsed * MAX_PLAYBACK_RATE) + Math.min(RANGE_SLACK_SECONDS, elapsed);
    const capped = totalLength(ranges) > allowed ? capRanges(ranges, allowed) : ranges;
    const maxBins = Math.ceil(allowed / (duration / RETENTION_BINS));
    if (capped.length && maxBins > 0) {
      const before = row.bins ? row.bins.reduce((s, v) => s + (v > 0 ? v : 0), 0) : 0;
      row.bins = applyRangesToBins(row.bins, capped, duration, maxBins);
      binsCounted = row.bins.reduce((s, v) => s + v, 0) - before;
    }
  }

  // Completion from what was actually watched.
  if (!row.completed && duration > 0) {
    const needed = (duration * ctx.thresholdPercent) / 100;
    const covered = coveragePercent(row.bins) >= ctx.thresholdPercent;
    const progressed = row.maxPositionSeconds >= needed && row.watchSeconds >= needed;
    if (covered || progressed) row.completed = true;
  }

  row.updatedAt = new Date(ctx.nowMs).toISOString();
  return { elapsed, watchedAdded: delta, binsCounted, duration, completed: row.completed };
}
