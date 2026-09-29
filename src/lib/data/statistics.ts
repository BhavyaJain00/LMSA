import "server-only";
import type { User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { hasRole, isModerator } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { batchStatus, type BatchStatus } from "@/lib/data/dashboard";
import { classWindow } from "@/components/dashboard/time";
import { addDays, percent, sum, toDateKey } from "@/lib/utils";

export const STAT_RANGES = [30, 90, 365] as const;
export type StatRange = (typeof STAT_RANGES)[number];

export function parseStatRange(raw: string | string[] | undefined): StatRange {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (STAT_RANGES as readonly number[]).includes(n) ? (n as StatRange) : 30;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface CourseStatRow {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  upcoming: boolean;
  status: string;
  lessons: number;
  enrollments: number;
  enrollmentsInRange: number;
  completions: number;
  completionRate: number;
  averageProgress: number;
  averageRating: number | null;
  reviewCount: number;
  certificates: number;
}

export interface BatchStatRow {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  status: BatchStatus;
  startDate: string;
  endDate: string;
  students: number;
  seats: number;
  courses: number;
  liveClasses: number;
  liveClassesHeld: number;
  assessments: number;
  feedbackAverage: number | null;
  feedbackCount: number;
}

export interface CategoryStat {
  id: string;
  name: string;
  courses: number;
  enrollments: number;
}

export interface StatisticsData {
  range: StatRange;
  /**
   * True for moderators and course creators. Only they receive the per-course
   * and per-batch drill-down tables; everyone else gets the aggregates.
   */
  detailed: boolean;
  kpis: {
    courses: number;
    users: number;
    enrollments: number;
    completions: number;
    certifications: number;
  };
  inRange: {
    courses: number;
    users: number;
    enrollments: number;
    completions: number;
    certifications: number;
  };
  series: {
    signups: SeriesPoint[];
    enrollments: SeriesPoint[];
    completions: SeriesPoint[];
    certifications: SeriesPoint[];
  };
  completion: { completed: number; inProgress: number };
  topCourses: { id: string; slug: string; title: string; enrollments: number; enrollmentsInRange: number }[];
  categories: CategoryStat[];
  batches: BatchStatRow[];
  courses: CourseStatRow[];
}

function dayKey(iso: string | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toDateKey(d);
}

function buildSeries(keys: string[], dates: (string | null)[]): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const d of dates) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  return keys.map((date) => ({ date, value: counts.get(date) ?? 0 }));
}

/**
 * Site-wide analytics. Anyone the sidebar offers Statistics to (members, and
 * guests when guest access is on) gets the aggregate KPIs and charts, which
 * only count published courses in the rankings. Moderators and course creators
 * also get the course and batch drill-down tables, limited to what they may see.
 * Charts use a daily grain over the selected range; KPI totals are all-time
 * (as in Frappe).
 */
