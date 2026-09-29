import "server-only";
import type { ActivityType, Batch, Course, Database, LiveClass, PaymentItemType, PublicUser, Role, Settings, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isCreator, isEvaluator, isModerator, isStaff } from "@/lib/auth/session";
import { canManageCourse, getCourseSummaries, getNextLesson, lessonHref } from "@/lib/data/courses";
import { getUserBadges } from "@/lib/services/badges";
import { classWindow, slotWindow } from "@/components/dashboard/time";
import { addDays, percent, sum, toDateKey } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared view models                                                  */
/* ------------------------------------------------------------------ */

export interface MiniUser {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
}

export interface CourseCardData {
  id: string;
  slug: string;
  title: string;
  shortIntroduction: string;
  imageUrl?: string;
  cardGradient: Course["cardGradient"];
  featured: boolean;
  upcoming: boolean;
  published: boolean;
  status: Course["status"];
  paidCourse: boolean;
  price: number;
  currency: string;
  lessonCount: number;
  totalDurationSeconds: number;
  enrollmentCount: number;
  averageRating: number | null;
  reviewCount: number;
  category: string | null;
  instructors: MiniUser[];
  /** Viewer progress 0-100 when enrolled. */
  progress?: number;
}

export interface DashboardLiveClass {
  id: string;
  title: string;
  description?: string;
  date: string;
  time: string;
  durationMinutes: number;
  timezone: string;
  provider: LiveClass["provider"];
  joinUrl: string;
  startUrl?: string;
  recordingUrl?: string;
  startsAt: string;
  endsAt: string;
  batch: { id: string; slug: string; title: string };
  host: MiniUser | null;
  /** Hosts, batch instructors, moderators and evaluators may start the meeting. */
  canStart: boolean;
}

export interface DashboardEvaluation {
  id: string;
  courseTitle: string;
  courseSlug: string | null;
  batchTitle: string | null;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  meetingLink?: string;
  evaluator: MiniUser | null;
  member: MiniUser | null;
  /** Only evaluations on a future date can be cancelled. */
  cancellable: boolean;
}

export type BatchStatus = "upcoming" | "active" | "completed";

export interface DashboardBatch {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageUrl?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  medium: Batch["medium"];
  published: boolean;
  status: BatchStatus;
  instructors: MiniUser[];
  courseCount: number;
  studentCount: number;
  seatCount: number;
  nextClass: { title: string; startsAt: string } | null;
}

export interface ContinueLearningItem {
  courseId: string;
  slug: string;
  title: string;
  shortIntroduction: string;
  imageUrl?: string;
  cardGradient: Course["cardGradient"];
  instructors: MiniUser[];
  progress: number;
  completedLessons: number;
  totalLessons: number;
  next: { title: string; href: string; chapterTitle: string; ref: string } | null;
  lastActivityAt: string;
  batchTitle: string | null;
}

export type PendingKind = "quiz" | "assignment" | "exercise";
export type PendingStatus = "not_started" | "retry" | "awaiting_grading";

export interface PendingItem {
  key: string;
  kind: PendingKind;
  refId: string;
  title: string;
  context: string;
  href: string;
  status: PendingStatus;
  dueDate?: string;
}

export interface DashboardProgram {
  id: string;
  slug: string;
  title: string;
  progress: number;
  enforceCourseOrder: boolean;
  courses: { id: string; slug: string; title: string; progress: number; completed: boolean; enrolled: boolean; locked: boolean }[];
  nextCourse: { slug: string; title: string } | null;
}

export interface DashboardCertificate {
  id: string;
  code: string;
  title: string;
  issueDate: string;
  expiryDate?: string;
}

export interface DashboardBadge {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  issuedOn: string;
}

export interface StreakSummary {
  current: number;
  longest: number;
  activeToday: boolean;
  activeDays: number;
  heatmap: { date: string; count: number }[];
}

