import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backBufferLength,
  bufferInfo,
  detachedForwardRanges,
  evictionRange,
  forwardFlushStart,
  nextSegmentIndex,
  retryDelayMs,
  segmentIndexAt,
  segmentToLoad,
  toRanges,
} from "@/components/player/hls/buffer";

/** Ten 6 s segments (0–60 s), like a VOD rendition. */
const SEGMENTS = Array.from({ length: 10 }, (_, i) => ({ start: i * 6, duration: 6 }));

describe("player-hls: buffered ranges", () => {
  it("copies TimeRanges-like objects", () => {
    const fake = { length: 2, start: (i: number) => [0, 10][i]!, end: (i: number) => [5, 20][i]! };
    assert.deepEqual(toRanges(fake), [
      { start: 0, end: 5 },
      { start: 10, end: 20 },
    ]);
    assert.deepEqual(toRanges(null), []);
  });

  it("measures the buffer ahead of the playhead, bridging tiny holes", () => {
    const ranges = [
      { start: 0, end: 12.02 },
      { start: 12.1, end: 30 },
      { start: 40, end: 50 },
    ];
    assert.deepEqual(bufferInfo(ranges, 5), { start: 0, end: 30, ahead: 25, buffered: true });
    assert.deepEqual(bufferInfo(ranges, 35), { start: 35, end: 35, ahead: 0, buffered: false });
    assert.equal(bufferInfo(ranges, 39.8).buffered, true, "just before a range counts as buffered");
    assert.equal(bufferInfo([], 3).ahead, 0);
  });

  it("measures the back buffer", () => {
    assert.equal(backBufferLength([{ start: 0, end: 30 }, { start: 40, end: 50 }], 45), 35);
    assert.equal(backBufferLength([{ start: 10, end: 30 }], 5), 0);
  });
});

describe("player-hls: segment lookup", () => {
  it("finds the segment playing at a time", () => {
    assert.equal(segmentIndexAt(SEGMENTS, 0), 0);
    assert.equal(segmentIndexAt(SEGMENTS, 5.99), 0);
    assert.equal(segmentIndexAt(SEGMENTS, 6), 1);
    assert.equal(segmentIndexAt(SEGMENTS, 59), 9);
    assert.equal(segmentIndexAt(SEGMENTS, 500), 9);
    assert.equal(segmentIndexAt(SEGMENTS, -3), 0);
    assert.equal(segmentIndexAt([], 3), -1);
  });

  it("continues where the buffer ends", () => {
    assert.equal(nextSegmentIndex(SEGMENTS, 12, 1), 2);
    // Media slightly shorter than EXTINF: the buffer ends at 11.96, inside segment 1 which is already appended.
    assert.equal(nextSegmentIndex(SEGMENTS, 11.6, 1), 2);
    assert.equal(nextSegmentIndex(SEGMENTS, 59.9, 9), SEGMENTS.length, "everything is buffered");
  });

  it("loads the segment under the playhead when nothing is buffered there", () => {
    assert.equal(segmentToLoad(SEGMENTS, 5.9, { buffered: false, end: 5.9 }, null), 0, "not the next one");
    assert.equal(segmentToLoad(SEGMENTS, 33, { buffered: false, end: 33 }, 2), 5);
    assert.equal(segmentToLoad(SEGMENTS, 59.9, { buffered: false, end: 59.9 }, null), SEGMENTS.length);
    assert.equal(segmentToLoad(SEGMENTS, 20, { buffered: true, end: 24 }, 3), 4);
    assert.equal(segmentToLoad([], 0, { buffered: false, end: 0 }, null), 0);
  });
});

describe("player-hls: eviction and flushing", () => {
  it("evicts the back buffer beyond the target", () => {
    assert.deepEqual(evictionRange([{ start: 0, end: 100 }], 90, 60), { start: 0, end: 30 });
    assert.equal(evictionRange([{ start: 0, end: 100 }], 62, 60), null, "less than the minimum chunk");
    assert.equal(evictionRange([{ start: 50, end: 100 }], 90, 60), null);
    assert.equal(evictionRange([], 90, 60), null);
  });

  it("removes ranges a backward seek left far ahead", () => {
    const ranges = [
      { start: 0, end: 20 },
      { start: 30, end: 36 },
      { start: 300, end: 330 },
    ];
    assert.deepEqual(detachedForwardRanges(ranges, 10, 30), [{ start: 300, end: 330 }]);
    assert.deepEqual(detachedForwardRanges(ranges, 310, 30), [], "the range around the playhead is kept");
    assert.deepEqual(detachedForwardRanges([{ start: 0, end: 60 }], 10, 30), []);
  });

  it("flushes forward from the end of the playing segment on a quality change", () => {
    assert.equal(forwardFlushStart(SEGMENTS, 7, 30), 12);
    assert.equal(forwardFlushStart(SEGMENTS, 11.5, 30), 18, "the next segment when the current one is nearly over");
    assert.equal(forwardFlushStart(SEGMENTS, 7, 12), null, "nothing buffered beyond the playing segment");
    assert.equal(forwardFlushStart([], 7, 30), null);
  });
});

describe("player-hls: retry backoff", () => {
  it("doubles with jitter and caps", () => {
    const mid = () => 0.5; // jitter factor 1.0
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((a) => retryDelayMs(a, 500, 8000, mid)), [500, 1000, 2000, 4000, 8000, 8000]);
    assert.equal(retryDelayMs(0, 500, 8000, () => 0), 400);
    assert.equal(retryDelayMs(0, 500, 8000, () => 1), 600);
  });
});
