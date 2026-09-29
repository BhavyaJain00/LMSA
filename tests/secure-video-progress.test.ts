import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { VideoWatch } from "@/lib/types";
import { MAX_DELTA_SECONDS, applyHeartbeat, resolveDuration, type HeartbeatContext, type HeartbeatInput } from "@/lib/media/heartbeat";
import { MAX_PLAYBACK_RATE } from "@/lib/media/playback";
import { coveragePercent } from "@/lib/media/retention";
import { refreshDelayMs } from "@/components/player/use-media-source";

/** Secure-video review, findings 3 and 4 (heartbeat trust, bin inflation) and 6 (renewal loop). */

const T0 = Date.parse("2026-03-01T10:00:00.000Z");

function newRow(): VideoWatch {
  return {
    id: "vw_test",
    userId: "usr_ada",
    courseId: "crs_1",
    lessonId: "les_1",
    blockId: "blk_1",
    source: "/uploads/videos/intro.mp4",
    watchSeconds: 0,
    lastPositionSeconds: 0,
    maxPositionSeconds: 0,
    durationSeconds: 0,
    completed: false,
    updatedAt: new Date(T0).toISOString(),
  };
}

const beat = (input: Partial<HeartbeatInput>): HeartbeatInput => ({
  position: null,
  watchedDelta: null,
  maxPosition: null,
  duration: null,
  ended: false,
  ranges: undefined,
  ...input,
});

const ctx = (nowMs: number, over: Partial<HeartbeatContext> = {}): HeartbeatContext => ({
  nowMs,
  isNew: false,
  blockDuration: 600,
  thresholdPercent: 90,
  preventSkipping: false,
  ...over,
});

/** Honest playback of [from, to) at `rate`, one heartbeat every `every` wall seconds (plus a little network jitter). */
function play(row: VideoWatch, startMs: number, from: number, to: number, rate: number, every = 10, blockDuration: number | undefined = 600): number {
  let now = startMs;
  let pos = from;
  let max = row.maxPositionSeconds;
  let i = 0;
  while (pos < to) {
    const wall = every + (i++ % 2 ? 0.3 : -0.3);
    const next = Math.min(to, pos + wall * rate);
    now += wall * 1000;
    max = Math.max(max, next);
    applyHeartbeat(row, beat({ position: next, watchedDelta: next - pos, maxPosition: max, duration: 600.4, ranges: [[pos, next]], ended: next >= 600 }), ctx(now, { blockDuration }));
    pos = next;
  }
  return now;
}