export interface StudentDashboard {
  streak: StreakSummary;
  continueLearning: ContinueLearningItem[];
  completedCourses: { id: string; slug: string; title: string; completedAt: string; certificateCode: string | null }[];
  liveClasses: DashboardLiveClass[];
  evaluations: DashboardEvaluation[];
  /** Totals behind the capped `liveClasses` / `evaluations` lists. */
  upcomingCounts: { liveClasses: number; evaluations: number };
  batches: DashboardBatch[];
  programs: DashboardProgram[];
  pending: { items: PendingItem[]; total: number };
  badges: { recent: DashboardBadge[]; total: number };
  certificates: DashboardCertificate[];
  recommended: CourseCardData[];
  stats: {
    enrolled: number;
    completed: number;
    lessonsCompleted: number;
    minutesLearned: number;
    certificates: number;
    badges: number;
  };
  teaching: {
    courses: number;
    upcomingBatches: number;
    pendingGrading: number;
    evaluations: number;
  } | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function toMiniUser(u: Pick<User, "id" | "name" | "username" | "avatarUrl"> | PublicUser | undefined | null): MiniUser | null {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl };
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function batchStatus(batch: Pick<Batch, "startDate" | "endDate">, today = toDateKey()): BatchStatus {
  if (batch.startDate > today) return "upcoming";
  if (batch.endDate && batch.endDate < today) return "completed";
  return "active";
}

/** Percent change between two periods; `null` when there is no baseline and no change. */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Map lessonId → numbers for building learn URLs. */
function lessonNumbers(db: Database, courseId: string): Map<string, { chapterNumber: number; lessonNumber: number; chapterTitle: string }> {
  const out = new Map<string, { chapterNumber: number; lessonNumber: number; chapterTitle: string }>();
  const chapters = db.chapters.filter((c) => c.courseId === courseId).sort((a, b) => a.order - b.order);
  chapters.forEach((chapter, ci) => {
    db.lessons
      .filter((l) => l.chapterId === chapter.id)
      .sort((a, b) => a.order - b.order)
      .forEach((lesson, li) => out.set(lesson.id, { chapterNumber: ci + 1, lessonNumber: li + 1, chapterTitle: chapter.title }));
  });
  return out;
}

export function toCourseCard(db: Database, course: Course, progress?: number): CourseCardData {
  const lessons = db.lessons.filter((l) => l.courseId === course.id);
  const reviews = db.reviews.filter((r) => r.courseId === course.id);
  const users = new Map(db.users.map((u) => [u.id, u]));
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    shortIntroduction: course.shortIntroduction,
    imageUrl: course.imageUrl,
    cardGradient: course.cardGradient,
    featured: course.featured,
    upcoming: course.upcoming,
    published: course.published,
    status: course.status,
    paidCourse: course.paidCourse,
    price: course.price,
    currency: course.currency,
    lessonCount: lessons.length,
    totalDurationSeconds: sum(lessons.map((l) => l.durationSeconds)),
    enrollmentCount: db.enrollments.filter((e) => e.courseId === course.id && e.memberType === "student").length,
    averageRating: reviews.length ? Math.round((sum(reviews.map((r) => r.rating)) / reviews.length) * 10) / 10 : null,
    reviewCount: reviews.length,
    category: db.categories.find((c) => c.id === course.categoryId)?.name ?? null,
    instructors: course.instructorIds.map((id) => toMiniUser(users.get(id))).filter((u): u is MiniUser => !!u),
    progress,
  };
}

export function toDashboardBatch(db: Database, batch: Batch): DashboardBatch {
  const users = new Map(db.users.map((u) => [u.id, u]));
  const now = Date.now();
  const next = db.liveClasses
    .filter((lc) => lc.batchId === batch.id)
    .map((lc) => ({ lc, win: classWindow(lc) }))
    .filter(({ win }) => win.end.getTime() >= now)
    .sort((a, b) => a.win.start.getTime() - b.win.start.getTime())[0];
  return {
    id: batch.id,
    slug: batch.slug,
    title: batch.title,
    description: batch.description,
    imageUrl: batch.imageUrl,
    startDate: batch.startDate,
    endDate: batch.endDate,
    startTime: batch.startTime,
    endTime: batch.endTime,
    timezone: batch.timezone,
    medium: batch.medium,
    published: batch.published,
    status: batchStatus(batch),
    instructors: batch.instructorIds.map((id) => toMiniUser(users.get(id))).filter((u): u is MiniUser => !!u),
    courseCount: batch.courseIds.length,
    studentCount: db.batchEnrollments.filter((e) => e.batchId === batch.id).length,
    seatCount: batch.seatCount,
    nextClass: next ? { title: next.lc.title, startsAt: next.win.start.toISOString() } : null,
  };
}

/**
 * Live classes of the given batches that end today or later (capped at `limit`),
 * plus the total number that have not ended yet (for the greeting subtitle).
 */
function collectLiveClasses(
  db: Database,
  batchIds: Set<string>,
  viewer: User,
  limit: number,
): { items: DashboardLiveClass[]; upcomingTotal: number } {
  if (!db.settings.features.liveClasses || batchIds.size === 0) return { items: [], upcomingTotal: 0 };
  const todayStart = startOfToday();
  const now = Date.now();
  const batches = new Map(db.batches.map((b) => [b.id, b]));
  const users = new Map(db.users.map((u) => [u.id, u]));
  const windows = db.liveClasses
    .filter((lc) => batchIds.has(lc.batchId) && batches.get(lc.batchId)?.showLiveClass !== false)
    .map((lc) => ({ lc, win: classWindow(lc) }))
    .filter(({ win }) => Number.isFinite(win.end.getTime()) && win.end.getTime() >= todayStart)
    .sort((a, b) => a.win.start.getTime() - b.win.start.getTime());
  const upcomingTotal = windows.filter(({ win }) => win.end.getTime() > now).length;
  const items = windows
    .slice(0, limit)
    .map(({ lc, win }) => {
      const batch = batches.get(lc.batchId)!;
      const canStart = lc.hostId === viewer.id || batch.instructorIds.includes(viewer.id) || isModerator(viewer) || isEvaluator(viewer);
      return {
        id: lc.id,
        title: lc.title,
        description: lc.description,
        date: lc.date,
        time: lc.time,
        durationMinutes: lc.durationMinutes,
        timezone: lc.timezone,
        provider: lc.provider,
        joinUrl: lc.joinUrl,
        startUrl: canStart ? lc.startUrl : undefined,
        recordingUrl: lc.recordingUrl,
        startsAt: win.start.toISOString(),
        endsAt: win.end.toISOString(),
        batch: { id: batch.id, slug: batch.slug, title: batch.title },
        host: toMiniUser(users.get(lc.hostId)),
        canStart,
      };
    });
  return { items, upcomingTotal };
}

