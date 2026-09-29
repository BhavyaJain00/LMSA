import "server-only";
import type {
  Batch,
  BatchEnrollment,
  BatchSummary,
  Category,
  Course,
  Database,
  Notification,
  NotificationType,
  PublicUser,
  TimetableItemType,
  User,
} from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { hasRole, isEvaluator, isModerator, toPublicUser } from "@/lib/auth/session";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import { sendNotificationEmails } from "@/lib/services/notifications";
import type {
  AdminBatchRow,
  AnnouncementView,
  AssessmentRow,
  BatchCourseItem,
  BatchListTab,
  BatchStatus,
  ChartDatum,
  DiscussionThread,
  EmailTemplateView,
  FeedbackAverages,
  FeedbackView,
  LiveClassView,
  Option,
  StudentProgressRow,
  TimetableEntry,
} from "@/components/batches/types";
import {
  addMinutesToClock,
  dayKeyInZone,
  formatClock12,
  formatTzLabel,
  shiftDayKey,
  zonedTimeToUtc,
} from "@/components/batches/tz";
import { liveClassRange } from "@/lib/calendar/time";

/* ------------------------------------------------------------------ */
/* Time & status                                                       */
/* ------------------------------------------------------------------ */

type BatchTiming = Pick<Batch, "startDate" | "endDate" | "startTime" | "endTime" | "timezone">;

/** Absolute start of the first session (epoch ms). */
export function batchStartsAt(b: BatchTiming): number {
  return zonedTimeToUtc(b.startDate, b.startTime || "00:00", b.timezone);
}

/** Absolute end of the last session (epoch ms). */
export function batchEndsAt(b: BatchTiming): number {
  return zonedTimeToUtc(b.endDate, b.endTime || "23:59", b.timezone);
}

export function getBatchStatus(b: BatchTiming, now: number = Date.now()): BatchStatus {
  if (now < batchStartsAt(b)) return "upcoming";
  if (now > batchEndsAt(b)) return "completed";
  return "active";
}

/**
 * Whether new learners may join: before the start, or while running when the
 * batch allows late enrollment (`allowFuture`). Never after it has ended.
 */
export function acceptsEnrollment(b: BatchTiming & Pick<Batch, "allowFuture">, now: number = Date.now()): boolean {
  const status = getBatchStatus(b, now);
  if (status === "completed") return false;
  if (status === "active") return b.allowFuture;
  return true;
}

export function seatsLeftFor(b: Pick<Batch, "seatCount">, studentCount: number): number | null {
  if (!b.seatCount || b.seatCount <= 0) return null;
  return Math.max(0, b.seatCount - studentCount);
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

type Viewer = Pick<User, "id" | "roles"> | null | undefined;

/** Moderators, instructors (course creators) and batch evaluators can create batches. */
export function canCreateBatch(user: Viewer): boolean {
  return hasRole(user, "moderator", "course_creator", "batch_evaluator");
}

/** Moderators manage every batch; instructors/evaluators manage batches they teach or created. */
export function canManageBatch(user: Viewer, batch: Pick<Batch, "instructorIds" | "createdById">): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  return hasRole(user, "course_creator", "batch_evaluator") && (batch.instructorIds.includes(user.id) || batch.createdById === user.id);
}

/** Published batches are public; unpublished ones are visible to enrolled learners, managers, evaluators and moderators. */
export function canViewBatch(user: Viewer, batch: Batch, enrolled: boolean): boolean {
  if (batch.published) return true;
  return enrolled || canManageBatch(user, batch) || isEvaluator(user);
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export async function getBatchBySlug(slug: string): Promise<Batch | null> {
  const db = await getDb();
  return db.batches.find((b) => b.slug === slug) ?? null;
}

export async function getBatchById(id: string): Promise<Batch | null> {
  const db = await getDb();
  return db.batches.find((b) => b.id === id) ?? null;
}

export async function getBatchEnrollment(userId: string | null | undefined, batchId: string): Promise<BatchEnrollment | null> {
  if (!userId) return null;
  const db = await getDb();
  return db.batchEnrollments.find((e) => e.batchId === batchId && e.userId === userId) ?? null;
}

export function batchStudentIds(db: Database, batchId: string): string[] {
  return db.batchEnrollments.filter((e) => e.batchId === batchId).map((e) => e.userId);
}

/* ------------------------------------------------------------------ */
/* Summaries & lists                                                   */
/* ------------------------------------------------------------------ */

function publicUsers(db: Database, ids: string[]): PublicUser[] {
  return ids
    .map((id) => db.users.find((u) => u.id === id))
    .filter((u): u is User => !!u)
    .map(toPublicUser);
}

export function buildBatchSummary(db: Database, batch: Batch, viewer: Viewer, now: number): BatchSummary {
  const studentCount = db.batchEnrollments.filter((e) => e.batchId === batch.id).length;
  const category: Category | null = batch.categoryId ? (db.categories.find((c) => c.id === batch.categoryId) ?? null) : null;
  return {
    ...batch,
    instructors: publicUsers(db, batch.instructorIds),
    category,
    studentCount,
    seatsLeft: seatsLeftFor(batch, studentCount),
    status: getBatchStatus(batch, now),
    enrolled: viewer ? db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === viewer.id) : false,
  };
}