describe("heartbeat accounting", () => {
  it("does not complete a video from one `ended` request", () => {
    const row = newRow();
    const out = applyHeartbeat(row, beat({ ended: true, duration: 1, maxPosition: 1e9, position: 1e9, watchedDelta: 1e9, ranges: [[0, 600]] }), ctx(T0 + 1000, { isNew: true }));
    assert.equal(out.completed, false);
    assert.equal(row.completed, false);
    assert.equal(row.durationSeconds, 600, "the block duration wins over the reported one");
    assert.ok(row.maxPositionSeconds <= 15 * MAX_PLAYBACK_RATE + 2);
    assert.ok(row.watchSeconds <= 15 * MAX_PLAYBACK_RATE + 2);
    assert.ok(coveragePercent(row.bins) < 10);
  });

  it("bounds watch time and the furthest point by real elapsed time", () => {
    const row = newRow();
    applyHeartbeat(row, beat({ watchedDelta: 0.2, maxPosition: 0.2, duration: 600 }), ctx(T0, { isNew: true }));
    // 250 requests 20 ms apart (5 s of real time) each claiming 120 s.
    let now = T0;
    for (let i = 0; i < 250; i++) {
      now += 20;
      applyHeartbeat(row, beat({ watchedDelta: 120, maxPosition: 1e9, position: 1e9, ranges: [[0, 600]], duration: 600 }), ctx(now));
    }
    const bound = 0.2 + 5 * MAX_PLAYBACK_RATE * 1.5 + 1;
    assert.ok(row.watchSeconds <= bound, `watch ${row.watchSeconds}`);
    assert.ok(row.maxPositionSeconds <= bound, `max ${row.maxPositionSeconds}`);
    assert.equal(row.completed, false);
    // An idle row does not bank unlimited credit either.
    now += 3 * 86_400_000;
    const before = row.maxPositionSeconds;
    applyHeartbeat(row, beat({ watchedDelta: 1e6, maxPosition: 1e9 }), ctx(now));
    assert.ok(row.watchSeconds - 0 <= bound + MAX_DELTA_SECONDS);
    assert.ok(row.maxPositionSeconds - before <= 120 * MAX_PLAYBACK_RATE + 2);
  });

  it("keeps the resume point behind the furthest point when skipping is prevented", () => {
    const row = newRow();
    row.maxPositionSeconds = 100;
    applyHeartbeat(row, beat({ position: 594, maxPosition: 100 }), ctx(T0 + 10_000, { preventSkipping: true }));
    assert.ok(row.lastPositionSeconds <= 102);
    applyHeartbeat(row, beat({ position: 594, maxPosition: 100 }), ctx(T0 + 20_000, { preventSkipping: false }));
    assert.equal(row.lastPositionSeconds, 594);
  });

  it("limits retention passes per request (no bin inflation from tiny ranges)", () => {
    const row = newRow();
    applyHeartbeat(row, beat({ duration: 600 }), ctx(T0, { isNew: true }));
    let now = T0;
    for (let i = 0; i < 1000; i++) {
      now += 20;
      applyHeartbeat(row, beat({ watchedDelta: 3, ranges: [[301, 304]] }), ctx(now));
    }
    // 20 s of real time can cover ~40 s of video at 2×: bin 50 cannot have been played 1000 times.
    assert.ok((row.bins?.[50] ?? 0) <= 20, `bin 50: ${row.bins?.[50]}`);
    // Many tiny ranges around different midpoints in one heartbeat count only what the budget covers.
    const spray = newRow();
    const ranges = Array.from({ length: 64 }, (_, i) => [i * 6 + 2.99, i * 6 + 3.01]);
    applyHeartbeat(spray, beat({ watchedDelta: 2, ranges }), ctx(T0 + 1000, { isNew: false }));
    assert.ok(coveragePercent(spray.bins) <= 2, `coverage ${coveragePercent(spray.bins)}`);
  });

  it("completes honest playback at 1× and 2×, and counts rewatches", () => {
    for (const rate of [1, 2]) {
      const row = newRow();
      applyHeartbeat(row, beat({ position: 0.25, watchedDelta: 0.25, maxPosition: 0.25, duration: 600.4, ranges: [[0, 0.25]] }), ctx(T0, { isNew: true }));
      play(row, T0, 0.25, 600, rate);
      assert.equal(row.completed, true, `rate ${rate}`);
      assert.ok(coveragePercent(row.bins) >= 99, `coverage at ${rate}×: ${coveragePercent(row.bins)}`);
      assert.ok(Math.abs(row.watchSeconds - 600) < 2, `watch ${row.watchSeconds}`);
      assert.equal(row.maxPositionSeconds, 600);
    }
    // Seeking back to rewatch 60–120 s adds a second pass there.
    const row = newRow();
    applyHeartbeat(row, beat({ duration: 600 }), ctx(T0, { isNew: true }));
    const end = play(row, T0, 0, 200, 1);
    play(row, end, 60, 120, 1);
    assert.equal(row.bins?.[15], 2);
    assert.equal(row.bins?.[25], 1);
    assert.equal(row.maxPositionSeconds, 200);
    assert.equal(row.completed, false);
  });

  it("does not complete by jumping to the end", () => {
    const row = newRow();
    applyHeartbeat(row, beat({ duration: 600 }), ctx(T0, { isNew: true }));
    let now = T0;
    // Seek to 95% and let it play out: only ~30 s were watched.
    for (let pos = 570; pos < 600; pos += 10) {
      now += 10_000;
      applyHeartbeat(row, beat({ position: pos + 10, watchedDelta: 10, maxPosition: pos + 10, ranges: [[pos, pos + 10]], ended: pos + 10 >= 600 }), ctx(now));
    }
    assert.equal(row.completed, false);
    assert.ok(row.maxPositionSeconds < 100);
  });

  it("pins the duration to the block, else to the first report (±5%)", () => {
    assert.equal(resolveDuration(0, 1, 600), 600);
    assert.equal(resolveDuration(0, 300, undefined), 300);
    assert.equal(resolveDuration(300, 1, undefined), 300);
    assert.equal(resolveDuration(300, 310, undefined), 310);
    assert.equal(resolveDuration(300, 5000, undefined), 300);
    assert.equal(resolveDuration(0, 10 ** 9, undefined), 0);
    assert.equal(resolveDuration(0, Number.NaN, undefined), 0);
  });
});

describe("signed URL renewal", () => {
  const now = 1_780_000_000_000;

  it("schedules renewals of fetched URLs from their lifetime, not the browser clock", () => {
    // Browser clock 10 minutes ahead of the server with a 5-minute lifetime: the old code renewed every 5 s.
    const expires = Math.floor((now - 10 * 60_000) / 1000) + 300;
    const delay = refreshDelayMs({ expires, now, issued: { receivedAt: now, ttlSeconds: 300 } });
    assert.equal(delay, 255_000);
    assert.ok(refreshDelayMs({ expires, now: now + 200_000, issued: { receivedAt: now, ttlSeconds: 300 } }) >= 5_000);
    // Never sooner than half the lifetime.
    assert.equal(refreshDelayMs({ expires, now, issued: { receivedAt: now, ttlSeconds: 60 } }), 30_000);
  });

  it("renews pre-signed URLs by their expiry, capped by the known lifetime", () => {
    const expires = Math.floor(now / 1000) + 3600;
    assert.equal(refreshDelayMs({ expires, now }), (3600 - 45) * 1000);
    // Browser clock 10 minutes behind: without the hint the renewal would come after the token expired.
    assert.equal(refreshDelayMs({ expires: expires - 600, now: now - 600_000, ttlHint: 3000 }), (3000 - 45) * 1000);
    // Clock far ahead: one quick renewal (5 s), after which fetched-URL scheduling applies.
    assert.equal(refreshDelayMs({ expires, now: now + 7200_000, ttlHint: 3600 }), 5_000);
  });
});