function collectEvaluations(
  db: Database,
  predicate: (r: Database["certificateRequests"][number]) => boolean,
  limit: number,
): { items: DashboardEvaluation[]; total: number } {
  const today = toDateKey();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const upcoming = db.certificateRequests
    .filter((r) => r.status === "upcoming" && r.date >= today && predicate(r))
    .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const items = upcoming
    .slice(0, limit)
    .map((r) => {
      const course = db.courses.find((c) => c.id === r.courseId);
      const batch = r.batchId ? db.batches.find((b) => b.id === r.batchId) : undefined;
      const win = slotWindow(r);
      return {
        id: r.id,
        courseTitle: course?.title ?? "Course evaluation",
        courseSlug: course?.slug ?? null,
        batchTitle: batch?.title ?? null,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        timezone: r.timezone,
        startsAt: win.start.toISOString(),
        endsAt: win.end.toISOString(),
        meetingLink: r.meetingLink,
        evaluator: toMiniUser(users.get(r.evaluatorId)),
        member: toMiniUser(users.get(r.userId)),
        cancellable: r.date > today,
      };
    });
  return { items, total: upcoming.length };
}

/* ------------------------------------------------------------------ */
/* Learning streak                                                     */
/* ------------------------------------------------------------------ */

/** Only real learning counts towards the streak and heatmap (not logins or enrollments). */
const LEARNING_ACTIVITY: ReadonlySet<ActivityType> = new Set<ActivityType>([
  "lesson_view",
  "lesson_complete",
  "quiz_submit",
  "assignment_submit",
  "exercise_submit",
]);

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

/**
 * Learning streak per the spec: consecutive days with lesson progress or a quiz,
 * assignment or exercise submission. A weekend day without activity does not
 * break the streak (weekend activity still counts), and today only breaks it
 * once it is over.
 */
