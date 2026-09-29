import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LiveClass } from "@/lib/types";
import { getBatchTimetable } from "@/lib/data/batches";
import { rowSchedule, scheduleRows, timetableTimesNote } from "@/components/batches/timetable-schedule";
import type { TimetableEntry } from "@/components/batches/types";
import { makeBatch, makeUser, resetDb } from "../helpers/db";

/**
 * The batch timetable shows rows backed by a live class at the class's real
 * time in the class's own timezone (its .ics instant), marked with that zone
 * when its clock differs from the batch's; every other row is in the batch
 * timezone, and the note under the timetable says so accurately.
 */

function liveClass(overrides: Partial<LiveClass> & Pick<LiveClass, "id" | "batchId">): LiveClass {
  return {
    title: `Class ${overrides.id}`,
    date: "2026-10-15",
    time: "18:00",
    durationMinutes: 60,
    timezone: "America/New_York",
    hostId: "usr_host",
    provider: "zoom",
    joinUrl: "https://meet.example.com/j/1",
    autoRecording: "none",
    attendeeIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const entry = (overrides: Partial<TimetableEntry>): TimetableEntry => ({
  id: "row",
  type: "custom",
  title: "Row",
  date: "2026-10-16",
  milestone: false,
  color: null,
  href: null,
  source: "timetable",
  ...overrides,
});

describe("timetable rows backed by live classes", () => {
  it("show the class in its own timezone and carry that zone", async () => {
    const batch = makeBatch({
      id: "bat_tt",
      timezone: "Asia/Kolkata",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      showLiveClass: true,
      timetable: [
        // Entered by an admin with other date/times: the class's own schedule wins.
        { id: "tt_class", type: "live_class", refId: "lc_listed", title: "Listed class", date: "2026-10-20", startTime: "09:00", endTime: "10:30", milestone: false },
        { id: "tt_custom", type: "custom", title: "Office hours", date: "2026-10-18", startTime: "09:00", endTime: "10:00", milestone: false },
      ],
    });
    await resetDb({
      batches: [batch],
      liveClasses: [
        liveClass({ id: "lc_merged", batchId: batch.id }),
        liveClass({ id: "lc_listed", batchId: batch.id, date: "2026-10-16", time: "09:00", durationMinutes: 90, timezone: "Europe/London" }),
        liveClass({ id: "lc_local", batchId: batch.id, date: "2026-10-17", time: "23:00", timezone: "Asia/Calcutta" }),
      ],
      users: [makeUser({ id: "usr_host" })],
    });
    const entries = await getBatchTimetable(batch, null);
    const byRef = (ref: string) => entries.find((e) => e.refId === ref)!;
    assert.equal(byRef("lc_merged").classTimeZone, "America/New_York");
    assert.equal(byRef("lc_listed").classTimeZone, "Europe/London");

    // 18:00 in New York on 15 Oct (03:30 on the 16th in Kolkata) stays on the 15th at 18:00, marked with New York.
    const merged = rowSchedule(byRef("lc_merged"), batch.timezone);
    assert.deepEqual(
      { date: merged.date, startTime: merged.startTime, endTime: merged.endTime, zone: merged.zone },
      { date: "2026-10-15", startTime: "18:00", endTime: "19:00", zone: "America/New_York" },
    );
    assert.equal(merged.startsAt, byRef("lc_merged").classRange!.start);

    // The timetable row pointing at a class moves to the class's real day and time.
    const listed = rowSchedule(byRef("lc_listed"), batch.timezone);
    assert.deepEqual(
      { date: listed.date, startTime: listed.startTime, endTime: listed.endTime, zone: listed.zone },
      { date: "2026-10-16", startTime: "09:00", endTime: "10:30", zone: "Europe/London" },
    );

    // A class whose zone keeps the batch's clock (an alias of Asia/Kolkata) needs no marker.
    const local = rowSchedule(byRef("lc_local"), batch.timezone);
    assert.deepEqual({ date: local.date, startTime: local.startTime, endTime: local.endTime, zone: local.zone }, { date: "2026-10-17", startTime: "23:00", endTime: "00:00", zone: null });

    // Other rows keep their batch-timezone date and times.
    const custom = rowSchedule(entries.find((e) => e.id === "tt_custom")!, batch.timezone);
    assert.deepEqual({ date: custom.date, startTime: custom.startTime, endTime: custom.endTime, zone: custom.zone, startsAt: custom.startsAt }, { date: "2026-10-18", startTime: "09:00", endTime: "10:00", zone: null, startsAt: null });

    const rows = scheduleRows(entries, batch.timezone);
    assert.deepEqual(
      rows.map((r) => r.entry.refId ?? r.entry.id),
      ["lc_merged", "lc_listed", "lc_local", "tt_custom"],
    );
    assert.equal(timetableTimesNote(rows, batch.timezone), "Times are shown in the batch timezone (Asia/Kolkata); live classes scheduled in another timezone are marked with theirs.");
  });

  it("keeps the plain note when every row is in the batch timezone", () => {
    const rows = scheduleRows([entry({ id: "a", startTime: "10:00" }), entry({ id: "b" })], "America/New_York");
    assert.deepEqual(
      rows.map((r) => r.entry.id),
      ["b", "a"],
      "all-day rows come first on their day",
    );
    assert.equal(timetableTimesNote(rows, "America/New_York"), "Times are shown in the batch timezone (America/New York).");
  });

  it("orders a day's rows chronologically across timezones", () => {
    const start = Date.UTC(2026, 9, 16, 13, 0); // 09:00 in New York, 14:00 in London
    const rows = scheduleRows(
      [
        entry({ id: "london_row", date: "2026-10-16", startTime: "13:30" }),
        entry({ id: "ny_class", type: "live_class", source: "live_class", date: "2026-10-16", startTime: "09:00", classRange: { start, end: start + 3_600_000 }, classTimeZone: "America/New_York" }),
      ],
      "Europe/London",
    );
    assert.deepEqual(
      rows.map((r) => [r.entry.id, r.schedule.startTime, r.schedule.zone]),
      [
        ["london_row", "13:30", null],
        ["ny_class", "09:00", "America/New_York"],
      ],
    );
  });
});
