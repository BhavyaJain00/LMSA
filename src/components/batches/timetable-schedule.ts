/**
 * When a batch timetable row happens, as the timetable shows it. Pure (shared
 * by the client timetable view and unit tests).
 */
import { clockInZone, dateKeyInZone, isClock, isValidTimeZone, tzOffsetMinutes, zonedTimeToUtc } from "@/lib/calendar/time";
import type { TimetableEntry } from "./types";

export interface RowSchedule {
  /** Day the row is shown on (YYYY-MM-DD). */
  date: string;
  startTime?: string;
  endTime?: string;
  /**
   * The zone of `date`/`startTime`/`endTime` when it is not the batch's: a
   * live class scheduled in a timezone whose clock differs from the batch's.
   * Null for rows in the batch timezone.
   */
  zone: string | null;
  /** Absolute start (epoch ms) of a row backed by a live class. */
  startsAt: number | null;
  /** Chronological sort key within a day. */
  sortKey: number;
}

/**
 * Rows backed by a live class are shown at the class's real start and end
 * (`classRange`, the instants its "Add to calendar" and .ics use) in the
 * class's own timezone, and are marked with that zone when its clock differs
 * from the batch's at that time. Every other row keeps its date and times,
 * which are in the batch timezone.
 */
export function rowSchedule(entry: TimetableEntry, batchZone: string): RowSchedule {
  const range = entry.classRange;
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    const timed = entry.startTime && isClock(entry.startTime) ? zonedTimeToUtc(entry.date, entry.startTime, batchZone) : NaN;
    // Untimed (all-day) rows sort before the timed rows of their day.
    const sortKey = Number.isNaN(timed) ? zonedTimeToUtc(entry.date, "00:00", batchZone) - 1 : timed;
    return { date: entry.date, startTime: entry.startTime, endTime: entry.endTime, zone: null, startsAt: null, sortKey: Number.isNaN(sortKey) ? 0 : sortKey };
  }
  const classZone = entry.classTimeZone && isValidTimeZone(entry.classTimeZone) ? entry.classTimeZone : batchZone;
  const sameClock =
    tzOffsetMinutes(classZone, range.start) === tzOffsetMinutes(batchZone, range.start) &&
    tzOffsetMinutes(classZone, range.end) === tzOffsetMinutes(batchZone, range.end);
  const zone = sameClock ? batchZone : classZone;
  return {
    date: dateKeyInZone(range.start, zone),
    startTime: clockInZone(range.start, zone),
    endTime: clockInZone(range.end, zone),
    zone: sameClock ? null : classZone,
    startsAt: range.start,
    sortKey: range.start,
  };
}

/** Timetable rows in display order (by shown day, then chronologically) with their schedules. */
export function scheduleRows(entries: TimetableEntry[], batchZone: string): { entry: TimetableEntry; schedule: RowSchedule }[] {
  return entries
    .map((entry) => ({ entry, schedule: rowSchedule(entry, batchZone) }))
    .sort((a, b) => a.schedule.date.localeCompare(b.schedule.date) || a.schedule.sortKey - b.schedule.sortKey);
}

/** The note under the timetable: accurate whether or not some rows are in another timezone. */
export function timetableTimesNote(rows: { schedule: RowSchedule }[], batchZone: string): string {
  const zoneName = batchZone.replace(/_/g, " ");
  return rows.some((r) => r.schedule.zone)
    ? `Times are shown in the batch timezone (${zoneName}); live classes scheduled in another timezone are marked with theirs.`
    : `Times are shown in the batch timezone (${zoneName}).`;
}
