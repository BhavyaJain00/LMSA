import "server-only";
import type { ActivityType, Course, Database, PointsEntry, PointsReason, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { canViewCourse, lessonHref } from "@/lib/data/courses";
import { addDays, toDateKey, uid } from "@/lib/utils";
import { notify } from "./notifications";
import { formatPoints, getLevelInfo, levelForPoints, tierForLevel, type LevelInfo, type TierName, type TierTone } from "@/components/gamification/levels";
import { DISCUSSION_REPLY_DAILY_CAP, MAX_MANUAL_POINTS, POINTS_REASONS, REASON_META, isPointsReason } from "@/components/gamification/reasons";

export { getLevelInfo, type LevelInfo } from "@/components/gamification/levels";

/**
 * Points ledger, levels and leaderboards.
 *
 * Every point a member earns is one `PointsEntry` in `db.points`. Awards are
 * idempotent per (user, reason, refId) — a lesson, quiz, assignment … can
 * only pay out once — and per day for "streak_day". Manual adjustments are
 * the only entries that may repeat. The ledger can be rebuilt from the
 * learning history at any time (admin "Recalculate"), and is backfilled
 * automatically the first time it is needed while empty.
 *
 * Canonical refIds (hooks and the backfill must agree):
 *   lesson_complete → lessonId        course_complete → courseId
 *   quiz_pass / quiz_perfect → quizId assignment_submit / assignment_pass → assignmentId
 *   exercise_pass → exerciseId        certificate → certificateId
 *   review → courseId                 discussion_reply → replyId
 *   streak_day → YYYY-MM-DD           manual → none (or an explicit refId)
 */

const MAX_ABS_POINTS = 100000;
const DAY_MS = 86400000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

/** Admins and moderators are hidden from leaderboards when `excludeStaff` is on. */
export function isLeaderboardStaff(user: Pick<User, "roles">): boolean {
  return user.roles.includes("admin") || user.roles.includes("moderator");
}

function clampPoints(value: number): number {
  return Math.max(-MAX_ABS_POINTS, Math.min(MAX_ABS_POINTS, value));
}

function resolveValue(reason: PointsReason, override: number | undefined, settings: Settings["gamification"]): number {
  const raw = override ?? (reason === "manual" ? 0 : settings.points[reason]);
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? clampPoints(n) : 0;
}

function sameRef(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

function hasEntry(points: PointsEntry[], userId: string, reason: PointsReason, refId: string | undefined): boolean {
  return points.some((p) => p.userId === userId && p.reason === reason && sameRef(p.refId, refId));
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toDateKey(d);
}

function countOnDay(points: PointsEntry[], userId: string, reason: PointsReason, day: string): number {
  let n = 0;
  for (const p of points) if (p.userId === userId && p.reason === reason && dayOf(p.createdAt) === day) n++;
  return n;
}

/** Midday of a YYYY-MM-DD key as ISO (avoids day shifts across time zones). */
function dayKeyToIso(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function validIso(value: string | undefined, fallback: string): string {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Activity types that make a day count as a learning day ("streak_day"). */
export function isLearningActivity(type: ActivityType): boolean {
  return type !== "login" && type !== "enroll";
}

/* ------------------------------------------------------------------ */
/* Awarding                                                             */
/* ------------------------------------------------------------------ */

export interface AwardPointsOptions {
  /** What the points are for (see the canonical refIds above). */
  refId?: string;
  courseId?: string;
  /** Override the configured value (required for "manual"). */
  points?: number;
  note?: string;
}

/**
 * Award points to a member. Uses `settings.gamification.points[reason]`
 * unless `points` is given. Idempotent per (user, reason, refId) — per day
 * for "streak_day" — and capped per day for discussion replies. A no-op
 * when gamification is off or the value is 0. Never throws: failures are
 * logged and `null` is returned, so it is safe to call from any flow.
 */
export async function awardPoints(userId: string, reason: PointsReason, opts: AwardPointsOptions = {}): Promise<PointsEntry | null> {
  try {
    if (!userId || !isPointsReason(reason)) return null;
    const db = await getDb();
    if (!db.settings.gamification.enabled) return null;
    const value = resolveValue(reason, opts.points, db.settings.gamification);
    if (value === 0) return null;

    // The first award on an empty ledger backfills the history first, so nothing is lost or doubled.
    await ensurePointsLedger();

    const refId = reason === "streak_day" ? opts.refId || toDateKey() : opts.refId || undefined;
    const keyed = reason !== "manual" || !!refId;
    // Cheap check outside the write lock: heartbeats call this for every tick.
    if (keyed && hasEntry(db.points, userId, reason, refId)) return null;

    const result = await mutate((d) => {
      if (!d.settings.gamification.enabled) return null;
      if (!d.users.some((u) => u.id === userId)) return null;
      if (keyed && hasEntry(d.points, userId, reason, refId)) return null;
      const now = new Date();
      if (reason === "discussion_reply" && countOnDay(d.points, userId, reason, toDateKey(now)) >= DISCUSSION_REPLY_DAILY_CAP) return null;
      let before = 0;
      for (const p of d.points) if (p.userId === userId) before += p.points;
      const entry: PointsEntry = {
        id: uid("pts"),
        userId,
        points: value,
        reason,
        refId,
        courseId: opts.courseId || undefined,
        note: opts.note?.trim().slice(0, 200) || undefined,
        createdAt: now.toISOString(),
      };
      d.points.push(entry);
      return { entry, before, after: before + value };
    });
    if (!result) return null;
    await notifyLevelUp(userId, result.before, result.after);
    return result.entry;
  } catch (err) {
    console.error(`[points] could not award "${reason}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Tell a member when an award takes them to a new level (never throws). */
async function notifyLevelUp(userId: string, before: number, after: number): Promise<void> {
  try {
    const from = levelForPoints(before);
    const to = getLevelInfo(after);
    if (to.level <= from) return;
    const newTier = tierForLevel(from).name !== to.tier;
    await notify(userId, {
      type: "system",
      subject: newTier ? `You reached level ${to.level} and became ${articleFor(to.tier)} ${to.tier}!` : `You reached level ${to.level}!`,
      message: to.nextTier
        ? `${formatPoints(to.pointsToNext)} more points to level ${to.level + 1}. Keep learning to reach ${to.nextTier.name}.`
        : `${formatPoints(to.pointsToNext)} more points to level ${to.level + 1}.`,
      link: "/leaderboard/points",
    });
  } catch (err) {
    console.error("[points] could not send the level-up notification:", err instanceof Error ? err.message : err);
  }
}

function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * Remove the entries of a reason for the given refIds (e.g. a deleted reply
 * or a regraded assignment). Optionally limited to one member. Never throws.
 * Returns how many entries were removed.
 */
export async function revokePoints(reason: PointsReason, refIds: string | string[], userId?: string): Promise<number> {
  try {
    const ids = new Set((Array.isArray(refIds) ? refIds : [refIds]).filter((id): id is string => typeof id === "string" && id.length > 0));
    if (!ids.size || !isPointsReason(reason)) return 0;
    const matches = (p: PointsEntry) => p.reason === reason && !!p.refId && ids.has(p.refId) && (!userId || p.userId === userId);
    const db = await getDb();
    if (!db.points.some(matches)) return 0;
    return await mutate((d) => {
      const before = d.points.length;
      d.points = d.points.filter((p) => !matches(p));
      return before - d.points.length;
    });
  } catch (err) {
    console.error(`[points] could not revoke "${reason}":`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Award when `earned`, otherwise take the award back (for results that can change, like a regrade). */
export async function setPointsAward(userId: string, reason: PointsReason, earned: boolean, opts: AwardPointsOptions & { refId: string }): Promise<void> {
  if (earned) await awardPoints(userId, reason, opts);
  else await revokePoints(reason, opts.refId, userId);
}

/** Pass / perfect-score points for a stored quiz submission (after submitting or grading). Never throws. */
export async function awardQuizPoints(submissionId: string): Promise<void> {
  try {
    const db = await getDb();
    const submission = db.quizSubmissions.find((s) => s.id === submissionId);
    if (!submission || submission.pendingGrading || !submission.passed) return;
    const quiz = db.quizzes.find((q) => q.id === submission.quizId);
    const courseId = submission.courseId ?? quiz?.courseId;
    await awardPoints(submission.userId, "quiz_pass", { refId: submission.quizId, courseId });
    if (submission.scoreOutOf > 0 && submission.percentage >= 100) {
      await awardPoints(submission.userId, "quiz_perfect", { refId: submission.quizId, courseId });
    }
  } catch (err) {
    console.error("[points] could not award quiz points:", err instanceof Error ? err.message : err);
  }
}

/**
 * Points for a discussion reply (lesson or batch). Skips the opening post
 * and replies on your own topic. Accepts a missing id as a no-op. Never throws.
 */
export async function awardDiscussionReplyPoints(replyId: string | undefined | null): Promise<void> {
  try {
    if (!replyId) return;
    const db = await getDb();
    const reply = db.discussionReplies.find((r) => r.id === replyId);
    const topic = reply ? db.discussionTopics.find((t) => t.id === reply.topicId) : undefined;
    if (!reply || !topic || reply.authorId === topic.authorId) return;
    const opening = db.discussionReplies
      .filter((r) => r.topicId === topic.id)
      .reduce<typeof reply | null>((first, r) => (!first || r.createdAt < first.createdAt ? r : first), null);
    if (opening?.id === reply.id) return;
    await awardPoints(reply.authorId, "discussion_reply", { refId: reply.id, courseId: topic.courseId });
  } catch (err) {
    console.error("[points] could not award reply points:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Backfill / recalculation                                             */
/* ------------------------------------------------------------------ */

interface BackfillState {
  running: Promise<void> | null;
  /** When an automatic backfill last ran and found nothing to award. */
  emptyCheckedAt: number;
}

const backfillGlobal = globalThis as unknown as { __llPointsBackfill?: BackfillState };
const backfill: BackfillState = (backfillGlobal.__llPointsBackfill ??= { running: null, emptyCheckedAt: 0 });

/** Minimum pause between automatic backfills of a ledger that stays empty. */
const EMPTY_RECHECK_MS = 60_000;

/**
 * Rebuild point entries (everything except manual adjustments) from the
 * learning history with the current point values. Pure: reads `db` only.
 */
export function buildLedgerFromHistory(db: Database): PointsEntry[] {
  const values = db.settings.gamification.points;
  const users = new Set(db.users.map((u) => u.id));
  const out: PointsEntry[] = [];
  const seen = new Set<string>();
  const nowIso = new Date().toISOString();

  const push = (userId: string, reason: PointsReason, refId: string | undefined, createdAt: string, courseId?: string) => {
    const points = resolveValue(reason, undefined, db.settings.gamification);
    if (!points || !users.has(userId)) return;
    const key = `${userId}|${reason}|${refId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: uid("pts"), userId, points, reason, refId, courseId: courseId || undefined, createdAt: validIso(createdAt, nowIso) });
  };
  const earliestFirst = <T>(rows: T[], at: (row: T) => string) => [...rows].sort((a, b) => time(at(a)) - time(at(b)));

  // Lessons completed (only lessons that still exist).
  if (values.lesson_complete) {
    const lessons = new Map(db.lessons.map((l) => [l.id, l]));
    for (const p of earliestFirst(db.progress, (r) => r.completedAt ?? r.updatedAt)) {
      if (p.status !== "complete") continue;
      const lesson = lessons.get(p.lessonId);
      if (!lesson) continue;
      push(p.userId, "lesson_complete", lesson.id, p.completedAt ?? p.updatedAt, lesson.courseId);
    }
  }

  // Courses completed.
  if (values.course_complete) {
    for (const e of earliestFirst(db.enrollments, (r) => r.completedAt ?? r.enrolledAt)) {
      if (e.completedAt) push(e.userId, "course_complete", e.courseId, e.completedAt, e.courseId);
    }
  }

  // Quizzes: the first passing attempt, and the first perfect one.
  if (values.quiz_pass || values.quiz_perfect) {
    const quizzes = new Map(db.quizzes.map((q) => [q.id, q]));
    for (const s of earliestFirst(db.quizSubmissions, (r) => r.submittedAt)) {
      if (s.pendingGrading || !s.passed) continue;
      const courseId = s.courseId ?? quizzes.get(s.quizId)?.courseId;
      push(s.userId, "quiz_pass", s.quizId, s.submittedAt, courseId);
      if (s.scoreOutOf > 0 && s.percentage >= 100) push(s.userId, "quiz_perfect", s.quizId, s.submittedAt, courseId);
    }
  }

  // Assignments: submitted, and graded as pass.
  if (values.assignment_submit || values.assignment_pass) {
    const assignments = new Map(db.assignments.map((a) => [a.id, a]));
    for (const s of earliestFirst(db.assignmentSubmissions, (r) => r.submittedAt)) {
      const courseId = s.courseId ?? assignments.get(s.assignmentId)?.courseId;
      push(s.userId, "assignment_submit", s.assignmentId, s.submittedAt, courseId);
      if (s.status === "pass") push(s.userId, "assignment_pass", s.assignmentId, s.gradedAt ?? s.updatedAt, courseId);
    }
  }

  // Programming exercises solved.
  if (values.exercise_pass) {
    const exercises = new Map(db.exercises.map((x) => [x.id, x]));
    for (const s of earliestFirst(db.exerciseSubmissions, (r) => r.submittedAt)) {
      if (s.status !== "passed") continue;
      push(s.userId, "exercise_pass", s.exerciseId, s.submittedAt, s.courseId ?? exercises.get(s.exerciseId)?.courseId);
    }
  }

  // Certificates issued (published or not, matching the award made when a certificate is created).
  if (values.certificate) {
    for (const c of db.certificates) push(c.userId, "certificate", c.id, dayKeyToIso(c.issueDate), c.courseId);
  }

  // Course reviews.
  if (values.review) {
    for (const r of db.reviews) push(r.userId, "review", r.courseId, r.createdAt, r.courseId);
  }

  // Helpful replies: not the opening post, not on your own topic, at most N a day.
  if (values.discussion_reply) {
    const topics = new Map(db.discussionTopics.map((t) => [t.id, t]));
    const byTopic = new Map<string, typeof db.discussionReplies>();
    for (const r of db.discussionReplies) {
      const list = byTopic.get(r.topicId) ?? [];
      list.push(r);
      byTopic.set(r.topicId, list);
    }
    const candidates: { userId: string; replyId: string; createdAt: string; courseId?: string }[] = [];
    for (const [topicId, replies] of byTopic) {
      const topic = topics.get(topicId);
      if (!topic) continue;
      const sorted = [...replies].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const r of sorted.slice(1)) {
        if (r.authorId === topic.authorId) continue;
        candidates.push({ userId: r.authorId, replyId: r.id, createdAt: r.createdAt, courseId: topic.courseId });
      }
    }
    const perDay = new Map<string, number>();
    for (const c of candidates.sort((a, b) => time(a.createdAt) - time(b.createdAt))) {
      const key = `${c.userId}|${dayOf(c.createdAt)}`;
      const used = perDay.get(key) ?? 0;
      if (used >= DISCUSSION_REPLY_DAILY_CAP) continue;
      perDay.set(key, used + 1);
      push(c.userId, "discussion_reply", c.replyId, c.createdAt, c.courseId);
    }
  }

  // Learning days: lessons, quizzes, assignments or exercises (logins and enrollments alone do not count).
  if (values.streak_day) {
    const firstOfDay = new Map<string, { userId: string; date: string; createdAt: string }>();
    for (const a of db.activities) {
      if (!isLearningActivity(a.type) || !a.date) continue;
      const key = `${a.userId}|${a.date}`;
      const existing = firstOfDay.get(key);
      if (!existing || time(a.createdAt) < time(existing.createdAt)) firstOfDay.set(key, { userId: a.userId, date: a.date, createdAt: a.createdAt });
    }
    for (const day of firstOfDay.values()) push(day.userId, "streak_day", day.date, day.createdAt || dayKeyToIso(day.date));
  }

  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Backfill the ledger from history once when it is empty and gamification
 * is on. Concurrent callers share one run; an empty result is not retried
 * for a minute. Never throws.
 */
export async function ensurePointsLedger(): Promise<void> {
  try {
    const db = await getDb();
    if (!db.settings.gamification.enabled || db.points.length > 0) return;
    if (backfill.running) return await backfill.running;
    if (Date.now() - backfill.emptyCheckedAt < EMPTY_RECHECK_MS) return;
    backfill.running = (async () => {
      try {
        const added = await mutate((d) => {
          if (d.points.length > 0 || !d.settings.gamification.enabled) return -1;
          const entries = buildLedgerFromHistory(d);
          d.points.push(...entries);
          return entries.length;
        });
        if (added === 0) backfill.emptyCheckedAt = Date.now();
        else if (added > 0) console.info(`[points] backfilled ${added} ledger entries from history`);
      } catch (err) {
        backfill.emptyCheckedAt = Date.now();
        console.error("[points] automatic backfill failed:", err instanceof Error ? err.message : err);
      } finally {
        backfill.running = null;
      }
    })();
    await backfill.running;
  } catch (err) {
    console.error("[points] could not check the ledger:", err instanceof Error ? err.message : err);
  }
}

export interface ReasonTotal {
  reason: PointsReason;
  count: number;
  points: number;
}

export interface RecalculateResult {
  entries: number;
  members: number;
  totalPoints: number;
  manualKept: number;
  previousEntries: number;
  byReason: ReasonTotal[];
}

function breakdown(entries: PointsEntry[]): ReasonTotal[] {
  const map = new Map<PointsReason, ReasonTotal>();
  for (const e of entries) {
    const row = map.get(e.reason) ?? { reason: e.reason, count: 0, points: 0 };
    row.count++;
    row.points += e.points;
    map.set(e.reason, row);
  }
  return POINTS_REASONS.map((r) => map.get(r)).filter((r): r is ReasonTotal => !!r);
}

/**
 * Rebuild the whole ledger from history with the current point values,
 * keeping manual adjustments. Throws on storage errors (admin action).
 */
export async function recalculatePointsLedger(): Promise<RecalculateResult> {
  const result = await mutate((d) => {
    const previousEntries = d.points.length;
    const manual = d.points.filter((p) => p.reason === "manual");
    const rebuilt = buildLedgerFromHistory(d);
    d.points = [...rebuilt, ...manual].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const members = new Set(d.points.map((p) => p.userId)).size;
    const totalPoints = d.points.reduce((sum, p) => sum + p.points, 0);
    return { entries: d.points.length, members, totalPoints, manualKept: manual.length, previousEntries, byReason: breakdown(d.points) };
  });
  backfill.emptyCheckedAt = result.entries === 0 ? Date.now() : 0;
  return result;
}

/** Record a manual adjustment (admin). Works while gamification is on; returns the entry. */
export async function addManualAdjustment(userId: string, points: number, note: string): Promise<PointsEntry | null> {
  const value = Math.round(points);
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) > MAX_MANUAL_POINTS) return null;
  return awardPoints(userId, "manual", { points: value, note });
}

/* ------------------------------------------------------------------ */
/* Periods                                                              */
/* ------------------------------------------------------------------ */

export type LeaderboardPeriod = "week" | "month" | "all";
export const LEADERBOARD_PERIODS: LeaderboardPeriod[] = ["week", "month", "all"];

export function parsePeriod(value: unknown): LeaderboardPeriod {
  return value === "month" || value === "all" ? value : "week";
}

/** Monday 00:00 (server local time) of the week containing `d`. */
export function startOfWeek(d: Date = new Date()): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export function startOfMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

interface TimeWindow {
  /** Inclusive start (ms), or null for "since the beginning". */
  start: number | null;
  /** Exclusive end (ms). */
  end: number;
}

export interface PeriodWindows {
  current: TimeWindow;
  previous: TimeWindow;
  label: string;
  trendLabel: string;
}

const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function periodWindows(period: LeaderboardPeriod, now: Date = new Date()): PeriodWindows {
  const end = now.getTime() + 1;
  if (period === "week") {
    const start = startOfWeek(now);
    const prevStart = addDays(start, -7);
    return {
      current: { start: start.getTime(), end },
      previous: { start: prevStart.getTime(), end: start.getTime() },
      label: `Since Monday, ${shortDate(start)}`,
      trendLabel: "vs. last week",
    };
  }
  if (period === "month") {
    const start = startOfMonth(now);
    const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    return {
      current: { start: start.getTime(), end },
      previous: { start: prevStart.getTime(), end: start.getTime() },
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      trendLabel: "vs. last month",
    };
  }
  return {
    current: { start: null, end },
    previous: { start: null, end: now.getTime() - 7 * DAY_MS },
    label: "All points ever earned",
    trendLabel: "vs. 7 days ago",
  };
}

function inWindow(iso: string, w: TimeWindow): boolean {
  const t = time(iso);
  return (w.start === null || t >= w.start) && t < w.end;
}

/* ------------------------------------------------------------------ */
/* Standings                                                            */
/* ------------------------------------------------------------------ */

interface Standing {
  userId: string;
  points: number;
  /** When the member reached their total (earlier wins ties in ordering). */
  lastAt: number;
  rank: number;
}

/** Members who may appear on a leaderboard. */
function eligibleMembers(db: Database): Map<string, User> {
  const exclude = db.settings.gamification.excludeStaff;
  const map = new Map<string, User>();
  for (const u of db.users) {
    if (!u.enabled) continue;
    if (exclude && isLeaderboardStaff(u)) continue;
    map.set(u.id, u);
  }
  return map;
}

/** Rank members by points in a window (competition ranking: 1, 2, 2, 4). Members at 0 or below are not ranked. */
function computeStandings(db: Database, eligible: Map<string, User>, window: TimeWindow, courseId: string | null): Standing[] {
  const totals = new Map<string, { points: number; lastAt: number }>();
  for (const p of db.points) {
    if (!eligible.has(p.userId)) continue;
    if (courseId && p.courseId !== courseId) continue;
    if (!inWindow(p.createdAt, window)) continue;
    const row = totals.get(p.userId) ?? { points: 0, lastAt: 0 };
    row.points += p.points;
    row.lastAt = Math.max(row.lastAt, time(p.createdAt));
    totals.set(p.userId, row);
  }
  const list = Array.from(totals, ([userId, v]) => ({ userId, points: v.points, lastAt: v.lastAt, rank: 0 }))
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || a.lastAt - b.lastAt || (eligible.get(a.userId)?.name ?? "").localeCompare(eligible.get(b.userId)?.name ?? ""));
  let rank = 0;
  let prevPoints: number | null = null;
  list.forEach((s, i) => {
    if (s.points !== prevPoints) rank = i + 1;
    s.rank = rank;
    prevPoints = s.points;
  });
  return list;
}

function allTimeTotals(db: Database): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of db.points) totals.set(p.userId, (totals.get(p.userId) ?? 0) + p.points);
  return totals;
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                          */
/* ------------------------------------------------------------------ */

