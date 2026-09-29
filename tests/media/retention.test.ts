import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RETENTION_BINS,
  applyRangesToBins,
  binsCovered,
  capRanges,
  coveragePercent,
  estimateBinsFromMax,
  findDropOffs,
  findRewatchHotspots,
  mergeRanges,
  normalizeBins,
  sanitizeRanges,
  summarizeRetention,
  totalLength,
  type WatchRange,
} from "@/lib/media/retention";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("sanitizeRanges", () => {
  it("accepts only numeric pairs, clamped to the video and merged", () => {
    const raw = [[5, 10], [8, 12], [12, 15], ["a", 3], [20], [30, 30], [-5, 2], [95, 500], [Number.NaN, 4], null, "x"];
    assert.deepEqual(sanitizeRanges(raw, 100), [
      [0, 2],
      [5, 15],
      [95, 100],
    ]);
  });

  it("rejects non-arrays and non-positive durations", () => {
    assert.deepEqual(sanitizeRanges("[[0,1]]", 100), []);
    assert.deepEqual(sanitizeRanges([[0, 1]], 0), []);
    assert.deepEqual(sanitizeRanges([[0, 1]], Number.NaN), []);
  });

  it("reads at most maxRanges entries", () => {
    const many = Array.from({ length: 100 }, (_, i) => [i * 2, i * 2 + 1]);
    assert.equal(sanitizeRanges(many, 1000, 10).length, 10);
  });
});

describe("range arithmetic", () => {
  it("merges overlapping and adjacent ranges", () => {
    assert.deepEqual(mergeRanges([[10, 20], [0, 5], [5, 7], [18, 25], [30, 30]]), [
      [0, 7],
      [10, 25],
    ]);
    assert.equal(totalLength([[0, 7], [10, 25]]), 22);
  });

  it("caps the total length, keeping the earliest parts", () => {
    const ranges: WatchRange[] = [
      [0, 10],
      [20, 30],
      [40, 50],
    ];
    assert.deepEqual(capRanges(ranges, 15), [
      [0, 10],
      [20, 25],
    ]);
    assert.deepEqual(capRanges(ranges, 100), ranges);
    assert.deepEqual(capRanges(ranges, 0), []);
  });
});

describe("retention bins", () => {
  it("normalises stored bins to 100 non-negative integers", () => {
    const bins = normalizeBins([1.9, -2, Number.NaN, 3]);
    assert.equal(bins.length, RETENTION_BINS);
    assert.deepEqual(bins.slice(0, 5), [1, 0, 0, 3, 0]);
    assert.deepEqual(normalizeBins(undefined), new Array<number>(100).fill(0));
  });

  it("covers a bin when its midpoint is inside a range", () => {
    // 100 s video: bin i spans [i, i + 1) with its midpoint at i + 0.5.
    assert.deepEqual(binsCovered([[0, 0.5]], 100), []);
    assert.deepEqual(binsCovered([[0, 0.51]], 100), [0]);
    assert.deepEqual(binsCovered([[10.5, 12.5]], 100), [10, 11]);
    assert.equal(binsCovered([[0, 100]], 100).length, 100);
    assert.deepEqual(binsCovered([[0, 1]], 0), []);
  });

  it("counts continuous playback once per bin, however the heartbeats split it", () => {
    let bins: number[] | undefined;
    const duration = 300;
    for (let t = 0; t < duration; t += 7.3) bins = applyRangesToBins(bins, [[t, Math.min(duration, t + 7.3)]], duration);
    assert.deepEqual(bins, new Array<number>(100).fill(1));
    assert.equal(coveragePercent(bins), 100);
  });

  it("counts rewatched sections again, but at most once per heartbeat", () => {
    let bins = applyRangesToBins(undefined, [[0, 50]], 100);
    bins = applyRangesToBins(bins, [[20, 30], [25, 35]], 100);
    assert.equal(bins[10], 1);
    assert.equal(bins[25], 2);
    assert.equal(bins[60], 0);
    assert.equal(sum(bins), 50 + 15);
    assert.equal(coveragePercent(bins), 50);
  });

  it("estimates legacy watches from the furthest position", () => {
    const bins = estimateBinsFromMax(30, 60);
    assert.equal(sum(bins), 50);
    assert.equal(bins[49], 1);
    assert.equal(bins[50], 0);
    assert.equal(sum(estimateBinsFromMax(0, 60)), 0);
    assert.equal(sum(estimateBinsFromMax(500, 60)), 100);
  });
});

describe("audience analytics", () => {
  const full = applyRangesToBins(undefined, [[0, 100]], 100);
  const half = applyRangesToBins(undefined, [[0, 50]], 100);
  const rewatch = applyRangesToBins(applyRangesToBins(undefined, [[0, 100]], 100), [[40, 45]], 100);

  it("summarises retention and passes per viewer", () => {
    const summary = summarizeRetention([
      { bins: full, maxPositionSeconds: 100, durationSeconds: 100 },
      { bins: half, maxPositionSeconds: 50, durationSeconds: 100 },
    ]);
    assert.equal(summary.viewers, 2);
    assert.equal(summary.retention[0], 100);
    assert.equal(summary.retention[75], 50);
    assert.equal(summary.passes[75], 0.5);
    assert.equal(summary.estimated, false);
  });

  it("estimates viewers without bins and flags it", () => {
    const summary = summarizeRetention([{ maxPositionSeconds: 25, durationSeconds: 100 }, { bins: [], maxPositionSeconds: 0, durationSeconds: 0 }], 100);
    assert.equal(summary.estimated, true);
    assert.equal(summary.retention[10], 50);
    assert.equal(summary.retention[30], 0);
  });

  it("handles no viewers", () => {
    const summary = summarizeRetention([]);
    assert.equal(summary.viewers, 0);
    assert.ok(summary.retention.every((v) => v === 0));
  });

  it("finds the steepest drop-offs, ignoring the last few percent", () => {
    const retention = Array.from({ length: 100 }, (_, i): number => (i < 30 ? 100 : i < 60 ? 60 : 58));
    retention[98] = 0;
    retention[99] = 0;
    const drops = findDropOffs(retention, 200);
    assert.equal(drops.length, 1);
    assert.equal(drops[0]!.from, 100);
    assert.equal(drops[0]!.to, 60);
    assert.ok(drops[0]!.bin >= 27 && drops[0]!.bin <= 29);
    assert.equal(drops[0]!.time, (drops[0]!.bin / 100) * 200);
    assert.deepEqual(findDropOffs(new Array<number>(100).fill(80), 200), []);
  });

  it("finds sections that are rewatched", () => {
    const summary = summarizeRetention([
      { bins: rewatch, maxPositionSeconds: 100, durationSeconds: 100 },
      { bins: full, maxPositionSeconds: 100, durationSeconds: 100 },
    ]);
    const hotspots = findRewatchHotspots(summary, 100, { threshold: 1.4 });
    assert.equal(hotspots.length, 1);
    assert.ok(hotspots[0]!.bin >= 40 && hotspots[0]!.bin <= 44);
    assert.equal(hotspots[0]!.passesPerViewer, 1.5);
  });
});
