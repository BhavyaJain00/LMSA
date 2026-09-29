import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Course, Database, Lesson, LessonBlock, LessonBlockType, PublicUser, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isModerator, requireUser, toPublicUser } from "@/lib/auth/session";
import { canManageCourse, lessonHref } from "@/lib/data/courses";
import { getUserMap, listEvaluators, listInstructors } from "@/lib/data/users";
import { formatDate, percent, relativeTime, sum } from "@/lib/utils";
import type {
  AdminCourseList,
  AdminCourseRow,
  AdminCourseTab,
  AnnouncementRow,
  AssessmentOptions,
  CourseDashboardData,
  CourseExportFile,
  CourseExportSummary,
  CourseFormOptions,
  DashboardStudent,
  EnrollCandidate,
  LessonCompletionStat,
  LessonEditorNavChapter,
  OutlineChapter,
  OutlineLesson,
  ProgressBucket,
  StudentAssessmentRow,
  StudentProgressDetail,
  StudentQuizRow,
  VideoStat,
  WorkflowFlags,
} from "@/components/admin/courses/types";

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export const ADMIN_COURSE_TABS: AdminCourseTab[] = ["all", "published", "unpublished", "under_review", "mine"];

export function isCourseTab(value: unknown): value is AdminCourseTab {
  return typeof value === "string" && (ADMIN_COURSE_TABS as string[]).includes(value);
}

/**
 * Review/publish workflow rules:
 *  - creators save → course is "in_progress"; they can submit it for review
 *  - moderators approve reviewed courses ("approved") or send them back
 *  - only approved courses can be published; moderators may publish directly
 */
export function getWorkflowFlags(user: Pick<User, "id" | "roles"> | null, course: Course): WorkflowFlags {
  const canEdit = canManageCourse(user, course);
  const moderator = isModerator(user);
  return {
    canEdit,
    isModerator: moderator,
    canPublish: canEdit && !course.published && (moderator || course.status === "approved"),
    canUnpublish: canEdit && course.published,
    canSubmitForReview: canEdit && !moderator && !course.published && course.status === "in_progress",
    canApprove: moderator && course.status === "under_review",
    canRequestChanges: moderator && course.status === "under_review",
    canDelete: canEdit,
  };
}

/** Course slugs that would collide with the /courses/... and /admin/courses/... routes. */
export const RESERVED_COURSE_SLUGS: readonly string[] = ["new", "import", "edit", "learn"];

/** Roles allowed to evaluate certificates for a course. */
export function canEvaluateCertificates(user: Pick<User, "roles"> | undefined | null): boolean {
  return !!user && user.roles.some((r) => r === "batch_evaluator" || r === "moderator" || r === "admin");
}

/** Appended to success messages when a content edit sent the course back to "in_progress". */
export const REVIEW_RESET_NOTE = "The course moved back to In progress, so submit it for review again when you're ready.";

/**
 * Record a content change on a course inside a mutate() call. Edits by a
 * non-moderator to an unpublished course invalidate a pending or granted
 * review, so the course goes back to "in_progress" and must be re-submitted.
 * Returns true when the review was reset.
 */
export function touchCourseContent(db: Pick<Database, "courses">, courseId: string, user: Pick<User, "roles">): boolean {
  const row = db.courses.find((c) => c.id === courseId);
  if (!row) return false;
  row.updatedAt = new Date().toISOString();
  if (isModerator(user) || row.published || row.status === "in_progress") return false;
  row.status = "in_progress";
  return true;
}

/** Success message, plus the review-reset note when it applies. */
export function withReviewNote(message: string, reviewReset: boolean): string {
  return reviewReset ? `${message}. ${REVIEW_RESET_NOTE}` : message;
}

/** Whether the viewer may create courses at all. */
export function canCreateCourses(user: Pick<User, "roles"> | null): boolean {
  if (!user) return false;
  return user.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin");
}

/**
 * Load a course the current user may manage, or bail out with the right
 * response (login redirect, 404, or forbidden).
 */