export interface LeaderboardMember {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  headline?: string;
}

export type TrendKind = "up" | "down" | "same" | "new";

export interface LeaderboardTrend {
  kind: TrendKind;
  /** Places gained (positive) or lost (negative). */
  change: number;
  previousRank: number | null;
}

export interface LeaderboardRow {
  rank: number;
  member: LeaderboardMember;
  points: number;
  level: number;
  tier: TierName;
  tierTone: TierTone;
  trend: LeaderboardTrend;
  isViewer: boolean;
}

export type ViewerStanding = "guest" | "ranked" | "unranked" | "excluded";

export interface LeaderboardResult {
  period: LeaderboardPeriod;
  course: { id: string; title: string; slug: string } | null;
  rangeLabel: string;
  trendLabel: string;
  rows: LeaderboardRow[];
  rankedCount: number;
  totalPoints: number;
  excludeStaff: boolean;
  viewer: {
    status: ViewerStanding;
    /** The viewer's row when ranked. */
    row: LeaderboardRow | null;
    /** True when the viewer is ranked below the visible rows (shown pinned under the table). */
    pinned: boolean;
    /** Viewer points in this period and filter (may be 0 or negative). */
    periodPoints: number;
    level: LevelInfo | null;
  };
}

function toMember(u: User): LeaderboardMember {
  return { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl, headline: u.headline };
}

