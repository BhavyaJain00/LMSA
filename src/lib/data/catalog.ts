import "server-only";
import type { Announcement, Batch, Category, Certificate, Course, CourseSummary, PublicUser, Review, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isModerator, isStaff } from "@/lib/auth/session";
import { canManageCourse, getCourseSummaries, type CourseFilter } from "./courses";
import { getUserMap } from "./users";
import { stripMarkdown, toDateKey } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Catalog tabs, sorting & paging                                      */
/* ------------------------------------------------------------------ */

export type CatalogTab = "live" | "upcoming" | "new" | "enrolled" | "created" | "unpublished";
export type CatalogSort = NonNullable<CourseFilter["sort"]>;

export const CATALOG_SORTS: { value: CatalogSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "title", label: "Title A–Z" },
];

export const CATALOG_PAGE_SIZES = [24, 60, 120] as const;
export type CatalogPageSize = (typeof CATALOG_PAGE_SIZES)[number];

export interface CatalogTabDef {
  value: CatalogTab;
  label: string;
  description: string;
}

/**
 * Tabs a viewer sees on the catalog (mirrors Frappe's role-aware tab strip):
 * everyone gets Live / Upcoming / New, signed-in users get Enrolled, staff get
 * Created and moderators additionally get Unpublished.
 */
export function catalogTabsFor(viewer: User | null): CatalogTabDef[] {
  const tabs: CatalogTabDef[] = [
    { value: "live", label: "Live", description: "Published courses open for enrollment" },
    { value: "upcoming", label: "Upcoming", description: "Announced courses that open soon" },
    { value: "new", label: "New", description: "Published in the last 30 days" },
  ];
  if (viewer) tabs.push({ value: "enrolled", label: "Enrolled", description: "Courses you are enrolled in" });
  if (viewer && isStaff(viewer)) tabs.push({ value: "created", label: "Created", description: "Courses you teach or created" });
  if (viewer && isModerator(viewer)) tabs.push({ value: "unpublished", label: "Unpublished", description: "Drafts and courses awaiting review" });
  return tabs;
}

export function parseCatalogTab(raw: string | undefined, viewer: User | null): CatalogTab {
  const allowed = catalogTabsFor(viewer).map((t) => t.value);
  return raw && (allowed as string[]).includes(raw) ? (raw as CatalogTab) : "live";
}

export function parseCatalogSort(raw: string | undefined): CatalogSort {
  return CATALOG_SORTS.some((s) => s.value === raw) ? (raw as CatalogSort) : "newest";
}

export function parsePageSize(raw: string | undefined): CatalogPageSize {
  const n = Number(raw);
  return (CATALOG_PAGE_SIZES as readonly number[]).includes(n) ? (n as CatalogPageSize) : 24;
}

export function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : 1;
}

export interface CatalogQuery {
  tab: CatalogTab;
  search?: string;
  categorySlug?: string;
  certification?: boolean;
  sort: CatalogSort;
}

