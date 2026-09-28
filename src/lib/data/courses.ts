import "server-only";
import type {
  Category,
  Chapter,
  ChapterWithLessons,
  Course,
  CourseProgressSummary,
  CourseSummary,
  Enrollment,
  Lesson,
  LessonWithState,
  PublicUser,
  User,
} from "@/lib/types";
import { all, findById, findOne, getDb } from "@/lib/db/store";
import { hasRole, isModerator } from "@/lib/auth/session";
import { getUserMap } from "./users";
import { percent } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export async function getCourseBySlug(slug: string): Promise<Course | null> {
  return findOne("courses", (c) => c.slug === slug);
}

export async function getCourseById(id: string): Promise<Course | null> {
  return findById("courses", id);
}

export async function getCategories(): Promise<Category[]> {
  const cats = await all("categories");
  return [...cats].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getChapters(courseId: string): Promise<Chapter[]> {
  const chapters = await all("chapters");
  return chapters.filter((c) => c.courseId === courseId).sort((a, b) => a.order - b.order);
}

export async function getLessons(courseId: string): Promise<Lesson[]> {
  const lessons = await all("lessons");
  return lessons.filter((l) => l.courseId === courseId).sort((a, b) => a.order - b.order);
}

export async function getLessonById(id: string): Promise<Lesson | null> {
  return findById("lessons", id);
}

export async function getEnrollment(userId: string | undefined | null, courseId: string): Promise<Enrollment | null> {
  if (!userId) return null;
  return findOne("enrollments", (e) => e.userId === userId && e.courseId === courseId);
}

/** Whether a user can manage (edit) a course. */
export function canManageCourse(user: Pick<User, "id" | "roles"> | null | undefined, course: Course): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  return hasRole(user, "course_creator") && (course.instructorIds.includes(user.id) || course.createdById === user.id);
}

