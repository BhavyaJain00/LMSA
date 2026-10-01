import "server-only";
import type {
  Category,
  Chapter,
  ChapterWithLessons,
  Course,
  CourseProgressSummary,
  CourseSummary,
  Database,
  Enrollment,
  Lesson,
  LessonWithState,
  ProgressStatus,
  PublicUser,
  User,
} from "@/lib/types";
import { all, findById, findOne, getDb } from "@/lib/db/store";
import { hasRole, isModerator } from "@/lib/auth/session";
import { getUserMap } from "./users";
import { isLessonPublishedNow, isPublishedNow } from "@/lib/teaching/scheduling";
import { percent } from "@/lib/utils";
import {
  computeLessonLocks,
  dripAnchor,
  pickContinueLesson,
  resolvePrerequisites,
  unmetPrerequisites,
  type LessonLock,
  type PrerequisiteItem,
} from "@/components/learn/drip-shared";

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
  if (isPublishedNow(course)) return true;
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
    // Scheduled publishing: a course whose publish time has passed is public now (see teaching/scheduling.ts).
    const published = isPublishedNow(c);
    if (!published && !filter.includeUnpublished && !canManageCourse(viewer, c)) return false;
    if (filter.tab === "live" && (!published || c.upcoming)) return false;
    if (filter.tab === "upcoming" && (!published || !c.upcoming)) return false;
    if (filter.tab === "new" && (!published || (!c.publishedOn && !c.publishAt) || new Date(c.publishedOn ?? c.publishAt!).getTime() < thirtyDaysAgo)) return false;
    if (filter.tab === "enrolled" && !viewerEnrollments.has(c.id)) return false;
    if (filter.tab === "created" && !(viewer && (c.instructorIds.includes(viewer.id) || c.createdById === viewer.id))) return false;
    if (filter.tab === "all" && !published && !canManageCourse(viewer, c)) return false;
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

/** A lesson of the viewer outline with the reason it is locked (drip, order, enroll, prerequisite). */
export interface ScheduledLesson extends LessonWithState {
  /** Set when `locked`: why, and for drip locks when the lesson opens. */
  lock?: LessonLock;
}

export interface ScheduledChapter extends ChapterWithLessons {
  lessons: ScheduledLesson[];
}

/** Everything about a viewer's relationship with a course that locking depends on. */
export interface ViewerCourseState {
  enrollment: Enrollment | null;
  /** Instructor of the course, moderator or admin. */
  manager: boolean;
  enrolled: boolean;
  /** Free-preview lessons are open to non-enrolled viewers (published course + guest access on). */
  previewAllowed: boolean;
  /** Epoch ms drip days count from (enrollment or batch start); null when not enrolled. */
  anchor: number | null;
  /** Prerequisite courses with the viewer's status (empty when the course has none). */
  prerequisites: PrerequisiteItem[];
  /**
   * A logged-in visitor must still complete prerequisites before enrolling
   * (never for managers, enrolled learners, batch-only courses or learners who
   * already paid for the course).
   */
  prerequisitesPending: boolean;
}

/** Resolve the viewer state used by the outline, the course page and access checks. */
export function getViewerCourseState(db: Database, course: Course, viewer: Pick<User, "id" | "roles"> | null): ViewerCourseState {
  const enrollment = viewer ? (db.enrollments.find((e) => e.userId === viewer.id && e.courseId === course.id) ?? null) : null;
  const manager = canManageCourse(viewer, course);
  const batch = enrollment?.batchId ? db.batches.find((b) => b.id === enrollment.batchId) : null;
  const anchor = enrollment ? dripAnchor(enrollment, batch) : null;
  const prerequisites = resolvePrerequisites(course.prerequisiteCourseIds, db, viewer?.id ?? null, course.id);
  const paid = !!viewer && db.payments.some((p) => p.userId === viewer.id && p.itemType === "course" && p.itemId === course.id && p.status === "paid");
  const prerequisitesPending =
    !!viewer && !manager && !enrollment && !course.disableSelfLearning && !paid && unmetPrerequisites(prerequisites).length > 0;
  return {
    enrollment,
    manager,
    enrolled: !!enrollment,
    previewAllowed: course.published && db.settings.learning.allowGuestAccess,
    anchor: anchor !== null && Number.isFinite(anchor) ? anchor : null,
    prerequisites,
    prerequisitesPending,
  };
}

/** One lesson of a course in outline order, with the viewer's status and lock. */
export interface ViewerLesson {
  lesson: Lesson;
  chapter: Chapter;
  /** 0-based chapter position (chapter number - 1). */
  ci: number;
  /** 0-based position within the chapter (lesson number - 1). */
  li: number;
  status: ProgressStatus;
  /** Why the viewer can't open the lesson right now; null when it is open. */
  lock: LessonLock | null;
}

