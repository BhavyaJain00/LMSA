import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDaysToKey, clockInZone, clockToMinutes, dateKeyInZone, liveClassRange, tzOffsetMinutes, zonedTimeToUtc } from "@/lib/calendar/time";
import { zonedRange } from "@/lib/calendar/ics";

/**
 * Wall-clock → UTC conversion in zones with 30- and 45-minute offsets, and
 * through DST gaps and overlaps whose size is 30 or 60 minutes. Expected
 * values come from the 2026 IANA rules:
 *  - Lord Howe: +11:00 → +10:30 at 02:00 on 5 Apr, +10:30 → +11:00 at 02:00 on 4 Oct.
 *  - Chatham: +13:45 → +12:45 at 03:45 on 5 Apr, +12:45 → +13:45 at 02:45 on 27 Sep.
 *  - St. John's: −3:30 → −2:30 at 02:00 on 8 Mar, back at 02:00 on 1 Nov.
 *  - Adelaide: +10:30 → +9:30 at 03:00 on 5 Apr, +9:30 → +10:30 at 02:00 on 4 Oct.
 *  - Kathmandu +5:45, Eucla +8:45, Kolkata +5:30 and Tehran +3:30 never change.
 */

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (dateKey: string, time: string, tz: string) => iso(zonedTimeToUtc(dateKey, time, tz));

describe("30- and 45-minute offsets", () => {
  it("converts wall-clock times in fixed half- and quarter-hour zones", () => {
    assert.equal(at("2026-01-15", "09:00", "Asia/Kathmandu"), "2026-01-15T03:15:00.000Z");
    assert.equal(at("2026-01-15", "05:44", "Asia/Kathmandu"), "2026-01-14T23:59:00.000Z");
    assert.equal(at("2026-07-01", "08:45", "Australia/Eucla"), "2026-07-01T00:00:00.000Z");
    assert.equal(at("2026-06-30", "00:15", "Asia/Kolkata"), "2026-06-29T18:45:00.000Z");
    assert.equal(at("2026-03-21", "12:00", "Asia/Tehran"), "2026-03-21T08:30:00.000Z");
  });

  it("uses the summer or winter offset of zones whose odd offset shifts with DST", () => {
    assert.equal(at("2026-01-15", "09:00", "Pacific/Chatham"), "2026-01-14T19:15:00.000Z");
    assert.equal(at("2026-07-15", "09:00", "Pacific/Chatham"), "2026-07-14T20:15:00.000Z");
    assert.equal(at("2026-01-15", "09:00", "America/St_Johns"), "2026-01-15T12:30:00.000Z");
    assert.equal(at("2026-07-15", "09:00", "America/St_Johns"), "2026-07-15T11:30:00.000Z");
    assert.equal(at("2026-01-15", "09:00", "Australia/Adelaide"), "2026-01-14T22:30:00.000Z");
    assert.equal(at("2026-07-15", "09:00", "Australia/Adelaide"), "2026-07-14T23:30:00.000Z");
    assert.equal(at("2026-01-15", "09:00", "Australia/Lord_Howe"), "2026-01-14T22:00:00.000Z");
    assert.equal(at("2026-07-15", "09:00", "Australia/Lord_Howe"), "2026-07-14T22:30:00.000Z");
  });

  it("reports the offsets in minutes", () => {
    const jan = Date.UTC(2026, 0, 15);
    const jul = Date.UTC(2026, 6, 15);
    assert.equal(tzOffsetMinutes("Asia/Kathmandu", jan), 345);
    assert.equal(tzOffsetMinutes("Australia/Eucla", jul), 525);
    assert.deepEqual([tzOffsetMinutes("Pacific/Chatham", jan), tzOffsetMinutes("Pacific/Chatham", jul)], [825, 765]);
    assert.deepEqual([tzOffsetMinutes("America/St_Johns", jan), tzOffsetMinutes("America/St_Johns", jul)], [-210, -150]);
    assert.deepEqual([tzOffsetMinutes("Australia/Adelaide", jan), tzOffsetMinutes("Australia/Adelaide", jul)], [630, 570]);
    assert.deepEqual([tzOffsetMinutes("Australia/Lord_Howe", jan), tzOffsetMinutes("Australia/Lord_Howe", jul)], [660, 630]);
  });
});