function computeLearningStreak(db: Database, userId: string, weeks: number): StreakSummary {
  const counts = new Map<string, number>();
  for (const a of db.activities) {
    if (a.userId !== userId || !LEARNING_ACTIVITY.has(a.type)) continue;
    counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
  }
  const now = new Date();
  const today = toDateKey(now);
  const activeToday = counts.has(today);

  let current = 0;
  for (let cursor = activeToday ? now : addDays(now, -1); ; cursor = addDays(cursor, -1)) {
    if (counts.has(toDateKey(cursor))) current++;
    else if (!isWeekend(cursor)) break;
  }

  let longest = 0;
  const first = Array.from(counts.keys()).sort()[0];
  if (first) {
    let run = 0;
    for (let cursor = dateFromKey(first); toDateKey(cursor) <= today; cursor = addDays(cursor, 1)) {
      const key = toDateKey(cursor);
      if (counts.has(key)) run++;
      else if (!isWeekend(cursor) && key !== today) run = 0;
      longest = Math.max(longest, run);
    }
  }

  const heatmap: { date: string; count: number }[] = [];
  const start = addDays(now, -(weeks * 7 - 1));
  for (let i = 0; i < weeks * 7; i++) {
    const key = toDateKey(addDays(start, i));
    heatmap.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return {
    current,
    longest: Math.max(longest, current),
    activeToday,
    activeDays: heatmap.filter((d) => d.count > 0).length,
    heatmap,
  };
}

/* ------------------------------------------------------------------ */
/* Pending work                                                         */
/* ------------------------------------------------------------------ */

function collectPendingWork(db: Database, user: User, courseIds: string[], batchIds: string[]): { items: PendingItem[]; total: number } {
  const byKey = new Map<string, PendingItem>();

  const quizStatus = (quizId: string): PendingStatus | null => {
    const quiz = db.quizzes.find((q) => q.id === quizId);
    if (!quiz) return null;
    const subs = db.quizSubmissions.filter((s) => s.quizId === quizId && s.userId === user.id);
    if (subs.some((s) => s.passed && !s.pendingGrading)) return null;
    if (subs.some((s) => s.pendingGrading)) return "awaiting_grading";
    if (subs.length === 0) return "not_started";
    if (quiz.maxAttempts > 0 && subs.length >= quiz.maxAttempts) return null;
    return "retry";
  };
  const assignmentStatus = (assignmentId: string): PendingStatus | null => {
    if (!db.assignments.some((a) => a.id === assignmentId)) return null;
    const latest = db.assignmentSubmissions
      .filter((s) => s.assignmentId === assignmentId && s.userId === user.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    if (!latest) return "not_started";
    if (latest.status === "not_graded") return "awaiting_grading";
    if (latest.status === "fail") return "retry";
    return null;
  };
  const exerciseStatus = (exerciseId: string): PendingStatus | null => {
    if (!db.exercises.some((e) => e.id === exerciseId)) return null;
    const subs = db.exerciseSubmissions.filter((s) => s.exerciseId === exerciseId && s.userId === user.id);
    if (subs.some((s) => s.status === "passed")) return null;
    return subs.length ? "retry" : "not_started";
  };
  const statusFor = (kind: PendingKind, refId: string) =>
    kind === "quiz" ? quizStatus(refId) : kind === "assignment" ? assignmentStatus(refId) : exerciseStatus(refId);
  const titleFor = (kind: PendingKind, refId: string) =>
    kind === "quiz"
      ? db.quizzes.find((q) => q.id === refId)?.title
      : kind === "assignment"
        ? db.assignments.find((a) => a.id === refId)?.title
        : db.exercises.find((e) => e.id === refId)?.title;
  const standaloneHref = (kind: PendingKind, refId: string) =>
    `/${kind === "quiz" ? "quiz" : kind === "assignment" ? "assignments" : "exercises"}/${refId}`;

  // Batch assessments (they may carry a due date on the timetable).
  for (const batchId of batchIds) {
    const batch = db.batches.find((b) => b.id === batchId);
    if (!batch) continue;
    for (const a of batch.assessments) {
      if (a.type === "exercise" && !db.settings.features.programmingExercises) continue;
      const status = statusFor(a.type, a.refId);
      const title = titleFor(a.type, a.refId);
      if (!status || !title) continue;
      const due = batch.timetable.find((t) => t.refId === a.refId)?.date;
      const key = `${a.type}:${a.refId}`;
      byKey.set(key, {
        key,
        kind: a.type,
        refId: a.refId,
        title,
        context: batch.title,
        href: standaloneHref(a.type, a.refId),
        status,
        dueDate: due,
      });
    }
  }

  // Quizzes / assignments / exercises embedded in lessons of courses in progress.
  for (const courseId of courseIds) {
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) continue;
    const numbers = lessonNumbers(db, courseId);
    const lessons = db.lessons
      .filter((l) => l.courseId === courseId && numbers.has(l.id))
      .sort((a, b) => {
        const na = numbers.get(a.id)!;
        const nb = numbers.get(b.id)!;
        return na.chapterNumber - nb.chapterNumber || na.lessonNumber - nb.lessonNumber;
      });
    for (const lesson of lessons) {
      const n = numbers.get(lesson.id)!;
      for (const block of lesson.blocks) {
        let kind: PendingKind | null = null;
        let refId = "";
        if (block.type === "quiz") {
          kind = "quiz";
          refId = block.quizId;
        } else if (block.type === "assignment") {
          kind = "assignment";
          refId = block.assignmentId;
        } else if (block.type === "exercise" && db.settings.features.programmingExercises) {
          kind = "exercise";
          refId = block.exerciseId;
        }
        if (!kind) continue;
        const key = `${kind}:${refId}`;
        if (byKey.has(key)) continue;
        const status = statusFor(kind, refId);
        const title = titleFor(kind, refId);
        if (!status || !title) continue;
        byKey.set(key, {
          key,
          kind,
          refId,
          title,
          context: `${course.title} · ${lesson.title}`,
          href: lessonHref(course.slug, n),
          status,
        });
      }
    }
  }

  const rank: Record<PendingStatus, number> = { retry: 0, not_started: 1, awaiting_grading: 2 };
  const items = Array.from(byKey.values()).sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
  return { items: items.slice(0, 8), total: items.length };
}

/* ------------------------------------------------------------------ */
/* Student dashboard                                                   */
/* ------------------------------------------------------------------ */

export async function getStudentDashboard(user: User, settings: Settings): Promise<StudentDashboard> {
  const db = await getDb();
  const badges = settings.features.badges ? await getUserBadges(user.id) : [];
  const streak = computeLearningStreak(db, user.id, 16);

  const users = new Map(db.users.map((u) => [u.id, u]));
  const enrollments = db.enrollments.filter((e) => e.userId === user.id);
  const myProgress = db.progress.filter((p) => p.userId === user.id);
  const lastTouch = new Map<string, string>();
  for (const p of myProgress) {
    const prev = lastTouch.get(p.courseId);
    if (!prev || p.updatedAt > prev) lastTouch.set(p.courseId, p.updatedAt);
  }

  /* Continue learning */
  const inProgress = enrollments.filter((e) => !e.completedAt && e.progress < 100);
  const continueLearning: ContinueLearningItem[] = [];
  for (const enrollment of inProgress) {
    const course = db.courses.find((c) => c.id === enrollment.courseId);
    if (!course || (!course.published && !canManageCourse(user, course))) continue;
    const next = await getNextLesson(course, user);
    const chapter = next ? db.chapters.find((c) => c.id === next.chapterId) : undefined;
    const totalLessons = db.lessons.filter((l) => l.courseId === course.id).length;
    const completedLessons = myProgress.filter((p) => p.courseId === course.id && p.status === "complete").length;
    const batch = enrollment.batchId ? db.batches.find((b) => b.id === enrollment.batchId) : undefined;
    continueLearning.push({
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      shortIntroduction: course.shortIntroduction,
      imageUrl: course.imageUrl,
      cardGradient: course.cardGradient,
      instructors: course.instructorIds.map((id) => toMiniUser(users.get(id))).filter((u): u is MiniUser => !!u),
      progress: enrollment.progress,
      completedLessons,
      totalLessons,
      next: next
        ? {
            title: next.title,
            href: lessonHref(course.slug, next),
            chapterTitle: chapter?.title ?? "",
            ref: `${next.chapterNumber}-${next.lessonNumber}`,
          }
        : null,
      lastActivityAt: lastTouch.get(course.id) ?? enrollment.enrolledAt,
      batchTitle: batch?.title ?? null,
    });
  }
  continueLearning.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  const completedCourses = enrollments
    .filter((e) => e.completedAt || e.progress >= 100)
    .map((e) => {
      const course = db.courses.find((c) => c.id === e.courseId);
      if (!course) return null;
      const cert = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id && c.published);
      return { id: course.id, slug: course.slug, title: course.title, completedAt: e.completedAt ?? e.enrolledAt, certificateCode: cert?.code ?? null };
    })
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  /* Batches */
  const myBatchIds = new Set(db.batchEnrollments.filter((e) => e.userId === user.id).map((e) => e.batchId));
  const statusRank: Record<BatchStatus, number> = { active: 0, upcoming: 1, completed: 2 };
  const batches = settings.features.batches
    ? db.batches
        .filter((b) => myBatchIds.has(b.id))
        .map((b) => toDashboardBatch(db, b))
        .sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.startDate.localeCompare(b.startDate))
    : [];

  /* Live classes: my batches + batches I teach */
  const liveBatchIds = new Set(myBatchIds);
  for (const b of db.batches) if (b.instructorIds.includes(user.id)) liveBatchIds.add(b.id);
  const live = settings.features.batches ? collectLiveClasses(db, liveBatchIds, user, 4) : { items: [], upcomingTotal: 0 };

  /* Evaluations I booked */
  const evals = settings.features.certifications ? collectEvaluations(db, (r) => r.userId === user.id, 4) : { items: [], total: 0 };

  /* Programs */
  const programs: DashboardProgram[] = settings.features.programs
    ? db.programMembers
        .filter((m) => m.userId === user.id)
        .map((m) => db.programs.find((p) => p.id === m.programId))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((program) => {
          let previousDone = true;
          const courses = program.courseIds
            .map((cid) => db.courses.find((c) => c.id === cid))
            .filter((c): c is Course => !!c)
            .map((course) => {
              const e = enrollments.find((x) => x.courseId === course.id);
              const completed = !!e && (!!e.completedAt || e.progress >= 100);
              const locked = program.enforceCourseOrder && !previousDone;
              previousDone = previousDone && completed;
              return { id: course.id, slug: course.slug, title: course.title, progress: e?.progress ?? 0, completed, enrolled: !!e, locked };
            });
          const progress = courses.length ? Math.round(sum(courses.map((c) => c.progress)) / courses.length) : 0;
          const next = courses.find((c) => !c.completed && !c.locked);
          return {
            id: program.id,
            slug: program.slug,
            title: program.title,
            progress,
            enforceCourseOrder: program.enforceCourseOrder,
            courses,
            nextCourse: next ? { slug: next.slug, title: next.title } : null,
          };
        })
    : [];

  /* Pending work */
  const pending = collectPendingWork(
    db,
    user,
    inProgress.map((e) => e.courseId),
    settings.features.batches ? Array.from(myBatchIds) : [],
  );

  /* Certificates */
  const certificates: DashboardCertificate[] = settings.features.certifications
    ? db.certificates
        .filter((c) => c.userId === user.id && c.published)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
        .map((c) => ({
          id: c.id,
          code: c.code,
          title:
            (c.courseId ? db.courses.find((x) => x.id === c.courseId)?.title : undefined) ??
            (c.batchId ? db.batches.find((x) => x.id === c.batchId)?.title : undefined) ??
            "Certificate",
          issueDate: c.issueDate,
          expiryDate: c.expiryDate,
        }))
    : [];

  /* Recommended */
  const catalog = settings.features.courses ? await getCourseSummaries(user, { tab: "live", sort: "popular" }) : [];
  const recommended = catalog
    .filter((c) => !c.enrollment)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.enrollmentCount - a.enrollmentCount)
    .slice(0, 3)
    .map((c) => toCourseCard(db, db.courses.find((x) => x.id === c.id) ?? c));

  /* Staff snapshot */
  let teaching: StudentDashboard["teaching"] = null;
  if (isStaff(user)) {
    const today = toDateKey();
    const myCourseIds = new Set(db.courses.filter((c) => c.instructorIds.includes(user.id) || c.createdById === user.id).map((c) => c.id));
    const moderator = isModerator(user);
    teaching = {
      courses: myCourseIds.size,
      upcomingBatches: db.batches.filter((b) => b.startDate >= today && (b.instructorIds.includes(user.id) || b.createdById === user.id)).length,
      pendingGrading:
        db.assignmentSubmissions.filter((s) => s.status === "not_graded" && (moderator || (s.courseId ? myCourseIds.has(s.courseId) : false))).length +
        db.quizSubmissions.filter((s) => s.pendingGrading && (moderator || (s.courseId ? myCourseIds.has(s.courseId) : false))).length,
      evaluations: db.certificateRequests.filter((r) => r.evaluatorId === user.id && r.status === "upcoming" && r.date >= today).length,
    };
  }

  return {
    streak,
    continueLearning,
    completedCourses,
    liveClasses: live.items,
    evaluations: evals.items,
    upcomingCounts: { liveClasses: live.upcomingTotal, evaluations: evals.total },
    batches,
    programs,
    pending,
    badges: {
      recent: badges.slice(0, 4).map((b) => ({ id: b.id, title: b.title, description: b.description, imageUrl: b.imageUrl, issuedOn: b.issuedOn })),
      total: badges.length,
    },
    certificates,
    recommended,
    stats: {
      enrolled: enrollments.length,
      completed: completedCourses.length,
      lessonsCompleted: myProgress.filter((p) => p.status === "complete").length,
      minutesLearned: Math.round(sum(myProgress.map((p) => p.dwellSeconds)) / 60),
      certificates: certificates.length,
      badges: badges.length,
    },
    teaching,
  };
}

