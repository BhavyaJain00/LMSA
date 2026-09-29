/**
 * Drip (scheduled) content and course prerequisites: pure rules and
 * formatting shared by the server (outline locking, access checks,
 * notifications) and the client (outline labels, countdowns, the admin
 * schedule editor and timeline).
 *
 * No "server-only" and only pure imports: everything here is a function of
 * its inputs so it can run in Server Components, Client Components, Server
 * Actions and unit tests alike.
 *
 * Release rules
 * -------------
 *  - `availableFrom` (YYYY-MM-DD) on a chapter or lesson means 00:00 UTC of
 *    that day and applies to everyone, free-preview visitors included.
 *  - `dripDays` on a chapter or lesson unlocks N × 24h after the learner's
 *    anchor: the enrollment time, or the batch start for batch enrollments.
 *    Guests and visitors have no enrollment, so drip days never apply to them.
 *  - The release time of a lesson is the LATEST of the chapter and lesson
 *    rules. No rule at all means "available immediately".
 *  - Course managers bypass every lock. Lessons a learner already completed
 *    never lock again, even when the schedule changes later.
 */
import type { ProgressStatus } from "@/lib/types";
import { zonedTimeToUtc } from "@/components/batches/tz";
import type { LessonNeighbor, LockReason, OutlineLessonItem } from "./types";

export const DAY_MS = 86_400_000;
/** Longest supported drip delay (10 years). */
export const MAX_DRIP_DAYS = 3650;
/** Most prerequisite courses one course may require. */
export const MAX_PREREQUISITES = 10;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Why the viewer cannot open a lesson right now. */
export type AccessLockReason = "drip" | "order" | "enroll" | "prerequisite";

export interface LessonLock {
  reason: AccessLockReason;
  /** ISO instant when a drip lock lifts (reason "drip" only). */
  unlocksAt?: string;
  /** A drip-locked lesson that will also wait for earlier lessons (enforced order). */
  afterPrevious?: boolean;
}

/** Scheduling fields shared by chapters and lessons. */
export interface ReleaseRule {
  dripDays?: number;
  availableFrom?: string;
}

/**
 * Client outline rows and neighbours carry the detailed lock next to the
 * legacy `locked`/`lockReason` fields (which stay for existing consumers).
 */
export interface OutlineLessonWithLock extends OutlineLessonItem {
  lock?: LessonLock;
}

export interface LessonNeighborWithLock extends LessonNeighbor {
  lock?: LessonLock;
}

/** Read the detailed lock of an outline row / neighbour, if the server attached one. */
export function lockOf(item: OutlineLessonItem | LessonNeighbor | null | undefined): LessonLock | undefined {
  if (!item || !item.locked) return undefined;
  const lock = (item as { lock?: unknown }).lock;
  if (!lock || typeof lock !== "object") return undefined;
  const reason = (lock as { reason?: unknown }).reason;
  return reason === "drip" || reason === "order" || reason === "enroll" || reason === "prerequisite" ? (lock as LessonLock) : undefined;
}

/** What the locked-lesson page needs to explain a drip or prerequisite lock. */
export interface LockedLessonState {
  lessonId: string;
  lessonTitle: string;
  lock: LessonLock;
  /** Prerequisite courses still to complete (reason "prerequisite"). */
  prerequisites: PrerequisiteItem[];
}

/** A lesson as the locking algorithm sees it (in course order). */
export interface LockInputLesson extends ReleaseRule {
  id: string;
  status: ProgressStatus;
  includeInPreview: boolean;
  chapter: ReleaseRule;
}

export interface LockContext {
  /** Instructor of the course, moderator or admin: nothing is locked. */
  manager: boolean;
  enrolled: boolean;
  /** Free-preview lessons are open to non-enrolled viewers (published course + guest access on). */
  previewAllowed: boolean;
  /** The course unlocks lessons strictly in order (`enforceLessonCompletion`). */
  enforceOrder: boolean;
  /** Epoch ms that drip days count from; null when the viewer is not enrolled. */
  anchor: number | null;
  /** A logged-in visitor who still has to complete prerequisite courses before enrolling. */
  prerequisitesPending: boolean;
  now: number;
}

