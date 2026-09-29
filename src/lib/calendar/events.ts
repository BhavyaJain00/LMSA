import "server-only";
import type { Batch, CertificateRequest, Database, LiveClass, Settings, TimetableItem, TimetableItemType, User } from "@/lib/types";
import { isModerator } from "@/lib/auth/session";
import { canManageBatch, canViewBatch, lessonHrefFromDb } from "@/lib/data/batches";
import { platformTimeZone } from "@/lib/data/certificates";
import { addDaysToKey, clockInZone, dateKeyInZone, isClock, isDateKey, safeTimeZone, zonedTimeToUtc } from "./time";
import { buildIcs, type IcsEvent } from "./ics";

/**
 * Calendar events of a member, collected from the database:
 *  - live classes of the batches they attend, teach or host,
 *  - batch timetable items (deduplicated against live classes),
 *  - certificate evaluations, as the learner or as the evaluator,
 *  - batch start and end dates.
 *
 * The same model powers the personal ICS feed, single-event downloads, the
 * "next events" list on /settings/calendar and the add-to-calendar links.
 */

export type CalendarEventKind = "live_class" | "timetable" | "evaluation" | "batch_start" | "batch_end";

/** Types accepted by the single-event endpoint (`/api/calendar/event?type=…&id=…`). */
export type SingleEventType = "live_class" | "timetable" | "evaluation" | "batch";

export const SINGLE_EVENT_TYPES: readonly SingleEventType[] = ["live_class", "timetable", "evaluation", "batch"];

