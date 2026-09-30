import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BandwidthEstimator,
  COMFORT_BUFFER_SECONDS,
  Ewma,
  UP_HOLD_SECONDS,
  chooseLevel,
  initialEstimate,
  levelsWithinCap,
  shouldAbandonDownload,
  type AbrInput,
} from "@/components/player/hls/abr";

/** 480p / 720p / 1080p ladder like the transcoder writes (sorted by bandwidth). */
const LEVELS = [
  { bandwidth: 1_100_000, height: 480 },
  { bandwidth: 2_800_000, height: 720 },
  { bandwidth: 5_500_000, height: 1080 },
];

function input(over: Partial<AbrInput>): AbrInput {
  return {
    levels: LEVELS,
    current: 1,
    estimate: 5_000_000,
    bufferAhead: 20,
    segmentDuration: 6,
    sinceLastSwitch: 60,
    ...over,
  };
}

describe("player-hls: EWMA and bandwidth estimation", () => {
  it("is bias-corrected: the first sample is the estimate", () => {
    const e = new Ewma(3);
    e.sample(1, 4_000_000);
    assert.ok(Math.abs(e.value - 4_000_000) < 1);
  });

  it("moves towards new samples with the configured half-life", () => {
    const e = new Ewma(2);
    e.sample(10, 1000);
    e.sample(2, 3000); // one half-life of weight: halfway between old estimate and new value
    assert.ok(Math.abs(e.value - 2000) < 60, `got ${e.value}`);
  });

  it("ignores invalid samples", () => {
    const e = new Ewma(3);
    e.sample(0, 100);
    e.sample(1, Number.NaN);
    assert.equal(e.value, 0);
    assert.equal(e.weight, 0);
  });

  it("uses the default estimate until enough has been measured", () => {
    const est = new BandwidthEstimator({ defaultEstimate: 1_500_000 });
    assert.equal(est.getEstimate(), 1_500_000);
    est.sample(10, 1_000); // tiny download: latency-dominated, ignored
    assert.equal(est.getEstimate(), 1_500_000);
    assert.equal(est.sampleCount, 0);
  });

  it("measures throughput in bits per second", () => {
    const est = new BandwidthEstimator({ defaultEstimate: 1 });
    est.sample(1000, 1_000_000); // 1 MB in 1 s = 8 Mbit/s
    assert.ok(Math.abs(est.getEstimate() - 8_000_000) < 1);
    assert.equal(est.sampleCount, 1);
  });

  it("reacts to drops faster than to recoveries (min of fast and slow averages)", () => {
    const est = new BandwidthEstimator({ defaultEstimate: 1 });
    for (let i = 0; i < 10; i++) est.sample(1000, 1_000_000); // steady 8 Mbit/s
    est.sample(4000, 500_000); // drop to 1 Mbit/s for 4 s
    const afterDrop = est.getEstimate();
    assert.ok(afterDrop < 4_500_000, `drop is acted on quickly (got ${afterDrop})`);

    const rec = new BandwidthEstimator({ defaultEstimate: 1 });
    for (let i = 0; i < 10; i++) rec.sample(1000, 125_000); // steady 1 Mbit/s
    rec.sample(1000, 1_000_000); // one fast download
    assert.ok(rec.getEstimate() < 3_000_000, `recovery is trusted slowly (got ${rec.getEstimate()})`);
  });

  it("derives the initial estimate from a saved value, the connection or a safe default", () => {
    assert.equal(initialEstimate(4_000_000, 10), 4_000_000);
    assert.equal(initialEstimate(null, 5), 4_000_000);
    assert.equal(initialEstimate(10, undefined), 1_500_000, "implausible saved values are ignored");
    assert.equal(initialEstimate(null, null), 1_500_000);
  });
});

