/**
 * Playback speeds offered by the custom player. Shared with the server so
 * heartbeat validation never allows more than the fastest real playback.
 */
export const PLAYBACK_RATES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Fastest playback the player allows (media seconds per wall-clock second). */
export const MAX_PLAYBACK_RATE = Math.max(...PLAYBACK_RATES);