/**
 * Every lesson of `course` in outline order (chapters, then lessons) with the
 * viewer's progress status and lock, computed synchronously from a database
 * snapshot. `getCourseOutline` is built on it; code that already holds the
 * database and must not await (inside `mutate`, other synchronous read
 * models) uses it directly so it applies exactly the same locking rules.
 *
 * Locking rules (Frappe LMS plus round-2 drip content; see drip-shared.ts):
 *  - Course managers see everything unlocked.
 *  - Guests / non-enrolled users can open only free-preview lessons (when the
 *    course is published and guest access is on). Logged-in visitors who still
 *    have prerequisite courses to finish get the "prerequisite" reason.
 *  - Scheduled lessons (chapter/lesson `availableFrom`, and for enrolled
 *    learners `dripDays` after enrollment or batch start) stay locked until
 *    their release time. `availableFrom` also applies to free previews.
 *  - With `enforceLessonCompletion`, an incomplete lesson unlocks only when
 *    every previous lesson (in order) is complete.
 *  - Completed lessons never lock.
 */
export function computeViewerLessons(
  db: Database,
  course: Course,
  viewer: Pick<User, "id" | "roles"> | null,
  now: number,
): { state: ViewerCourseState; chapters: Chapter[]; lessons: ViewerLesson[] } {
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const state = getViewerCourseState(db, course, viewer);
  const lessonsByChapter = new Map<string, Lesson[]>();
  for (const lesson of db.lessons) {
    if (lesson.courseId !== course.id) continue;
    const list = lessonsByChapter.get(lesson.chapterId) ?? [];
    list.push(lesson);
    lessonsByChapter.set(lesson.chapterId, list);
  }
  for (const list of lessonsByChapter.values()) list.sort((a, b) => a.order - b.order);

  const progressMap = new Map<string, ProgressStatus>();
  if (viewer) {
    for (const p of db.progress) if (p.userId === viewer.id && p.courseId === course.id) progressMap.set(p.lessonId, p.status);
  }

  const ordered: { lesson: Lesson; chapter: Chapter; ci: number; li: number; status: ProgressStatus }[] = [];
  chapters.forEach((chapter, ci) =>
    (lessonsByChapter.get(chapter.id) ?? []).forEach((lesson, li) => {
      // Scheduled lessons stay out of a learner's outline until their publish time (managers see them).
      // Numbering counts them, so lesson links stay the same when they appear.
      if (!state.manager && !isLessonPublishedNow(lesson, now)) return;
      ordered.push({ lesson, chapter, ci, li, status: progressMap.get(lesson.id) ?? "incomplete" });
    }),
  );

  const locks = computeLessonLocks(
    ordered.map(({ lesson, chapter, status }) => ({
      id: lesson.id,
      status,
      includeInPreview: lesson.includeInPreview,
      dripDays: lesson.dripDays,
      availableFrom: lesson.availableFrom,
      chapter: { dripDays: chapter.dripDays, availableFrom: chapter.availableFrom },
    })),
    {
      manager: state.manager,
      enrolled: state.enrolled,
      previewAllowed: state.previewAllowed,
      enforceOrder: course.enforceLessonCompletion,
      anchor: state.anchor,
      prerequisitesPending: state.prerequisitesPending,
      now,
    },
  );

  return { state, chapters, lessons: ordered.map((row, i) => ({ ...row, lock: locks[i] ?? null })) };
}

/**
 * Build the chapter/lesson tree for a course with completion and locking
 * computed for the viewer (rules: see `computeViewerLessons`).
 */
export async function getCourseOutline(course: Course, viewer: User | null, now: number = Date.now()): Promise<ScheduledChapter[]> {
  const db = await getDb();
  const { chapters, lessons } = computeViewerLessons(db, course, viewer, now);

  const byChapter = new Map<string, ScheduledLesson[]>();
  for (const { lesson, chapter, ci, li, status, lock } of lessons) {
    const row: ScheduledLesson = {
      ...lesson,
      status,
      locked: !!lock,
      ...(lock ? { lock } : {}),
      chapterNumber: ci + 1,
      lessonNumber: li + 1,
      ...lessonFlags(lesson),
    };
    const list = byChapter.get(chapter.id) ?? [];
    list.push(row);
    byChapter.set(chapter.id, list);
  }

  return chapters.map((chapter) => ({ ...chapter, lessons: byChapter.get(chapter.id) ?? [] }));
}

export function flattenOutline<L extends LessonWithState>(outline: { lessons: L[] }[]): L[] {
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

/**
 * Lesson for "continue learning": the lesson the learner last opened (when it
 * is still open and incomplete), else the first open incomplete lesson. Never
 * a locked lesson, and never a finished lesson while later content is still
 * scheduled: a learner who has completed everything released so far gets
 * null, so callers fall back to the course page, which shows when the next
 * lesson unlocks ("Next lesson is scheduled"). Once the whole course is done,
 * the first lesson (for review). See `pickContinueLesson`.
 */
export async function getNextLesson(course: Course, viewer: User | null): Promise<ScheduledLesson | null> {
  const flat = flattenOutline(await getCourseOutline(course, viewer));
  if (!flat.length) return null;
  const enrollment = viewer ? await getEnrollment(viewer.id, course.id) : null;
  return pickContinueLesson(flat, enrollment?.currentLessonId);
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