/* ------------------------------------------------------------------ */
/* Parsing & validation                                                */
/* ------------------------------------------------------------------ */

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch ms of 00:00 UTC on a YYYY-MM-DD day, or null when the value is not a real calendar date. */
export function dateKeyToUtcMs(key: string | undefined | null): number | null {
  if (!key) return null;
  const m = DATE_KEY_RE.exec(key.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

export function isDateKey(value: string | undefined | null): value is string {
  return dateKeyToUtcMs(value) !== null;
}

/** YYYY-MM-DD of an instant in UTC. */
export function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** A whole number of days in 1..MAX_DRIP_DAYS, or undefined for "no delay". */
export function normalizeDripDays(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return Math.min(n, MAX_DRIP_DAYS);
}

/** Only the fields that actually schedule something (0 days / invalid dates dropped). */
export function cleanReleaseRule(rule: ReleaseRule | null | undefined): ReleaseRule {
  const dripDays = normalizeDripDays(rule?.dripDays);
  const availableFrom = isDateKey(rule?.availableFrom) ? rule!.availableFrom!.trim() : undefined;
  return { ...(dripDays ? { dripDays } : {}), ...(availableFrom ? { availableFrom } : {}) };
}

export function hasReleaseRule(rule: ReleaseRule | null | undefined): boolean {
  const clean = cleanReleaseRule(rule);
  return clean.dripDays !== undefined || clean.availableFrom !== undefined;
}

export type ReleaseValidation = { ok: true; rule: ReleaseRule } | { ok: false; errors: { dripDays?: string; availableFrom?: string } };

/**
 * Validate raw form input for a release schedule. Empty values mean "no rule";
 * anything else must be a whole number of days (1–3650) or a real date.
 */
export function validateReleaseInput(raw: { dripDays?: unknown; availableFrom?: unknown }): ReleaseValidation {
  const errors: { dripDays?: string; availableFrom?: string } = {};
  const rule: ReleaseRule = {};

  const daysRaw = raw.dripDays === undefined || raw.dripDays === null ? "" : String(raw.dripDays).trim();
  if (daysRaw !== "" && daysRaw !== "0") {
    const n = Number(daysRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) errors.dripDays = "Enter a whole number of days (1 or more).";
    else if (n > MAX_DRIP_DAYS) errors.dripDays = `Use at most ${MAX_DRIP_DAYS.toLocaleString("en-US")} days.`;
    else rule.dripDays = n;
  }

  const dateRaw = raw.availableFrom === undefined || raw.availableFrom === null ? "" : String(raw.availableFrom).trim();
  if (dateRaw) {
    const ms = dateKeyToUtcMs(dateRaw);
    if (ms === null) errors.availableFrom = "Enter a valid date (YYYY-MM-DD).";
    else if (ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2200, 0, 1)) errors.availableFrom = "Pick a date between 2000 and 2200.";
    else rule.availableFrom = dateRaw;
  }

  return errors.dripDays || errors.availableFrom ? { ok: false, errors } : { ok: true, rule };
}

/* ------------------------------------------------------------------ */
/* Release time & locking                                              */
/* ------------------------------------------------------------------ */

/**
 * The instant drip days count from for an enrollment: the batch start (its
 * start date and time in the batch timezone) for batch enrollments, else the
 * enrollment time. NaN when the stored data is unusable (drip days are then
 * ignored rather than locking content forever).
 */
export function dripAnchor(
  enrollment: { enrolledAt: string; batchId?: string },
  batch: { startDate: string; startTime?: string; timezone?: string } | null | undefined,
): number {
  if (enrollment.batchId && batch?.startDate) {
    const start = zonedTimeToUtc(batch.startDate, batch.startTime || "00:00", batch.timezone || "UTC");
    if (Number.isFinite(start)) return start;
  }
  const enrolled = Date.parse(enrollment.enrolledAt);
  return Number.isFinite(enrolled) ? enrolled : Number.NaN;
}

/**
 * When a lesson becomes available: the latest of the chapter/lesson
 * `availableFrom` dates and, when the viewer is enrolled (`anchor` set), the
 * chapter/lesson drip delays counted from the anchor. Null = no restriction.
 */
export function releaseTime(chapter: ReleaseRule | null | undefined, lesson: ReleaseRule | null | undefined, anchor: number | null): number | null {
  let latest: number | null = null;
  const consider = (t: number | null) => {
    if (t !== null && Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  };
  consider(dateKeyToUtcMs(chapter?.availableFrom));
  consider(dateKeyToUtcMs(lesson?.availableFrom));
  if (anchor !== null && Number.isFinite(anchor)) {
    const chapterDays = normalizeDripDays(chapter?.dripDays);
    const lessonDays = normalizeDripDays(lesson?.dripDays);
    if (chapterDays) consider(anchor + chapterDays * DAY_MS);
    if (lessonDays) consider(anchor + lessonDays * DAY_MS);
  }
  return latest;
}

/**
 * Per-lesson locks for one viewer, combining free preview, prerequisites,
 * drip schedules and enforced lesson order. Returns one entry per input
 * lesson (same order): null when the lesson is open.
 *
 *  - Managers: nothing is locked.
 *  - Not enrolled: only free-preview lessons open (when previews are allowed);
 *    everything else is "enroll" (or "prerequisite" for a logged-in visitor who
 *    still has prerequisite courses to finish). A preview lesson with a future
 *    `availableFrom` is "drip"-locked for everyone.
 *  - Enrolled: a lesson whose release time is in the future is "drip"-locked;
 *    with enforced order every incomplete lesson after the first incomplete one
 *    is "order"-locked. Both can apply at once (drip wins, `afterPrevious` set).
 *    Completed lessons never lock. A free preview (while previews are allowed)
 *    ignores drip days, so enrolling never hides a lesson a visitor could open.
 */
export function computeLessonLocks(lessons: readonly LockInputLesson[], ctx: LockContext): (LessonLock | null)[] {
  if (ctx.manager) return lessons.map(() => null);
  const firstIncomplete = ctx.enrolled ? lessons.findIndex((l) => l.status !== "complete") : -1;

  return lessons.map((lesson, index): LessonLock | null => {
    const previewOpen = ctx.previewAllowed && lesson.includeInPreview;
    // Drip days need an enrollment. A free preview that anyone may open is never held back from
    // enrolled learners by drip days either (only its `availableFrom` dates apply to everyone).
    const release = releaseTime(lesson.chapter, lesson, ctx.enrolled && !previewOpen ? ctx.anchor : null);
    const dripPending = release !== null && release > ctx.now && lesson.status !== "complete";
    const drip = (afterPrevious: boolean): LessonLock => ({
      reason: "drip",
      unlocksAt: new Date(release as number).toISOString(),
      ...(afterPrevious ? { afterPrevious: true } : {}),
    });

    if (!ctx.enrolled) {
      if (!previewOpen) return { reason: ctx.prerequisitesPending ? "prerequisite" : "enroll" };
      return dripPending ? drip(false) : null;
    }

    const orderLocked = ctx.enforceOrder && firstIncomplete !== -1 && index > firstIncomplete && lesson.status !== "complete";
    if (dripPending) return drip(orderLocked);
    if (orderLocked) return { reason: "order" };
    return null;
  });
}

/**
 * Map the detailed lock onto the legacy client `LockReason` (`"sequential"` for
 * enforced order, `"enroll"` for enrollment and prerequisites). Drip locks map
 * to undefined so "complete this lesson to unlock the next" is never offered
 * for a lesson that waits for a date.
 */
export function legacyLockReason(lock: LessonLock | null | undefined): LockReason | undefined {
  if (!lock) return undefined;
  if (lock.reason === "order") return "sequential";
  if (lock.reason === "enroll" || lock.reason === "prerequisite") return "enroll";
  return undefined;
}

/** Earliest future drip unlock among locks (epoch ms), or null. */
export function nextUnlockTime(locks: Iterable<LessonLock | null | undefined>, now: number): number | null {
  let best: number | null = null;
  for (const lock of locks) {
    if (!lock || lock.reason !== "drip" || !lock.unlocksAt) continue;
    const t = Date.parse(lock.unlocksAt);
    if (!Number.isFinite(t) || t <= now) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Prerequisites                                                        */
/* ------------------------------------------------------------------ */

export type PrerequisiteState = "completed" | "in_progress" | "not_started" | "unknown";

export interface PrerequisiteItem {
  courseId: string;
  slug: string;
  title: string;
  published: boolean;
  /** "unknown" for guests (no account to check). */
  state: PrerequisiteState;
  /** Viewer progress 0-100 when enrolled. */
  progress: number;
}

interface PrereqCourse {
  id: string;
  slug: string;
  title: string;
  published: boolean;
}

interface PrereqEnrollment {
  userId: string;
  courseId: string;
  progress: number;
  completedAt?: string;
}

/**
 * Status of every prerequisite of `prerequisiteCourseIds` for a viewer.
 * Deleted courses are skipped; unpublished ones are skipped too unless the
 * viewer already completed them (learners cannot take an unpublished course,
 * so it must not become a dead end).
 */
export function resolvePrerequisites(
  prerequisiteCourseIds: readonly string[] | undefined,
  data: { courses: readonly PrereqCourse[]; enrollments: readonly PrereqEnrollment[] },
  userId: string | null | undefined,
  selfCourseId?: string,
): PrerequisiteItem[] {
  if (!prerequisiteCourseIds?.length) return [];
  const byId = new Map(data.courses.map((c) => [c.id, c]));
  const out: PrerequisiteItem[] = [];
  const seen = new Set<string>();
  for (const id of prerequisiteCourseIds) {
    if (seen.has(id) || id === selfCourseId) continue;
    seen.add(id);
    const course = byId.get(id);
    if (!course) continue;
    const enrollment = userId ? data.enrollments.find((e) => e.userId === userId && e.courseId === id) : undefined;
    const completed = !!enrollment?.completedAt;
    if (!course.published && !completed) continue;
    const state: PrerequisiteState = !userId ? "unknown" : completed ? "completed" : enrollment ? "in_progress" : "not_started";
    out.push({ courseId: course.id, slug: course.slug, title: course.title, published: course.published, state, progress: enrollment?.progress ?? 0 });
  }
  return out;
}

export function unmetPrerequisites(items: readonly PrerequisiteItem[]): PrerequisiteItem[] {
  return items.filter((i) => i.state !== "completed");
}

/** "Complete Course A and Course B first." style message for errors and hints. */
export function prerequisiteMessage(missing: readonly Pick<PrerequisiteItem, "title">[]): string {
  if (!missing.length) return "";
  const names = missing.map((m) => `“${m.title}”`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Complete ${list} before enrolling in this course.`;
}

/**
 * Whether adding `candidateIds` as prerequisites of `courseId` would create a
 * cycle (A requires B … requires A). `graph` maps a course id to its current
 * prerequisite ids. Returns the id of the first candidate that closes a loop.
 */
export function findPrerequisiteCycle(courseId: string, candidateIds: readonly string[], graph: ReadonlyMap<string, readonly string[]>): string | null {
  for (const start of candidateIds) {
    if (start === courseId) return start;
    const stack = [start];
    const visited = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === courseId) return start;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const next of graph.get(id) ?? []) if (!visited.has(next)) stack.push(next);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Oct 4, 2026" for a YYYY-MM-DD key (deterministic, no ICU / timezone). */
export function formatDateKey(key: string, withYear = true): string {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return key;
  const label = `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
  return withYear ? `${label}, ${m[1]}` : label;
}

/** "Oct 4, 2026" in UTC (used for server-rendered fallbacks before the browser shows local time). */
export function formatUtcDate(ms: number, withYear = true): string {
  return formatDateKey(utcDateKey(ms), withYear);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Local date label ("Oct 4" or "Oct 4, 2027" when not this year). */
export function formatLocalDate(ms: number, now: number, opts: { weekday?: boolean } = {}): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en-US", {
    ...(opts.weekday ? { weekday: "long" } : {}),
    month: opts.weekday ? "long" : "short",
    day: "numeric",
    ...(sameYear && !opts.weekday ? {} : { year: "numeric" }),
  });
}

/** Local time label ("9:30 AM"). */
export function formatLocalTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Short name of the viewer's time zone ("GMT+5:30", "PDT"). */
export function localTimeZoneName(ms: number): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Relative unlock label for outline rows (local time):
 * "Unlocks in 12 minutes", "Unlocks in 5 hours", "Unlocks tomorrow",
 * "Unlocks in 3 days", "Unlocks on Oct 4".
 */
export function formatUnlockLabel(unlockMs: number, now: number): string {
  const diff = unlockMs - now;
  if (diff <= 0) return "Unlocking now";
  if (diff < 60_000) return "Unlocks in less than a minute";
  if (diff < 3_600_000) return `Unlocks in ${plural(Math.ceil(diff / 60_000), "minute")}`;
  if (diff < DAY_MS) return `Unlocks in ${plural(Math.round(diff / 3_600_000), "hour")}`;
  const unlockDay = new Date(unlockMs);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (diff < 2 * DAY_MS && unlockDay.toDateString() === tomorrow.toDateString()) return "Unlocks tomorrow";
  if (diff < 7 * DAY_MS) return `Unlocks in ${plural(Math.max(1, Math.round(diff / DAY_MS)), "day")}`;
  return `Unlocks on ${formatLocalDate(unlockMs, now)}`;
}

/** Server-safe unlock label (UTC date) shown until the browser renders local time. */
export function formatUnlockFallback(unlockMs: number): string {
  return `Unlocks on ${formatUtcDate(unlockMs)}`;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownParts(ms: number): CountdownParts {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Compact badge text for a release rule: "Day 7", "Oct 4", "Day 7 · Oct 4". */
export function shortRuleLabel(rule: ReleaseRule | null | undefined): string | null {
  const clean = cleanReleaseRule(rule);
  const parts: string[] = [];
  if (clean.dripDays) parts.push(`Day ${clean.dripDays}`);
  if (clean.availableFrom) parts.push(formatDateKey(clean.availableFrom, false));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Plain-language description of a release rule, used as the preview sentence
 * in the admin editors: "Available as soon as learners enroll.",
 * "Unlocks 7 days after a learner enrolls.", "Unlocks on Oct 4, 2026 (00:00 UTC).",
 * "Unlocks 7 days after a learner enrolls, but not before Oct 4, 2026 (00:00 UTC)."
 */
export function describeReleaseRule(rule: ReleaseRule | null | undefined, subject: "chapter" | "lesson" = "lesson"): string {
  const clean = cleanReleaseRule(rule);
  const days = clean.dripDays ? `${plural(clean.dripDays, "day")} after a learner enrolls` : null;
  const date = clean.availableFrom ? `${formatDateKey(clean.availableFrom)} (00:00 UTC)` : null;
  if (days && date) return `This ${subject} unlocks ${days}, but not before ${date}.`;
  if (days) return `This ${subject} unlocks ${days}.`;
  if (date) return `This ${subject} unlocks for everyone on ${date}.`;
  return `This ${subject} is available as soon as learners enroll.`;
}

/** Human explanation of a lock, without time (the time is rendered separately in local time). */
export function lockExplanation(lock: LessonLock): string {
  switch (lock.reason) {
    case "order":
      return "Complete the previous lesson to unlock this one";
    case "prerequisite":
      return "Complete the prerequisite courses, then enroll to unlock this lesson";
    case "enroll":
      return "Enroll in the course to unlock this lesson";
    case "drip":
      return lock.afterPrevious ? "Scheduled lesson. It also needs the previous lessons completed." : "Scheduled lesson. It opens automatically at the release time.";
  }
}

/* ------------------------------------------------------------------ */
/* Admin schedule timeline                                               */
/* ------------------------------------------------------------------ */

export interface TimelineLessonInput extends ReleaseRule {
  id: string;
  title: string;
  chapterNumber: number;
  lessonNumber: number;
  includeInPreview: boolean;
}

export interface TimelineChapterInput extends ReleaseRule {
  id: string;
  title: string;
  lessons: TimelineLessonInput[];
}

export interface TimelineEntry {
  lessonId: string;
  title: string;
  index: string;
  chapterTitle: string;
  preview: boolean;
  /** Which rules decide the release time (for the explanation chip). */
  source: "immediate" | "days" | "date" | "both";
  rule: ReleaseRule;
  chapterRule: ReleaseRule;
}

export interface TimelineGroup {
  /** Epoch ms the group unlocks at (the anchor for "At enrollment"). */
  at: number;
  /** Whole days after the anchor (can be negative for fixed dates before it). */
  dayOffset: number;
  immediate: boolean;
  entries: TimelineEntry[];
}

/**
 * Group every lesson by the moment it unlocks for a learner whose drip
 * anchor (enrollment or batch start) is `anchor`. Lessons whose rules have
 * already passed at the anchor count as available at enrollment.
 */
export function buildReleaseTimeline(chapters: readonly TimelineChapterInput[], anchor: number): TimelineGroup[] {
  const groups = new Map<number, TimelineGroup>();
  for (const chapter of chapters) {
    const chapterRule = cleanReleaseRule(chapter);
    for (const lesson of chapter.lessons) {
      const rule = cleanReleaseRule(lesson);
      // Free previews ignore day-based schedules (see computeLessonLocks).
      const release = releaseTime(chapterRule, rule, lesson.includeInPreview ? null : anchor);
      const immediate = release === null || release <= anchor;
      const at = immediate ? anchor : release!;
      const byDays = !lesson.includeInPreview && [chapterRule.dripDays, rule.dripDays].some(Boolean);
      const byDate = [chapterRule.availableFrom, rule.availableFrom].some(Boolean);
      let source: TimelineEntry["source"] = "immediate";
      if (!immediate) {
        const daysAt = Math.max(
          chapterRule.dripDays ? anchor + chapterRule.dripDays * DAY_MS : -Infinity,
          rule.dripDays ? anchor + rule.dripDays * DAY_MS : -Infinity,
        );
        const dateAt = Math.max(dateKeyToUtcMs(chapterRule.availableFrom) ?? -Infinity, dateKeyToUtcMs(rule.availableFrom) ?? -Infinity);
        source = byDays && byDate ? (daysAt === dateAt ? "both" : daysAt > dateAt ? "days" : "date") : byDays ? "days" : "date";
      }
      const group = groups.get(at) ?? { at, dayOffset: Math.floor((at - anchor) / DAY_MS), immediate, entries: [] };
      group.entries.push({
        lessonId: lesson.id,
        title: lesson.title,
        index: `${lesson.chapterNumber}.${lesson.lessonNumber}`,
        chapterTitle: chapter.title,
        preview: lesson.includeInPreview,
        source,
        rule,
        chapterRule,
      });
      groups.set(at, group);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.at - b.at);
}