export interface CalendarEvent {
  /** Stable identifier without host, e.g. "live-class-lc_1". */
  uid: string;
  kind: CalendarEventKind;
  /** Reference for the single-event endpoint. */
  refType: SingleEventType;
  refId: string;
  title: string;
  /** Plain text. */
  description: string;
  timezone: string;
  allDay: boolean;
  /** Epoch ms. All-day events start at midnight of `startDate` in `timezone`. */
  start: number;
  /** Exclusive end (epoch ms). */
  end: number;
  /** All-day: first day. Timed: the day of the start in `timezone`. */
  startDate: string;
  /** All-day: EXCLUSIVE end day. Timed: the day of the end in `timezone`. */
  endDate: string;
  /** HH:mm wall-clock times in `timezone` (timed events only). */
  startTime?: string;
  endTime?: string;
  location?: string;
  /** In-app path for "details" links. */
  path: string;
  status: "CONFIRMED" | "CANCELLED";
  /** Reminder before the start, in minutes. */
  alarmMinutes?: number;
  categories: string[];
  milestone: boolean;
  batchTitle?: string;
  /** Does not block time in calendars (date markers). */
  transparent: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const REMINDER_MINUTES = 15;
const MAX_FEED_EVENTS = 1500;

const timetableTypeLabel: Record<TimetableItemType, string> = {
  course: "Course",
  lesson: "Lesson",
  live_class: "Live class",
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Exercise",
  custom: "Event",
};

const providerLabel: Record<LiveClass["provider"], string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  custom: "Online meeting",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Viewer = Pick<User, "id" | "roles">;

function batchPath(batch: Pick<Batch, "slug">, tab?: string): string {
  return `/batches/${encodeURIComponent(batch.slug)}${tab ? `?tab=${tab}` : ""}`;
}

function isEnrolled(db: Database, userId: string, batchId: string): boolean {
  return db.batchEnrollments.some((e) => e.batchId === batchId && e.userId === userId);
}

function userName(db: Database, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return db.users.find((u) => u.id === id)?.name;
}

function joinLines(...blocks: (string | undefined | false | null)[]): string {
  return blocks
    .map((b) => (typeof b === "string" ? b.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Timed event from a wall-clock range; `endTime` before `startTime` crosses midnight. */
function timedRange(dateKey: string, startTime: string, endTime: string | undefined, tz: string, fallbackMinutes: number) {
  const start = zonedTimeToUtc(dateKey, startTime, tz);
  if (Number.isNaN(start)) return null;
  let end = endTime && isClock(endTime) ? zonedTimeToUtc(dateKey, endTime, tz) : NaN;
  if (!Number.isNaN(end) && end <= start) end = zonedTimeToUtc(addDaysToKey(dateKey, 1), endTime!, tz);
  if (Number.isNaN(end) || end <= start) end = start + Math.max(1, fallbackMinutes) * MINUTE;
  return { start, end };
}

/** All-day event covering [firstDay, lastDay] inclusive. */
function allDayRange(firstDay: string, lastDay: string, tz: string) {
  const endDate = addDaysToKey(lastDay, 1);
  const start = zonedTimeToUtc(firstDay, "00:00", tz);
  const end = zonedTimeToUtc(endDate, "00:00", tz);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end, startDate: firstDay, endDate };
}

/* ------------------------------------------------------------------ */
/* Event builders                                                      */
/* ------------------------------------------------------------------ */

export function liveClassEvent(db: Database, batch: Batch, c: LiveClass): CalendarEvent | null {
  if (!isDateKey(c.date) || !isClock(c.time)) return null;
  const tz = safeTimeZone(c.timezone || batch.timezone);
  const duration = c.durationMinutes > 0 ? c.durationMinutes : 60;
  const start = zonedTimeToUtc(c.date, c.time, tz);
  if (Number.isNaN(start)) return null;
  const end = start + duration * MINUTE;
  const host = userName(db, c.hostId);
  const joinDetails = [
    c.joinUrl ? `Join: ${c.joinUrl}` : "",
    c.meetingId ? `Meeting ID: ${c.meetingId}` : "",
    c.password ? `Passcode: ${c.password}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    uid: `live-class-${c.id}`,
    kind: "live_class",
    refType: "live_class",
    refId: c.id,
    title: c.title,
    description: joinLines(
      c.description,
      joinDetails,
      [`Batch: ${batch.title}`, host ? `Hosted by ${host}` : "", `${providerLabel[c.provider] ?? "Online meeting"} · ${duration} min`]
        .filter(Boolean)
        .join("\n"),
    ),
    timezone: tz,
    allDay: false,
    start,
    end,
    startDate: c.date,
    endDate: dateKeyInZone(end, tz),
    startTime: c.time,
    endTime: clockInZone(end, tz),
    location: c.joinUrl || providerLabel[c.provider],
    path: `${batchPath(batch, "classes")}#class-${c.id}`,
    status: "CONFIRMED",
    alarmMinutes: REMINDER_MINUTES,
    categories: ["Live class", batch.title],
    milestone: false,
    batchTitle: batch.title,
    transparent: false,
    createdAt: c.createdAt,
  };
}

function timetablePath(db: Database, batch: Batch, item: TimetableItem): string {
  const ref = item.refId;
  switch (item.type) {
    case "course": {
      const course = ref ? db.courses.find((c) => c.id === ref) : undefined;
      return course ? `/courses/${encodeURIComponent(course.slug)}` : batchPath(batch, "timetable");
    }
    case "lesson":
      return lessonHrefFromDb(db, ref) ?? batchPath(batch, "timetable");
    case "live_class":
      return ref && db.liveClasses.some((c) => c.id === ref) ? `${batchPath(batch, "classes")}#class-${ref}` : batchPath(batch, "timetable");
    case "quiz":
      return ref && db.quizzes.some((q) => q.id === ref) ? `/quiz/${encodeURIComponent(ref)}` : batchPath(batch, "timetable");
    case "assignment":
      return ref && db.assignments.some((a) => a.id === ref) ? `/assignments/${encodeURIComponent(ref)}` : batchPath(batch, "timetable");
    case "exercise":
      return ref && db.exercises.some((e) => e.id === ref) ? `/exercises/${encodeURIComponent(ref)}` : batchPath(batch, "timetable");
    default:
      return batchPath(batch, "timetable");
  }
}

export function timetableEvent(db: Database, batch: Batch, item: TimetableItem): CalendarEvent | null {
  if (!isDateKey(item.date)) return null;
  const tz = safeTimeZone(batch.timezone);
  const typeLabel = timetableTypeLabel[item.type] ?? "Event";
  const legend = item.legendId ? batch.timetableLegends.find((l) => l.id === item.legendId) : undefined;
  const meta = [
    item.milestone ? "Milestone" : "",
    `${typeLabel} · ${batch.title}`,
    legend && legend.label !== typeLabel ? legend.label : "",
  ]
    .filter(Boolean)
    .join("\n");
  const base = {
    uid: `timetable-${batch.id}-${item.id}`,
    kind: "timetable" as const,
    refType: "timetable" as const,
    refId: item.id,
    title: item.milestone ? `★ ${item.title}` : item.title,
    description: meta,
    timezone: tz,
    path: timetablePath(db, batch, item),
    status: "CONFIRMED" as const,
    categories: [typeLabel, batch.title, ...(item.milestone ? ["Milestone"] : [])],
    milestone: item.milestone,
    batchTitle: batch.title,
    updatedAt: batch.updatedAt,
  };
  if (item.startTime && isClock(item.startTime)) {
    const range = timedRange(item.date, item.startTime, item.endTime, tz, 60);
    if (!range) return null;
    return {
      ...base,
      allDay: false,
      start: range.start,
      end: range.end,
      startDate: item.date,
      endDate: dateKeyInZone(range.end, tz),
      startTime: item.startTime,
      endTime: item.endTime && isClock(item.endTime) ? item.endTime : undefined,
      transparent: false,
    };
  }
  const range = allDayRange(item.date, item.date, tz);
  if (!range) return null;
  return { ...base, allDay: true, ...range, transparent: true };
}

export function batchDateEvents(batch: Batch): CalendarEvent[] {
  if (!isDateKey(batch.startDate) || !isDateKey(batch.endDate)) return [];
  const tz = safeTimeZone(batch.timezone);
  const sessions =
    isClock(batch.startTime) && isClock(batch.endTime) ? `Sessions ${batch.startTime}–${batch.endTime} (${tz.replace(/_/g, " ")})` : "";
  const description = joinLines(batch.description, [sessions, batch.medium === "offline" ? "In person" : "Online"].filter(Boolean).join(" · "));
  const common = {
    refType: "batch" as const,
    refId: batch.id,
    description,
    timezone: tz,
    allDay: true,
    location: batch.medium === "offline" ? undefined : "Online",
    path: batchPath(batch),
    status: "CONFIRMED" as const,
    categories: ["Batch", batch.title],
    milestone: false,
    batchTitle: batch.title,
    transparent: true,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
  if (batch.endDate <= batch.startDate) {
    const range = allDayRange(batch.startDate, batch.startDate, tz);
    return range ? [{ ...common, ...range, uid: `batch-${batch.id}-day`, kind: "batch_start", title: batch.title }] : [];
  }
  const out: CalendarEvent[] = [];
  const first = allDayRange(batch.startDate, batch.startDate, tz);
  if (first) out.push({ ...common, ...first, uid: `batch-${batch.id}-start`, kind: "batch_start", title: `${batch.title} starts` });
  const last = allDayRange(batch.endDate, batch.endDate, tz);
  if (last) out.push({ ...common, ...last, uid: `batch-${batch.id}-end`, kind: "batch_end", title: `${batch.title} ends` });
  return out;
}

type EvaluationPerspective = "learner" | "evaluator" | "staff";

export function evaluationEvent(db: Database, r: CertificateRequest, perspective: EvaluationPerspective): CalendarEvent | null {
  if (!isDateKey(r.date) || !isClock(r.startTime)) return null;
  const tz = safeTimeZone(r.timezone || platformTimeZone());
  const range = timedRange(r.date, r.startTime, r.endTime, tz, 30);
  if (!range) return null;
  const course = db.courses.find((c) => c.id === r.courseId);
  const batch = r.batchId ? db.batches.find((b) => b.id === r.batchId) : undefined;
  const evaluator = db.users.find((u) => u.id === r.evaluatorId);
  const learner = db.users.find((u) => u.id === r.userId);
  const courseTitle = course?.title ?? "Course";
  const title =
    perspective === "learner"
      ? `Certificate evaluation · ${courseTitle}`
      : `Evaluation with ${learner?.name ?? "a learner"} · ${courseTitle}`;
  const people = [
    perspective !== "evaluator" && evaluator ? `Evaluator: ${evaluator.name}` : "",
    perspective !== "learner" && learner ? `Learner: ${learner.name}` : "",
    batch ? `Batch: ${batch.title}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const path =
    perspective === "evaluator" && evaluator
      ? `/user/${encodeURIComponent(evaluator.username)}/schedule`
      : course
        ? `/courses/${encodeURIComponent(course.slug)}`
        : "/dashboard";
  return {
    uid: `evaluation-${r.id}`,
    kind: "evaluation",
    refType: "evaluation",
    refId: r.id,
    title: r.status === "cancelled" ? `Cancelled: ${title}` : title,
    description: joinLines(r.meetingLink ? `Join: ${r.meetingLink}` : "", people, r.status === "cancelled" ? "This evaluation was cancelled." : ""),
    timezone: tz,
    allDay: false,
    start: range.start,
    end: range.end,
    startDate: r.date,
    endDate: dateKeyInZone(range.end, tz),
    startTime: r.startTime,
    endTime: r.endTime && isClock(r.endTime) ? r.endTime : undefined,
    location: r.meetingLink || undefined,
    path,
    status: r.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
    alarmMinutes: r.status === "cancelled" ? undefined : REMINDER_MINUTES,
    categories: ["Evaluation", courseTitle],
    milestone: false,
    batchTitle: batch?.title,
    transparent: false,
    createdAt: r.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export interface CollectOptions {
  /** Keep events that end at or after this instant (epoch ms). Default: 90 days ago. */
  from?: number;
  /** Keep events that start at or before this instant (epoch ms). Default: 400 days ahead. */
  to?: number;
  /** Drop cancelled events (used for "next events" lists). */
  excludeCancelled?: boolean;
  limit?: number;
}

function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}

/** Every calendar event of a member (see module docs), honoring feature toggles. */
export function collectUserEvents(db: Database, user: User, settings: Settings, opts: CollectOptions = {}): CalendarEvent[] {
  const now = Date.now();
  const from = opts.from ?? now - 90 * DAY;
  const to = opts.to ?? now + 400 * DAY;
  const out: CalendarEvent[] = [];
  const seen = new Set<string>();
  const push = (ev: CalendarEvent | null) => {
    if (!ev || seen.has(ev.uid)) return;
    if (opts.excludeCancelled && ev.status === "CANCELLED") return;
    if (ev.end < from || ev.start > to) return;
    seen.add(ev.uid);
    out.push(ev);
  };

  if (settings.features.batches) {
    const enrolledIds = new Set(db.batchEnrollments.filter((e) => e.userId === user.id).map((e) => e.batchId));
    const batches = db.batches.filter((b) => enrolledIds.has(b.id) || b.instructorIds.includes(user.id));
    const batchIds = new Set(batches.map((b) => b.id));

    for (const batch of batches) {
      for (const ev of batchDateEvents(batch)) push(ev);

      const classIds = new Set<string>();
      if (settings.features.liveClasses) {
        for (const c of db.liveClasses) {
          if (c.batchId !== batch.id) continue;
          classIds.add(c.id);
          push(liveClassEvent(db, batch, c));
        }
      }
      for (const item of batch.timetable) {
        // Live classes on the timetable are already in the calendar as classes.
        if (item.type === "live_class" && item.refId && classIds.has(item.refId)) continue;
        if (item.type === "live_class" && !settings.features.liveClasses) continue;
        push(timetableEvent(db, batch, item));
      }
    }

    // Classes the member hosts in batches they don't otherwise belong to.
    if (settings.features.liveClasses) {
      for (const c of db.liveClasses) {
        if (c.hostId !== user.id || batchIds.has(c.batchId)) continue;
        const batch = db.batches.find((b) => b.id === c.batchId);
        if (batch) push(liveClassEvent(db, batch, c));
      }
    }
  }

  if (settings.features.certifications) {
    for (const r of db.certificateRequests) {
      if (r.userId === user.id) push(evaluationEvent(db, r, "learner"));
      else if (r.evaluatorId === user.id) push(evaluationEvent(db, r, "evaluator"));
    }
  }

  sortEvents(out);
  return out.slice(0, opts.limit ?? MAX_FEED_EVENTS);
}

/** The next `limit` events that have not ended yet. */
export function upcomingUserEvents(db: Database, user: User, settings: Settings, limit = 10, now = Date.now()): CalendarEvent[] {
  return collectUserEvents(db, user, settings, { from: now, excludeCancelled: true, limit });
}

/* ------------------------------------------------------------------ */
/* Single events (with access checks)                                  */
/* ------------------------------------------------------------------ */

export type SingleEventResult =
  | { ok: true; events: CalendarEvent[]; name: string }
  | { ok: false; status: 403 | 404; error: string };

const NOT_FOUND: SingleEventResult = { ok: false, status: 404, error: "This event doesn't exist or is no longer available." };
const FORBIDDEN: SingleEventResult = { ok: false, status: 403, error: "You don't have access to this event." };

function canSeeBatchSchedule(db: Database, viewer: Viewer, batch: Batch): boolean {
  return isEnrolled(db, viewer.id, batch.id) || canManageBatch(viewer, batch) || isModerator(viewer);
}

/** Resolve one event for a signed-in member, enforcing the same access rules as the pages that show it. */
export function resolveSingleEvent(db: Database, viewer: Viewer, settings: Settings, type: string, id: string): SingleEventResult {
  if (!id) return NOT_FOUND;
  switch (type) {
    case "live_class": {
      if (!settings.features.batches || !settings.features.liveClasses) return NOT_FOUND;
      const c = db.liveClasses.find((x) => x.id === id);
      const batch = c ? db.batches.find((b) => b.id === c.batchId) : undefined;
      if (!c || !batch) return NOT_FOUND;
      if (!canSeeBatchSchedule(db, viewer, batch) && c.hostId !== viewer.id) return FORBIDDEN;
      const ev = liveClassEvent(db, batch, c);
      return ev ? { ok: true, events: [ev], name: c.title } : NOT_FOUND;
    }
    case "timetable": {
      if (!settings.features.batches) return NOT_FOUND;
      const batch = db.batches.find((b) => b.timetable.some((t) => t.id === id));
      const item = batch?.timetable.find((t) => t.id === id);
      if (!batch || !item) return NOT_FOUND;
      if (!canSeeBatchSchedule(db, viewer, batch)) return FORBIDDEN;
      if (item.type === "live_class" && item.refId) {
        if (!settings.features.liveClasses) return NOT_FOUND;
        const c = db.liveClasses.find((x) => x.id === item.refId && x.batchId === batch.id);
        const classEvent = c ? liveClassEvent(db, batch, c) : null;
        if (classEvent) return { ok: true, events: [classEvent], name: classEvent.title };
      }
      const ev = timetableEvent(db, batch, item);
      return ev ? { ok: true, events: [ev], name: item.title } : NOT_FOUND;
    }
    case "evaluation": {
      if (!settings.features.certifications) return NOT_FOUND;
      const r = db.certificateRequests.find((x) => x.id === id);
      if (!r) return NOT_FOUND;
      const perspective: EvaluationPerspective | null =
        r.userId === viewer.id ? "learner" : r.evaluatorId === viewer.id ? "evaluator" : isModerator(viewer) ? "staff" : null;
      if (!perspective) return FORBIDDEN;
      const ev = evaluationEvent(db, r, perspective);
      return ev ? { ok: true, events: [ev], name: ev.title } : NOT_FOUND;
    }
    case "batch": {
      if (!settings.features.batches) return NOT_FOUND;
      const batch = db.batches.find((b) => b.id === id);
      if (!batch) return NOT_FOUND;
      if (!canViewBatch(viewer, batch, isEnrolled(db, viewer.id, batch.id))) return FORBIDDEN;
      const events = batchDateEvents(batch);
      return events.length ? { ok: true, events, name: batch.title } : NOT_FOUND;
    }
    default:
      return NOT_FOUND;
  }
}

/* ------------------------------------------------------------------ */
/* ICS output                                                          */
/* ------------------------------------------------------------------ */

export interface IcsContext {
  /** Public origin without trailing slash, e.g. "https://learn.example.com". */
  baseUrl: string;
  now: number;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || "learnloop.local";
  } catch {
    return "learnloop.local";
  }
}

export function toIcsEvent(ev: CalendarEvent, ctx: IcsContext): IcsEvent {
  const pageUrl = `${ctx.baseUrl}${ev.path}`;
  const created = ev.createdAt ? Date.parse(ev.createdAt) : NaN;
  const modified = ev.updatedAt ? Date.parse(ev.updatedAt) : NaN;
  return {
    uid: `${ev.uid}@${hostOf(ctx.baseUrl)}`,
    dtstamp: ctx.now,
    start: ev.allDay ? { kind: "date", dateKey: ev.startDate } : { kind: "utc", epochMs: ev.start },
    end: ev.allDay ? { kind: "date", dateKey: ev.endDate } : { kind: "utc", epochMs: ev.end },
    summary: ev.title,
    description: joinLines(ev.description, `Details: ${pageUrl}`),
    location: ev.location,
    url: pageUrl,
    status: ev.status,
    categories: ev.categories,
    transparency: ev.transparent ? "TRANSPARENT" : "OPAQUE",
    created: Number.isFinite(created) ? created : undefined,
    lastModified: Number.isFinite(modified) ? modified : undefined,
    alarms: ev.alarmMinutes ? [{ minutesBefore: ev.alarmMinutes, description: `${ev.title} starts in ${ev.alarmMinutes} minutes` }] : undefined,
  };
}

export function eventsToIcs(
  events: CalendarEvent[],
  ctx: IcsContext & { calendarName: string; calendarDescription?: string; color?: string; refreshMinutes?: number },
): string {
  return buildIcs({
    prodId: `-//${ctx.calendarName.replace(/\/+/g, " ")}//LMS Calendar 1.0//EN`,
    name: ctx.calendarName,
    description: ctx.calendarDescription,
    color: ctx.color,
    refreshMinutes: ctx.refreshMinutes,
    events: events.map((ev) => toIcsEvent(ev, ctx)),
  });
}

/** Path of the single-event .ics download for an event. */
export function icsPathFor(ev: Pick<CalendarEvent, "refType" | "refId">): string {
  return `/api/calendar/event?type=${ev.refType}&id=${encodeURIComponent(ev.refId)}`;
}