function trendFor(rank: number, previousRank: number | undefined): LeaderboardTrend {
  if (previousRank === undefined) return { kind: "new", change: 0, previousRank: null };
  const change = previousRank - rank;
  return { kind: change > 0 ? "up" : change < 0 ? "down" : "same", change, previousRank };
}

export async function getLeaderboard(input: { viewer: User | null; period: LeaderboardPeriod; courseId?: string | null; limit?: number }): Promise<LeaderboardResult> {
  await ensurePointsLedger();
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const course = input.courseId ? (db.courses.find((c) => c.id === input.courseId) ?? null) : null;
  const courseId = course && canViewCourse(input.viewer, course) ? course.id : null;
  const windows = periodWindows(input.period);
  const eligible = eligibleMembers(db);
  const current = computeStandings(db, eligible, windows.current, courseId);
  const previous = computeStandings(db, eligible, windows.previous, courseId);
  const previousRanks = new Map(previous.map((s) => [s.userId, s.rank]));
  const totals = allTimeTotals(db);
  const viewerId = input.viewer?.id ?? null;

  const toRow = (s: Standing): LeaderboardRow => {
    const user = eligible.get(s.userId)!;
    const level = getLevelInfo(totals.get(s.userId) ?? 0);
    return {
      rank: s.rank,
      member: toMember(user),
      points: s.points,
      level: level.level,
      tier: level.tier,
      tierTone: level.tierTone,
      trend: trendFor(s.rank, previousRanks.get(s.userId)),
      isViewer: s.userId === viewerId,
    };
  };

  const rows = current.slice(0, limit).map(toRow);
  let status: ViewerStanding = "guest";
  let viewerRow: LeaderboardRow | null = null;
  let pinned = false;
  let periodPoints = 0;
  if (input.viewer) {
    const viewer = input.viewer;
    for (const p of db.points) {
      if (p.userId === viewer.id && (!courseId || p.courseId === courseId) && inWindow(p.createdAt, windows.current)) periodPoints += p.points;
    }
    if (!eligible.has(viewer.id)) status = "excluded";
    else {
      const standing = current.find((s) => s.userId === viewer.id);
      if (standing) {
        status = "ranked";
        viewerRow = rows.find((r) => r.isViewer) ?? toRow(standing);
        pinned = !rows.some((r) => r.isViewer);
      } else status = "unranked";
    }
  }

  return {
    period: input.period,
    course: course && courseId ? { id: course.id, title: course.title, slug: course.slug } : null,
    rangeLabel: windows.label,
    trendLabel: windows.trendLabel,
    rows,
    rankedCount: current.length,
    totalPoints: current.reduce((sum, s) => sum + s.points, 0),
    excludeStaff: db.settings.gamification.excludeStaff,
    viewer: {
      status,
      row: viewerRow,
      pinned,
      periodPoints,
      level: input.viewer ? getLevelInfo(totals.get(input.viewer.id) ?? 0) : null,
    },
  };
}