export async function getStatistics(viewer: Pick<User, "id" | "roles"> | null, range: StatRange): Promise<StatisticsData> {
  const db = await getDb();
  const moderator = isModerator(viewer);
  const detailed = hasRole(viewer, "moderator", "course_creator");
  const now = new Date();
  const keys: string[] = [];
  for (let i = range - 1; i >= 0; i--) keys.push(toDateKey(addDays(now, -i)));
  const firstKey = keys[0]!;
  const inRange = (key: string | null) => !!key && key >= firstKey;

  const studentEnrollments = db.enrollments.filter((e) => e.memberType === "student");
  const completedEnrollments = studentEnrollments.filter((e) => e.completedAt || e.progress >= 100);
  const activeUsers = db.users.filter((u) => u.enabled);
  const publishedCertificates = db.certificates.filter((c) => c.published);

  const signupDates = activeUsers.map((u) => dayKey(u.createdAt));
  const enrollmentDates = studentEnrollments.map((e) => dayKey(e.enrolledAt));
  const completionDates = completedEnrollments.map((e) => dayKey(e.completedAt));
  const certificateDates = publishedCertificates.map((c) => dayKey(c.issueDate));

  /* Course table */
  const visibleCourses = db.courses.filter((c) => c.published || (detailed && (moderator || canManageCourse(viewer, c))));
  const courses: CourseStatRow[] = visibleCourses
    .map((course) => {
      const enrollments = studentEnrollments.filter((e) => e.courseId === course.id);
      const completions = enrollments.filter((e) => e.completedAt || e.progress >= 100).length;
      const reviews = db.reviews.filter((r) => r.courseId === course.id);
      return {
        id: course.id,
        slug: course.slug,
        title: course.title,
        published: course.published,
        upcoming: course.upcoming,
        status: course.status,
        lessons: db.lessons.filter((l) => l.courseId === course.id).length,
        enrollments: enrollments.length,
        enrollmentsInRange: enrollments.filter((e) => inRange(dayKey(e.enrolledAt))).length,
        completions,
        completionRate: percent(completions, enrollments.length),
        averageProgress: enrollments.length ? Math.round(sum(enrollments.map((e) => e.progress)) / enrollments.length) : 0,
        averageRating: reviews.length ? Math.round((sum(reviews.map((r) => r.rating)) / reviews.length) * 10) / 10 : null,
        reviewCount: reviews.length,
        certificates: publishedCertificates.filter((c) => c.courseId === course.id).length,
      };
    })
    .sort((a, b) => b.enrollments - a.enrollments || a.title.localeCompare(b.title));

  const topCourses = courses
    .filter((c) => c.enrollments > 0)
    .slice(0, 10)
    .map((c) => ({ id: c.id, slug: c.slug, title: c.title, enrollments: c.enrollments, enrollmentsInRange: c.enrollmentsInRange }));

  /* Categories */
  const categoryMap = new Map<string, CategoryStat>();
  for (const cat of db.categories) categoryMap.set(cat.id, { id: cat.id, name: cat.name, courses: 0, enrollments: 0 });
  const uncategorized: CategoryStat = { id: "none", name: "Uncategorized", courses: 0, enrollments: 0 };
  for (const course of db.courses.filter((c) => c.published)) {
    const bucket = (course.categoryId && categoryMap.get(course.categoryId)) || uncategorized;
    bucket.courses++;
    bucket.enrollments += studentEnrollments.filter((e) => e.courseId === course.id).length;
  }
  const categories = [...categoryMap.values(), uncategorized]
    .filter((c) => c.courses > 0)
    .sort((a, b) => b.enrollments - a.enrollments || b.courses - a.courses);

  /* Batches */
  const nowMs = now.getTime();
  const viewerId = viewer?.id ?? "";
  const visibleBatches = detailed ? db.batches.filter((b) => b.published || moderator || b.instructorIds.includes(viewerId) || b.createdById === viewerId) : [];
  const batches: BatchStatRow[] = visibleBatches
    .map((batch) => {
      const classes = db.liveClasses.filter((lc) => lc.batchId === batch.id);
      const feedback = db.batchFeedback.filter((f) => f.batchId === batch.id);
      const feedbackScores = feedback.map((f) => (f.contentRating + f.instructorsRating + f.valueRating) / 3);
      return {
        id: batch.id,
        slug: batch.slug,
        title: batch.title,
        published: batch.published,
        status: batchStatus(batch),
        startDate: batch.startDate,
        endDate: batch.endDate,
        students: db.batchEnrollments.filter((e) => e.batchId === batch.id).length,
        seats: batch.seatCount,
        courses: batch.courseIds.length,
        liveClasses: classes.length,
        liveClassesHeld: classes.filter((lc) => classWindow(lc).end.getTime() < nowMs).length,
        assessments: batch.assessments.length,
        feedbackAverage: feedbackScores.length ? Math.round((sum(feedbackScores) / feedbackScores.length) * 10) / 10 : null,
        feedbackCount: feedback.length,
      };
    })
    .sort((a, b) => {
      const rank: Record<BatchStatus, number> = { active: 0, upcoming: 1, completed: 2 };
      return rank[a.status] - rank[b.status] || b.startDate.localeCompare(a.startDate);
    });

  return {
    range,
    detailed,
    kpis: {
      courses: db.courses.filter((c) => c.published && !c.upcoming).length,
      users: activeUsers.length,
      enrollments: studentEnrollments.length,
      completions: completedEnrollments.length,
      certifications: publishedCertificates.length,
    },
    inRange: {
      courses: db.courses.filter((c) => c.published && !c.upcoming && inRange(dayKey(c.publishedOn))).length,
      users: signupDates.filter(inRange).length,
      enrollments: enrollmentDates.filter(inRange).length,
      completions: completionDates.filter(inRange).length,
      certifications: certificateDates.filter(inRange).length,
    },
    series: {
      signups: buildSeries(keys, signupDates),
      enrollments: buildSeries(keys, enrollmentDates),
      completions: buildSeries(keys, completionDates),
      certifications: buildSeries(keys, certificateDates),
    },
    completion: {
      completed: completedEnrollments.length,
      inProgress: studentEnrollments.length - completedEnrollments.length,
    },
    topCourses,
    categories,
    batches,
    courses: detailed ? courses : [],
  };
}
