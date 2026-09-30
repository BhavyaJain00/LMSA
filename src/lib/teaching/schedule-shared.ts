import type { Course, Lesson } from "@/lib/types";

/**
 * Scheduled publishing rules shared by the server and the schedule forms.
 * Pure functions: every check takes `now`.
 *
 * A course with `publishAt` stays unpublished until that time, then goes live
 * by itself. It counts as live from the very moment the time passes (the
 * visibility helpers check the clock), and the next request also writes
 * `published: true` and sends the publishing notifications, exactly once.
 * Like publishing by hand, going live needs the course to be approved: a
 * scheduled course that lost its approval (an instructor edited it) is "held"
 * and goes live as soon as it is approved again after its time.
 *
 * A lesson with `publishAt` in the future is hidden from learners (course
 * managers still see it) and appears when the time passes.
 */

export const SCHEDULE_LIMITS = {
  /** A schedule must be at least this far in the future. */
  minLeadMs: 60_000,
  /** ...and at most two years ahead. */
  maxAheadMs: 2 * 365 * 86_400_000,
} as const;

/** The publish time of a course or lesson in epoch ms, or null when none (or unreadable) is set. */
export function publishTime(row: { publishAt?: string }): number | null {
  if (!row.publishAt) return null;
  const at = Date.parse(row.publishAt);
  return Number.isFinite(at) ? at : null;
}

/**
 * - "live": published.
 * - "scheduled": will go live at its publish time.
 * - "due": the publish time has passed; visible already, the stored flag follows on the next request.
 * - "held": has a publish time but is not approved, so it will not go live until it is.
 * - "draft": unpublished without a schedule.
 */
export type CoursePublishState = "live" | "scheduled" | "due" | "held" | "draft";

export function coursePublishState(course: Pick<Course, "published" | "publishAt" | "status">, now: number): CoursePublishState {
  if (course.published) return "live";
  const at = publishTime(course);
  if (at === null) return "draft";
  if (course.status !== "approved") return "held";
  return at > now ? "scheduled" : "due";
}

/** Whether learners can see the course right now (published, or its publish time has passed). */
export function isCourseLive(course: Pick<Course, "published" | "publishAt" | "status">, now: number): boolean {
  const state = coursePublishState(course, now);
  return state === "live" || state === "due";
}

/** Whether learners can see the lesson right now (no publish time, or it has passed). */
export function isLessonLive(lesson: Pick<Lesson, "publishAt">, now: number): boolean {
  const at = publishTime(lesson);
  return at === null || at <= now;
}

export type PublishAtInput = { ok: true; iso: string; at: number } | { ok: false; error: string };

/** Validate a publish time sent by a form (an ISO instant). */
export function parsePublishAt(input: unknown, now: number): PublishAtInput {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "Pick a date and time." };
  const at = Date.parse(input.trim());
  if (!Number.isFinite(at)) return { ok: false, error: "That date and time could not be read. Pick it again." };
  if (at - now < SCHEDULE_LIMITS.minLeadMs) return { ok: false, error: "Pick a time in the future (at least a minute from now)." };
  if (at - now > SCHEDULE_LIMITS.maxAheadMs) return { ok: false, error: "Pick a time within the next two years." };
  // Whole minutes: the pickers work in minutes, and it keeps the stored value tidy.
  const rounded = Math.floor(at / 60_000) * 60_000;
  return { ok: true, iso: new Date(rounded).toISOString(), at: rounded };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Value for an `<input type="datetime-local">` showing `ms` in the browser's time zone. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch ms of a `datetime-local` value read in the browser's time zone, or null when it is empty or invalid. */
export function fromLocalInputValue(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Reject values the calendar rolled over (Feb 31 → Mar 3).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day || d.getHours() !== hour || d.getMinutes() !== minute) return null;
  return d.getTime();
}

/** "in 3 days", "in 5 hours", "in 12 minutes", "in less than a minute"; "now" once passed. */
export function describeTimeUntil(at: number, now: number): string {
  const diff = at - now;
  if (diff <= 0) return "now";
  if (diff < 60_000) return "in less than a minute";
  const plural = (n: number, unit: string) => `in ${n} ${unit}${n === 1 ? "" : "s"}`;
  if (diff < 3_600_000) return plural(Math.round(diff / 60_000), "minute");
  if (diff < 86_400_000) return plural(Math.round(diff / 3_600_000), "hour");
  if (diff < 60 * 86_400_000) return plural(Math.round(diff / 86_400_000), "day");
  return plural(Math.round(diff / (30 * 86_400_000)), "month");
}

/* ------------------------------------------------------------------ */
/* View models (server actions → schedule forms)                       */
/* ------------------------------------------------------------------ */

export interface CourseScheduleInfo {
  courseId: string;
  title: string;
  state: CoursePublishState;
  publishAt: string | null;
  /** The viewer may set, change or cancel the schedule. */
  canSchedule: boolean;
  /** Why not, when `canSchedule` is false. */
  reason: string | null;
  lessonCount: number;
  /** Members are told about a newly published course (Settings → Learning). */
  notifiesMembers: boolean;
  /** The course was never published before, so going live announces it. */
  firstPublish: boolean;
}

export interface LessonScheduleInfo {
  lessonId: string;
  title: string;
  publishAt: string | null;
  /** Learners cannot see the lesson yet. */
  hidden: boolean;
  /** The course is live, so learners see the lesson as soon as it is published. */
  courseLive: boolean;
  /** Learners who are told when the lesson appears. */
  learnerCount: number;
}