/** Courses offered in the leaderboard filter: those the viewer can see, with points first. */
export async function getLeaderboardCourses(viewer: User | null): Promise<{ id: string; title: string; hasPoints: boolean }[]> {
  const db = await getDb();
  const withPoints = new Set<string>();
  for (const p of db.points) if (p.courseId) withPoints.add(p.courseId);
  return db.courses
    .filter((c: Course) => canViewCourse(viewer, c))
    .map((c) => ({ id: c.id, title: c.title, hasPoints: withPoints.has(c.id) }))
    .sort((a, b) => Number(b.hasPoints) - Number(a.hasPoints) || a.title.localeCompare(b.title));
}

/* ------------------------------------------------------------------ */
/* Per-member summaries                                                 */
/* ------------------------------------------------------------------ */

export interface PointsTotals {
  all: number;
  week: number;
  month: number;
}

function totalsFor(db: Database, userId: string, now = new Date()): PointsTotals {
  const week = startOfWeek(now).getTime();
  const month = startOfMonth(now).getTime();
  const out: PointsTotals = { all: 0, week: 0, month: 0 };
  for (const p of db.points) {
    if (p.userId !== userId) continue;
    out.all += p.points;
    const t = time(p.createdAt);
    if (t >= week) out.week += p.points;
    if (t >= month) out.month += p.points;
  }
  return out;
}