/** Lowercased search tokens; every token must match somewhere in the course. */
function tokenize(search: string | undefined): string[] {
  if (!search) return [];
  return search
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function searchHaystack(c: CourseSummary): string {
  return [
    c.title,
    c.shortIntroduction,
    stripMarkdown(c.description),
    c.tags.join(" "),
    c.category?.name ?? "",
    c.instructors.map((i) => i.name).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

async function listForTab(viewer: User | null, tab: CatalogTab, base: { categoryId?: string; sort: CatalogSort }): Promise<CourseSummary[]> {
  if (tab === "unpublished") {
    if (!isModerator(viewer)) return [];
    const list = await getCourseSummaries(viewer, { tab: "all", includeUnpublished: true, categoryId: base.categoryId, sort: base.sort });
    return list.filter((c) => !c.published);
  }
  return getCourseSummaries(viewer, { tab, categoryId: base.categoryId, sort: base.sort });
}

function applyRefinements(list: CourseSummary[], tokens: string[], certification: boolean | undefined): CourseSummary[] {
  let out = list;
  if (tokens.length) {
    out = out.filter((c) => {
      const hay = searchHaystack(c);
      return tokens.every((t) => hay.includes(t));
    });
  }
  if (certification) out = out.filter((c) => c.enableCertification || c.paidCertificate);
  return out;
}

export interface CatalogResult {
  courses: CourseSummary[];
  /** Resolved category for `?category=` (null when missing or unknown). */
  category: Category | null;
}

/**
 * Catalog listing. Wraps `getCourseSummaries` and adds the moderator-only
 * "Unpublished" tab, category-by-slug, a multi-field search (title, intro,
 * description, tags, category and instructor names) and the certification filter.
 */
export async function getCatalogCourses(viewer: User | null, query: CatalogQuery): Promise<CatalogResult> {
  const category = await getCategoryBySlug(query.categorySlug);
  const list = await listForTab(viewer, query.tab, { categoryId: category?.id, sort: query.sort });
  return { courses: applyRefinements(list, tokenize(query.search), query.certification), category };
}

/** Result counts per tab for the current search/category/certification refinements. */
export async function getCatalogTabCounts(viewer: User | null, query: CatalogQuery): Promise<Partial<Record<CatalogTab, number>>> {
  const category = await getCategoryBySlug(query.categorySlug);
  const tokens = tokenize(query.search);
  const tabs = catalogTabsFor(viewer);
  const entries = await Promise.all(
    tabs.map(async (t) => {
      const list = await listForTab(viewer, t.value, { categoryId: category?.id, sort: query.sort });
      return [t.value, applyRefinements(list, tokens, query.certification).length] as const;
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<CatalogTab, number>>;
}

/** Categories that have at least one published course, with counts. */
export async function getCatalogCategories(): Promise<(Category & { courseCount: number })[]> {
  const db = await getDb();
  const counts = new Map<string, number>();
  for (const c of db.courses) {
    if (!c.published || !c.categoryId) continue;
    counts.set(c.categoryId, (counts.get(c.categoryId) ?? 0) + 1);
  }
  return db.categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({ ...c, courseCount: counts.get(c.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCategoryBySlug(slug: string | undefined): Promise<Category | null> {
  if (!slug) return null;
  const db = await getDb();
  return db.categories.find((c) => c.slug === slug) ?? null;
}

/* ------------------------------------------------------------------ */
/* Course page extras                                                  */
/* ------------------------------------------------------------------ */

/**
 * Related courses: the course's explicit list first, then (when none are
 * set) published courses from the same category. Only courses the viewer
 * may see are returned.
 */
export async function getRelatedCourses(course: Course, viewer: User | null, limit = 4): Promise<{ explicit: boolean; courses: CourseSummary[] }> {
  const all = await getCourseSummaries(viewer, { tab: "all", sort: "popular" });
  const visible = all.filter((c) => c.id !== course.id && (c.published || canManageCourse(viewer, c)));
  const explicit = course.relatedCourseIds.map((id) => visible.find((c) => c.id === id)).filter((c): c is CourseSummary => !!c);
  if (explicit.length) return { explicit: true, courses: explicit.slice(0, limit) };
  if (!course.categoryId) return { explicit: false, courses: [] };
  const sameCategory = visible.filter((c) => c.categoryId === course.categoryId && c.published).slice(0, limit);
  return { explicit: false, courses: sameCategory };
}

export interface CourseContentStats {
  quizCount: number;
  assignmentCount: number;
  exerciseCount: number;
  videoLessonCount: number;
  previewLessonCount: number;
  /** Seconds of video across all lessons. */
  videoSeconds: number;
}

/** Counts of quizzes / assignments / exercises / videos referenced by the course's lessons. */
export async function getCourseContentStats(courseId: string): Promise<CourseContentStats> {
  const db = await getDb();
  const quizzes = new Set<string>();
  const assignments = new Set<string>();
  const exercises = new Set<string>();
  let videoLessonCount = 0;
  let previewLessonCount = 0;
  let videoSeconds = 0;
  for (const lesson of db.lessons) {
    if (lesson.courseId !== courseId) continue;
    if (lesson.includeInPreview) previewLessonCount++;
    let hasVideo = false;
    for (const b of lesson.blocks) {
      if (b.type === "quiz") quizzes.add(b.quizId);
      else if (b.type === "assignment") assignments.add(b.assignmentId);
      else if (b.type === "exercise") exercises.add(b.exerciseId);
      else if (b.type === "video") {
        hasVideo = true;
        videoSeconds += b.duration ?? 0;
      }
    }
    if (hasVideo) videoLessonCount++;
  }
  return {
    quizCount: quizzes.size,
    assignmentCount: assignments.size,
    exerciseCount: exercises.size,
    videoLessonCount,
    previewLessonCount,
    videoSeconds,
  };
}

export async function getCourseAnnouncements(courseId: string, limit = 5): Promise<(Announcement & { author: PublicUser | null })[]> {
  const db = await getDb();
  const users = await getUserMap();
  return db.announcements
    .filter((a) => a.courseId === courseId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((a) => ({ ...a, author: users.get(a.authorId) ?? null }));
}

export async function getUserCourseCertificate(userId: string | undefined | null, courseId: string): Promise<Certificate | null> {
  if (!userId) return null;
  const db = await getDb();
  return db.certificates.find((c) => c.userId === userId && c.courseId === courseId) ?? null;
}

export async function getViewerReview(userId: string | undefined | null, courseId: string): Promise<Review | null> {
  if (!userId) return null;
  const db = await getDb();
  return db.reviews.find((r) => r.userId === userId && r.courseId === courseId) ?? null;
}

/** Published batches that include the course and are still open (upcoming or running). */
export async function getBatchesForCourse(courseId: string, limit = 3): Promise<Batch[]> {
  const db = await getDb();
  const today = toDateKey();
  return db.batches
    .filter((b) => b.published && b.courseIds.includes(courseId) && b.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit);
}

export interface InstructorStats {
  courseCount: number;
  studentCount: number;
  reviewCount: number;
  averageRating: number | null;
}

/** Teaching stats per instructor across their published courses. */
export async function getInstructorStats(instructorIds: string[]): Promise<Map<string, InstructorStats>> {
  const db = await getDb();
  const out = new Map<string, InstructorStats>();
  for (const id of instructorIds) {
    const courses = db.courses.filter((c) => c.published && c.instructorIds.includes(id));
    const courseIds = new Set(courses.map((c) => c.id));
    const students = new Set(db.enrollments.filter((e) => courseIds.has(e.courseId) && e.memberType === "student").map((e) => e.userId));
    const reviews = db.reviews.filter((r) => courseIds.has(r.courseId));
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    out.set(id, {
      courseCount: courses.length,
      studentCount: students.size,
      reviewCount: reviews.length,
      averageRating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : null,
    });
  }
  return out;
}

/** Whether the viewer already paid for a course (a paid payment row exists). */
export async function hasPaidForCourse(userId: string | undefined | null, courseId: string): Promise<boolean> {
  if (!userId) return false;
  const db = await getDb();
  return db.payments.some((p) => p.userId === userId && p.itemType === "course" && p.itemId === courseId && p.status === "paid");
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

export interface LandingStats {
  courses: number;
  learners: number;
  certificates: number;
  instructors: number;
  lessons: number;
}

export interface Testimonial extends Review {
  user: PublicUser;
  course: Pick<Course, "id" | "slug" | "title">;
}

export interface LandingBatch extends Batch {
  instructors: PublicUser[];
  studentCount: number;
  seatsLeft: number | null;
  status: "upcoming" | "active";
  /** Whole days until the batch starts (0 when it already started). */
  startsInDays: number;
}

export interface LandingData {
  stats: LandingStats;
  featured: CourseSummary[];
  upcoming: CourseSummary[];
  categories: (Category & { courseCount: number })[];
  batches: LandingBatch[];
  testimonials: Testimonial[];
  averageRating: number | null;
  reviewCount: number;
}

export async function getLandingData(): Promise<LandingData> {
  const db = await getDb();
  const users = await getUserMap();
  const today = toDateKey();

  const published = db.courses.filter((c) => c.published);
  const publishedIds = new Set(published.map((c) => c.id));
  const instructorIds = new Set(published.flatMap((c) => c.instructorIds));
  const learnerIds = new Set(
    db.enrollments.filter((e) => e.memberType === "student" && publishedIds.has(e.courseId)).map((e) => e.userId),
  );

  const stats: LandingStats = {
    courses: published.filter((c) => !c.upcoming).length,
    learners: learnerIds.size,
    certificates: db.certificates.filter((c) => c.published).length,
    instructors: instructorIds.size,
    lessons: db.lessons.filter((l) => publishedIds.has(l.courseId)).length,
  };

  const live = await getCourseSummaries(null, { tab: "live", sort: "popular" });
  const featuredOnly = live.filter((c) => c.featured);
  const featured = (featuredOnly.length >= 3 ? featuredOnly : [...featuredOnly, ...live.filter((c) => !c.featured)]).slice(0, 6);
  const upcoming = (await getCourseSummaries(null, { tab: "upcoming", sort: "newest" })).slice(0, 3);

  const categories = await getCatalogCategories();

  const batches: LandingBatch[] = db.batches
    .filter((b) => b.published && b.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 3)
    .map((b) => {
      const studentCount = db.batchEnrollments.filter((e) => e.batchId === b.id).length;
      const startsInDays = Math.max(0, Math.round((new Date(`${b.startDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000));
      return {
        ...b,
        startsInDays,
        instructors: b.instructorIds.map((id) => users.get(id)).filter((u): u is PublicUser => !!u),
        studentCount,
        seatsLeft: b.seatCount > 0 ? Math.max(0, b.seatCount - studentCount) : null,
        status: b.startDate > today ? "upcoming" : "active",
      };
    });

  const courseById = new Map(published.map((c) => [c.id, c]));
  const publicReviews = db.reviews.filter((r) => courseById.has(r.courseId));
  const ratingSum = publicReviews.reduce((acc, r) => acc + r.rating, 0);
  const testimonials: Testimonial[] = publicReviews
    .filter((r) => r.rating >= 4 && r.review.trim().length >= 20 && users.has(r.userId))
    .sort((a, b) => b.rating - a.rating || b.review.length - a.review.length || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3)
    .map((r) => {
      const course = courseById.get(r.courseId)!;
      return { ...r, user: users.get(r.userId)!, course: { id: course.id, slug: course.slug, title: course.title } };
    });

  return {
    stats,
    featured,
    upcoming,
    categories,
    batches,
    testimonials,
    averageRating: publicReviews.length ? Math.round((ratingSum / publicReviews.length) * 10) / 10 : null,
    reviewCount: publicReviews.length,
  };
}