export async function getBatchSummary(batch: Batch, viewer: Viewer): Promise<BatchSummary> {
  const db = await getDb();
  return buildBatchSummary(db, batch, viewer, Date.now());
}

export interface BatchTabDef {
  value: BatchListTab;
  label: string;
}

/** Which list tabs a viewer sees on /batches. */
export function batchTabsFor(viewer: Viewer): BatchTabDef[] {
  const tabs: BatchTabDef[] = [
    { value: "upcoming", label: "Upcoming" },
    { value: "live", label: "Live" },
    { value: "archived", label: "Archived" },
  ];
  if (viewer) tabs.push({ value: "enrolled", label: "Enrolled" });
  if (viewer && canCreateBatch(viewer)) tabs.push({ value: "unpublished", label: "Unpublished" });
  return tabs;
}

export function parseBatchTab(raw: string | undefined, viewer: Viewer): BatchListTab {
  const allowed = batchTabsFor(viewer).map((t) => t.value);
  return raw && (allowed as string[]).includes(raw) ? (raw as BatchListTab) : "upcoming";
}

export interface BatchListQuery {
  tab: BatchListTab;
  search?: string;
  categoryId?: string;
  certification?: boolean;
}

function matchesTab(summary: BatchSummary, tab: BatchListTab, viewer: Viewer): boolean {
  switch (tab) {
    case "upcoming":
      return summary.published && summary.status === "upcoming";
    case "live":
      return summary.published && summary.status === "active";
    case "archived":
      return summary.published && summary.status === "completed";
    case "enrolled":
      return !!summary.enrolled;
    case "unpublished":
      return !summary.published && canManageBatch(viewer, summary);
  }
}

function sortForTab(list: BatchSummary[], tab: BatchListTab): BatchSummary[] {
  const byStart = (a: BatchSummary, b: BatchSummary) => `${a.startDate} ${a.startTime}`.localeCompare(`${b.startDate} ${b.startTime}`);
  if (tab === "upcoming" || tab === "live") return list.sort(byStart);
  if (tab === "unpublished") return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.sort((a, b) => byStart(b, a));
}

