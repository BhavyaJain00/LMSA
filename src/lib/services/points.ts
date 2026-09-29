import "server-only";
import type {
  ActivityType,
  Assignment,
  Batch,
  Certificate,
  Course,
  Database,
  DiscussionReply,
  DiscussionTopic,
  Lesson,
  PointsEntry,
  PointsReason,
  ProgrammingExercise,
  Quiz,
  Settings,
  User,
} from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { isCreator, isModerator, isStaff } from "@/lib/auth/session";
import { canManageCourse, canViewCourse, lessonHref } from "@/lib/data/courses";
import { canManageBatch } from "@/lib/data/batches";
import { addDays, toDateKey, uid } from "@/lib/utils";
import { notify } from "./notifications";
import {
  adoptSource,
  entryTime,
  indexAdd,
  indexRemove,
  invalidateIndex,
  localDay,
  pointsKey,
  syncIndex,
  windowTotals,
  type LedgerIndex,
  type TimeWindow,
} from "./points-index";
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
 * learning history at any time (admin "Recalculate"), and is filled from
 * history once, automatically (`settings.gamification.ledgerBuiltAt` records
 * that the one-time backfill succeeded).
 *
 * Nobody earns points from content they control: course managers get
 * nothing for lessons, completions, certificates, reviews or replies in
 * their courses, quiz managers nothing for their quizzes, staff (who can
 * edit and grade every assignment and exercise) nothing for assignments and
 * exercises, and nothing is paid for courses that are not published or for
 * results a member graded or issued to themselves.
 *
 * Canonical refIds (hooks and the backfill must agree):
 *   lesson_complete → lessonId        course_complete → courseId
 *   quiz_pass / quiz_perfect → quizId assignment_submit / assignment_pass → assignmentId
 *   exercise_pass → exerciseId        certificate → "course:<courseId>" or "batch:<batchId>"
 *   review → courseId                 discussion_reply → replyId
 *   streak_day → YYYY-MM-DD           manual → none (or an explicit refId)
 *
 * Course attribution of quiz, assignment and exercise points is derived on
 * the server from where the content really lives (the verified lesson that
 * embeds it, the content's own course, other embedding lessons), limited to
 * courses the member is enrolled in — never from a course id sent by the
 * client.
 *
 * Reads go through the in-memory ledger index (`points-index.ts`), so
 * awards and heartbeats are O(1) and leaderboards add up day buckets.
 */

const MAX_ABS_POINTS = 100000;
/** How long computed standings are reused for identical requests. */
const STANDINGS_TTL_MS = 15_000;
/** Pause before retrying a failed automatic backfill. */
const BACKFILL_RETRY_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Staff are hidden from leaderboards when `excludeStaff` is on: admins,
 * moderators, course creators (instructors) and batch evaluators.
 */
export function isLeaderboardStaff(user: Pick<User, "roles">): boolean {
  return isStaff(user);
}

function clampPoints(value: number): number {
  return Math.max(-MAX_ABS_POINTS, Math.min(MAX_ABS_POINTS, value));
}

function resolveValue(reason: PointsReason, override: number | undefined, settings: Settings["gamification"]): number {
  const raw = override ?? (reason === "manual" ? 0 : settings.points[reason]);
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? clampPoints(n) : 0;
}

/** Midday of a YYYY-MM-DD key in ms (avoids day shifts across time zones). */
function dayKeyToMs(day: string): number {
  const t = new Date(`${day}T12:00:00`).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

/** Activity types that make a day count as a learning day ("streak_day"). */
export function isLearningActivity(type: ActivityType): boolean {
  return type !== "login" && type !== "enroll";
}

/** ISO timestamps sort correctly as plain strings (much faster than localeCompare). */
function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function ledgerIndex(db: Database): LedgerIndex {
  return syncIndex(db.points);
}

/**
 * Id lookups that stay O(1) on repeated calls: positions are cached per
 * array and verified on every hit, so replaced, appended, removed or
 * reordered rows are always found correctly (a miss rebuilds the map).
 */
const positions = new WeakMap<object, Map<string, number>>();
function lookup<T extends { id: string }>(rows: T[], id: string | undefined | null): T | undefined {
  if (!id) return undefined;
  const cached = positions.get(rows);
  const at = cached?.get(id);
  if (at !== undefined && rows[at]?.id === id) return rows[at];
  const map = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) map.set(rows[i]!.id, i);
  positions.set(rows, map);
  const i = map.get(id);
  return i === undefined ? undefined : rows[i];
}

/* ------------------------------------------------------------------ */
/* Certificates                                                         */
/* ------------------------------------------------------------------ */

/** Certificate points are keyed by what is certified, so re-issuing never pays twice. */
export function certificatePointsRef(cert: Pick<Certificate, "id" | "courseId" | "batchId">): string {
  if (cert.courseId) return `course:${cert.courseId}`;
  if (cert.batchId) return `batch:${cert.batchId}`;
  return cert.id;
}

function parseCertificateRef(ref: string): { kind: "course" | "batch"; id: string } | { kind: "legacy"; id: string } {
  if (ref.startsWith("course:")) return { kind: "course", id: ref.slice(7) };
  if (ref.startsWith("batch:")) return { kind: "batch", id: ref.slice(6) };
  return { kind: "legacy", id: ref };
}

function sameCertificateSubject(a: Pick<Certificate, "courseId" | "batchId">, b: Pick<Certificate, "courseId" | "batchId">): boolean {
  if (a.courseId || b.courseId) return a.courseId === b.courseId;
  return !!a.batchId && a.batchId === b.batchId;
}

/* ------------------------------------------------------------------ */
/* Who may earn what (shared by live awards and the backfill)           */
/* ------------------------------------------------------------------ */

type ContentKind = "quiz" | "assignment" | "exercise";

interface Catalog {
  user(id?: string): User | undefined;
  lesson(id?: string): Lesson | undefined;
  course(id?: string): Course | undefined;
  batch(id?: string): Batch | undefined;
  quiz(id?: string): Quiz | undefined;
  assignment(id?: string): Assignment | undefined;
  exercise(id?: string): ProgrammingExercise | undefined;
  certificate(id?: string): Certificate | undefined;
  topic(id?: string): DiscussionTopic | undefined;
  reply(id?: string): DiscussionReply | undefined;
  enrolled(userId: string, courseId: string): boolean;
  /** Courses of the lessons that embed the content. */
  placements(kind: ContentKind, id: string): string[];
}

function lessonEmbeds(lesson: Lesson, kind: ContentKind, id: string): boolean {
  return lesson.blocks.some((b) =>
    kind === "quiz"
      ? (b.type === "quiz" && b.quizId === id) || (b.type === "video" && !!b.quizMarkers?.some((m) => m.quizId === id))
      : kind === "assignment"
        ? b.type === "assignment" && b.assignmentId === id
        : b.type === "exercise" && b.exerciseId === id,
  );
}

/** Lookups for single awards: O(1) id lookups, placements scanned on demand. */
function liveCatalog(db: Database): Catalog {
  const placementMemo = new Map<string, string[]>();
  return {
    user: (id) => lookup(db.users, id),
    lesson: (id) => lookup(db.lessons, id),
    course: (id) => lookup(db.courses, id),
    batch: (id) => lookup(db.batches, id),
    quiz: (id) => lookup(db.quizzes, id),
    assignment: (id) => lookup(db.assignments, id),
    exercise: (id) => lookup(db.exercises, id),
    certificate: (id) => lookup(db.certificates, id),
    topic: (id) => lookup(db.discussionTopics, id),
    reply: (id) => lookup(db.discussionReplies, id),
    enrolled: (userId, courseId) => db.enrollments.some((e) => e.userId === userId && e.courseId === courseId),
    placements: (kind, id) => {
      const key = `${kind}:${id}`;
      let out = placementMemo.get(key);
      if (!out) {
        const set = new Set<string>();
        for (const lesson of db.lessons) if (lessonEmbeds(lesson, kind, id)) set.add(lesson.courseId);
        out = Array.from(set);
        placementMemo.set(key, out);
      }
      return out;
    },
  };
}

/** Lookups for whole-history work: every map is built once. */
function bulkCatalog(db: Database): Catalog {
  const byId = <T extends { id: string }>(rows: () => T[]) => {
    let map: Map<string, T> | null = null;
    return (id?: string) => {
      if (!id) return undefined;
      map ??= new Map(rows().map((r) => [r.id, r]));
      return map.get(id);
    };
  };
  let enrollments: Set<string> | null = null;
  let placements: Map<string, string[]> | null = null;
  return {
    user: byId(() => db.users),
    lesson: byId(() => db.lessons),
    course: byId(() => db.courses),
    batch: byId(() => db.batches),
    quiz: byId(() => db.quizzes),
    assignment: byId(() => db.assignments),
    exercise: byId(() => db.exercises),
    certificate: byId(() => db.certificates),
    topic: byId(() => db.discussionTopics),
    reply: byId(() => db.discussionReplies),
    enrolled: (userId, courseId) => {
      enrollments ??= new Set(db.enrollments.map((e) => `${e.userId}|${e.courseId}`));
      return enrollments.has(`${userId}|${courseId}`);
    },
    placements: (kind, id) => {
      if (!placements) {
        const map = new Map<string, Set<string>>();
        const add = (key: string, courseId: string) => {
          const set = map.get(key) ?? new Set<string>();
          set.add(courseId);
          map.set(key, set);
        };
        for (const lesson of db.lessons) {
          for (const b of lesson.blocks) {
            if (b.type === "quiz") add(`quiz:${b.quizId}`, lesson.courseId);
            else if (b.type === "assignment") add(`assignment:${b.assignmentId}`, lesson.courseId);
            else if (b.type === "exercise") add(`exercise:${b.exerciseId}`, lesson.courseId);
            else if (b.type === "video") for (const m of b.quizMarkers ?? []) add(`quiz:${m.quizId}`, lesson.courseId);
          }
        }
        placements = new Map(Array.from(map, ([k, v]) => [k, Array.from(v)]));
      }
      return placements.get(`${kind}:${id}`) ?? [];
    },
  };
}

interface AwardContext {
  refId?: string;
  courseId?: string;
  lessonId?: string;
  grantedBy?: string;
  activity?: { type: ActivityType; refId?: string };
}

type Verdict = { ok: true; courseId?: string } | { ok: false };

const DENY: Verdict = { ok: false };

/** Points for a course: none in unpublished courses or courses the member manages. */
function courseVerdict(cat: Catalog, user: User, courseId: string | undefined): Verdict {
  const course = cat.course(courseId);
  if (!course) return { ok: true, courseId: courseId || undefined };
  if (!course.published || canManageCourse(user, course)) return DENY;
  return { ok: true, courseId: course.id };
}

function quizCourses(cat: Catalog, quiz: Quiz): string[] {
  const ids = new Set<string>();
  if (quiz.courseId) ids.add(quiz.courseId);
  const own = cat.lesson(quiz.lessonId);
  if (own) ids.add(own.courseId);
  for (const id of cat.placements("quiz", quiz.id)) ids.add(id);
  return Array.from(ids);
}

/** The member manages the quiz (moderator, author, instructor of its course) or teaches a course that embeds it. */
function managesQuiz(cat: Catalog, user: User, quiz: Quiz): boolean {
  if (quiz.authorId === user.id || isModerator(user)) return true;
  if (!isCreator(user)) return false;
  return quizCourses(cat, quiz).some((id) => {
    const course = cat.course(id);
    return !!course && canManageCourse(user, course);
  });
}

/**
 * The course quiz/assignment/exercise points count toward: the verified
 * lesson's course, then a (validated) course hint, then the content's own
 * course and the courses of other lessons that embed it — the first one the
 * member is enrolled in. Undefined when the member is in none of them.
 */
function contentCourse(cat: Catalog, userId: string, kind: ContentKind, content: { id: string; courseId?: string; lessonId?: string }, ctx: AwardContext): string | undefined {
  const usable = (courseId: string | undefined) => (courseId && cat.course(courseId) && cat.enrolled(userId, courseId) ? courseId : undefined);
  const hinted = cat.lesson(ctx.lessonId);
  if (hinted && (lessonEmbeds(hinted, kind, content.id) || content.lessonId === hinted.id)) {
    const found = usable(hinted.courseId);
    if (found) return found;
  }
  const candidates = new Set<string>();
  if (content.courseId) candidates.add(content.courseId);
  const own = cat.lesson(content.lessonId);
  if (own) candidates.add(own.courseId);
  for (const id of cat.placements(kind, content.id)) candidates.add(id);
  if (ctx.courseId && candidates.has(ctx.courseId)) {
    const found = usable(ctx.courseId);
    if (found) return found;
  }
  for (const id of candidates) {
    const found = usable(id);
    if (found) return found;
  }
  return undefined;
}

/** Content points attributed to an unpublished course are not paid. */
function withCourse(cat: Catalog, courseId: string | undefined): Verdict {
  if (!courseId) return { ok: true };
  const course = cat.course(courseId);
  return course && !course.published ? DENY : { ok: true, courseId };
}

/**
 * Whether a member may earn `reason` for `ctx.refId`, and which course the
 * points count toward. Unknown content is allowed (nothing to check).
 */
function assessAward(cat: Catalog, user: User, reason: PointsReason, ctx: AwardContext): Verdict {
  const ref = ctx.refId ?? "";
  switch (reason) {
    case "manual":
      return { ok: true, courseId: ctx.courseId };
    case "lesson_complete": {
      const lesson = cat.lesson(ref);
      return lesson ? courseVerdict(cat, user, lesson.courseId) : { ok: true, courseId: ctx.courseId };
    }
    case "course_complete":
    case "review":
      return courseVerdict(cat, user, ref || ctx.courseId);
    case "certificate": {
      if (ctx.grantedBy && ctx.grantedBy === user.id) return DENY;
      const subject = parseCertificateRef(ref);
      let courseId: string | undefined;
      let batchId: string | undefined;
      if (subject.kind === "course") courseId = subject.id;
      else if (subject.kind === "batch") batchId = subject.id;
      else {
        const cert = cat.certificate(subject.id);
        courseId = cert?.courseId;
        batchId = cert?.batchId;
      }
      if (courseId) return courseVerdict(cat, user, courseId);
      const batch = cat.batch(batchId);
      if (batch && canManageBatch(user, batch)) return DENY;
      return { ok: true };
    }
    case "quiz_pass":
    case "quiz_perfect": {
      const quiz = cat.quiz(ref);
      if (!quiz) return { ok: true };
      if (managesQuiz(cat, user, quiz)) return DENY;
      return withCourse(cat, contentCourse(cat, user.id, "quiz", quiz, ctx));
    }
    case "assignment_submit":
    case "assignment_pass": {
      // Staff can edit and grade every assignment.
      if (isStaff(user)) return DENY;
      if (reason === "assignment_pass" && ctx.grantedBy === user.id) return DENY;
      const assignment = cat.assignment(ref);
      if (!assignment) return { ok: true };
      if (assignment.authorId === user.id) return DENY;
      return withCourse(cat, contentCourse(cat, user.id, "assignment", assignment, ctx));
    }
    case "exercise_pass": {
      // Staff can edit every exercise (including its test cases).
      if (isStaff(user)) return DENY;
      const exercise = cat.exercise(ref);
      if (!exercise) return { ok: true };
      if (exercise.authorId === user.id) return DENY;
      return withCourse(cat, contentCourse(cat, user.id, "exercise", exercise, ctx));
    }
    case "discussion_reply": {
      const reply = cat.reply(ref);
      const topic = cat.topic(reply?.topicId);
      if (!topic) return { ok: true, courseId: ctx.courseId };
      if (topic.refType === "batch") {
        const batch = cat.batch(topic.refId);
        return batch && canManageBatch(user, batch) ? DENY : { ok: true };
      }
      const lesson = topic.refType === "lesson" ? cat.lesson(topic.refId) : undefined;
      const verdict = courseVerdict(cat, user, lesson?.courseId ?? topic.courseId);
      return verdict.ok ? { ok: true, courseId: topic.courseId ?? verdict.courseId } : DENY;
    }
    case "streak_day": {
      const activity = ctx.activity;
      if (!activity?.refId) return { ok: true };
      switch (activity.type) {
        case "lesson_view":
        case "lesson_complete": {
          const lesson = cat.lesson(activity.refId);
          return lesson && !courseVerdict(cat, user, lesson.courseId).ok ? DENY : { ok: true };
        }
        case "quiz_submit": {
          const quiz = cat.quiz(activity.refId);
          return quiz && managesQuiz(cat, user, quiz) ? DENY : { ok: true };
        }
        case "assignment_submit":
        case "exercise_submit":
          return isStaff(user) ? DENY : { ok: true };
        default:
          return { ok: true };
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Awarding                                                             */
/* ------------------------------------------------------------------ */

export interface AwardPointsOptions {
  /** What the points are for (see the canonical refIds above). */
  refId?: string;
  /**
   * Course hint. For quiz, assignment and exercise points it is only used
   * when the content really belongs to that course and the member is
   * enrolled in it.
   */
  courseId?: string;
  /** Lesson the activity happened in (verified to embed the content before it is used). */
  lessonId?: string;
  /** Override the configured value (required for "manual"). */
  points?: number;
  note?: string;
  /** Who graded or issued the result: nothing is awarded when that is the member themselves. */
  grantedBy?: string;
  /** For "streak_day": the learning activity that made the day count. */
  activity?: { type: ActivityType; refId?: string };
}

/** Re-checked inside the write lock (e.g. the stored grade still is "pass"). */
type AwardGuard = (db: Database) => boolean;

async function award(userId: string, reason: PointsReason, opts: AwardPointsOptions, guard?: AwardGuard): Promise<PointsEntry | null> {
  try {
    if (!userId || !isPointsReason(reason)) return null;
    const db = await getDb();
    if (!db.settings.gamification.enabled) return null;
    const value = resolveValue(reason, opts.points, db.settings.gamification);
    if (value === 0) return null;

    const refId = reason === "streak_day" ? opts.refId || toDateKey() : opts.refId || undefined;
    const key = reason !== "manual" || refId ? pointsKey(userId, reason, refId) : null;
    // O(1) idempotency check outside the write lock: heartbeats call this on every tick.
    if (key && ledgerIndex(db).keys.has(key)) return null;

    // The first award fills the ledger from history once (a keyed merge, safe next to live awards).
    await ensurePointsLedger();

    const member = lookup(db.users, userId);
    if (!member) return null;
    const verdict = assessAward(liveCatalog(db), member, reason, { ...opts, refId });
    if (!verdict.ok) return null;

    const result = await mutate((d) => {
      if (!d.settings.gamification.enabled) return null;
      if (!lookup(d.users, userId)) return null;
      if (guard && !guard(d)) return null;
      const idx = ledgerIndex(d);
      if (key && idx.keys.has(key)) return null;
      const now = Date.now();
      if (reason === "discussion_reply" && (idx.replyDays.get(`${userId}|${localDay(now)}`) ?? 0) >= DISCUSSION_REPLY_DAILY_CAP) return null;
      const before = idx.all.totals.get(userId)?.points ?? 0;
      const entry: PointsEntry = {
        id: uid("pts"),
        userId,
        points: value,
        reason,
        refId,
        courseId: verdict.courseId || undefined,
        note: opts.note?.trim().slice(0, 200) || undefined,
        createdAt: new Date(now).toISOString(),
      };
      d.points.push(entry);
      indexAdd(idx, entry);
      adoptSource(idx, d.points);
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

/**
 * Award points to a member. Uses `settings.gamification.points[reason]`
 * unless `points` is given. Idempotent per (user, reason, refId) — per day
 * for "streak_day" — and capped per day for discussion replies. A no-op
 * when gamification is off, the value is 0 or the member controls the
 * content (see the module comment). Never throws: failures are logged and
 * `null` is returned, so it is safe to call from any flow.
 */
export async function awardPoints(userId: string, reason: PointsReason, opts: AwardPointsOptions = {}): Promise<PointsEntry | null> {
  return award(userId, reason, opts);
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

async function revoke(reason: PointsReason, refIds: string | string[], userId?: string, guard?: AwardGuard): Promise<number> {
  try {
    const ids = new Set((Array.isArray(refIds) ? refIds : [refIds]).filter((id): id is string => typeof id === "string" && id.length > 0));
    if (!ids.size || !isPointsReason(reason)) return 0;
    const matches = (p: PointsEntry) => p.reason === reason && !!p.refId && ids.has(p.refId) && (!userId || p.userId === userId);
    const db = await getDb();
    const idx = ledgerIndex(db);
    // Cheap pre-check through the index.
    let any = false;
    for (const id of ids) {
      if (userId ? idx.keys.has(pointsKey(userId, reason, id)) : reason === "discussion_reply" ? idx.replies.has(id) : true) {
        any = true;
        break;
      }
    }
    if (!any) return 0;
    return await mutate((d) => {
      if (guard && !guard(d)) return 0;
      const current = ledgerIndex(d);
      const removed: PointsEntry[] = [];
      d.points = d.points.filter((p) => {
        if (!matches(p)) return true;
        removed.push(p);
        return false;
      });
      if (!removed.length) return 0;
      for (const e of removed) indexRemove(current, e);
      adoptSource(current, d.points);
      return removed.length;
    });
  } catch (err) {
    console.error(`[points] could not revoke "${reason}":`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Remove the entries of a reason for the given refIds (e.g. a deleted reply
 * or a regraded assignment). Optionally limited to one member. Never throws.
 * Returns how many entries were removed.
 */
export async function revokePoints(reason: PointsReason, refIds: string | string[], userId?: string): Promise<number> {
  return revoke(reason, refIds, userId);
}

/** Award when `earned`, otherwise take the award back (for results that can change, like a regrade). */
export async function setPointsAward(userId: string, reason: PointsReason, earned: boolean, opts: AwardPointsOptions & { refId: string }): Promise<void> {
  if (earned) await awardPoints(userId, reason, opts);
  else await revokePoints(reason, opts.refId, userId);
}

/**
 * Make the "assignment passed" points follow the grade that is stored now.
 * The stored status is re-read inside the write lock, so concurrent
 * regrades always end with points matching the saved grade. Never throws.
 */
export async function syncAssignmentPassPoints(submissionId: string, gradedBy?: string): Promise<void> {
  try {
    const db = await getDb();
    const s = lookup(db.assignmentSubmissions, submissionId);
    if (!s) return;
    const passing = (d: Database) => lookup(d.assignmentSubmissions, submissionId)?.status === "pass";
    if (s.status === "pass") {
      await award(s.userId, "assignment_pass", { refId: s.assignmentId, lessonId: s.lessonId, grantedBy: gradedBy ?? s.evaluatorId }, passing);
    } else {
      await revoke("assignment_pass", s.assignmentId, s.userId, (d) => !passing(d));
    }
  } catch (err) {
    console.error("[points] could not update assignment points:", err instanceof Error ? err.message : err);
  }
}

/** Pass / perfect-score points for a stored quiz submission (after submitting or grading). Never throws. */
export async function awardQuizPoints(submissionId: string): Promise<void> {
  try {
    const db = await getDb();
    const submission = lookup(db.quizSubmissions, submissionId);
    if (!submission || submission.pendingGrading || !submission.passed) return;
    const opts: AwardPointsOptions = { refId: submission.quizId, lessonId: submission.lessonId, courseId: submission.courseId };
    await awardPoints(submission.userId, "quiz_pass", opts);
    if (submission.scoreOutOf > 0 && submission.percentage >= 100) await awardPoints(submission.userId, "quiz_perfect", opts);
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
    const reply = lookup(db.discussionReplies, replyId);
    const topic = reply ? lookup(db.discussionTopics, reply.topicId) : undefined;
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

/**
 * "Learning day" points for an activity (called by `logActivity`). Days
 * spent only on content the member controls do not count. Never throws.
 */
export async function awardLearningDayPoints(userId: string, type: ActivityType, refId?: string, date: string = toDateKey()): Promise<void> {
  if (!isLearningActivity(type)) return;
  await awardPoints(userId, "streak_day", { refId: date, activity: { type, refId } });
}

/** Certificate points for a newly issued certificate (once per course or batch). Never throws. */
export async function awardCertificatePoints(cert: Certificate, opts: { grantedBy?: string } = {}): Promise<void> {
  await awardPoints(cert.userId, "certificate", {
    refId: certificatePointsRef(cert),
    courseId: cert.courseId,
    grantedBy: opts.grantedBy ?? cert.evaluatorId,
  });
}

/**
 * Take certificate points back after a certificate was revoked (unless the
 * member still holds another certificate for the same course or batch).
 * Never throws.
 */
export async function revokeCertificatePoints(cert: Certificate): Promise<void> {
  try {
    const db = await getDb();
    if (db.certificates.some((c) => c.userId === cert.userId && c.id !== cert.id && sameCertificateSubject(c, cert))) return;
    await revokePoints("certificate", [certificatePointsRef(cert), cert.id], cert.userId);
  } catch (err) {
    console.error("[points] could not revoke certificate points:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Backfill / recalculation                                             */
/* ------------------------------------------------------------------ */

interface BackfillState {
  running: Promise<void> | null;
  error: string | null;
  failedAt: number;
  retryAt: number;
  /** Ledger array the failure happened on (a replaced ledger retries at once). */
  failedSource: PointsEntry[] | null;
}

const backfillGlobal = globalThis as unknown as { __llPointsBackfill?: BackfillState };
const backfill: BackfillState = (backfillGlobal.__llPointsBackfill ??= { running: null, error: null, failedAt: 0, retryAt: 0, failedSource: null });
// Older shapes of this state (hot reload) lack the new fields.
backfill.error ??= null;
backfill.failedAt ??= 0;
backfill.retryAt ??= 0;
backfill.failedSource ??= null;

export interface BuildLedgerOptions {
  /**
   * The ledger being replaced: its "exercise_pass" entries are kept (the
   * submission row only stores the latest attempt, so a later failing
   * attempt must not take away an exercise that was solved).
   */
  previous?: PointsEntry[];
}

/**
 * Rebuild point entries (everything except manual adjustments) from the
 * learning history with the current point values and the same rules as
 * live awards. Pure: reads `db` only. Entries are never dated in the future.
 */
export function buildLedgerFromHistory(db: Database, options: BuildLedgerOptions = {}): PointsEntry[] {
  const values = db.settings.gamification.points;
  const cat = bulkCatalog(db);
  const out: PointsEntry[] = [];
  const seen = new Set<string>();
  const nowMs = Date.now();
  // One random id per run plus a counter: generating 16 random bytes per entry is slow on large histories.
  const idBase = uid("pts");
  let idCounter = 0;

  const push = (userId: string, reason: PointsReason, ctx: AwardContext, at: number) => {
    const points = resolveValue(reason, undefined, db.settings.gamification);
    if (!points) return;
    const key = pointsKey(userId, reason, ctx.refId);
    if (seen.has(key)) return;
    const user = cat.user(userId);
    if (!user) return;
    const verdict = assessAward(cat, user, reason, ctx);
    if (!verdict.ok) return;
    seen.add(key);
    const ms = Math.min(Number.isFinite(at) && at > 0 ? at : nowMs, nowMs);
    out.push({ id: `${idBase}${(idCounter++).toString(36)}`, userId, points, reason, refId: ctx.refId, courseId: verdict.courseId || undefined, createdAt: new Date(ms).toISOString() });
  };
  const byTime = <T>(rows: T[], at: (row: T) => string | undefined) =>
    rows
      .map((row) => ({ row, t: entryTime(at(row)) }))
      .sort((a, b) => a.t - b.t);

  // Lessons completed (only lessons that still exist).
  if (values.lesson_complete) {
    for (const { row: p, t } of byTime(db.progress, (r) => r.completedAt ?? r.updatedAt)) {
      if (p.status !== "complete" || !cat.lesson(p.lessonId)) continue;
      push(p.userId, "lesson_complete", { refId: p.lessonId }, t);
    }
  }

  // Courses completed.
  if (values.course_complete) {
    for (const { row: e, t } of byTime(db.enrollments, (r) => r.completedAt)) {
      if (e.completedAt) push(e.userId, "course_complete", { refId: e.courseId }, t);
    }
  }

  // Quizzes: the first passing attempt, and the first perfect one.
  if (values.quiz_pass || values.quiz_perfect) {
    for (const { row: s, t } of byTime(db.quizSubmissions, (r) => r.submittedAt)) {
      if (s.pendingGrading || !s.passed) continue;
      const ctx: AwardContext = { refId: s.quizId, lessonId: s.lessonId, courseId: s.courseId };
      push(s.userId, "quiz_pass", ctx, t);
      if (s.scoreOutOf > 0 && s.percentage >= 100) push(s.userId, "quiz_perfect", ctx, t);
    }
  }

  // Assignments: submitted, and graded as pass (never when the member graded themselves).
  if (values.assignment_submit || values.assignment_pass) {
    for (const { row: s, t } of byTime(db.assignmentSubmissions, (r) => r.submittedAt)) {
      push(s.userId, "assignment_submit", { refId: s.assignmentId, lessonId: s.lessonId }, t);
      if (s.status === "pass") {
        push(s.userId, "assignment_pass", { refId: s.assignmentId, lessonId: s.lessonId, grantedBy: s.evaluatorId }, entryTime(s.gradedAt ?? s.updatedAt));
      }
    }
  }

  // Programming exercises solved: earlier passes recorded in the ledger count even if a later attempt failed.
  if (values.exercise_pass) {
    const submissions = new Map(db.exerciseSubmissions.map((s) => [`${s.userId}|${s.exerciseId}`, s]));
    const kept = (options.previous ?? []).filter((p) => p.reason === "exercise_pass" && p.refId && submissions.has(`${p.userId}|${p.refId}`));
    for (const { row: p, t } of byTime(kept, (r) => r.createdAt)) {
      const s = submissions.get(`${p.userId}|${p.refId}`)!;
      push(p.userId, "exercise_pass", { refId: p.refId, lessonId: s.lessonId }, t);
    }
    for (const { row: s, t } of byTime(db.exerciseSubmissions, (r) => r.submittedAt)) {
      if (s.status !== "passed") continue;
      push(s.userId, "exercise_pass", { refId: s.exerciseId, lessonId: s.lessonId }, t);
    }
  }

  // Certificates: once per certified course or batch (published or not, like the live award).
  if (values.certificate) {
    for (const { row: c, t } of byTime(db.certificates, (r) => r.issueDate)) {
      push(c.userId, "certificate", { refId: certificatePointsRef(c), grantedBy: c.evaluatorId }, Number.isFinite(t) && t > 0 ? dayKeyToMs(c.issueDate) : nowMs);
    }
  }

  // Course reviews.
  if (values.review) {
    for (const r of db.reviews) push(r.userId, "review", { refId: r.courseId }, entryTime(r.createdAt));
  }

  // Helpful replies: not the opening post, not on your own topic, at most N a day.
  if (values.discussion_reply) {
    const byTopic = new Map<string, DiscussionReply[]>();
    for (const r of db.discussionReplies) {
      const list = byTopic.get(r.topicId) ?? [];
      list.push(r);
      byTopic.set(r.topicId, list);
    }
    const candidates: { userId: string; replyId: string; t: number; courseId?: string }[] = [];
    for (const [topicId, replies] of byTopic) {
      const topic = cat.topic(topicId);
      if (!topic) continue;
      const sorted = [...replies].sort(byCreatedAt);
      for (const r of sorted.slice(1)) {
        if (r.authorId === topic.authorId) continue;
        candidates.push({ userId: r.authorId, replyId: r.id, t: entryTime(r.createdAt), courseId: topic.courseId });
      }
    }
    const perDay = new Map<string, number>();
    for (const c of candidates.sort((a, b) => a.t - b.t)) {
      const key = `${c.userId}|${localDay(c.t)}`;
      const used = perDay.get(key) ?? 0;
      if (used >= DISCUSSION_REPLY_DAILY_CAP) continue;
      const before = out.length;
      push(c.userId, "discussion_reply", { refId: c.replyId, courseId: c.courseId }, c.t);
      if (out.length > before) perDay.set(key, used + 1);
    }
  }

  // Learning days: lessons, quizzes, assignments or exercises (logins, enrollments and content you control do not count).
  if (values.streak_day) {
    const firstOfDay = new Map<string, { userId: string; date: string; t: number }>();
    for (const a of db.activities) {
      if (!isLearningActivity(a.type) || !a.date) continue;
      const user = cat.user(a.userId);
      if (!user || !assessAward(cat, user, "streak_day", { refId: a.date, activity: { type: a.type, refId: a.refId } }).ok) continue;
      const key = `${a.userId}|${a.date}`;
      const t = entryTime(a.createdAt) || dayKeyToMs(a.date);
      const existing = firstOfDay.get(key);
      if (!existing || t < existing.t) firstOfDay.set(key, { userId: a.userId, date: a.date, t });
    }
    for (const day of firstOfDay.values()) push(day.userId, "streak_day", { refId: day.date }, day.t);
  }

  return out.sort(byCreatedAt);
}

interface MergePlan {
  drop: Set<PointsEntry>;
  rewrite: { entry: PointsEntry; refId?: string; courseId?: string; createdAt?: string }[];
  add: PointsEntry[];
}

/**
 * The one-time fill of an existing ledger from history. A keyed merge: every
 * history entry whose (member, reason, refId) is missing is added, so live
 * awards that landed first are never doubled. Legacy certificate entries
 * (keyed by certificate id) move to the course/batch key — duplicates and
 * entries of revoked certificates are dropped — and entries dated in the
 * future are brought back to now. Pure: reads `db` only.
 */
function planHistoryMerge(db: Database): MergePlan {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const certs = new Map(db.certificates.map((c) => [c.id, c]));
  const keys = new Set<string>();
  const replyDays = new Map<string, number>();
  const plan: MergePlan = { drop: new Set(), rewrite: [], add: [] };

  for (const p of db.points) {
    let refId = p.refId;
    let courseId = p.courseId;
    let changed = false;
    if (p.reason === "certificate" && refId && !refId.startsWith("course:") && !refId.startsWith("batch:")) {
      const cert = certs.get(refId);
      if (!cert) {
        plan.drop.add(p);
        continue;
      }
      refId = certificatePointsRef(cert);
      courseId = cert.courseId;
      changed = true;
    }
    const keyed = p.reason !== "manual" || !!refId;
    const key = pointsKey(p.userId, p.reason, refId);
    if (keyed && keys.has(key) && p.reason === "certificate") {
      plan.drop.add(p);
      continue;
    }
    if (keyed) keys.add(key);
    const future = entryTime(p.createdAt) > nowMs;
    if (changed || future) plan.rewrite.push({ entry: p, refId, courseId, createdAt: future ? nowIso : undefined });
    if (p.reason === "discussion_reply") {
      const dayKey = `${p.userId}|${localDay(Math.min(entryTime(p.createdAt), nowMs))}`;
      replyDays.set(dayKey, (replyDays.get(dayKey) ?? 0) + 1);
    }
  }

  for (const h of buildLedgerFromHistory(db)) {
    const key = pointsKey(h.userId, h.reason, h.refId);
    if (keys.has(key)) continue;
    if (h.reason === "discussion_reply") {
      const dayKey = `${h.userId}|${localDay(entryTime(h.createdAt))}`;
      const used = replyDays.get(dayKey) ?? 0;
      if (used >= DISCUSSION_REPLY_DAILY_CAP) continue;
      replyDays.set(dayKey, used + 1);
    }
    keys.add(key);
    plan.add.push(h);
  }
  return plan;
}

/** Apply a merge plan (cannot throw: plain assignments and pushes). */
function applyMerge(d: Database, plan: MergePlan): void {
  if (plan.drop.size) d.points = d.points.filter((p) => !plan.drop.has(p));
  for (const r of plan.rewrite) {
    r.entry.refId = r.refId;
    r.entry.courseId = r.courseId || undefined;
    if (r.createdAt) r.entry.createdAt = r.createdAt;
  }
  // Append one by one: spreading a large array into push() overflows the call stack.
  for (const e of plan.add) d.points.push(e);
  invalidateIndex();
}

/**
 * Fill the ledger from history once (gamification on and the one-time
 * backfill not done yet — `settings.gamification.ledgerBuiltAt` unset).
 * Concurrent callers share one run. On failure nothing is changed, the
 * marker stays unset, the error is kept for the admin page and the next
 * attempt happens after a short pause (live awards keep working meanwhile:
 * the merge is keyed, so they are never doubled). Never throws.
 */
export async function ensurePointsLedger(): Promise<void> {
  try {
    const db = await getDb();
    const g = db.settings.gamification;
    if (!g.enabled || g.ledgerBuiltAt) return;
    if (backfill.running) return await backfill.running;
    if (backfill.failedSource === db.points && Date.now() < backfill.retryAt) return;
    backfill.running = (async () => {
      try {
        const added = await mutate((d) => {
          const gg = d.settings.gamification;
          if (!gg.enabled || gg.ledgerBuiltAt) return -1;
          const plan = planHistoryMerge(d);
          applyMerge(d, plan);
          gg.ledgerBuiltAt = new Date().toISOString();
          return plan.add.length;
        });
        backfill.error = null;
        backfill.failedSource = null;
        if (added > 0) console.info(`[points] backfilled ${added} ledger entries from history`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        backfill.error = message;
        backfill.failedAt = Date.now();
        backfill.retryAt = Date.now() + BACKFILL_RETRY_MS;
        backfill.failedSource = (await getDb()).points;
        console.error("[points] automatic backfill failed:", message);
      } finally {
        backfill.running = null;
      }
    })();
    await backfill.running;
  } catch (err) {
    console.error("[points] could not check the ledger:", err instanceof Error ? err.message : err);
  }
}

export interface LedgerStatus {
  /** The one-time fill from history has succeeded (or a recalculation ran). */
  built: boolean;
  builtAt: string | null;
  /** Why the last automatic attempt failed (null when it did not). */
  error: string | null;
  failedAt: string | null;
}

/** State of the one-time backfill, for the admin page. */
export async function getLedgerStatus(): Promise<LedgerStatus> {
  const db = await getDb();
  const builtAt = db.settings.gamification.ledgerBuiltAt ?? null;
  return {
    built: !!builtAt,
    builtAt,
    error: builtAt ? null : backfill.error,
    failedAt: !builtAt && backfill.error && backfill.failedAt ? new Date(backfill.failedAt).toISOString() : null,
  };
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

function breakdown(entries: Iterable<PointsEntry>): ReasonTotal[] {
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
 * keeping manual adjustments (and earlier exercise passes). Throws on
 * storage errors (admin action); nothing changes when building fails.
 */
export async function recalculatePointsLedger(): Promise<RecalculateResult> {
  const result = await mutate((d) => {
    const previousEntries = d.points.length;
    const manual = d.points.filter((p) => p.reason === "manual");
    const rebuilt = buildLedgerFromHistory(d, { previous: d.points });
    const next = rebuilt.concat(manual).sort(byCreatedAt);
    d.points = next;
    d.settings.gamification.ledgerBuiltAt = new Date().toISOString();
    invalidateIndex();
    let totalPoints = 0;
    const members = new Set<string>();
    for (const p of next) {
      totalPoints += p.points;
      members.add(p.userId);
    }
    return { entries: next.length, members: members.size, totalPoints, manualKept: manual.length, previousEntries, byReason: breakdown(next) };
  });
  backfill.error = null;
  backfill.failedSource = null;
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
      current: { start: start.getTime(), end, open: true },
      previous: { start: prevStart.getTime(), end: start.getTime(), open: false },
      label: `Since Monday, ${shortDate(start)}`,
      trendLabel: "vs. last week",
    };
  }
  if (period === "month") {
    const start = startOfMonth(now);
    const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    return {
      current: { start: start.getTime(), end, open: true },
      previous: { start: prevStart.getTime(), end: start.getTime(), open: false },
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      trendLabel: "vs. last month",
    };
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return {
    current: { start: null, end, open: true },
    // Standings as they were at the start of the day a week ago.
    previous: { start: null, end: addDays(today, -7).getTime(), open: false },
    label: "All points ever earned",
    trendLabel: "vs. 7 days ago",
  };
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

interface StandingSet {
  list: Standing[];
  byUser: Map<string, Standing>;
}

interface CachedStandings extends StandingSet {
  version: number;
  start: number | null;
  end: number;
  users: User[];
  userCount: number;
  excludeStaff: boolean;
  at: number;
}

const standingsGlobal = globalThis as unknown as { __llPointsStandings?: Map<string, CachedStandings> };
const standingsCache: Map<string, CachedStandings> = (standingsGlobal.__llPointsStandings ??= new Map());

/** The member when they may appear on a leaderboard (enabled; not staff while staff are excluded). */
function rankable(db: Database, userId: string): User | null {
  const user = lookup(db.users, userId);
  if (!user || !user.enabled) return null;
  if (db.settings.gamification.excludeStaff && isLeaderboardStaff(user)) return null;
  return user;
}

/**
 * Rank members by points in a window (competition ranking: 1, 2, 2, 4).
 * Members at 0 or below are not ranked. Results are shared between the
 * leaderboard and the dashboard and reused for a short time while neither
 * the ledger nor the member list changes.
 */
function standingsFor(db: Database, idx: LedgerIndex, courseId: string | null, window: TimeWindow): StandingSet {
  const key = `${courseId ?? ""}|${window.start ?? "all"}|${window.open ? "open" : window.end}`;
  const now = Date.now();
  const excludeStaff = db.settings.gamification.excludeStaff;
  const exact = !(window.open && idx.maxTime >= window.end);
  const cached = standingsCache.get(key);
  if (
    exact &&
    cached &&
    cached.version === idx.version &&
    cached.users === db.users &&
    cached.userCount === db.users.length &&
    cached.excludeStaff === excludeStaff &&
    now - cached.at < STANDINGS_TTL_MS
  ) {
    return cached;
  }

  const totals = windowTotals(idx, courseId, window);
  const names = new Map<string, string>();
  const list: Standing[] = [];
  for (const [userId, a] of totals) {
    if (a.points <= 0) continue;
    const user = rankable(db, userId);
    if (!user) continue;
    names.set(userId, user.name);
    list.push({ userId, points: a.points, lastAt: a.lastAt, rank: 0 });
  }
  list.sort((a, b) => b.points - a.points || a.lastAt - b.lastAt || (names.get(a.userId) ?? "").localeCompare(names.get(b.userId) ?? ""));
  let rank = 0;
  let prevPoints: number | null = null;
  list.forEach((s, i) => {
    if (s.points !== prevPoints) rank = i + 1;
    s.rank = rank;
    prevPoints = s.points;
  });
  const set: StandingSet = { list, byUser: new Map(list.map((s) => [s.userId, s])) };
  if (exact) {
    if (standingsCache.size > 200) {
      for (const [k, v] of standingsCache) if (now - v.at >= STANDINGS_TTL_MS) standingsCache.delete(k);
      if (standingsCache.size > 200) standingsCache.clear();
    }
    standingsCache.set(key, { ...set, version: idx.version, start: window.start, end: window.end, users: db.users, userCount: db.users.length, excludeStaff, at: now });
  }
  return set;
}

/** A member's ledger entries. */
function ownEntries(idx: LedgerIndex, userId: string): Set<PointsEntry> {
  return idx.users.get(userId) ?? new Set();
}

/** All-time points of a member (levels). */
function allTimePoints(idx: LedgerIndex, userId: string, now = Date.now()): number {
  if (idx.maxTime <= now) return idx.all.totals.get(userId)?.points ?? 0;
  let sum = 0;
  for (const e of ownEntries(idx, userId)) if ((idx.times.get(e) ?? 0) <= now) sum += e.points;
  return sum;
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

/** Points a member earned in a window (optionally one course), from their own entries. */
function memberWindowPoints(idx: LedgerIndex, userId: string, courseId: string | null, w: TimeWindow): number {
  let sum = 0;
  for (const e of ownEntries(idx, userId)) {
    if (courseId && e.courseId !== courseId) continue;
    const t = idx.times.get(e) ?? 0;
    if ((w.start === null || t >= w.start) && t < w.end) sum += e.points;
  }
  return sum;
}

export async function getLeaderboard(input: { viewer: User | null; period: LeaderboardPeriod; courseId?: string | null; limit?: number }): Promise<LeaderboardResult> {
  await ensurePointsLedger();
  const db = await getDb();
  const idx = ledgerIndex(db);
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const course = input.courseId ? (lookup(db.courses, input.courseId) ?? null) : null;
  const courseId = course && canViewCourse(input.viewer, course) ? course.id : null;
  const windows = periodWindows(input.period);
  const current = standingsFor(db, idx, courseId, windows.current);
  const previous = standingsFor(db, idx, courseId, windows.previous);
  const viewerId = input.viewer?.id ?? null;

  const toRow = (s: Standing): LeaderboardRow => {
    const user = lookup(db.users, s.userId)!;
    const level = getLevelInfo(allTimePoints(idx, s.userId));
    return {
      rank: s.rank,
      member: toMember(user),
      points: s.points,
      level: level.level,
      tier: level.tier,
      tierTone: level.tierTone,
      trend: trendFor(s.rank, previous.byUser.get(s.userId)?.rank),
      isViewer: s.userId === viewerId,
    };
  };

  const rows = current.list.slice(0, limit).map(toRow);
  let status: ViewerStanding = "guest";
  let viewerRow: LeaderboardRow | null = null;
  let pinned = false;
  let periodPoints = 0;
  if (input.viewer) {
    const viewer = input.viewer;
    periodPoints = memberWindowPoints(idx, viewer.id, courseId, windows.current);
    if (!rankable(db, viewer.id)) status = "excluded";
    else {
      const standing = current.byUser.get(viewer.id);
      if (standing) {
        status = "ranked";
        viewerRow = rows.find((r) => r.isViewer) ?? toRow(standing);
        pinned = !rows.some((r) => r.isViewer);
      } else status = "unranked";
    }
  }

  let totalPoints = 0;
  for (const s of current.list) totalPoints += s.points;
  return {
    period: input.period,
    course: course && courseId ? { id: course.id, title: course.title, slug: course.slug } : null,
    rangeLabel: windows.label,
    trendLabel: windows.trendLabel,
    rows,
    rankedCount: current.list.length,
    totalPoints,
    excludeStaff: db.settings.gamification.excludeStaff,
    viewer: {
      status,
      row: viewerRow,
      pinned,
      periodPoints,
      level: input.viewer ? getLevelInfo(allTimePoints(idx, input.viewer.id)) : null,
    },
  };
}

/** Courses offered in the leaderboard filter: those the viewer can see, with points first. */
export async function getLeaderboardCourses(viewer: User | null): Promise<{ id: string; title: string; hasPoints: boolean }[]> {
  const db = await getDb();
  const idx = ledgerIndex(db);
  return db.courses
    .filter((c: Course) => canViewCourse(viewer, c))
    .map((c) => ({ id: c.id, title: c.title, hasPoints: (idx.courses.get(c.id)?.totals.size ?? 0) > 0 }))
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

/** A member's totals; entries dated after `now` are left out everywhere, like on the boards. */
function totalsFor(idx: LedgerIndex, userId: string, now = new Date()): PointsTotals {
  const week = startOfWeek(now).getTime();
  const month = startOfMonth(now).getTime();
  const end = now.getTime();
  const out: PointsTotals = { all: 0, week: 0, month: 0 };
  for (const e of ownEntries(idx, userId)) {
    const t = idx.times.get(e) ?? 0;
    if (t > end) continue;
    out.all += e.points;
    if (t >= week) out.week += e.points;
    if (t >= month) out.month += e.points;
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
  const totals = totalsFor(ledgerIndex(db), userId);
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
  const idx = ledgerIndex(db);
  const g = db.settings.gamification;
  const now = new Date();
  const totals = totalsFor(idx, user.id, now);
  const excluded = !rankable(db, user.id);
  const weekWindows = periodWindows("week", now);
  const week = standingsFor(db, idx, null, weekWindows.current);
  const prevWeek = standingsFor(db, idx, null, weekWindows.previous);
  const all = standingsFor(db, idx, null, periodWindows("all", now).current);
  const mineWeek = week.byUser.get(user.id) ?? null;
  const mineAll = all.byUser.get(user.id) ?? null;
  let gap: number | null = null;
  if (mineWeek && mineWeek.rank > 1) {
    const above = week.list[mineWeek.rank - 2];
    if (above && above.points > mineWeek.points) gap = above.points - mineWeek.points + 1;
  }
  let last: PointsEntry | null = null;
  let lastAt = -Infinity;
  const end = now.getTime();
  for (const p of ownEntries(idx, user.id)) {
    const t = idx.times.get(p) ?? 0;
    if (t <= end && t > lastAt) {
      last = p;
      lastAt = t;
    }
  }
  return {
    enabled: g.enabled,
    showLeaderboard: g.showLeaderboard,
    excluded,
    totals,
    level: getLevelInfo(totals.all),
    week: { rank: mineWeek?.rank ?? null, ranked: week.list.length, trend: mineWeek ? trendFor(mineWeek.rank, prevWeek.byUser.get(user.id)?.rank) : null },
    allTime: { rank: mineAll?.rank ?? null, ranked: all.list.length },
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
function createEntryDescriber(db: Database, userId: string) {
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const lessons = new Map(db.lessons.map((l) => [l.id, l]));
  const quizzes = new Map(db.quizzes.map((q) => [q.id, q]));
  const assignments = new Map(db.assignments.map((a) => [a.id, a]));
  const exercises = new Map(db.exercises.map((x) => [x.id, x]));
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const topics = new Map(db.discussionTopics.map((t) => [t.id, t]));
  const replies = new Map(db.discussionReplies.map((r) => [r.id, r]));
  const mine = db.certificates.filter((c) => c.userId === userId);
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
        const subject = parseCertificateRef(ref);
        const cert =
          subject.kind === "legacy"
            ? mine.find((c) => c.id === subject.id)
            : mine.find((c) => (subject.kind === "course" ? c.courseId === subject.id : !c.courseId && c.batchId === subject.id));
        const courseId = subject.kind === "course" ? subject.id : cert?.courseId;
        const batchId = subject.kind === "batch" ? subject.id : cert?.batchId;
        const title = courseId ? courseTitle(courseId) : batchId ? (batches.get(batchId)?.title ?? null) : null;
        return { title, context: null, href: cert?.published ? `/certificates/${cert.code}` : null };
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
  const idx = ledgerIndex(db);
  const mine = Array.from(ownEntries(idx, userId)).sort((a, b) => byCreatedAt(b, a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const reason = opts.reason && isPointsReason(opts.reason) ? opts.reason : null;
  const filtered = reason ? mine.filter((p) => p.reason === reason) : mine;
  const pageSize = Math.max(5, Math.min(100, opts.pageSize ?? 25));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(opts.page ?? 1) || 1));
  const describe = createEntryDescriber(db, userId);
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
  const totals = totalsFor(idx, userId);
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
  const idx = ledgerIndex(db);
  const now = new Date();
  let pointsThisMonth = 0;
  for (const a of windowTotals(idx, null, periodWindows("month", now).current).values()) pointsThisMonth += a.points;
  return {
    entries: db.points.length,
    members: idx.users.size,
    totalPoints: idx.totalPoints,
    pointsThisMonth,
    manualAdjustments: idx.manual.size,
    lastEntryAt: idx.maxTime > 0 ? new Date(Math.min(idx.maxTime, now.getTime())).toISOString() : null,
    byReason: POINTS_REASONS.filter((r) => idx.reasons.has(r)).map((r) => ({ reason: r, ...idx.reasons.get(r)! })),
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
  const idx = ledgerIndex(db);
  return Array.from(idx.manual)
    .sort((a, b) => byCreatedAt(b, a))
    .slice(0, Math.max(1, limit))
    .map((p) => {
      const u = lookup(db.users, p.userId);
      return { id: p.id, points: p.points, note: p.note ?? "", createdAt: p.createdAt, member: u ? toMember(u) : null };
    });
}

/** Remove one manual adjustment (admin undo). Returns the removed entry. */
export async function removeManualAdjustment(entryId: string): Promise<PointsEntry | null> {
  return mutate((d) => {
    const idx = ledgerIndex(d);
    const index = d.points.findIndex((p) => p.id === entryId && p.reason === "manual");
    if (index === -1) return null;
    const [removed] = d.points.splice(index, 1);
    if (!removed) return null;
    indexRemove(idx, removed);
    adoptSource(idx, d.points);
    return removed;
  });
}

/**
 * Discussion points earned for specific replies, per member (the community
 * hub sums only replies the viewer can see).
 */
export async function getReplyPoints(replyIds: Iterable<string>): Promise<Map<string, number>> {
  const db = await getDb();
  const idx = ledgerIndex(db);
  const out = new Map<string, number>();
  for (const id of replyIds) {
    const e = idx.replies.get(id);
    if (e) out.set(e.userId, (out.get(e.userId) ?? 0) + e.points);
  }
  return out;
}

/** Test/diagnostic hook: drop cached standings (the ledger index is kept). */
export function clearStandingsCache(): void {
  standingsCache.clear();
}

