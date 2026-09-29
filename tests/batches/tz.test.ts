import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockInZone as batchClockInZone, dayKeyInZone, zonedTimeToUtc as batchZonedTimeToUtc } from "@/components/batches/tz";
import { addDaysToKey, clockInZone, zonedTimeToUtc as calendarZonedTimeToUtc } from "@/lib/calendar/time";
import { dripAnchor } from "@/components/learn/drip-shared";

/**
 * Batch pages, drip anchors and emails convert wall-clock times with
 * `@/components/batches/tz`; calendar exports use `@/lib/calendar/time`. Both
 * must resolve every wall-clock time to the same instant, including times
 * skipped when clocks spring forward (moved FORWARD by the gap) and times
 * repeated when they fall back (the earlier instant).
 */

const iso = (ms: number) => new Date(ms).toISOString();

describe("batch timezone conversion across DST transitions", () => {
  it("moves a time inside a spring-forward gap forward by the gap", () => {
    // New York skips 02:00–03:00 on 2026-03-08: 02:30 is 03:30 EDT, not 01:30 EST.
    const t = batchZonedTimeToUtc("2026-03-08", "02:30", "America/New_York");
    assert.equal(iso(t), "2026-03-08T07:30:00.000Z");
    assert.equal(batchClockInZone(t, "America/New_York"), "03:30");
    // London skips 01:00–02:00 on 2026-03-29: 01:30 is 02:30 BST.
    assert.equal(iso(batchZonedTimeToUtc("2026-03-29", "01:30", "Europe/London")), "2026-03-29T01:30:00.000Z");
    // Lord Howe's 30-minute gap (02:00–02:30 on 2026-10-04): 02:15 is 02:45.
    const lh = batchZonedTimeToUtc("2026-10-04", "02:15", "Australia/Lord_Howe");
    assert.equal(iso(lh), "2026-10-03T15:45:00.000Z");
    assert.equal(batchClockInZone(lh, "Australia/Lord_Howe"), "02:45");
  });

  it("resolves a repeated fall-back time to the earlier instant", () => {
    assert.equal(iso(batchZonedTimeToUtc("2026-11-01", "01:30", "America/New_York")), "2026-11-01T05:30:00.000Z");
    assert.equal(iso(batchZonedTimeToUtc("2026-10-25", "01:30", "Europe/London")), "2026-10-25T00:30:00.000Z");
  });

  it("agrees with the calendar export for every quarter hour of transition days", () => {
    const days: [string, string][] = [
      ["America/New_York", "2026-03-08"],
      ["America/New_York", "2026-11-01"],
      ["Europe/London", "2026-03-29"],
      ["Europe/London", "2026-10-25"],
      ["Australia/Sydney", "2026-04-05"],
      ["Australia/Sydney", "2026-10-04"],
      ["Australia/Lord_Howe", "2026-04-05"],
      ["Australia/Lord_Howe", "2026-10-04"],
      ["Pacific/Chatham", "2026-04-05"],
      ["Pacific/Chatham", "2026-09-27"],
      ["Asia/Kolkata", "2026-03-08"],
    ];
    for (const [tz, day] of days) {
      for (const key of [addDaysToKey(day, -1), day, addDaysToKey(day, 1)]) {
        for (let minutes = 0; minutes < 1440; minutes += 15) {
          const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
          const expected = calendarZonedTimeToUtc(key, time, tz);
          assert.equal(batchZonedTimeToUtc(key, time, tz), expected, `${key} ${time} ${tz}`);
          // Existing times round-trip; skipped ones land after the gap on the same day.
          assert.equal(dayKeyInZone(expected, tz), key, `${key} ${time} ${tz}`);
          assert.ok(clockInZone(expected, tz) >= time, `${key} ${time} ${tz}`);
        }
      }
    }
  });

  it("keeps the shared input rules (default midnight, UTC fallback, NaN for bad input)", () => {
    assert.equal(iso(batchZonedTimeToUtc("2026-01-15", "", "UTC")), "2026-01-15T00:00:00.000Z");
    assert.equal(iso(batchZonedTimeToUtc("2026-01-15", "09:00", "Nowhere/Zone")), "2026-01-15T09:00:00.000Z");
    assert.ok(Number.isNaN(batchZonedTimeToUtc("2026-02-30", "09:00", "UTC")));
    assert.ok(Number.isNaN(batchZonedTimeToUtc("2026-01-15", "9am", "UTC")));
  });

  it("anchors drip schedules of a batch starting inside a DST gap after the gap", () => {
    const anchor = dripAnchor(
      { enrolledAt: "2026-02-01T00:00:00.000Z", batchId: "bat_dst" },
      { startDate: "2026-03-08", startTime: "02:30", timezone: "America/New_York" },
    );
    assert.equal(iso(anchor), "2026-03-08T07:30:00.000Z");
    assert.equal(anchor, calendarZonedTimeToUtc("2026-03-08", "02:30", "America/New_York"));
  });
});