/** Whether a user can view a course page at all. */
export function canViewCourse(user: Pick<User, "id" | "roles"> | null | undefined, course: Course): boolean {
  if (course.published) return true;
  return canManageCourse(user, course);
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export interface CourseFilter {
  search?: string;
  categoryId?: string;
  /** "live" = published & not upcoming, "upcoming", "new" (last 30 days), "enrolled", "created", "all" */
  tab?: "live" | "upcoming" | "new" | "enrolled" | "created" | "all";
  includeUnpublished?: boolean;
  instructorId?: string;
  featured?: boolean;
  free?: boolean;
  sort?: "newest" | "popular" | "rating" | "title";
}

export async function getCourseSummaries(viewer: User | null, filter: CourseFilter = {}): Promise<CourseSummary[]> {
  const db = await getDb();
  const users = await getUserMap();
  const categories = new Map(db.categories.map((c) => [c.id, c]));

  const lessonCounts = new Map<string, { count: number; duration: number; chapters: Set<string> }>();
  for (const l of db.lessons) {
    const entry = lessonCounts.get(l.courseId) ?? { count: 0, duration: 0, chapters: new Set<string>() };
    entry.count++;
    entry.duration += l.durationSeconds;
    entry.chapters.add(l.chapterId);
    lessonCounts.set(l.courseId, entry);
  }
  const enrollmentCounts = new Map<string, number>();
  const viewerEnrollments = new Map<string, Enrollment>();
  for (const e of db.enrollments) {
    if (e.memberType === "student") enrollmentCounts.set(e.courseId, (enrollmentCounts.get(e.courseId) ?? 0) + 1);
    if (viewer && e.userId === viewer.id) viewerEnrollments.set(e.courseId, e);
  }
  const ratings = new Map<string, { sum: number; n: number }>();
  for (const r of db.reviews) {
    const entry = ratings.get(r.courseId) ?? { sum: 0, n: 0 };
    entry.sum += r.rating;
    entry.n++;
    ratings.set(r.courseId, entry);
  }

  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const search = filter.search?.trim().toLowerCase();

  let list = db.courses.filter((c) => {
    if (!c.published && !filter.includeUnpublished && !canManageCourse(viewer, c)) return false;
    if (filter.tab === "live" && (!c.published || c.upcoming)) return false;
    if (filter.tab === "upcoming" && (!c.published || !c.upcoming)) return false;
    if (filter.tab === "new" && (!c.published || !c.publishedOn || new Date(c.publishedOn).getTime() < thirtyDaysAgo)) return false;
    if (filter.tab === "enrolled" && !viewerEnrollments.has(c.id)) return false;
    if (filter.tab === "created" && !(viewer && (c.instructorIds.includes(viewer.id) || c.createdById === viewer.id))) return false;
    if (filter.tab === "all" && !c.published && !canManageCourse(viewer, c)) return false;
    if (filter.categoryId && c.categoryId !== filter.categoryId) return false;
    if (filter.instructorId && !c.instructorIds.includes(filter.instructorId)) return false;
    if (filter.featured && !c.featured) return false;
    if (filter.free && c.paidCourse) return false;
    if (search) {
      const hay = `${c.title} ${c.shortIntroduction} ${c.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const summaries: CourseSummary[] = list.map((c) => {
    const lc = lessonCounts.get(c.id);
    const rt = ratings.get(c.id);
    const enrollment = viewerEnrollments.get(c.id) ?? null;
    return {
      ...c,
      instructors: c.instructorIds.map((id) => users.get(id)).filter((u): u is PublicUser => !!u),
      category: c.categoryId ? (categories.get(c.categoryId) ?? null) : null,
      lessonCount: lc?.count ?? 0,
      chapterCount: lc?.chapters.size ?? 0,
      totalDurationSeconds: lc?.duration ?? 0,
      enrollmentCount: enrollmentCounts.get(c.id) ?? 0,
      averageRating: rt && rt.n ? Math.round((rt.sum / rt.n) * 10) / 10 : null,
      reviewCount: rt?.n ?? 0,
      enrollment,
      progress: enrollment?.progress,
    };
  });

  const sort = filter.sort ?? "newest";
  summaries.sort((a, b) => {
    if (sort === "popular") return b.enrollmentCount - a.enrollmentCount;
    if (sort === "rating") return (b.averageRating ?? 0) - (a.averageRating ?? 0);
    if (sort === "title") return a.title.localeCompare(b.title);
    // newest: featured first, then by publishedOn/createdAt desc
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.publishedOn ?? b.createdAt).localeCompare(a.publishedOn ?? a.createdAt);
  });
  list = [];
  return summaries;
}

export async function getCourseSummary(courseId: string, viewer: User | null): Promise<CourseSummary | null> {
  const list = await getCourseSummaries(viewer, { includeUnpublished: true, tab: "all" });
  return list.find((c) => c.id === courseId) ?? null;
}

/* ------------------------------------------------------------------ */
/* Outline with per-viewer state                                        */
/* ------------------------------------------------------------------ */

export function lessonFlags(lesson: Lesson) {
  return {
    hasVideo: lesson.blocks.some((b) => b.type === "video"),
    hasQuiz: lesson.blocks.some((b) => b.type === "quiz"),
    hasAssignment: lesson.blocks.some((b) => b.type === "assignment"),
    hasExercise: lesson.blocks.some((b) => b.type === "exercise"),
  };
}

/**
 * Build the chapter/lesson tree for a course with completion and locking
 * computed for the viewer.
 *
 * Locking rules (mirrors Frappe LMS):
 *  - Course managers see everything unlocked.
 *  - Guests / non-enrolled users can open only preview lessons.
 *  - With `enforceLessonCompletion`, a lesson unlocks only when every
 *    previous lesson (in order) is complete.
 */
export async function getCourseOutline(course: Course, viewer: User | null): Promise<ChapterWithLessons[]> {
  const [chapters, lessons, db] = await Promise.all([getChapters(course.id), getLessons(course.id), getDb()]);
  const enrollment = viewer ? await getEnrollment(viewer.id, course.id) : null;
  const manager = canManageCourse(viewer, course);
  const progressMap = new Map<string, "complete" | "partial" | "incomplete">();
  if (viewer) {
    for (const p of db.progress) if (p.userId === viewer.id && p.courseId === course.id) progressMap.set(p.lessonId, p.status);
  }

  let previousAllComplete = true;
  return chapters.map((chapter, ci) => {
    const chapterLessons = lessons
      .filter((l) => l.chapterId === chapter.id)
      .map((lesson, li): LessonWithState => {
        const status = progressMap.get(lesson.id) ?? "incomplete";
        let locked = false;
        if (!manager) {
          if (!enrollment) locked = !lesson.includeInPreview;
          else if (course.enforceLessonCompletion) locked = !previousAllComplete;
        }
        if (status !== "complete") previousAllComplete = false;
        return {
          ...lesson,
          status,
          locked,
          chapterNumber: ci + 1,
          lessonNumber: li + 1,
          ...lessonFlags(lesson),
        };
      });
    return { ...chapter, lessons: chapterLessons };
  });
}

export function flattenOutline(outline: ChapterWithLessons[]): LessonWithState[] {
  return outline.flatMap((c) => c.lessons);
}

export function findLessonByNumbers(outline: ChapterWithLessons[], chapterNumber: number, lessonNumber: number): LessonWithState | null {
  const chapter = outline[chapterNumber - 1];
  return chapter?.lessons[lessonNumber - 1] ?? null;
}

/** Parse "2-3" into chapter/lesson numbers. */
export function parseLessonRef(ref: string): { chapterNumber: number; lessonNumber: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(ref);
  if (!m) return null;
  return { chapterNumber: Number(m[1]), lessonNumber: Number(m[2]) };
}

export function lessonHref(courseSlug: string, lesson: { chapterNumber: number; lessonNumber: number }): string {
  return `/courses/${courseSlug}/learn/${lesson.chapterNumber}-${lesson.lessonNumber}`;
}

/** Resolve a lesson id to its learn URL (`/courses/<slug>/learn/<chapter>-<lesson>`). */
export async function getLessonHref(lessonId: string | undefined | null): Promise<string | null> {
  if (!lessonId) return null;
  const db = await getDb();
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

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export async function getCourseProgress(userId: string, courseId: string): Promise<CourseProgressSummary> {
  const db = await getDb();
  const lessons = db.lessons.filter((l) => l.courseId === courseId);
  const completed = db.progress.filter((p) => p.userId === userId && p.courseId === courseId && p.status === "complete").length;
  const enrollment = db.enrollments.find((e) => e.userId === userId && e.courseId === courseId);
  return {
    courseId,
    totalLessons: lessons.length,
    completedLessons: completed,
    percent: percent(completed, lessons.length),
    completed: lessons.length > 0 && completed >= lessons.length,
    currentLessonId: enrollment?.currentLessonId,
  };
}

/** First incomplete lesson (or the first lesson) for "continue learning". */
export async function getNextLesson(course: Course, viewer: User | null): Promise<LessonWithState | null> {
  const outline = await getCourseOutline(course, viewer);
  const flat = flattenOutline(outline);
  if (!flat.length) return null;
  const enrollment = viewer ? await getEnrollment(viewer.id, course.id) : null;
  if (enrollment?.currentLessonId) {
    const current = flat.find((l) => l.id === enrollment.currentLessonId);
    if (current && current.status !== "complete") return current;
  }
  return flat.find((l) => l.status !== "complete" && !l.locked) ?? flat[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export async function getCourseReviews(courseId: string) {
  const db = await getDb();
  const users = await getUserMap();
  return db.reviews
    .filter((r) => r.courseId === courseId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({ ...r, user: users.get(r.userId) ?? null }));
}

export async function getRatingBreakdown(courseId: string): Promise<{ average: number | null; count: number; buckets: Record<1 | 2 | 3 | 4 | 5, number> }> {
  const db = await getDb();
  const reviews = db.reviews.filter((r) => r.courseId === courseId);
  const buckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let sum = 0;
  for (const r of reviews) {
    buckets[r.rating]++;
    sum += r.rating;
  }
  return { average: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : null, count: reviews.length, buckets };
}