describe("DST gaps and overlaps", () => {
  it("pushes a time in Lord Howe's 30-minute gap forward by 30 minutes", () => {
    assert.equal(at("2026-10-04", "01:59", "Australia/Lord_Howe"), "2026-10-03T15:29:00.000Z");
    assert.equal(at("2026-10-04", "02:00", "Australia/Lord_Howe"), "2026-10-03T15:30:00.000Z");
    assert.equal(at("2026-10-04", "02:15", "Australia/Lord_Howe"), "2026-10-03T15:45:00.000Z");
    assert.equal(clockInZone(zonedTimeToUtc("2026-10-04", "02:15", "Australia/Lord_Howe"), "Australia/Lord_Howe"), "02:45");
    assert.equal(at("2026-10-04", "02:30", "Australia/Lord_Howe"), "2026-10-03T15:30:00.000Z");
  });

  it("resolves Lord Howe's repeated half hour to its first occurrence", () => {
    assert.equal(at("2026-04-05", "01:29", "Australia/Lord_Howe"), "2026-04-04T14:29:00.000Z");
    assert.equal(at("2026-04-05", "01:30", "Australia/Lord_Howe"), "2026-04-04T14:30:00.000Z");
    assert.equal(at("2026-04-05", "01:45", "Australia/Lord_Howe"), "2026-04-04T14:45:00.000Z");
    assert.equal(at("2026-04-05", "02:00", "Australia/Lord_Howe"), "2026-04-04T15:30:00.000Z");
  });

  it("handles the hour-long gap and overlap of a 45-minute zone (Chatham)", () => {
    assert.equal(at("2026-09-27", "02:44", "Pacific/Chatham"), "2026-09-26T13:59:00.000Z");
    assert.equal(at("2026-09-27", "03:00", "Pacific/Chatham"), "2026-09-26T14:15:00.000Z");
    assert.equal(clockInZone(zonedTimeToUtc("2026-09-27", "03:00", "Pacific/Chatham"), "Pacific/Chatham"), "04:00");
    assert.equal(at("2026-09-27", "03:45", "Pacific/Chatham"), "2026-09-26T14:00:00.000Z");
    assert.equal(at("2026-04-05", "03:00", "Pacific/Chatham"), "2026-04-04T13:15:00.000Z");
    assert.equal(at("2026-04-05", "03:45", "Pacific/Chatham"), "2026-04-04T15:00:00.000Z");
  });

  it("handles half-hour zones with a one-hour shift (St. John's, Adelaide)", () => {
    assert.equal(at("2026-03-08", "02:30", "America/St_Johns"), "2026-03-08T06:00:00.000Z");
    assert.equal(at("2026-11-01", "01:30", "America/St_Johns"), "2026-11-01T04:00:00.000Z");
    assert.equal(at("2026-10-04", "02:30", "Australia/Adelaide"), "2026-10-03T17:00:00.000Z");
    assert.equal(at("2026-04-05", "02:30", "Australia/Adelaide"), "2026-04-04T16:00:00.000Z");
  });

  it("round-trips every quarter hour, except gap times, which move forward by exactly the gap", () => {
    const shift: Record<string, number> = {
      "Australia/Lord_Howe": 30,
      "Pacific/Chatham": 60,
      "America/St_Johns": 60,
      "Australia/Adelaide": 60,
      "Asia/Kathmandu": 0,
      "Australia/Eucla": 0,
    };
    const days = ["2026-03-08", "2026-04-05", "2026-09-27", "2026-10-04", "2026-11-01"];
    for (let d = 0; d < 365; d += 14) days.push(addDaysToKey("2026-01-01", d));
    const gaps: Record<string, number> = {};
    for (const [tz, size] of Object.entries(shift)) {
      for (const key of days) {
        for (let m = 0; m < 24 * 60; m += 15) {
          const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const t = zonedTimeToUtc(key, time, tz);
          assert.equal(dateKeyInZone(t, tz), key, `${tz} ${key} ${time}`);
          const shown = clockInZone(t, tz);
          if (shown === time) {
            // The earliest instant: half an hour / an hour earlier is a different wall-clock time.
            if (size) assert.notEqual(clockInZone(t - size * MINUTE, tz), time, `${tz} ${key} ${time} is not the first occurrence`);
          } else {
            assert.equal(clockToMinutes(shown) - m, size, `${tz} ${key} ${time} → ${shown}`);
            gaps[tz] = (gaps[tz] ?? 0) + 1;
          }
        }
      }
    }
    assert.deepEqual(gaps, { "Australia/Lord_Howe": 2, "Pacific/Chatham": 4, "America/St_Johns": 4, "Australia/Adelaide": 4 });
  });
});