/* ------------------------------------------------------------------ */
/* Admin overview                                                      */
/* ------------------------------------------------------------------ */

export type ActivityKind =
  | "signup"
  | "enrollment"
  | "batch_enrollment"
  | "completion"
  | "certificate"
  | "quiz"
  | "assignment"
  | "review"
  | "payment";

export interface ActivityFeedItem {
  id: string;
  kind: ActivityKind;
  actor: MiniUser | null;
  verb: string;
  /** `href` is omitted when the viewer cannot open the target page. */
  target: { label: string; href?: string } | null;
  detail?: string;
  at: string;
}

export interface RecentEnrollment {
  id: string;
  user: MiniUser | null;
  course: { id: string; title: string; slug: string };
  enrolledAt: string;
  progress: number;
  completed: boolean;
  batchTitle: string | null;
}

export interface RecentSignup {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  email: string;
  roles: Role[];
  createdAt: string;
  enrollments: number;
}

export interface AdminOverview {
  scope: "site" | "mine";
  kpis: {
    courses: number;
    published: number;
    learners: number;
    newSignupsThisWeek: number;
    enrollmentsThisWeek: number;
    enrollmentsLastWeek: number;
    enrollmentTrend: number | null;
    completions: number;
    completionRate: number;
    revenueThisMonth: number;
    revenueLastMonth: number;
    revenueTrend: number | null;
    revenueCurrency: string;
    paymentsThisMonth: number;
    pendingAssignments: number;
    pendingQuizzes: number;
    underReview: number;
  };
  recentEnrollments: RecentEnrollment[];
  recentSignups: RecentSignup[];
  activity: ActivityFeedItem[];
  evaluations: DashboardEvaluation[];
  liveClasses: DashboardLiveClass[];
  /** Totals behind the capped `liveClasses` / `evaluations` lists. */
  upcomingCounts: { liveClasses: number; evaluations: number };
  createdCourses: CourseCardData[];
  upcomingBatches: DashboardBatch[];
  counts: {
    courses: number;
    batches: number;
    programs: number;
    quizzes: number;
    questions: number;
    assignments: number;
    exercises: number;
    certificates: number;
    jobs: number;
    members: number;
  };
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export async function getAdminOverview(user: User): Promise<AdminOverview> {
  const db = await getDb();
  const moderator = isModerator(user);
  const creator = isCreator(user);
  const scope: AdminOverview["scope"] = moderator ? "site" : "mine";
  const now = Date.now();
  const weekAgo = now - 7 * 86_400_000;
  const twoWeeksAgo = now - 14 * 86_400_000;
  const today = toDateKey();
  const users = new Map(db.users.map((u) => [u.id, u]));

  const scopedCourses = moderator
    ? db.courses
    : db.courses.filter((c) => c.instructorIds.includes(user.id) || c.createdById === user.id || c.evaluatorId === user.id);
  const courseIds = new Set(scopedCourses.map((c) => c.id));
  const scopedBatches = moderator ? db.batches : db.batches.filter((b) => b.instructorIds.includes(user.id) || b.createdById === user.id);
  const batchIds = new Set(scopedBatches.map((b) => b.id));

  const assignmentIdsInScope = new Set(
    db.assignments.filter((a) => moderator || a.authorId === user.id || (!!a.courseId && courseIds.has(a.courseId))).map((a) => a.id),
  );
  const quizIdsInScope = new Set(
    db.quizzes.filter((q) => moderator || q.authorId === user.id || (!!q.courseId && courseIds.has(q.courseId))).map((q) => q.id),
  );
  for (const b of scopedBatches) {
    for (const a of b.assessments) {
      if (a.type === "assignment") assignmentIdsInScope.add(a.refId);
      if (a.type === "quiz") quizIdsInScope.add(a.refId);
    }
  }

  const studentEnrollments = db.enrollments.filter((e) => e.memberType === "student" && courseIds.has(e.courseId));
  const learnerIds = new Set(studentEnrollments.map((e) => e.userId));
  for (const be of db.batchEnrollments) if (batchIds.has(be.batchId)) learnerIds.add(be.userId);

  const enrollmentsThisWeek = studentEnrollments.filter((e) => new Date(e.enrolledAt).getTime() >= weekAgo).length;
  const enrollmentsLastWeek = studentEnrollments.filter((e) => {
    const t = new Date(e.enrolledAt).getTime();
    return t >= twoWeeksAgo && t < weekAgo;
  }).length;
  const completions = studentEnrollments.filter((e) => e.completedAt || e.progress >= 100).length;

  const itemInScope = (type: PaymentItemType, id: string) => (type === "batch" ? batchIds.has(id) : courseIds.has(id));
  const currency = db.settings.commerce.defaultCurrency;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const lastMonthStart = new Date(monthStart);
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
  const paid = db.payments.filter((p) => p.status === "paid" && p.currency === currency && (moderator || itemInScope(p.itemType, p.itemId)));
  const paidAt = (p: (typeof paid)[number]) => new Date(p.paidAt ?? p.createdAt).getTime();
  const thisMonth = paid.filter((p) => paidAt(p) >= monthStart.getTime());
  const lastMonth = paid.filter((p) => paidAt(p) >= lastMonthStart.getTime() && paidAt(p) < monthStart.getTime());
  const revenueThisMonth = sum(thisMonth.map((p) => p.amount));
  const revenueLastMonth = sum(lastMonth.map((p) => p.amount));

  const pendingAssignments = db.assignmentSubmissions.filter((s) => s.status === "not_graded" && assignmentIdsInScope.has(s.assignmentId)).length;
  const pendingQuizzes = db.quizSubmissions.filter((s) => s.pendingGrading && quizIdsInScope.has(s.quizId)).length;

  /* Recent enrollments */
  const recentEnrollments: RecentEnrollment[] = [...studentEnrollments]
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
    .slice(0, 8)
    .flatMap((e) => {
      const course = db.courses.find((c) => c.id === e.courseId);
      if (!course) return [];
      return [
        {
          id: e.id,
          user: toMiniUser(users.get(e.userId)),
          course: { id: course.id, title: course.title, slug: course.slug },
          enrolledAt: e.enrolledAt,
          progress: e.progress,
          completed: !!e.completedAt || e.progress >= 100,
          batchTitle: e.batchId ? (db.batches.find((b) => b.id === e.batchId)?.title ?? null) : null,
        },
      ];
    });

  /* Recent signups (moderators see the whole site; others their own learners) */
  const signupPool = moderator ? db.users : db.users.filter((u) => learnerIds.has(u.id));
  const recentSignups: RecentSignup[] = [...signupPool]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      avatarUrl: u.avatarUrl,
      email: moderator ? u.email : "",
      roles: u.roles,
      createdAt: u.createdAt,
      enrollments: db.enrollments.filter((e) => e.userId === u.id).length,
    }));
  const newSignupsThisWeek = signupPool.filter((u) => new Date(u.createdAt).getTime() >= weekAgo).length;

  /* Activity feed */
  const activity: ActivityFeedItem[] = [];
  const courseTarget = (id: string | undefined) => {
    const c = id ? db.courses.find((x) => x.id === id) : undefined;
    return c ? { label: c.title, href: `/courses/${c.slug}` } : null;
  };
  for (const e of studentEnrollments) {
    activity.push({
      id: `enr-${e.id}`,
      kind: "enrollment",
      actor: toMiniUser(users.get(e.userId)),
      verb: "enrolled in",
      target: courseTarget(e.courseId),
      at: e.enrolledAt,
    });
    if (e.completedAt) {
      activity.push({
        id: `cmp-${e.id}`,
        kind: "completion",
        actor: toMiniUser(users.get(e.userId)),
        verb: "completed",
        target: courseTarget(e.courseId),
        at: e.completedAt,
      });
    }
  }
  for (const be of db.batchEnrollments) {
    if (!batchIds.has(be.batchId)) continue;
    const batch = db.batches.find((b) => b.id === be.batchId);
    activity.push({
      id: `ben-${be.id}`,
      kind: "batch_enrollment",
      actor: toMiniUser(users.get(be.userId)),
      verb: "joined the batch",
      target: batch ? { label: batch.title, href: `/batches/${batch.slug}` } : null,
      at: be.enrolledAt,
    });
  }
  for (const c of db.certificates) {
    if (!(c.courseId && courseIds.has(c.courseId)) && !(c.batchId && batchIds.has(c.batchId))) continue;
    const batch = c.batchId ? db.batches.find((b) => b.id === c.batchId) : undefined;
    activity.push({
      id: `crt-${c.id}`,
      kind: "certificate",
      actor: toMiniUser(users.get(c.userId)),
      verb: "earned a certificate for",
      target: courseTarget(c.courseId) ?? (batch ? { label: batch.title, href: `/batches/${batch.slug}` } : null),
      at: c.issueDate.length === 10 ? `${c.issueDate}T12:00:00.000Z` : c.issueDate,
    });
  }
  for (const s of db.quizSubmissions) {
    if (!quizIdsInScope.has(s.quizId)) continue;
    activity.push({
      id: `qz-${s.id}`,
      kind: "quiz",
      actor: toMiniUser(users.get(s.userId)),
      verb: s.pendingGrading ? "submitted the quiz" : s.passed ? "passed the quiz" : "attempted the quiz",
      // Quiz submission review is limited to course creators and moderators.
      target: { label: s.quizTitle, href: creator ? `/admin/quizzes/submissions/${s.id}` : undefined },
      detail: s.pendingGrading ? "Awaiting grading" : `Scored ${s.percentage}%`,
      at: s.submittedAt,
    });
  }
  for (const s of db.assignmentSubmissions) {
    if (!assignmentIdsInScope.has(s.assignmentId)) continue;
    activity.push({
      id: `as-${s.id}`,
      kind: "assignment",
      actor: toMiniUser(users.get(s.userId)),
      verb: "submitted",
      target: { label: s.assignmentTitle, href: `/admin/assignments/submissions/${s.id}` },
      detail: s.status === "not_graded" ? "Needs grading" : s.status === "pass" ? "Passed" : s.status === "fail" ? "Failed" : undefined,
      at: s.submittedAt,
    });
  }
  for (const r of db.reviews) {
    if (!courseIds.has(r.courseId)) continue;
    activity.push({
      id: `rv-${r.id}`,
      kind: "review",
      actor: toMiniUser(users.get(r.userId)),
      verb: `rated ${r.rating}/5`,
      target: courseTarget(r.courseId),
      detail: r.review ? `“${r.review.length > 90 ? `${r.review.slice(0, 89)}…` : r.review}”` : undefined,
      at: r.createdAt,
    });
  }
  if (moderator) {
    for (const u of db.users) {
      activity.push({ id: `su-${u.id}`, kind: "signup", actor: toMiniUser(u), verb: "joined the platform", target: null, at: u.createdAt });
    }
  }
  for (const p of db.payments) {
    if (p.status !== "paid" || !(moderator || itemInScope(p.itemType, p.itemId))) continue;
    activity.push({
      id: `pay-${p.id}`,
      kind: "payment",
      actor: toMiniUser(users.get(p.userId)),
      verb: "paid for",
      target: null,
      detail: `${p.itemTitle} · ${formatMoney(p.amount, p.currency)}`,
      at: p.paidAt ?? p.createdAt,
    });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  /* Spec "admin home" blocks */
  const evals = db.settings.features.certifications ? collectEvaluations(db, (r) => r.evaluatorId === user.id, 4) : { items: [], total: 0 };
  const hostedBatchIds = new Set(db.batches.filter((b) => b.instructorIds.includes(user.id)).map((b) => b.id));
  for (const lc of db.liveClasses) if (lc.hostId === user.id) hostedBatchIds.add(lc.batchId);
  const live = collectLiveClasses(db, hostedBatchIds, user, 4);

  let created = db.courses
    .filter((c) => c.instructorIds.includes(user.id) || c.createdById === user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (created.length === 0 && moderator) created = [...db.courses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const createdCourses = created.slice(0, 3).map((c) => toCourseCard(db, c));

  const upcomingBatches = db.batches
    .filter((b) => b.startDate >= today && (b.instructorIds.includes(user.id) || b.createdById === user.id || (moderator && b.published)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 4)
    .map((b) => toDashboardBatch(db, b));

  return {
    scope,
    kpis: {
      courses: scopedCourses.length,
      published: scopedCourses.filter((c) => c.published).length,
      learners: learnerIds.size,
      newSignupsThisWeek,
      enrollmentsThisWeek,
      enrollmentsLastWeek,
      enrollmentTrend: trendPercent(enrollmentsThisWeek, enrollmentsLastWeek),
      completions,
      completionRate: percent(completions, studentEnrollments.length),
      revenueThisMonth,
      revenueLastMonth,
      revenueTrend: trendPercent(revenueThisMonth, revenueLastMonth),
      revenueCurrency: currency,
      paymentsThisMonth: thisMonth.length,
      pendingAssignments,
      pendingQuizzes,
      underReview: scopedCourses.filter((c) => c.status === "under_review").length,
    },
    recentEnrollments,
    recentSignups,
    activity: activity.slice(0, 12),
    evaluations: evals.items,
    liveClasses: live.items,
    upcomingCounts: { liveClasses: live.upcomingTotal, evaluations: evals.total },
    createdCourses,
    upcomingBatches,
    counts: {
      courses: scopedCourses.length,
      batches: scopedBatches.length,
      programs: db.programs.length,
      quizzes: quizIdsInScope.size,
      questions: db.questions.length,
      assignments: assignmentIdsInScope.size,
      exercises: moderator
        ? db.exercises.length
        : db.exercises.filter((e) => e.authorId === user.id || (!!e.courseId && courseIds.has(e.courseId))).length,
      certificates: moderator
        ? db.certificates.length
        : db.certificates.filter((c) => (!!c.courseId && courseIds.has(c.courseId)) || (!!c.batchId && batchIds.has(c.batchId))).length,
      jobs: db.jobs.filter((j) => j.status === "open").length,
      members: db.users.filter((u) => u.enabled).length,
    },
  };
}