export interface MemberLevel {
  enabled: boolean;
  totals: PointsTotals;
  level: LevelInfo;
}

/** Point totals and level of a member (level uses the all-time total). */
export async function getMemberLevel(userId: string): Promise<MemberLevel> {
  await ensurePointsLedger();
  const db = await getDb();
  const totals = totalsFor(db, userId);
  return { enabled: db.settings.gamification.enabled, totals, level: getLevelInfo(totals.all) };
}

export interface RankSummary {
  enabled: boolean;
  showLeaderboard: boolean;
  /** Staff hidden from leaderboards (points still count). */
  excluded: boolean;
  totals: PointsTotals;
  level: LevelInfo;
  week: { rank: number | null; ranked: number; trend: LeaderboardTrend | null };
  allTime: { rank: number | null; ranked: number };
  /** Points needed to pass the member right above in this week's standings. */
  weekGapToNext: number | null;
  lastEarned: { reason: PointsReason; points: number; createdAt: string } | null;
}

/** Everything the dashboard "Your rank" widget shows. */
export async function getRankSummary(user: User): Promise<RankSummary> {
  await ensurePointsLedger();
  const db = await getDb();
  const g = db.settings.gamification;
  const totals = totalsFor(db, user.id);
  const eligible = eligibleMembers(db);
  const excluded = !eligible.has(user.id);
  const weekWindows = periodWindows("week");
  const weekStandings = computeStandings(db, eligible, weekWindows.current, null);
  const prevWeek = computeStandings(db, eligible, weekWindows.previous, null);
  const allStandings = computeStandings(db, eligible, periodWindows("all").current, null);
  const mineWeek = weekStandings.find((s) => s.userId === user.id) ?? null;
  const mineAll = allStandings.find((s) => s.userId === user.id) ?? null;
  const prevRank = prevWeek.find((s) => s.userId === user.id)?.rank;
  let gap: number | null = null;
  if (mineWeek && mineWeek.rank > 1) {
    const above = weekStandings.filter((s) => s.points > mineWeek.points).at(-1);
    if (above) gap = above.points - mineWeek.points + 1;
  }
  let last: PointsEntry | null = null;
  for (const p of db.points) if (p.userId === user.id && (!last || p.createdAt > last.createdAt)) last = p;
  return {
    enabled: g.enabled,
    showLeaderboard: g.showLeaderboard,
    excluded,
    totals,
    level: getLevelInfo(totals.all),
    week: { rank: mineWeek?.rank ?? null, ranked: weekStandings.length, trend: mineWeek ? trendFor(mineWeek.rank, prevRank) : null },
    allTime: { rank: mineAll?.rank ?? null, ranked: allStandings.length },
    weekGapToNext: gap,
    lastEarned: last ? { reason: last.reason, points: last.points, createdAt: last.createdAt } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Points history                                                       */
/* ------------------------------------------------------------------ */

export interface PointsHistoryItem {
  id: string;
  reason: PointsReason;
  label: string;
  points: number;
  createdAt: string;
  /** What the points were for (lesson, quiz, course …), when it still exists. */
  title: string | null;
  /** Where it happened (course or batch title). */
  context: string | null;
  href: string | null;
  note?: string;
}

export interface PointsHistory {
  items: PointsHistoryItem[];
  page: number;
  pageCount: number;
  pageSize: number;
  /** Entries matching the reason filter. */
  total: number;
  reason: PointsReason | null;
  breakdown: ReasonTotal[];
  totals: PointsTotals;
  level: LevelInfo;
  entryCount: number;
  firstEarnedAt: string | null;
}

/** Resolves ledger entries to titles and links, caching lesson positions per course. */
function createEntryDescriber(db: Database) {
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const lessons = new Map(db.lessons.map((l) => [l.id, l]));
  const quizzes = new Map(db.quizzes.map((q) => [q.id, q]));
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  const exercises = new Map(db.exercises.map((x) => [x.id, x]));
  const certificates = new Map(db.certificates.map((c) => [c.id, c]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const topics = new Map(db.discussionTopics.map((t) => [t.id, t]));
  const replies = new Map(db.discussionReplies.map((r) => [r.id, r]));
  const lessonHrefs = new Map<string, string | null>();

  const lessonLink = (lessonId: string): string | null => {
    if (lessonHrefs.has(lessonId)) return lessonHrefs.get(lessonId)!;
    let href: string | null = null;
    const lesson = lessons.get(lessonId);
    const course = lesson ? courses.get(lesson.courseId) : undefined;
    if (lesson && course) {
      const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
      const ci = chapters.findIndex((c) => c.id === lesson.chapterId);
      const siblings = db.lessons.filter((l) => l.chapterId === lesson.chapterId).sort((a, b) => a.order - b.order);
      const li = siblings.findIndex((l) => l.id === lesson.id);
      if (ci !== -1 && li !== -1) href = lessonHref(course.slug, { chapterNumber: ci + 1, lessonNumber: li + 1 });
    }
    lessonHrefs.set(lessonId, href);
    return href;
  };
  const courseTitle = (id: string | undefined) => (id ? (courses.get(id)?.title ?? null) : null);

  return (entry: PointsEntry): { title: string | null; context: string | null; href: string | null } => {
    const ref = entry.refId ?? "";
    switch (entry.reason) {
      case "lesson_complete": {
        const lesson = lessons.get(ref);
        return { title: lesson?.title ?? null, context: courseTitle(lesson?.courseId ?? entry.courseId), href: lesson ? lessonLink(lesson.id) : null };
      }
      case "course_complete":
      case "review": {
        const course = courses.get(ref) ?? (entry.courseId ? courses.get(entry.courseId) : undefined);
        if (!course) return { title: null, context: null, href: null };
        return { title: course.title, context: null, href: entry.reason === "review" ? `/courses/${course.slug}#reviews` : `/courses/${course.slug}` };
      }
      case "quiz_pass":
      case "quiz_perfect": {
        const quiz = quizzes.get(ref);
        return { title: quiz?.title ?? null, context: courseTitle(entry.courseId ?? quiz?.courseId), href: quiz ? `/quiz/${quiz.id}` : null };
      }
      case "assignment_submit":
      case "assignment_pass": {
        const assignment = assignments.get(ref);
        return { title: assignment?.title ?? null, context: courseTitle(entry.courseId ?? assignment?.courseId), href: assignment ? `/assignments/${assignment.id}` : null };
      }
      case "exercise_pass": {
        const exercise = exercises.get(ref);
        return { title: exercise?.title ?? null, context: courseTitle(entry.courseId ?? exercise?.courseId), href: exercise ? `/exercises/${exercise.id}` : null };
      }
      case "certificate": {
        const cert = certificates.get(ref);
        if (!cert) return { title: null, context: null, href: null };
        const subject = cert.courseId ? courses.get(cert.courseId)?.title : cert.batchId ? batches.get(cert.batchId)?.title : undefined;
        return { title: subject ?? null, context: null, href: cert.published ? `/certificates/${cert.code}` : null };
      }
      case "discussion_reply": {
        const reply = replies.get(ref);
        const topic = reply ? topics.get(reply.topicId) : undefined;
        if (!topic) return { title: null, context: courseTitle(entry.courseId), href: null };
        if (topic.refType === "batch") {
          const batch = batches.get(topic.refId);
          return { title: topic.title, context: batch?.title ?? null, href: batch ? `/batches/${batch.slug}?tab=discussions#topic-${topic.id}` : null };
        }
        if (topic.refType === "lesson") {
          const href = lessonLink(topic.refId);
          return { title: topic.title, context: courseTitle(topic.courseId), href: href ? `${href}?tab=discussion&topic=${encodeURIComponent(topic.id)}` : null };
        }
        return { title: topic.title, context: courseTitle(topic.courseId), href: null };
      }
      case "streak_day":
        return { title: null, context: null, href: null };
      case "manual":
        return { title: entry.note ?? null, context: courseTitle(entry.courseId), href: null };
    }
  };
}

export async function getPointsHistory(userId: string, opts: { page?: number; pageSize?: number; reason?: PointsReason | null } = {}): Promise<PointsHistory> {
  await ensurePointsLedger();
  const db = await getDb();
  const mine = db.points.filter((p) => p.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const reason = opts.reason && isPointsReason(opts.reason) ? opts.reason : null;
  const filtered = reason ? mine.filter((p) => p.reason === reason) : mine;
  const pageSize = Math.max(5, Math.min(100, opts.pageSize ?? 25));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(opts.page ?? 1) || 1));
  const describe = createEntryDescriber(db);
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((p): PointsHistoryItem => {
    const d = describe(p);
    return {
      id: p.id,
      reason: p.reason,
      label: REASON_META[p.reason].label,
      points: p.points,
      createdAt: p.createdAt,
      title: d.title,
      context: d.context,
      href: d.href,
      note: p.reason === "manual" ? undefined : p.note,
    };
  });
  const totals = totalsFor(db, userId);
  return {
    items,
    page,
    pageCount,
    pageSize,
    total: filtered.length,
    reason,
    breakdown: breakdown(mine).sort((a, b) => b.points - a.points),
    totals,
    level: getLevelInfo(totals.all),
    entryCount: mine.length,
    firstEarnedAt: mine.length ? mine[mine.length - 1]!.createdAt : null,
  };
}

/* ------------------------------------------------------------------ */
/* Admin overview                                                       */
/* ------------------------------------------------------------------ */

export interface LedgerStats {
  entries: number;
  members: number;
  totalPoints: number;
  pointsThisMonth: number;
  manualAdjustments: number;
  lastEntryAt: string | null;
  byReason: ReasonTotal[];
}

export async function getLedgerStats(): Promise<LedgerStats> {
  const db = await getDb();
  const month = startOfMonth().getTime();
  let totalPoints = 0;
  let pointsThisMonth = 0;
  let manual = 0;
  let last: string | null = null;
  const members = new Set<string>();
  for (const p of db.points) {
    totalPoints += p.points;
    if (time(p.createdAt) >= month) pointsThisMonth += p.points;
    if (p.reason === "manual") manual++;
    members.add(p.userId);
    if (!last || p.createdAt > last) last = p.createdAt;
  }
  return {
    entries: db.points.length,
    members: members.size,
    totalPoints,
    pointsThisMonth,
    manualAdjustments: manual,
    lastEntryAt: last,
    byReason: breakdown(db.points),
  };
}

export interface ManualAdjustmentRow {
  id: string;
  points: number;
  note: string;
  createdAt: string;
  member: LeaderboardMember | null;
}

export async function getRecentManualAdjustments(limit = 15): Promise<ManualAdjustmentRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  return db.points
    .filter((p) => p.reason === "manual")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit))
    .map((p) => {
      const u = users.get(p.userId);
      return { id: p.id, points: p.points, note: p.note ?? "", createdAt: p.createdAt, member: u ? toMember(u) : null };
    });
}

/** Remove one manual adjustment (admin undo). Returns the removed entry. */
export async function removeManualAdjustment(entryId: string): Promise<PointsEntry | null> {
  return mutate((d) => {
    const index = d.points.findIndex((p) => p.id === entryId && p.reason === "manual");
    if (index === -1) return null;
    const [removed] = d.points.splice(index, 1);
    return removed ?? null;
  });
}

/** Points each member earned from discussions since a moment (used by the community hub). */
export async function getDiscussionPointsSince(since: Date): Promise<Map<string, number>> {
  const db = await getDb();
  const from = since.getTime();
  const out = new Map<string, number>();
  for (const p of db.points) {
    if (p.reason !== "discussion_reply" || time(p.createdAt) < from) continue;
    out.set(p.userId, (out.get(p.userId) ?? 0) + p.points);
  }
  return out;
}