describe("player-hls: level choice", () => {
  it("starts at the highest level that fits 70 % of the estimate", () => {
    assert.equal(chooseLevel(input({ current: -1, estimate: 10_000_000 })), 2);
    assert.equal(chooseLevel(input({ current: -1, estimate: 5_000_000 })), 1);
    assert.equal(chooseLevel(input({ current: -1, estimate: 1_000_000 })), 0, "the lowest when nothing fits");
  });

  it("handles trivial ladders", () => {
    assert.equal(chooseLevel(input({ levels: [] })), -1);
    assert.equal(chooseLevel(input({ levels: [{ bandwidth: 9_000_000 }], current: 0, estimate: 1 })), 0);
  });

  it("does not depend on the order of the levels", () => {
    const shuffled = [LEVELS[2]!, LEVELS[0]!, LEVELS[1]!];
    assert.equal(chooseLevel({ ...input({ current: -1, estimate: 10_000_000 }), levels: shuffled }), 0, "index 0 is the 1080p level here");
  });

  it("switches up only after the hold time (hysteresis)", () => {
    const base = input({ current: 1, estimate: 20_000_000, bufferAhead: 20 });
    assert.equal(chooseLevel({ ...base, sinceLastSwitch: UP_HOLD_SECONDS - 1 }), 1);
    assert.equal(chooseLevel({ ...base, sinceLastSwitch: UP_HOLD_SECONDS }), 2);
  });

  it("switches up only with a healthy buffer", () => {
    const base = input({ current: 0, estimate: 20_000_000, sinceLastSwitch: 60 });
    assert.equal(chooseLevel({ ...base, bufferAhead: 5 }), 0);
    assert.equal(chooseLevel({ ...base, bufferAhead: 12 }), 2);
  });

  it("keeps the level inside the dead band between the up and down thresholds", () => {
    // 720p costs 2.8 Mbit/s. With 3.5 Mbit/s: 2.8 <= 0.85 * 3.5 (no down) and 5.5 > 0.7 * 3.5 (no up).
    assert.equal(chooseLevel(input({ current: 1, estimate: 3_500_000 })), 1);
    // 1080p needs 5.5 / 0.7 = 7.86 Mbit/s to be picked: 7.5 is not enough.
    assert.equal(chooseLevel(input({ current: 1, estimate: 7_500_000 })), 1);
  });

  it("does not flap on an estimate oscillating around one level's cost", () => {
    let current = 1;
    let since = 60;
    const picks: number[] = [];
    for (const estimate of [4_000_000, 3_400_000, 4_200_000, 3_300_000, 4_100_000]) {
      const next = chooseLevel(input({ current, estimate, sinceLastSwitch: since }));
      since = next === current ? since + 6 : 0;
      current = next;
      picks.push(next);
    }
    assert.deepEqual(picks, [1, 1, 1, 1, 1]);
  });

  it("switches down when the current level no longer fits", () => {
    assert.equal(chooseLevel(input({ current: 2, estimate: 4_000_000, bufferAhead: 10 })), 1);
    assert.equal(chooseLevel(input({ current: 2, estimate: 2_000_000, bufferAhead: 10 })), 0);
  });

  it("rides out a small dip with a comfortable buffer", () => {
    // 5.5 Mbit/s > 0.85 * 6 Mbit/s, but <= 6 Mbit/s and 25 s are buffered.
    assert.equal(chooseLevel(input({ current: 2, estimate: 6_000_000, bufferAhead: COMFORT_BUFFER_SECONDS + 5 })), 2);
    assert.equal(chooseLevel(input({ current: 2, estimate: 6_000_000, bufferAhead: 8 })), 1);
  });

  it("drops sharply when the buffer is about to run dry", () => {
    // 1080p (5.5 Mbit/s) with a 4 Mbit/s estimate: a normal step down goes to 720p (fits 85 %),
    // but with 1 s of buffer the choice falls back to what half the estimate sustains.
    assert.equal(chooseLevel(input({ current: 2, estimate: 4_000_000, bufferAhead: 12 })), 1);
    assert.equal(chooseLevel(input({ current: 2, estimate: 4_000_000, bufferAhead: 1 })), 0);
  });

  it("accounts for the playback rate", () => {
    // At 2x, 720p needs 5.6 Mbit/s; 5 Mbit/s is not enough.
    assert.equal(chooseLevel(input({ current: 1, estimate: 5_000_000, bufferAhead: 10, playbackRate: 2 })), 0);
    assert.equal(chooseLevel(input({ current: -1, estimate: 5_000_000, playbackRate: 2 })), 0);
  });

  it("honours Data Saver", () => {
    assert.equal(chooseLevel(input({ current: 2, estimate: 50_000_000, saveData: true })), 0);
  });

  it("caps the level at the player size", () => {
    // A 400 css px tall player on a 1x screen: 480p is the first level tall enough.
    assert.deepEqual(levelsWithinCap(LEVELS, 400), [0]);
    // 700 device px: 720p (>= 90 % of 700) is allowed, 1080p is not.
    assert.deepEqual(levelsWithinCap(LEVELS, 700), [0, 1]);
    assert.deepEqual(levelsWithinCap(LEVELS, 2000), [0, 1, 2], "taller than every level: all allowed");
    assert.deepEqual(levelsWithinCap(LEVELS, undefined), [0, 1, 2]);
    assert.deepEqual(levelsWithinCap([{ bandwidth: 1 }, { bandwidth: 2 }], 300), [0, 1], "unknown heights are never capped");

    assert.equal(chooseLevel(input({ current: -1, estimate: 50_000_000, maxHeight: 700 })), 1);
    // The player shrank (left fullscreen): leave the capped level at once.
    assert.equal(chooseLevel(input({ current: 2, estimate: 50_000_000, maxHeight: 400 })), 0);
  });
});

describe("player-hls: abandoning slow downloads", () => {
  const base = {
    elapsedMs: 4000,
    loadedBytes: 500_000,
    totalBytes: 4_000_000,
    segmentDuration: 6,
    bufferAhead: 3,
    lowerLevelBandwidth: 1_100_000,
  };

  it("abandons when the rest would outlast the buffer and a lower level arrives in time", () => {
    // 1 Mbit/s so far: the 3.5 MB left take 28 s. A 480p segment (6.6 Mbit) takes 6.6 s:
    // too slow for 3 s of buffer, in time for 8 s.
    assert.equal(shouldAbandonDownload(base), false, "a lower level that also misses the buffer does not help");
    assert.equal(shouldAbandonDownload({ ...base, bufferAhead: 8 }), true);
  });

  it("keeps downloads that finish in time", () => {
    assert.equal(shouldAbandonDownload({ ...base, loadedBytes: 3_900_000, bufferAhead: 8 }), false);
  });

  it("never abandons early, at the lowest level, or before half the segment's play time", () => {
    assert.equal(shouldAbandonDownload({ ...base, bufferAhead: 8, elapsedMs: 400 }), false);
    assert.equal(shouldAbandonDownload({ ...base, bufferAhead: 8, lowerLevelBandwidth: null }), false);
    assert.equal(shouldAbandonDownload({ ...base, bufferAhead: 8, elapsedMs: 2500 }), false);
  });

  it("abandons a stalled download once it outlasts the buffer", () => {
    assert.equal(shouldAbandonDownload({ ...base, loadedBytes: 0, bufferAhead: 3 }), true);
    assert.equal(shouldAbandonDownload({ ...base, loadedBytes: 0, bufferAhead: 10 }), false);
  });
});