export async function getBatchList(viewer: Viewer, query: BatchListQuery): Promise<BatchSummary[]> {
  const db = await getDb();
  const now = Date.now();
  const search = query.search?.trim().toLowerCase();
  const list = db.batches
    .map((b) => buildBatchSummary(db, b, viewer, now))
    .filter((s) => {
      if (!matchesTab(s, query.tab, viewer)) return false;
      if (query.categoryId && s.categoryId !== query.categoryId) return false;
      if (query.certification && !s.certification) return false;
      if (search) {
        const hay = `${s.title} ${s.description} ${s.instructors.map((i) => i.name).join(" ")}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  return sortForTab(list, query.tab);
}

/** Count per tab (ignoring search/category) for the tab strip. */
export async function getBatchTabCounts(viewer: Viewer): Promise<Record<BatchListTab, number>> {
  const db = await getDb();
  const now = Date.now();
  const summaries = db.batches.map((b) => buildBatchSummary(db, b, viewer, now));
  const counts: Record<BatchListTab, number> = { upcoming: 0, live: 0, archived: 0, enrolled: 0, unpublished: 0 };
  for (const tab of Object.keys(counts) as BatchListTab[]) {
    counts[tab] = summaries.filter((s) => matchesTab(s, tab, viewer)).length;
  }
  return counts;
}

/** Categories that at least one visible batch uses. */
export async function getBatchCategories(viewer: Viewer): Promise<Category[]> {
  const db = await getDb();
  const used = new Set(db.batches.filter((b) => b.published || canManageBatch(viewer, b)).map((b) => b.categoryId).filter(Boolean));
  return db.categories.filter((c) => used.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export async function getBatchCourseItems(batch: Batch, viewer: User | null): Promise<BatchCourseItem[]> {
  const db = await getDb();
  const items: BatchCourseItem[] = [];
  for (const courseId of batch.courseIds) {
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) continue;
    const enrollment = viewer ? db.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id) : undefined;
    let continueHref: string | null = null;
    let nextLessonTitle: string | undefined;
    if (enrollment && viewer) {
      const next = await getNextLesson(course, viewer);
      if (next) {
        continueHref = lessonHref(course.slug, next);
        nextLessonTitle = next.title;
      }
    }
    items.push({
      id: course.id,
      slug: course.slug,
      title: course.title,
      shortIntroduction: course.shortIntroduction,
      imageUrl: course.imageUrl,
      cardGradient: course.cardGradient,
      published: course.published,
      lessonCount: db.lessons.filter((l) => l.courseId === course.id).length,
      instructors: publicUsers(db, course.instructorIds),
      enrolled: !!enrollment,
      progress: enrollment ? enrollment.progress : null,
      completed: !!enrollment && (enrollment.progress >= 100 || !!enrollment.completedAt),
      continueHref,
      nextLessonTitle,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

export const assessmentTypeLabels: Record<AssessmentRow["type"], string> = {
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Programming Exercise",
};

export function assessmentHref(type: AssessmentRow["type"], refId: string): string {
  if (type === "quiz") return `/quiz/${refId}`;
  if (type === "assignment") return `/assignments/${refId}`;
  return `/exercises/${refId}`;
}

/** Resolve a batch's assessments with the given learner's status. */
export function buildAssessmentRows(db: Database, batch: Batch, userId: string | null): AssessmentRow[] {
  const courseTitle = (courseId?: string) => (courseId ? db.courses.find((c) => c.id === courseId)?.title : undefined);
  return batch.assessments.map((a): AssessmentRow => {
    const base = { id: a.id, type: a.type, refId: a.refId, href: assessmentHref(a.type, a.refId) };
    if (a.type === "quiz") {
      const quiz = db.quizzes.find((q) => q.id === a.refId);
      const row: AssessmentRow = {
        ...base,
        title: quiz?.title ?? "Deleted quiz",
        missing: !quiz,
        status: "not_attempted",
        statusLabel: "Not attempted",
        courseTitle: courseTitle(quiz?.courseId),
      };
      if (!userId || !quiz) return row;
      const subs = db.quizSubmissions.filter((s) => s.userId === userId && s.quizId === quiz.id);
      if (!subs.length) return row;
      const best = subs.reduce((acc, s) => (s.percentage > acc.percentage ? s : acc), subs[0]!);
      const latest = subs.reduce((acc, s) => (s.submittedAt > acc.submittedAt ? s : acc), subs[0]!);
      const passed = subs.some((s) => s.passed);
      row.percentage = Math.round(best.percentage);
      row.submittedAt = latest.submittedAt;
      if (passed) {
        row.status = "pass";
        row.statusLabel = `Passed · ${row.percentage}%`;
      } else if (latest.pendingGrading) {
        row.status = "pending";
        row.statusLabel = "Awaiting grading";
      } else {
        row.status = "fail";
        row.statusLabel = `${row.percentage}%`;
      }
      return row;
    }
    if (a.type === "assignment") {
      const assignment = db.assignments.find((x) => x.id === a.refId);
      const row: AssessmentRow = {
        ...base,
        title: assignment?.title ?? "Deleted assignment",
        missing: !assignment,
        status: "not_attempted",
        statusLabel: "Not attempted",
        courseTitle: courseTitle(assignment?.courseId),
      };
      if (!userId || !assignment) return row;
      const subs = db.assignmentSubmissions
        .filter((s) => s.userId === userId && s.assignmentId === assignment.id)
        .sort((x, y) => y.submittedAt.localeCompare(x.submittedAt));
      const latest = subs[0];
      if (!latest) return row;
      row.submittedAt = latest.submittedAt;
      if (latest.status === "pass") {
        row.status = "pass";
        row.statusLabel = "Pass";
      } else if (latest.status === "fail") {
        row.status = "fail";
        row.statusLabel = "Fail";
      } else if (latest.status === "not_graded") {
        row.status = "not_graded";
        row.statusLabel = "Not graded";
      } else {
        row.status = "submitted";
        row.statusLabel = "Submitted";
      }
      return row;
    }
    const exercise = db.exercises.find((x) => x.id === a.refId);
    const row: AssessmentRow = {
      ...base,
      title: exercise?.title ?? "Deleted exercise",
      missing: !exercise,
      status: "not_attempted",
      statusLabel: "Not attempted",
      courseTitle: courseTitle(exercise?.courseId),
    };
    if (!userId || !exercise) return row;
    const subs = db.exerciseSubmissions
      .filter((s) => s.userId === userId && s.exerciseId === exercise.id)
      .sort((x, y) => y.submittedAt.localeCompare(x.submittedAt));
    if (!subs.length) return row;
    row.submittedAt = subs[0]!.submittedAt;
    if (subs.some((s) => s.status === "passed")) {
      row.status = "pass";
      row.statusLabel = "Passed";
    } else {
      row.status = "fail";
      row.statusLabel = "Failed";
    }
    return row;
  });
}

export async function getBatchAssessmentRows(batch: Batch, userId: string | null): Promise<AssessmentRow[]> {
  const db = await getDb();
  return buildAssessmentRows(db, batch, userId);
}

/* ------------------------------------------------------------------ */
/* Live classes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds live class rows for display. Pass `forManager: false` (the default)
 * for learners: host-only fields (`startUrl`) and the full attendance list are
 * stripped so they never reach the client payload; the viewer only learns
 * whether they themselves attended.
 */
export function buildLiveClassViews(
  db: Database,
  batchId: string,
  viewerId?: string | null,
  opts: { forManager?: boolean } = {},
): LiveClassView[] {
  const forManager = opts.forManager === true;
  return db.liveClasses
    .filter((c) => c.batchId === batchId)
    .map((c): LiveClassView => {
      const startsAt = zonedTimeToUtc(c.date, c.time, c.timezone);
      const host = db.users.find((u) => u.id === c.hostId);
      const { startUrl, attendeeIds, ...pub } = c;
      const isHost = !!viewerId && c.hostId === viewerId;
      return {
        ...pub,
        startUrl: forManager || isHost ? startUrl : undefined,
        attendeeIds: forManager ? attendeeIds : [],
        host: host ? toPublicUser(host) : null,
        startsAt,
        endsAt: startsAt + c.durationMinutes * 60000,
        endTime: addMinutesToClock(c.time, c.durationMinutes),
        attended: viewerId ? c.attendeeIds.includes(viewerId) : undefined,
      };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
}

export async function getBatchLiveClasses(
  batchId: string,
  viewerId?: string | null,
  opts: { forManager?: boolean } = {},
): Promise<LiveClassView[]> {
  const db = await getDb();
  return buildLiveClassViews(db, batchId, viewerId, opts);
}

/* ------------------------------------------------------------------ */
/* Announcements, discussions, feedback, email templates               */
/* ------------------------------------------------------------------ */

export async function getBatchAnnouncements(batchId: string): Promise<AnnouncementView[]> {
  const db = await getDb();
  return db.announcements
    .filter((a) => a.batchId === batchId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => {
      const author = db.users.find((u) => u.id === a.authorId);
      return { ...a, author: author ? toPublicUser(author) : null };
    });
}

export async function getBatchThreads(batchId: string): Promise<DiscussionThread[]> {
  const db = await getDb();
  const userOf = (id: string) => {
    const u = db.users.find((x) => x.id === id);
    return u ? toPublicUser(u) : null;
  };
  return db.discussionTopics
    .filter((t) => t.refType === "batch" && t.refId === batchId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((t) => ({
      ...t,
      author: userOf(t.authorId),
      replies: db.discussionReplies
        .filter((r) => r.topicId === t.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => ({ ...r, author: userOf(r.authorId) })),
    }));
}

export async function getBatchFeedback(batchId: string): Promise<FeedbackView[]> {
  const db = await getDb();
  return db.batchFeedback
    .filter((f) => f.batchId === batchId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((f) => {
      const u = db.users.find((x) => x.id === f.userId);
      return { ...f, user: u ? toPublicUser(u) : null };
    });
}

export function feedbackAverages(list: { contentRating: number; instructorsRating: number; valueRating: number }[]): FeedbackAverages {
  if (!list.length) return { count: 0, content: null, instructors: null, value: null, overall: null };
  const avg = (nums: number[]) => Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  const content = avg(list.map((f) => f.contentRating));
  const instructors = avg(list.map((f) => f.instructorsRating));
  const value = avg(list.map((f) => f.valueRating));
  return { count: list.length, content, instructors, value, overall: Math.round(((content + instructors + value) / 3) * 10) / 10 };
}

export async function getBatchEmailTemplates(batchId: string): Promise<EmailTemplateView[]> {
  const db = await getDb();
  return db.emailTemplates
    .filter((t) => t.batchId === batchId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, updatedAt: t.updatedAt }));
}

/* ------------------------------------------------------------------ */
/* Timetable                                                           */
/* ------------------------------------------------------------------ */

export function lessonHrefFromDb(db: Database, lessonId: string | undefined): string | null {
  if (!lessonId) return null;
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return null;
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const chapterIndex = chapters.findIndex((c) => c.id === lesson.chapterId);
  if (chapterIndex === -1) return null;
  const siblings = db.lessons.filter((l) => l.chapterId === lesson.chapterId).sort((a, b) => a.order - b.order);
  const lessonIndex = siblings.findIndex((l) => l.id === lesson.id);
  return lessonHref(course.slug, { chapterNumber: chapterIndex + 1, lessonNumber: lessonIndex + 1 });
}

function timetableHref(db: Database, batch: Batch, type: TimetableItemType, refId?: string): string | null {
  if (!refId && type !== "custom") return null;
  switch (type) {
    case "course": {
      const course = db.courses.find((c) => c.id === refId);
      return course ? `/courses/${course.slug}` : null;
    }
    case "lesson":
      return lessonHrefFromDb(db, refId);
    case "live_class":
      return db.liveClasses.some((c) => c.id === refId) ? `/batches/${batch.slug}?tab=classes#class-${refId}` : null;
    case "quiz":
      return db.quizzes.some((q) => q.id === refId) ? `/quiz/${refId}` : null;
    case "assignment":
      return db.assignments.some((a) => a.id === refId) ? `/assignments/${refId}` : null;
    case "exercise":
      return db.exercises.some((e) => e.id === refId) ? `/exercises/${refId}` : null;
    case "custom":
      return null;
  }
}

function timetableCompleted(db: Database, type: TimetableItemType, refId: string | undefined, userId: string | null): boolean | undefined {
  if (!userId || !refId) return undefined;
  switch (type) {
    case "course":
      return db.enrollments.some((e) => e.userId === userId && e.courseId === refId && (e.progress >= 100 || !!e.completedAt));
    case "lesson":
      return db.progress.some((p) => p.userId === userId && p.lessonId === refId && p.status === "complete");
    case "quiz":
      return db.quizSubmissions.some((s) => s.userId === userId && s.quizId === refId && s.passed);
    case "assignment":
      return db.assignmentSubmissions.some((s) => s.userId === userId && s.assignmentId === refId && s.status !== "fail");
    case "exercise":
      return db.exerciseSubmissions.some((s) => s.userId === userId && s.exerciseId === refId && s.status === "passed");
    case "live_class":
      return db.liveClasses.some((c) => c.id === refId && c.attendeeIds.includes(userId));
    default:
      return undefined;
  }
}

/**
 * Timetable rows for a batch, enriched with target URLs, legend colors and the
 * viewer's completion. When `showLiveClass` is on, live classes that are not
 * already on the timetable are merged in.
 */
export async function getBatchTimetable(batch: Batch, viewerId: string | null): Promise<TimetableEntry[]> {
  const db = await getDb();
  const legends = new Map(batch.timetableLegends.map((l) => [l.id, l]));
  // Absolute times of this batch's classes: their clock times are in the class's own timezone.
  const classRanges = new Map<string, { start: number; end: number }>();
  const classZones = new Map<string, string>();
  for (const c of db.liveClasses) {
    const range = c.batchId === batch.id ? liveClassRange(c, batch.timezone) : null;
    if (!range) continue;
    classRanges.set(c.id, { start: range.start, end: range.end });
    classZones.set(c.id, range.timeZone);
  }
  const entries: TimetableEntry[] = batch.timetable.map((item) => {
    const legend = item.legendId ? legends.get(item.legendId) : undefined;
    return {
      id: item.id,
      itemId: item.id,
      type: item.type,
      refId: item.refId,
      title: item.title,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      milestone: item.milestone,
      legendId: item.legendId,
      color: legend?.color ?? null,
      legendLabel: legend?.label,
      href: timetableHref(db, batch, item.type, item.refId),
      completed: timetableCompleted(db, item.type, item.refId, viewerId),
      source: "timetable",
      classRange: item.type === "live_class" && item.refId ? classRanges.get(item.refId) : undefined,
      classTimeZone: item.type === "live_class" && item.refId ? classZones.get(item.refId) : undefined,
    };
  });
  if (batch.showLiveClass) {
    const referenced = new Set(batch.timetable.filter((t) => t.type === "live_class" && t.refId).map((t) => t.refId));
    for (const c of db.liveClasses.filter((x) => x.batchId === batch.id && !referenced.has(x.id))) {
      entries.push({
        id: `lc-${c.id}`,
        type: "live_class",
        refId: c.id,
        title: c.title,
        date: c.date,
        startTime: c.time,
        endTime: addMinutesToClock(c.time, c.durationMinutes),
        milestone: false,
        color: null,
        legendLabel: "Live class",
        href: `/batches/${batch.slug}?tab=classes#class-${c.id}`,
        completed: viewerId ? c.attendeeIds.includes(viewerId) : undefined,
        source: "live_class",
        classRange: classRanges.get(c.id),
        classTimeZone: classZones.get(c.id),
      });
    }
  }
  return entries.sort((a, b) => `${a.date} ${a.startTime ?? "00:00"}`.localeCompare(`${b.date} ${b.startTime ?? "00:00"}`));
}

/* ------------------------------------------------------------------ */
/* Students & progress (admin)                                         */
/* ------------------------------------------------------------------ */

function lastActiveFor(db: Database, user: User): string | undefined {
  let latest = user.lastActiveAt;
  for (const a of db.activities) {
    if (a.userId === user.id && (!latest || a.createdAt > latest)) latest = a.createdAt;
  }
  return latest;
}

export function buildStudentRow(db: Database, batch: Batch, enrollment: BatchEnrollment): StudentProgressRow | null {
  const user = db.users.find((u) => u.id === enrollment.userId);
  if (!user) return null;
  const courses = batch.courseIds
    .map((cid) => db.courses.find((c) => c.id === cid))
    .filter((c): c is Course => !!c)
    .map((course) => {
      const e = db.enrollments.find((x) => x.userId === user.id && x.courseId === course.id);
      return { courseId: course.id, title: course.title, slug: course.slug, enrolled: !!e, progress: e ? Math.round(e.progress) : 0 };
    });
  const assessments = buildAssessmentRows(db, batch, user.id);
  const valid = assessments.filter((a) => !a.missing);
  const passed = valid.filter((a) => a.status === "pass").length;
  const courseSum = courses.reduce((acc, c) => acc + c.progress, 0);
  const denominator = courses.length + valid.length;
  return {
    enrollmentId: enrollment.id,
    userId: user.id,
    user: toPublicUser(user),
    enrolledAt: enrollment.enrolledAt,
    source: enrollment.source,
    paymentId: enrollment.paymentId,
    lastActiveAt: lastActiveFor(db, user),
    courses,
    assessments,
    averageCourseProgress: courses.length ? Math.round(courseSum / courses.length) : 0,
    passedAssessments: passed,
    overallProgress: denominator ? Math.round((courseSum + passed * 100) / denominator) : 0,
    completedCourses: courses.filter((c) => c.progress >= 100).length,
  };
}

export async function getBatchStudentRows(batch: Batch): Promise<StudentProgressRow[]> {
  const db = await getDb();
  return db.batchEnrollments
    .filter((e) => e.batchId === batch.id)
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
    .map((e) => buildStudentRow(db, batch, e))
    .filter((r): r is StudentProgressRow => !!r);
}

/** Completion / pass counts per course and assessment for the summary chart. */
export async function getBatchChartData(batch: Batch): Promise<ChartDatum[]> {
  const db = await getDb();
  const students = new Set(batchStudentIds(db, batch.id));
  const out: ChartDatum[] = [];
  for (const cid of batch.courseIds) {
    const course = db.courses.find((c) => c.id === cid);
    if (!course) continue;
    const value = db.enrollments.filter((e) => e.courseId === cid && students.has(e.userId) && (e.progress >= 100 || !!e.completedAt)).length;
    out.push({ refId: course.id, label: course.title, value, kind: "course" });
  }
  for (const a of batch.assessments) {
    if (a.type === "quiz") {
      const quiz = db.quizzes.find((q) => q.id === a.refId);
      if (!quiz) continue;
      const passedBy = new Set(db.quizSubmissions.filter((s) => s.quizId === quiz.id && s.passed && students.has(s.userId)).map((s) => s.userId));
      out.push({ refId: quiz.id, label: quiz.title, value: passedBy.size, kind: "quiz" });
    } else if (a.type === "assignment") {
      const assignment = db.assignments.find((x) => x.id === a.refId);
      if (!assignment) continue;
      const passedBy = new Set(
        db.assignmentSubmissions.filter((s) => s.assignmentId === assignment.id && s.status === "pass" && students.has(s.userId)).map((s) => s.userId),
      );
      out.push({ refId: assignment.id, label: assignment.title, value: passedBy.size, kind: "assignment" });
    } else {
      const exercise = db.exercises.find((x) => x.id === a.refId);
      if (!exercise) continue;
      const passedBy = new Set(
        db.exerciseSubmissions.filter((s) => s.exerciseId === exercise.id && s.status === "passed" && students.has(s.userId)).map((s) => s.userId),
      );
      out.push({ refId: exercise.id, label: exercise.title, value: passedBy.size, kind: "exercise" });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Certification (learner view)                                        */
/* ------------------------------------------------------------------ */

export interface BatchCertificationCourse {
  id: string;
  title: string;
  slug: string;
  /** Learner's course progress 0-100 (null when not enrolled). */
  progress: number | null;
  /** Verification code of the learner's certificate for this course, if issued. */
  certificateCode: string | null;
  /** The learner has an upcoming evaluation booked for this course. */
  booked: boolean;
  /** Latest evaluation outcome for this course within the batch, if any. */
  result: "pass" | "fail" | null;
}

export interface BatchCertificationInfo {
  /** Last day to schedule evaluations (batch `evaluationEndDate`). */
  deadline: { date: string; passed: boolean } | null;
  courses: BatchCertificationCourse[];
}

/**
 * Per-course certification status of one learner in a batch: issued
 * certificates, booked evaluations and results, plus the scheduling deadline
 * (compared against today in the batch timezone).
 */
export async function getBatchCertificationInfo(batch: Batch, userId: string, now: number = Date.now()): Promise<BatchCertificationInfo> {
  const db = await getDb();
  const todayKey = dayKeyInZone(now, batch.timezone);
  const courses = batch.courseIds
    .map((cid) => db.courses.find((c) => c.id === cid))
    .filter((c): c is Course => !!c)
    .map((course): BatchCertificationCourse => {
      const enrollment = db.enrollments.find((e) => e.userId === userId && e.courseId === course.id);
      const certificate =
        db.certificates.find((c) => c.userId === userId && c.courseId === course.id && c.batchId === batch.id && c.published) ??
        db.certificates.find((c) => c.userId === userId && c.courseId === course.id && c.published);
      const booked = db.certificateRequests.some((r) => r.userId === userId && r.courseId === course.id && r.status === "upcoming" && (!r.batchId || r.batchId === batch.id));
      const evaluation = db.certificateEvaluations
        .filter((e) => e.userId === userId && e.courseId === course.id && (!e.batchId || e.batchId === batch.id) && (e.status === "pass" || e.status === "fail"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        id: course.id,
        title: course.title,
        slug: course.slug,
        progress: enrollment ? Math.round(enrollment.progress) : null,
        certificateCode: certificate?.code ?? null,
        booked,
        result: evaluation ? (evaluation.status as "pass" | "fail") : null,
      };
    });
  return {
    deadline: batch.evaluationEndDate ? { date: batch.evaluationEndDate, passed: todayKey > batch.evaluationEndDate } : null,
    courses,
  };
}

export async function getBatchCertificateCount(batchId: string): Promise<number> {
  const db = await getDb();
  return db.certificates.filter((c) => c.batchId === batchId).length;
}

/* ------------------------------------------------------------------ */
/* Admin list                                                          */
/* ------------------------------------------------------------------ */

export type AdminBatchListTab = "all" | "upcoming" | "active" | "completed" | "unpublished";

export async function getAdminBatchRows(viewer: User, query: { tab: AdminBatchListTab; search?: string }): Promise<AdminBatchRow[]> {
  const db = await getDb();
  const now = Date.now();
  const search = query.search?.trim().toLowerCase();
  return db.batches
    .filter((b) => canManageBatch(viewer, b))
    .map((b): AdminBatchRow => {
      const s = buildBatchSummary(db, b, viewer, now);
      return {
        id: s.id,
        slug: s.slug,
        title: s.title,
        startDate: s.startDate,
        endDate: s.endDate,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone,
        status: s.status,
        published: s.published,
        studentCount: s.studentCount,
        seatCount: s.seatCount,
        seatsLeft: s.seatsLeft,
        paidBatch: s.paidBatch,
        amount: s.amount,
        currency: s.currency,
        instructors: s.instructors,
        courseCount: s.courseIds.length,
      };
    })
    .filter((r) => {
      if (query.tab === "upcoming" && r.status !== "upcoming") return false;
      if (query.tab === "active" && r.status !== "active") return false;
      if (query.tab === "completed" && r.status !== "completed") return false;
      if (query.tab === "unpublished" && r.published) return false;
      if (search && !`${r.title} ${r.slug}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => `${b.startDate}`.localeCompare(`${a.startDate}`));
}

/* ------------------------------------------------------------------ */
/* Pickers                                                             */
/* ------------------------------------------------------------------ */

/** Users who can be listed as batch instructors or live class hosts. */
export async function getInstructorOptions(): Promise<Option[]> {
  const db = await getDb();
  return db.users
    .filter((u) => u.enabled && u.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin" || r === "batch_evaluator"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: u.id, label: u.name, hint: u.email }));
}

/** Courses that can still be added to a batch. */
export async function getCourseOptions(batch: Batch, viewer: User): Promise<Option[]> {
  const db = await getDb();
  return db.courses
    .filter((c) => !batch.courseIds.includes(c.id))
    .filter((c) => c.published || isModerator(viewer) || c.instructorIds.includes(viewer.id) || c.createdById === viewer.id)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => ({ value: c.id, label: c.title, hint: c.published ? undefined : "Unpublished" }));
}

export interface AssessmentOptions {
  quiz: Option[];
  assignment: Option[];
  exercise: Option[];
}

/** Quizzes / assignments / exercises that can be attached (batch courses first). */
export async function getAssessmentOptions(batch: Batch): Promise<AssessmentOptions> {
  const db = await getDb();
  const taken = new Set(batch.assessments.map((a) => `${a.type}:${a.refId}`));
  const inBatch = new Set(batch.courseIds);
  const courseTitle = (id?: string) => (id ? db.courses.find((c) => c.id === id)?.title : undefined);
  const build = (type: "quiz" | "assignment" | "exercise", rows: { id: string; title: string; courseId?: string }[]): Option[] =>
    rows
      .filter((r) => !taken.has(`${type}:${r.id}`))
      .map((r) => ({
        value: r.id,
        label: r.title,
        hint: courseTitle(r.courseId),
        group: r.courseId && inBatch.has(r.courseId) ? "From this batch's courses" : "Other",
      }))
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Other" ? 1 : -1));
  return {
    quiz: build("quiz", db.quizzes),
    assignment: build("assignment", db.assignments),
    exercise: build("exercise", db.exercises),
  };
}

/** Enabled users who are not yet enrolled in the batch. */
export async function getStudentCandidates(batch: Batch): Promise<Option[]> {
  const db = await getDb();
  const enrolled = new Set(batchStudentIds(db, batch.id));
  return db.users
    .filter((u) => u.enabled && !enrolled.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ value: u.id, label: u.name, hint: u.email }));
}

export interface TimetableRefOptions {
  course: Option[];
  lesson: Option[];
  live_class: Option[];
  quiz: Option[];
  assignment: Option[];
  exercise: Option[];
}

/** Reference targets for the timetable builder. */
export async function getTimetableRefOptions(batch: Batch): Promise<TimetableRefOptions> {
  const db = await getDb();
  const courses = batch.courseIds.map((id) => db.courses.find((c) => c.id === id)).filter((c): c is Course => !!c);
  const lesson: Option[] = [];
  for (const course of courses) {
    const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    chapters.forEach((chapter, ci) => {
      db.lessons
        .filter((l) => l.chapterId === chapter.id)
        .sort((a, b) => a.order - b.order)
        .forEach((l, li) => lesson.push({ value: l.id, label: `${ci + 1}.${li + 1} ${l.title}`, group: course.title }));
    });
  }
  const assessmentTitle = (type: string, id: string) =>
    type === "quiz"
      ? db.quizzes.find((q) => q.id === id)?.title
      : type === "assignment"
        ? db.assignments.find((q) => q.id === id)?.title
        : db.exercises.find((q) => q.id === id)?.title;
  const fromAssessments = (type: "quiz" | "assignment" | "exercise"): Option[] => {
    const attached = batch.assessments.filter((a) => a.type === type).map((a) => ({ value: a.refId, label: assessmentTitle(type, a.refId) ?? "", group: "Batch assessments" }));
    const courseSet = new Set(batch.courseIds);
    const rows = type === "quiz" ? db.quizzes : type === "assignment" ? db.assignments : db.exercises;
    const others = rows
      .filter((r) => r.courseId && courseSet.has(r.courseId) && !attached.some((a) => a.value === r.id))
      .map((r) => ({ value: r.id, label: r.title, group: "From batch courses" }));
    return [...attached.filter((a) => a.label), ...others];
  };
  return {
    course: courses.map((c) => ({ value: c.id, label: c.title })),
    lesson,
    live_class: db.liveClasses
      .filter((c) => c.batchId === batch.id)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .map((c) => ({ value: c.id, label: c.title, hint: `${c.date} ${c.time}` })),
    quiz: fromAssessments("quiz"),
    assignment: fromAssessments("assignment"),
    exercise: fromAssessments("exercise"),
  };
}

/** Current server time (kept out of components so render stays pure). */
export function serverNow(): number {
  return Date.now();
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/**
 * Idempotency keys stored in `Notification.dedupeKey`. Together with the
 * recipient they identify one (batch or class, member, kind) reminder. The
 * scheduled day is part of the key, so rescheduling a batch or class to another
 * day produces a fresh reminder while page reloads never repeat one.
 */
export function batchStartReminderKey(batch: Pick<Batch, "id" | "startDate">): string {
  return `batch-start:${batch.id}:${batch.startDate}`;
}

export function liveClassReminderKey(liveClass: { id: string; date: string }): string {
  return `live-class:${liveClass.id}:${liveClass.date}`;
}

interface PendingReminder {
  key: string;
  type: NotificationType;
  subject: string;
  message: string;
  link: string;
}

/** Reminders due right now for one member, across every batch they are enrolled in. */
function collectDueReminders(db: Database, userId: string, now: number): PendingReminder[] {
  const member = db.users.find((u) => u.id === userId);
  if (!member || !member.enabled) return [];
  const batchIds = new Set(db.batchEnrollments.filter((e) => e.userId === userId).map((e) => e.batchId));
  if (!batchIds.size) return [];
  const out: PendingReminder[] = [];

  for (const batchId of batchIds) {
    const batch = db.batches.find((b) => b.id === batchId);
    if (!batch) continue;

    // The day before a published batch starts (in the batch's own timezone).
    if (batch.published && dayKeyInZone(now, batch.timezone) === shiftDayKey(batch.startDate, -1)) {
      const startsAt = batchStartsAt(batch);
      const when = Number.isNaN(startsAt)
        ? `Starts tomorrow at ${formatClock12(batch.startTime)} (${batch.timezone}).`
        : `Starts tomorrow at ${formatClock12(batch.startTime)} · ${formatTzLabel(batch.timezone, startsAt)}.`;
      out.push({
        key: batchStartReminderKey(batch),
        type: "system",
        ...(batch.showLiveClass
          ? { subject: `Your batch ${batch.title} is starting tomorrow`, message: when }
          : {
              subject: `You're enrolled in ${batch.title} – start whenever you're ready`,
              message: "Your batch opens tomorrow. Its courses and schedule are waiting for you.",
            }),
        link: `/batches/${batch.slug}`,
      });
    }

    // The day of each live class (in the class's timezone), until it ends.
    for (const c of db.liveClasses) {
      if (c.batchId !== batch.id) continue;
      if (dayKeyInZone(now, c.timezone) !== c.date) continue;
      const startsAt = zonedTimeToUtc(c.date, c.time, c.timezone);
      if (Number.isNaN(startsAt) || now > startsAt + c.durationMinutes * 60000) continue;
      out.push({
        key: liveClassReminderKey(c),
        type: "live_class",
        subject: `Live class today: ${c.title}`,
        message: `${batch.title} · ${formatClock12(c.time)} – ${formatClock12(addMinutesToClock(c.time, c.durationMinutes))} · ${formatTzLabel(c.timezone, startsAt)}`,
        link: `/batches/${batch.slug}?tab=classes#class-${c.id}`,
      });
    }
  }
  return out;
}

function sentReminderKeys(db: Database, userId: string): Set<string> {
  const sent = new Set<string>();
  for (const n of db.notifications) if (n.userId === userId && n.dedupeKey) sent.add(n.dedupeKey);
  return sent;
}

/**
 * In-app reminders for a batch member: the day before a published batch starts,
 * and on the day of each live class (until the class has ended). There is no
 * scheduler, so pages call this on load (like `closeExpiredJobs`): the batch
 * list, the batch page and the dashboard. It is idempotent: each
 * (batch or class, member, kind) reminder is sent at most once, keyed by
 * `Notification.dedupeKey`, and it only writes when something is due.
 * Returns the number of notifications created.
 */
export async function ensureBatchReminders(userId: string, now: number = Date.now()): Promise<number> {
  if (!userId) return 0;
  const db = await getDb();
  const sent = sentReminderKeys(db, userId);
  if (!collectDueReminders(db, userId, now).some((r) => !sent.has(r.key))) return 0;

  const created = await mutate((d) => {
    // Re-check inside the serialized write so concurrent page loads cannot double-send.
    const already = sentReminderKeys(d, userId);
    const stamp = new Date(now).toISOString();
    const rows: Notification[] = [];
    for (const r of collectDueReminders(d, userId, now)) {
      if (already.has(r.key)) continue;
      already.add(r.key);
      const n: Notification = {
        id: uid("ntf"),
        userId,
        type: r.type,
        subject: r.subject,
        message: r.message,
        link: r.link,
        read: false,
        dedupeKey: r.key,
        createdAt: stamp,
      };
      d.notifications.push(n);
      rows.push(n);
    }
    return rows;
  });
  // Email copies (Settings → Email and each member's preferences decide); never throws.
  if (created.length) await sendNotificationEmails(created);
  return created.length;
}