export async function requireManageableCourse(courseId: string, nextPath: string): Promise<{ user: User; course: Course }> {
  const user = await requireUser(nextPath);
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) notFound();
  if (!canManageCourse(user, course)) redirect("/forbidden");
  return { user, course };
}

/* ------------------------------------------------------------------ */
/* Course list                                                         */
/* ------------------------------------------------------------------ */

function matchesTab(course: Course, tab: AdminCourseTab, viewer: User): boolean {
  switch (tab) {
    case "published":
      return course.published;
    case "unpublished":
      return !course.published;
    case "under_review":
      return course.status === "under_review";
    case "mine":
      return course.instructorIds.includes(viewer.id) || course.createdById === viewer.id;
    default:
      return true;
  }
}

export async function getAdminCourseList(viewer: User, opts: { tab: AdminCourseTab; search?: string }): Promise<AdminCourseList> {
  const db = await getDb();
  const users = await getUserMap();
  const categories = new Map(db.categories.map((c) => [c.id, c.name]));
  const moderator = isModerator(viewer);
  const search = opts.search?.trim().toLowerCase() ?? "";

  const lessonCounts = new Map<string, number>();
  for (const l of db.lessons) lessonCounts.set(l.courseId, (lessonCounts.get(l.courseId) ?? 0) + 1);
  const chapterCounts = new Map<string, number>();
  for (const c of db.chapters) chapterCounts.set(c.courseId, (chapterCounts.get(c.courseId) ?? 0) + 1);
  const enrollmentCounts = new Map<string, number>();
  for (const e of db.enrollments) {
    if (e.memberType === "student") enrollmentCounts.set(e.courseId, (enrollmentCounts.get(e.courseId) ?? 0) + 1);
  }

  // Moderators see everything; creators see published courses plus the ones they manage.
  const visible = db.courses.filter((c) => {
    if (!moderator && !c.published && !canManageCourse(viewer, c)) return false;
    if (!search) return true;
    const instructorNames = c.instructorIds.map((id) => users.get(id)?.name ?? "").join(" ");
    const hay = `${c.title} ${c.slug} ${c.shortIntroduction} ${c.tags.join(" ")} ${instructorNames}`.toLowerCase();
    return hay.includes(search);
  });

  const counts = Object.fromEntries(ADMIN_COURSE_TABS.map((t) => [t, visible.filter((c) => matchesTab(c, t, viewer)).length])) as Record<
    AdminCourseTab,
    number
  >;

  const rows: AdminCourseRow[] = visible
    .filter((c) => matchesTab(c, opts.tab, viewer))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      shortIntroduction: c.shortIntroduction,
      imageUrl: c.imageUrl,
      cardGradient: c.cardGradient,
      published: c.published,
      upcoming: c.upcoming,
      featured: c.featured,
      paidCourse: c.paidCourse,
      price: c.price,
      currency: c.currency,
      status: c.status,
      category: c.categoryId ? (categories.get(c.categoryId) ?? null) : null,
      instructors: c.instructorIds.map((id) => users.get(id)).filter((u): u is PublicUser => !!u),
      chapterCount: chapterCounts.get(c.id) ?? 0,
      lessonCount: lessonCounts.get(c.id) ?? 0,
      enrollmentCount: enrollmentCounts.get(c.id) ?? 0,
      updatedAt: c.updatedAt,
      workflow: getWorkflowFlags(viewer, c),
    }));

  return { rows, counts };
}

/* ------------------------------------------------------------------ */
/* Course form                                                         */
/* ------------------------------------------------------------------ */

export async function getCourseFormOptions(currentCourseId?: string): Promise<CourseFormOptions> {
  const db = await getDb();
  const [instructors, evaluators] = await Promise.all([listInstructors(), listEvaluators()]);
  return {
    categories: [...db.categories].sort((a, b) => a.name.localeCompare(b.name)),
    instructors: instructors.filter((u) => u.enabled),
    evaluators: evaluators.filter((u) => u.enabled),
    relatedCourses: db.courses
      .filter((c) => c.id !== currentCourseId)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => ({ id: c.id, title: c.title, slug: c.slug, published: c.published })),
    takenSlugs: db.courses.filter((c) => c.id !== currentCourseId).map((c) => c.slug),
  };
}

