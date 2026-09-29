import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToKey,
  clockInZone,
  clockToMinutes,
  dateKeyInZone,
  formatDateValue,
  formatUtcStamp,
  isClock,
  isDateKey,
  isValidTimeZone,
  safeTimeZone,
  toIsoSeconds,
  tzOffsetMinutes,
  wallClockInZone,
  zonedTimeToUtc,
} from "@/lib/calendar/time";

const iso = (ms: number) => new Date(ms).toISOString();

describe("date keys and clocks", () => {
  it("validates real calendar dates", () => {
    assert.equal(isDateKey("2024-02-29"), true);
    assert.equal(isDateKey("2026-02-29"), false);
    assert.equal(isDateKey("2026-13-01"), false);
    assert.equal(isDateKey("2026-04-31"), false);
    assert.equal(isDateKey("2026-1-01"), false);
    assert.equal(isDateKey(""), false);
    assert.equal(isDateKey(null), false);
  });

  it("validates 24-hour clocks", () => {
    for (const ok of ["00:00", "09:05", "23:59"]) assert.equal(isClock(ok), true, ok);
    for (const bad of ["24:00", "7:30", "12:60", "12:5", "", undefined]) assert.equal(isClock(bad), false, String(bad));
    assert.equal(clockToMinutes("14:30"), 870);
    assert.ok(Number.isNaN(clockToMinutes("25:00")));
  });

  it("adds days across months, years and leap days", () => {
    assert.equal(addDaysToKey("2024-02-28", 1), "2024-02-29");
    assert.equal(addDaysToKey("2026-02-28", 1), "2026-03-01");
    assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysToKey("2026-01-15", 30), "2026-02-14");
  });
});

describe("time zones", () => {
  it("recognises IANA zones and falls back to UTC", () => {
    assert.equal(isValidTimeZone("America/New_York"), true);
    assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
    assert.equal(isValidTimeZone(""), false);
    assert.equal(safeTimeZone("Mars/Olympus_Mons"), "UTC");
    assert.equal(safeTimeZone(undefined), "UTC");
    assert.equal(safeTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  });

  it("reports offsets, including DST and half-hour zones", () => {
    assert.equal(tzOffsetMinutes("UTC", Date.UTC(2026, 0, 1)), 0);
    assert.equal(tzOffsetMinutes("Asia/Kolkata", Date.UTC(2026, 0, 1)), 330);
    assert.equal(tzOffsetMinutes("Asia/Kathmandu", Date.UTC(2026, 6, 1)), 345);
    assert.equal(tzOffsetMinutes("America/New_York", Date.UTC(2026, 0, 15)), -300);
    assert.equal(tzOffsetMinutes("America/New_York", Date.UTC(2026, 6, 15)), -240);
    assert.equal(tzOffsetMinutes("Australia/Sydney", Date.UTC(2026, 0, 15)), 660);
    assert.equal(tzOffsetMinutes("Australia/Sydney", Date.UTC(2026, 6, 15)), 600);
  });

  it("reads wall-clock fields of an instant", () => {
    const t = Date.UTC(2026, 0, 15, 3, 30, 15);
    assert.deepEqual(wallClockInZone(t, "Asia/Kolkata"), { y: 2026, m: 1, d: 15, hh: 9, mm: 0, ss: 15 });
    assert.equal(dateKeyInZone(t, "America/Los_Angeles"), "2026-01-14");
    assert.equal(clockInZone(t, "America/Los_Angeles"), "19:30");
    assert.equal(clockInZone(Date.UTC(2026, 0, 15, 0, 0), "UTC"), "00:00");
  });
});

describe("zonedTimeToUtc", () => {
  it("converts ordinary wall-clock times", () => {
    assert.equal(iso(zonedTimeToUtc("2026-01-15", "09:00", "America/New_York")), "2026-01-15T14:00:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-07-15", "09:00", "America/New_York")), "2026-07-15T13:00:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-01-15", "09:00", "Asia/Kolkata")), "2026-01-15T03:30:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-01-01", "00:30", "Pacific/Auckland")), "2025-12-31T11:30:00.000Z");
  });

  it("pushes times in a spring-forward gap forward by the gap", () => {
    // New York skips 02:00–03:00 on 2026-03-08: 02:30 becomes 03:30 EDT.
    assert.equal(iso(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York")), "2026-03-08T07:30:00.000Z");
    assert.equal(clockInZone(zonedTimeToUtc("2026-03-08", "02:30", "America/New_York"), "America/New_York"), "03:30");
    // London skips 01:00–02:00 on 2026-03-29.
    assert.equal(iso(zonedTimeToUtc("2026-03-29", "01:30", "Europe/London")), "2026-03-29T01:30:00.000Z");
    // Sydney skips 02:00–03:00 on 2026-10-04 (southern hemisphere).
    assert.equal(iso(zonedTimeToUtc("2026-10-04", "02:30", "Australia/Sydney")), "2026-10-03T16:30:00.000Z");
  });

  it("resolves ambiguous fall-back times to the earlier instant", () => {
    // New York repeats 01:00–02:00 on 2026-11-01; 01:30 EDT comes first.
    assert.equal(iso(zonedTimeToUtc("2026-11-01", "01:30", "America/New_York")), "2026-11-01T05:30:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-10-25", "01:30", "Europe/London")), "2026-10-25T00:30:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-04-05", "02:30", "Australia/Sydney")), "2026-04-04T15:30:00.000Z");
  });

  it("keeps times right around the transitions exact", () => {
    assert.equal(iso(zonedTimeToUtc("2026-03-08", "01:59", "America/New_York")), "2026-03-08T06:59:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-03-08", "03:00", "America/New_York")), "2026-03-08T07:00:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-11-01", "02:00", "America/New_York")), "2026-11-01T07:00:00.000Z");
  });

  it("round-trips with the wall clock for every hour of a DST year", () => {
    for (let day = 0; day < 365; day += 5) {
      const key = addDaysToKey("2026-01-01", day);
      for (const time of ["00:00", "06:15", "12:30", "18:45", "23:59"]) {
        for (const tz of ["America/New_York", "Europe/Berlin", "Australia/Sydney", "Asia/Kolkata"]) {
          const t = zonedTimeToUtc(key, time, tz);
          assert.equal(dateKeyInZone(t, tz), key, `${key} ${time} ${tz}`);
          assert.equal(clockInZone(t, tz), time, `${key} ${time} ${tz}`);
        }
      }
    }
  });

  it("returns NaN for invalid input and uses UTC for unknown zones", () => {
    assert.ok(Number.isNaN(zonedTimeToUtc("2026-02-30", "09:00", "UTC")));
    assert.ok(Number.isNaN(zonedTimeToUtc("2026-01-15", "9am", "UTC")));
    assert.equal(iso(zonedTimeToUtc("2026-01-15", "09:00", "Nowhere/Zone")), "2026-01-15T09:00:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-01-15", undefined, "UTC")), "2026-01-15T00:00:00.000Z");
    assert.equal(iso(zonedTimeToUtc("2026-01-15", "", null)), "2026-01-15T00:00:00.000Z");
  });
});

describe("RFC 5545 value formatting", () => {
  it("formats UTC stamps and dates", () => {
    assert.equal(formatUtcStamp(1767261600000), "20260101T100000Z");
    assert.equal(formatUtcStamp(Date.UTC(2026, 2, 8, 7, 30, 5)), "20260308T073005Z");
    assert.equal(formatDateValue("2026-01-01"), "20260101");
    assert.equal(toIsoSeconds(Date.UTC(2026, 0, 1, 10, 0, 0, 999)), "2026-01-01T10:00:00Z");
  });
});
