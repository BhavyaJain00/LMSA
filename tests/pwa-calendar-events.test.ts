import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Database, LiveClass, TimetableItem } from "@/lib/types";
import { capEvents, collectUserEvents, liveClassEvent, upcomingUserEvents, type CalendarEvent } from "@/lib/calendar/events";
import { getBatchTimetable } from "@/lib/data/batches";
import { addDaysToKey } from "@/lib/calendar/time";
import { buildSettings, makeBatch, makeUser, resetDb } from "./helpers/db";

const MINUTE = 60_000;
const DAY = 86_400_000;

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

describe("timetable rows backed by live classes (review finding 1)", () => {
  it("carry the class's own start and end, identical to its .ics", async () => {
    // Batch in Asia/Kolkata, classes in New York: the batch zone would put them 9.5 hours early.
    const batch = makeBatch({
      id: "bat_tz",
      timezone: "Asia/Kolkata",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      showLiveClass: true,
      timetable: [
        { id: "tt_class", type: "live_class", refId: "lc_listed", title: "Listed class", date: "2026-10-16", startTime: "09:00", endTime: "10:30", milestone: false },
        { id: "tt_other", type: "live_class", refId: "lc_elsewhere", title: "Other batch", date: "2026-10-17", startTime: "09:00", milestone: false },
        { id: "tt_custom", type: "custom", title: "Office hours", date: "2026-10-18", startTime: "09:00", endTime: "10:00", milestone: false },
      ],
    });
    const merged = liveClass({ id: "lc_merged", batchId: batch.id });
    const listed = liveClass({ id: "lc_listed", batchId: batch.id, date: "2026-10-16", time: "09:00", durationMinutes: 90, timezone: "Pacific/Chatham" });
    const elsewhere = liveClass({ id: "lc_elsewhere", batchId: "bat_other" });
    const db = await resetDb({ batches: [batch, makeBatch({ id: "bat_other" })], liveClasses: [merged, listed, elsewhere], users: [makeUser({ id: "usr_host" })] });

    const entries = await getBatchTimetable(batch, null);
    const byRef = (ref: string) => entries.find((e) => e.refId === ref);
    for (const c of [merged, listed]) {
      const ics = liveClassEvent(db, batch, c)!;
      assert.deepEqual(byRef(c.id)?.classRange, { start: ics.start, end: ics.end }, c.id);
    }
    assert.equal(new Date(byRef("lc_merged")!.classRange!.start).toISOString(), "2026-10-15T22:00:00.000Z");
    assert.equal(byRef("lc_listed")!.classRange!.end - byRef("lc_listed")!.classRange!.start, 90 * MINUTE);
    // Classes of other batches and non-class rows keep the batch-timezone conversion.
    assert.equal(byRef("lc_elsewhere")?.classRange, undefined);
    assert.equal(entries.find((e) => e.id === "tt_custom")?.classRange, undefined);
  });
});

function ev(uid: string, start: number, end: number): CalendarEvent {
  return {
    uid,
    kind: "timetable",
    refType: "timetable",
    refId: uid,
    title: uid,
    description: "",
    timezone: "UTC",
    allDay: false,
    start,
    end,
    startDate: "2026-06-15",
    endDate: "2026-06-15",
    path: "/",
    status: "CONFIRMED",
    categories: [],
    milestone: false,
    transparent: false,
  };
}

describe("feed cap (review finding 3)", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0);
  const h = (hours: number) => now + hours * 3_600_000;

  it("keeps every upcoming event first, then the most recent past ones, in order", () => {
    const sorted = [ev("p1", h(-10), h(-9)), ev("p2", h(-8), h(-7)), ev("p3", h(-6), h(-5)), ev("f1", h(1), h(2)), ev("f2", h(3), h(4))];
    assert.deepEqual(capEvents(sorted, 4, now).map((e) => e.uid), ["p2", "p3", "f1", "f2"]);
    assert.deepEqual(capEvents(sorted, 2, now).map((e) => e.uid), ["f1", "f2"]);
    assert.deepEqual(capEvents(sorted, 1, now).map((e) => e.uid), ["f1"], "the nearest upcoming event wins");
    assert.deepEqual(capEvents(sorted, 0, now), []);
    assert.equal(capEvents(sorted, 10, now), sorted);
  });

  it("counts an event that is still running as upcoming and keeps the input order", () => {
    const sorted = [ev("running", h(-48), h(24)), ev("p1", h(-10), h(-9)), ev("p2", h(-3), h(-2)), ev("f1", h(1), h(2))];
    assert.deepEqual(capEvents(sorted, 3, now).map((e) => e.uid), ["running", "p2", "f1"]);
  });

  it("never drops upcoming classes from a crowded feed", () => {
    const user = makeUser({ id: "usr_busy" });
    const today = new Date(now).toISOString().slice(0, 10);
    const timetable: TimetableItem[] = [];
    // 12 sessions a day for the past 89 days (1,068) and 10 a day for the next 70 days (700).
    for (let d = -89; d < 70; d++) {
      const date = addDaysToKey(today, d);
      for (let s = 0; s < (d < 0 ? 12 : 10); s++) {
        const time = `${String(s + 13).padStart(2, "0")}:00`;
        timetable.push({ id: `tt_${d}_${s}`, type: "custom", title: `Session ${d}/${s}`, date, startTime: time, endTime: `${String(s + 13).padStart(2, "0")}:30`, milestone: false });
      }
    }
    const batch = makeBatch({ id: "bat_busy", startDate: addDaysToKey(today, -200), endDate: addDaysToKey(today, 200), timezone: "UTC", instructorIds: [user.id], timetable });
    const db = { batches: [batch], batchEnrollments: [], liveClasses: [], certificateRequests: [], users: [user], courses: [], lessons: [], chapters: [], quizzes: [], assignments: [], exercises: [] } as unknown as Database;

    const events = collectUserEvents(db, user, buildSettings(), { now });
    assert.equal(events.length, 1500);
    const upcoming = events.filter((e) => e.end >= now);
    assert.equal(upcoming.length, 701, "all 700 sessions and the batch end");
    assert.ok(events.some((e) => e.uid === "timetable-bat_busy-tt_69_9"), "the furthest session is kept");
    assert.ok(!events.some((e) => e.uid === "timetable-bat_busy-tt_-89_0"), "the oldest history goes first");
    assert.deepEqual(events.map((e) => e.start), [...events.map((e) => e.start)].sort((a, b) => a - b));

    const next = upcomingUserEvents(db, user, buildSettings(), 3, now + 30 * DAY);
    assert.equal(next.length, 3);
    assert.ok(next.every((e) => e.end >= now + 30 * DAY));
  });
});