/* ------------------------------------------------------------------ */
/* Outline                                                             */
/* ------------------------------------------------------------------ */

export function blockTypesOf(blocks: LessonBlock[]): LessonBlockType[] {
  const seen: LessonBlockType[] = [];
  for (const b of blocks) if (!seen.includes(b.type)) seen.push(b.type);
  return seen;
}

function sortedChapters(db: Database, courseId: string) {
  return db.chapters.filter((c) => c.courseId === courseId).sort((a, b) => a.order - b.order);
}

function sortedLessons(db: Database, chapterId: string) {
  return db.lessons.filter((l) => l.chapterId === chapterId).sort((a, b) => a.order - b.order);
}

export async function getAdminOutline(course: Course): Promise<OutlineChapter[]> {
  const db = await getDb();
  return sortedChapters(db, course.id).map((chapter, ci) => {
    const lessons: OutlineLesson[] = sortedLessons(db, chapter.id).map((lesson, li) => {
      const { blocks, instructorNotes: _notes, ...rest } = lesson;
      void _notes;
      const position = { chapterNumber: ci + 1, lessonNumber: li + 1 };
      return {
        ...rest,
        ...position,
        blockTypes: blockTypesOf(blocks),
        blockCount: blocks.length,
        learnHref: lessonHref(course.slug, position),
        editHref: `/admin/courses/${course.id}/lessons/${lesson.id}`,
      };
    });
    return { ...chapter, lessons, durationSeconds: sum(lessons.map((l) => l.durationSeconds)) };
  });
}

/** Compact chapter → lesson list for the lesson editor sidebar. */
export async function getLessonEditorNav(course: Course): Promise<LessonEditorNavChapter[]> {
  const db = await getDb();
  return sortedChapters(db, course.id).map((chapter, ci) => ({
    id: chapter.id,
    title: chapter.title,
    lessons: sortedLessons(db, chapter.id).map((lesson, li) => ({
      id: lesson.id,
      title: lesson.title,
      index: `${ci + 1}.${li + 1}`,
      editHref: `/admin/courses/${course.id}/lessons/${lesson.id}`,
    })),
  }));
}

/** Where a lesson sits in its course (numbers are 1-based, for URLs). */
export async function getLessonPosition(lesson: Lesson): Promise<{ chapterNumber: number; lessonNumber: number } | null> {
  const db = await getDb();
  const chapters = sortedChapters(db, lesson.courseId);
  const ci = chapters.findIndex((c) => c.id === lesson.chapterId);
  if (ci === -1) return null;
  const li = sortedLessons(db, lesson.chapterId).findIndex((l) => l.id === lesson.id);
  if (li === -1) return null;
  return { chapterNumber: ci + 1, lessonNumber: li + 1 };
}

/**
 * Recompute every enrollment's denormalized progress for a course after the
 * outline changed (lessons added/removed). Call inside `mutate`. Completion
 * side effects (certificates, badges) are intentionally not re-run here.
 */
export function recomputeEnrollmentProgress(db: Database, courseId: string): void {
  const lessonIds = new Set(db.lessons.filter((l) => l.courseId === courseId).map((l) => l.id));
  for (const enrollment of db.enrollments) {
    if (enrollment.courseId !== courseId) continue;
    const done = db.progress.filter((p) => p.userId === enrollment.userId && p.status === "complete" && lessonIds.has(p.lessonId)).length;
    enrollment.progress = percent(done, lessonIds.size);
    if (enrollment.currentLessonId && !lessonIds.has(enrollment.currentLessonId)) delete enrollment.currentLessonId;
  }
}