describe("ranges across DST changes", () => {
  const minutes = (range: ReturnType<typeof zonedRange>) => {
    assert.ok(range && range.start.kind === "utc" && range.end?.kind === "utc");
    return (range.end.epochMs - range.start.epochMs) / MINUTE;
  };

  it("spans the real elapsed time across 30- and 60-minute shifts", () => {
    assert.equal(minutes(zonedRange("2026-04-05", "01:00", "02:00", "Australia/Lord_Howe")), 90);
    assert.equal(minutes(zonedRange("2026-10-04", "01:00", "03:00", "Australia/Lord_Howe")), 90);
    assert.equal(minutes(zonedRange("2026-09-27", "02:00", "04:00", "Pacific/Chatham")), 60);
    assert.equal(minutes(zonedRange("2026-04-05", "02:00", "04:00", "Pacific/Chatham")), 180);
  });

  it("keeps the scheduled length when a 30-minute gap swallows the start", () => {
    const range = zonedRange("2026-10-04", "02:15", "02:40", "Australia/Lord_Howe");
    assert.equal(minutes(range), 25);
    assert.equal(range?.start.kind === "utc" ? iso(range.start.epochMs) : null, "2026-10-03T15:45:00.000Z");
  });
});

describe("liveClassRange", () => {
  it("uses the class's own timezone, not the batch's", () => {
    // The review's repro: a 18:00 New York class in an Asia/Kolkata batch.
    const range = liveClassRange({ date: "2026-10-15", time: "18:00", timezone: "America/New_York", durationMinutes: 60 }, "Asia/Kolkata");
    assert.ok(range);
    assert.equal(iso(range.start), "2026-10-15T22:00:00.000Z");
    assert.equal(iso(range.end), "2026-10-15T23:00:00.000Z");
    assert.equal(range.timeZone, "America/New_York");
    assert.equal(at("2026-10-15", "18:00", "Asia/Kolkata"), "2026-10-15T12:30:00.000Z", "the batch zone would be 9.5 hours early");
  });

  it("falls back to the batch timezone when the class has none", () => {
    const range = liveClassRange({ date: "2026-10-15", time: "18:00", timezone: "", durationMinutes: 60 }, "Asia/Kolkata");
    assert.equal(range && iso(range.start), "2026-10-15T12:30:00.000Z");
    assert.equal(range?.timeZone, "Asia/Kolkata");
  });

  it("handles quarter-hour zones and defaults to an hour without a positive duration", () => {
    const kathmandu = liveClassRange({ date: "2026-05-01", time: "10:00", timezone: "Asia/Kathmandu", durationMinutes: 45 });
    assert.deepEqual(kathmandu && [iso(kathmandu.start), iso(kathmandu.end)], ["2026-05-01T04:15:00.000Z", "2026-05-01T05:00:00.000Z"]);
    for (const durationMinutes of [0, -30]) {
      const range = liveClassRange({ date: "2026-05-01", time: "10:00", timezone: "UTC", durationMinutes });
      assert.equal(range && range.end - range.start, 60 * MINUTE);
    }
  });

  it("keeps the class length in real time across DST changes", () => {
    // 01:30 on the New York fall-back day is the first (EDT) occurrence; 90 minutes later it is 02:00 EST.
    const fallBack = liveClassRange({ date: "2026-11-01", time: "01:30", timezone: "America/New_York", durationMinutes: 90 });
    assert.ok(fallBack);
    assert.equal(iso(fallBack.start), "2026-11-01T05:30:00.000Z");
    assert.equal(clockInZone(fallBack.end, "America/New_York"), "02:00");
    const gap = liveClassRange({ date: "2026-10-04", time: "02:15", timezone: "Australia/Lord_Howe", durationMinutes: 30 });
    assert.deepEqual(gap && [iso(gap.start), iso(gap.end)], ["2026-10-03T15:45:00.000Z", "2026-10-03T16:15:00.000Z"]);
  });

  it("rejects invalid dates and times", () => {
    assert.equal(liveClassRange({ date: "2026-02-30", time: "10:00", timezone: "UTC", durationMinutes: 60 }), null);
    assert.equal(liveClassRange({ date: "2026-05-01", time: "24:00", timezone: "UTC", durationMinutes: 60 }), null);
    assert.equal(liveClassRange({ date: "2026-05-01", time: "7:30", timezone: "UTC", durationMinutes: 60 }), null);
  });
});