/** Renumber chapter/lesson `order` fields to 1..n (call inside `mutate`). */
export function renumberOutline(db: Database, courseId: string): void {
  const chapters = sortedChapters(db, courseId);
  chapters.forEach((c, i) => {
    c.order = i + 1;
    sortedLessons(db, c.id).forEach((l, j) => {
      l.order = j + 1;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Assessment pickers                                                   */
/* ------------------------------------------------------------------ */

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function getAssessmentOptions(): Promise<AssessmentOptions> {
  const db = await getDb();
  const courseTitles = new Map(db.courses.map((c) => [c.id, c.title]));
  const byTitle = <T extends { title: string }>(a: T, b: T) => a.title.localeCompare(b.title);
  return {
    quizzes: [...db.quizzes].sort(byTitle).map((q) => ({
      id: q.id,
      title: q.title,
      courseId: q.courseId,
      courseTitle: q.courseId ? courseTitles.get(q.courseId) : undefined,
      meta: `${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"} · pass ${q.passingPercentage}%`,
    })),
    assignments: [...db.assignments].sort(byTitle).map((a) => ({
      id: a.id,
      title: a.title,
      courseId: a.courseId,
      courseTitle: a.courseId ? courseTitles.get(a.courseId) : undefined,
      meta: `${capitalize(a.type)} submission${a.gradeAssignment ? " · graded" : ""}`,
    })),
    exercises: [...db.exercises].sort(byTitle).map((e) => ({
      id: e.id,
      title: e.title,
      courseId: e.courseId,
      courseTitle: e.courseId ? courseTitles.get(e.courseId) : undefined,
      meta: `${capitalize(e.language)} · ${e.testCases.length} ${e.testCases.length === 1 ? "test" : "tests"}`,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

const BUCKETS: Omit<ProgressBucket, "count" | "percent">[] = [
  { key: "just_started", label: "Just Started", range: "0-30%", intensity: 0.3 },
  { key: "in_progress", label: "In Progress", range: "30-60%", intensity: 0.55 },
  { key: "advanced", label: "Advanced", range: "60-99%", intensity: 0.8 },
  { key: "completed", label: "Completed", range: "100%", intensity: 1 },
];

function bucketFor(progress: number): ProgressBucket["key"] {
  if (progress >= 100) return "completed";
  if (progress >= 60) return "advanced";
  if (progress >= 30) return "in_progress";
  return "just_started";
}

function lastActivityFor(db: Database, userId: string, courseId: string): string | null {
  let latest: string | null = null;
  const consider = (iso: string | undefined) => {
    if (iso && (!latest || iso > latest)) latest = iso;
  };
  for (const p of db.progress) if (p.userId === userId && p.courseId === courseId) consider(p.updatedAt);
  for (const w of db.videoWatches) if (w.userId === userId && w.courseId === courseId) consider(w.updatedAt);
  for (const s of db.quizSubmissions) if (s.userId === userId && s.courseId === courseId) consider(s.submittedAt);
  for (const s of db.assignmentSubmissions) if (s.userId === userId && s.courseId === courseId) consider(s.submittedAt);
  for (const s of db.exerciseSubmissions) if (s.userId === userId && s.courseId === courseId) consider(s.submittedAt);
  return latest;
}

export async function getCourseDashboard(course: Course): Promise<CourseDashboardData> {
  const db = await getDb();
  const users = await getUserMap();
  const enrollments = db.enrollments.filter((e) => e.courseId === course.id);
  const studentEnrollments = enrollments.filter((e) => e.memberType === "student");
  const certificates = new Map(db.certificates.filter((c) => c.courseId === course.id).map((c) => [c.userId, c.code]));

  const students: DashboardStudent[] = enrollments
    .map((e): DashboardStudent | null => {
      const user = users.get(e.userId);
      if (!user) return null;
      const lastActivity = lastActivityFor(db, e.userId, course.id);
      return {
        user,
        enrollmentId: e.id,
        memberType: e.memberType,
        enrolledAt: e.enrolledAt,
        enrolledLabel: formatDate(e.enrolledAt),
        completedAt: e.completedAt,
        progress: Math.round(e.progress),
        lastActivityAt: lastActivity,
        lastActivityLabel: lastActivity ? relativeTime(lastActivity) : null,
        certificateCode: certificates.get(e.userId) ?? null,
        batchId: e.batchId,
      };
    })
    .filter((s): s is DashboardStudent => !!s)
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));

  const enrollmentCount = studentEnrollments.length;
  const completedCount = studentEnrollments.filter((e) => e.progress >= 100 || !!e.completedAt).length;
  const averageProgress = enrollmentCount ? Math.ceil(sum(studentEnrollments.map((e) => e.progress)) / enrollmentCount) : 0;

  const buckets: ProgressBucket[] = BUCKETS.map((b) => {
    const count = studentEnrollments.filter((e) => bucketFor(e.progress) === b.key).length;
    return { ...b, count, percent: percent(count, enrollmentCount) };
  });

  const payments = db.payments.filter((p) => p.itemId === course.id && (p.itemType === "course" || p.itemType === "certificate") && p.status === "paid");
  const currency = course.currency || db.settings.commerce.defaultCurrency;
  const revenue = sum(payments.filter((p) => p.currency === currency).map((p) => p.amount));

  const reviews = db.reviews
    .filter((r) => r.courseId === course.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({ ...r, user: users.get(r.userId) ?? null }));
  const averageRating = reviews.length ? Math.round((sum(reviews.map((r) => r.rating)) / reviews.length) * 10) / 10 : null;

  const studentIds = new Set(studentEnrollments.map((e) => e.userId));
  const completions = new Map<string, number>();
  for (const p of db.progress) {
    if (p.courseId === course.id && p.status === "complete" && studentIds.has(p.userId)) completions.set(p.lessonId, (completions.get(p.lessonId) ?? 0) + 1);
  }
  const lessonCompletion: LessonCompletionStat[] = [];
  let order = 0;
  sortedChapters(db, course.id).forEach((chapter, ci) => {
    sortedLessons(db, chapter.id).forEach((lesson, li) => {
      const completionCount = completions.get(lesson.id) ?? 0;
      lessonCompletion.push({
        lessonId: lesson.id,
        index: `${ci + 1}.${li + 1}`,
        order: order++,
        title: lesson.title,
        completionCount,
        percent: enrollmentCount ? Math.ceil((completionCount / enrollmentCount) * 100) : 0,
      });
    });
  });

  return {
    enrollmentCount,
    completedCount,
    completionRate: percent(completedCount, enrollmentCount),
    averageProgress,
    revenue,
    currency,
    paidOrders: payments.length,
    averageRating,
    reviewCount: reviews.length,
    lessonCount: lessonCompletion.length,
    students,
    lessonCompletion,
    buckets,
    reviews,
  };
}

function assessmentTone(status: string): StudentAssessmentRow["tone"] {
  const s = status.toLowerCase();
  if (s.includes("pass")) return "success";
  if (s.includes("fail")) return "danger";
  return "warning";
}

const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  not_graded: "Not Graded",
  not_applicable: "Submitted",
};

export function collectAssessmentRefs(lessons: Lesson[]) {
  const quizIds = new Set<string>();
  const assignmentIds = new Set<string>();
  const exerciseIds = new Set<string>();
  for (const lesson of lessons) {
    for (const b of lesson.blocks) {
      if (b.type === "quiz") quizIds.add(b.quizId);
      else if (b.type === "assignment") assignmentIds.add(b.assignmentId);
      else if (b.type === "exercise") exerciseIds.add(b.exerciseId);
      else if (b.type === "video") for (const m of b.quizMarkers ?? []) quizIds.add(m.quizId);
    }
  }
  return { quizIds, assignmentIds, exerciseIds };
}

function courseAssessmentRefs(db: Database, course: Course, lessons: Lesson[]) {
  const refs = collectAssessmentRefs(lessons);
  for (const q of db.quizzes) if (q.courseId === course.id) refs.quizIds.add(q.id);
  for (const a of db.assignments) if (a.courseId === course.id) refs.assignmentIds.add(a.id);
  for (const e of db.exercises) if (e.courseId === course.id) refs.exerciseIds.add(e.id);
  return refs;
}

export async function getStudentProgressDetail(course: Course, userId: string): Promise<StudentProgressDetail | null> {
  const db = await getDb();
  const enrollment = db.enrollments.find((e) => e.courseId === course.id && e.userId === userId);
  const userRow = db.users.find((u) => u.id === userId);
  if (!enrollment || !userRow) return null;

  const progress = new Map(db.progress.filter((p) => p.userId === userId && p.courseId === course.id).map((p) => [p.lessonId, p]));
  const chapters = sortedChapters(db, course.id).map((chapter, ci) => ({
    chapterId: chapter.id,
    title: chapter.title,
    lessons: sortedLessons(db, chapter.id).map((lesson, li) => {
      const row = progress.get(lesson.id);
      return {
        lessonId: lesson.id,
        index: `${ci + 1}.${li + 1}`,
        title: lesson.title,
        status: row?.status ?? ("incomplete" as const),
        completedAt: row?.completedAt,
      };
    }),
  }));

  // Every assessment used by the course: referenced in lesson blocks / video markers, or linked by courseId.
  const refs = courseAssessmentRefs(
    db,
    course,
    db.lessons.filter((l) => l.courseId === course.id),
  );
  const latest = <T extends { submittedAt: string }>(rows: T[]): T | undefined => [...rows].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];

  const quizzes: StudentQuizRow[] = db.quizzes
    .filter((q) => refs.quizIds.has(q.id))
    .map((quiz) => {
      const sub = latest(db.quizSubmissions.filter((s) => s.quizId === quiz.id && s.userId === userId));
      return {
        quizId: quiz.id,
        title: quiz.title,
        score: sub?.score ?? 0,
        scoreOutOf: sub?.scoreOutOf ?? quiz.totalMarks,
        percentage: sub ? Math.round(sub.percentage) : 0,
        passed: sub?.passed ?? false,
        attempted: !!sub,
      };
    });

  const assignments: StudentAssessmentRow[] = db.assignments
    .filter((a) => refs.assignmentIds.has(a.id))
    .map((a) => {
      const sub = latest(db.assignmentSubmissions.filter((s) => s.assignmentId === a.id && s.userId === userId));
      const status = sub ? (ASSIGNMENT_STATUS_LABELS[sub.status] ?? sub.status) : "Not Submitted";
      return { id: a.id, title: a.title, status, tone: sub?.status === "not_applicable" ? "neutral" : assessmentTone(status) };
    });

  const exercises: StudentAssessmentRow[] = db.exercises
    .filter((e) => refs.exerciseIds.has(e.id))
    .map((ex) => {
      const sub = latest(db.exerciseSubmissions.filter((s) => s.exerciseId === ex.id && s.userId === userId));
      const status = sub ? (sub.status === "passed" ? "Passed" : "Failed") : "Not Attempted";
      return { id: ex.id, title: ex.title, status, tone: assessmentTone(status) };
    });

  const certificate = db.certificates.find((c) => c.courseId === course.id && c.userId === userId);
  return {
    user: toPublicUser(userRow),
    memberType: enrollment.memberType,
    progress: Math.round(enrollment.progress),
    enrolledAt: enrollment.enrolledAt,
    enrolledLabel: formatDate(enrollment.enrolledAt),
    completedAt: enrollment.completedAt,
    completedLabel: enrollment.completedAt ? formatDate(enrollment.completedAt) : undefined,
    certificateCode: certificate?.code ?? null,
    chapters,
    quizzes,
    assignments,
    exercises,
  };
}

/** Users matching a search, flagged when already enrolled, with their paid orders for this course. */
export async function searchEnrollCandidates(course: Course, query: string, limit = 8): Promise<EnrollCandidate[]> {
  const db = await getDb();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const enrolled = new Set(db.enrollments.filter((e) => e.courseId === course.id).map((e) => e.userId));
  return db.users
    .filter((u) => u.enabled && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)))
    .sort((a, b) => Number(enrolled.has(a.id)) - Number(enrolled.has(b.id)) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((u) => ({
      user: toPublicUser(u),
      enrolled: enrolled.has(u.id),
      payments: db.payments
        .filter((p) => p.userId === u.id && p.itemId === course.id && p.status === "paid")
        .map((p) => ({ id: p.id, orderId: p.orderId, amount: p.amount, currency: p.currency, itemType: p.itemType, createdAt: p.createdAt })),
    }));
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

export async function getCourseAnnouncements(courseId: string): Promise<AnnouncementRow[]> {
  const db = await getDb();
  const users = await getUserMap();
  const recipientCount = db.enrollments.filter((e) => e.courseId === courseId && e.memberType !== "staff").length;
  return db.announcements
    .filter((a) => a.courseId === courseId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({ ...a, author: users.get(a.authorId) ?? null, recipientCount }));
}

/* ------------------------------------------------------------------ */
/* Lesson editor                                                       */
/* ------------------------------------------------------------------ */

export async function getLessonVideoStats(lesson: Lesson): Promise<VideoStat[]> {
  const db = await getDb();
  const users = await getUserMap();
  return lesson.blocks
    .filter((b): b is Extract<LessonBlock, { type: "video" }> => b.type === "video")
    .map((block, i) => {
      const rows = db.videoWatches
        .filter((w) => w.lessonId === lesson.id && w.blockId === block.id)
        .map((w) => {
          const user = users.get(w.userId);
          if (!user) return null;
          return {
            user,
            watchSeconds: w.watchSeconds,
            maxPositionSeconds: w.maxPositionSeconds,
            durationSeconds: w.durationSeconds || block.duration || 0,
            completed: w.completed,
            updatedAt: w.updatedAt,
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
        .sort((a, b) => b.watchSeconds - a.watchSeconds);
      return {
        blockId: block.id,
        title: block.title || `Video ${i + 1}`,
        src: block.src,
        duration: block.duration ?? 0,
        averageWatchSeconds: rows.length ? Math.round(sum(rows.map((r) => r.watchSeconds)) / rows.length) : 0,
        completionRate: percent(rows.filter((r) => r.completed).length, rows.length),
        rows,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export async function buildCourseExport(course: Course): Promise<CourseExportFile> {
  const db = await getDb();
  const chapters = sortedChapters(db, course.id);
  const lessons = chapters.flatMap((c) => sortedLessons(db, c.id));
  const refs = courseAssessmentRefs(db, course, lessons);
  const quizzes = db.quizzes.filter((q) => refs.quizIds.has(q.id));
  const questionIds = new Set(quizzes.flatMap((q) => q.questions.map((r) => r.questionId)));
  return {
    format: "learnloop-course",
    version: 1,
    exportedAt: new Date().toISOString(),
    course,
    chapters,
    lessons,
    quizzes,
    questions: db.questions.filter((q) => questionIds.has(q.id)),
    assignments: db.assignments.filter((a) => refs.assignmentIds.has(a.id)),
    exercises: db.exercises.filter((e) => refs.exerciseIds.has(e.id)),
  };
}

export function summarizeExport(file: CourseExportFile): CourseExportSummary {
  const uploads = new Set<string>();
  const addUpload = (url: string | undefined) => {
    if (url && url.startsWith("/uploads/")) uploads.add(url);
  };
  addUpload(file.course.imageUrl);
  addUpload(file.course.videoUrl);
  for (const l of file.lessons) {
    for (const b of l.blocks) {
      if (b.type === "video") {
        addUpload(b.src);
        addUpload(b.posterUrl);
        addUpload(b.captionsUrl);
      } else if (b.type === "audio" || b.type === "pdf" || b.type === "image" || b.type === "file") {
        addUpload(b.src);
      }
    }
  }
  return {
    chapters: file.chapters.length,
    lessons: file.lessons.length,
    blocks: sum(file.lessons.map((l) => l.blocks.length)),
    quizzes: file.quizzes.length,
    questions: file.questions.length,
    assignments: file.assignments.length,
    exercises: file.exercises.length,
    uploads: uploads.size,
  };
}
