import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Batch, Category, Course, CourseSummary, Database, JobOpening, Program, Settings, User } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { getCourseSummaries } from "@/lib/data/courses";
import { JOB_AUTO_CLOSE_DAYS } from "@/lib/data/jobs";
import { isProtectedVideoPath } from "@/lib/media/paths";
import { zonedTimeToUtc } from "@/lib/calendar/time";
import {
  type JsonLdObject,
  type SeoContext,
  courseJsonLd,
  educationEventJsonLd,
  faqPageJsonLd,
  inferEducationalLevel,
  itemListJsonLd,
  jobPostingJsonLd,
  personJsonLd,
  seoContext,
  videoObjectJsonLd,
} from "@/lib/seo/jsonld";
import { batchPath, buildContentIndex, categoryPath, coursePath, instructorPath, jobPath, postPath, profilePath, programPath, tagPath } from "@/lib/seo/content-index";
import { clampText, plainText, splitKeywords, tagLabel, tagSlug } from "@/lib/seo/text";
import { defaultShareImage, feedAlternates } from "@/lib/seo/metadata";
import { guestsCanBrowse, isBatchPublic, isCoursePublic, isJobPublic, isPostPublic, isProgramPublic } from "@/lib/seo/visibility";
import { type IndexNowResult, isPingableOrigin, isValidIndexNowKey } from "@/lib/seo/indexnow";
import { lastIndexNowResult } from "@/lib/seo/indexnow-client";
import type { LandingSort } from "@/lib/seo/landing";
import { type RedirectTargetStatus, redirectTargetStatus } from "@/lib/seo/redirects";
import { siteOrigin } from "@/lib/seo/site";
import { type ResourceHints, resourceHints } from "@/lib/seo/resource-hints";
import { type SitemapSummary, buildSitemap, publicCourses, summarizeSitemap } from "@/lib/seo/sitemap";
import { sitemapChunkCount } from "@/lib/seo/sitemap-xml";
import { getLatestPosts, getPostsForCourse, getPublicPosts, type PostListItem } from "@/lib/data/blog";
import { legalLinks, type LegalLink } from "@/lib/legal/links";

/**
 * Data for the public landing pages that power internal linking (category,
 * tag and instructor pages, the site footer, the HTML sitemap) and for the
 * structured data of pages owned by other areas (courses, batches, programs,
 * jobs, profiles). Everything here is limited to what an anonymous visitor
 * may see.
 */

export async function getSeoContext(): Promise<SeoContext> {
  return seoContext(await getSettings());
}

/**
 * Published (and released) courses: exactly the set a guest sees. Passing the
 * signed-in `viewer` only adds their own enrollment and progress to the cards.
 */
export async function getPublicCourseSummaries(
  filter: { categoryId?: string; instructorId?: string; sort?: "newest" | "popular" | "rating" | "title" } = {},
  viewer: User | null = null,
): Promise<CourseSummary[]> {
  const now = Date.now();
  const list = await getCourseSummaries(viewer, { tab: "all", categoryId: filter.categoryId, instructorId: filter.instructorId, sort: filter.sort ?? "popular" });
  return list.filter((c) => isCoursePublic(c, now));
}

/**
 * `preconnect` / `dns-prefetch` targets for the hosts that serve the site's
 * media: the CDN in front of the storage first, then the hosts most public
 * course covers and preview videos come from.
 */
export async function getResourceHints(): Promise<ResourceHints> {
  const [settings, db] = await Promise.all([getSettings(), getDb()]);
  const courses = publicCourses(db, Date.now());
  return resourceHints({
    siteOrigin: siteOrigin(),
    cdnBaseUrl: settings.storage.cdnBaseUrl,
    mediaUrls: [settings.brand.logoUrl, ...courses.flatMap((c) => [c.imageUrl, c.videoUrl])],
  });
}

/**
 * Gate of the landing pages built on the course catalog (categories, topics,
 * instructors): "not found" while courses are switched off, and the login
 * page for guests when the catalog is members-only. Returns the viewer.
 */
export async function requireCatalogAccess(path: string): Promise<{ user: User | null; settings: Settings }> {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  if (!settings.features.courses) notFound();
  if (!user && !guestsCanBrowse(settings)) redirect(`/login?next=${encodeURIComponent(path)}`);
  return { user, settings };
}

/** Whether catalog landing pages may be indexed at all (public catalog, courses on). */
export function catalogIsPublic(settings: Pick<Settings, "features" | "learning">): boolean {
  return settings.features.courses && guestsCanBrowse(settings);
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export interface FooterData {
  /** Current year for the copyright line. */
  year: number;
  brandName: string;
  tagline: string;
  logoUrl?: string;
  footerText?: string;
  contactEmail?: string;
  contactUrl?: string;
  sameAs: string[];
  categories: { name: string; href: string; count: number }[];
  popularCourses: { title: string; href: string }[];
  latestPosts: { title: string; href: string }[];
  explore: { label: string; href: string }[];
  legal: LegalLink[];
  /** The cookie banner is on, so the footer offers "Cookie settings". */
  cookieBanner: boolean;
}

export async function getFooterData(): Promise<FooterData> {
  const [settings, db] = await Promise.all([getSettings(), getDb()]);
  const guests = guestsCanBrowse(settings) && settings.features.courses;
  const courses = guests ? await getPublicCourseSummaries({ sort: "popular" }) : [];
  const counts = countByCategory(courses);
  const categories = db.categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({ name: c.name, href: categoryPath(c.slug), count: counts.get(c.id)! }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);

  const explore: FooterData["explore"] = [];
  if (guests) explore.push({ label: "All courses", href: "/courses" });
  if (guestsCanBrowse(settings) && settings.features.batches) explore.push({ label: "Live batches", href: "/batches" });
  if (guestsCanBrowse(settings) && settings.features.programs) explore.push({ label: "Programs", href: "/programs" });
  if (guests) explore.push({ label: "Instructors", href: "/instructors" });
  if (settings.seo.blogEnabled) explore.push({ label: "Blog", href: "/blog" });
  explore.push({ label: "Free resources", href: "/free" });
  if (guestsCanBrowse(settings) && settings.features.jobs) explore.push({ label: "Jobs", href: "/jobs" });
  if (settings.features.certifiedMembers) explore.push({ label: "Certified members", href: "/certified-members" });

  const [posts, legal] = await Promise.all([settings.seo.blogEnabled ? getLatestPosts(4) : Promise.resolve([] as PostListItem[]), legalLinks()]);
  return {
    year: new Date().getFullYear(),
    brandName: settings.brand.name,
    tagline: settings.brand.tagline,
    logoUrl: settings.brand.logoUrl,
    footerText: settings.brand.footerText,
    contactEmail: settings.contact.email || settings.legal.contactEmail || undefined,
    contactUrl: settings.contact.url || undefined,
    sameAs: settings.seo.sameAs,
    categories,
    popularCourses: courses.slice(0, 5).map((c) => ({ title: c.title, href: coursePath(c.slug) })),
    latestPosts: posts.map((p) => ({ title: p.title, href: postPath(p.slug) })),
    explore,
    legal,
    cookieBanner: settings.legal.cookieBanner,
  };
}

/* ------------------------------------------------------------------ */
/* Category and tag landing pages                                      */
/* ------------------------------------------------------------------ */

export interface TagCount {
  slug: string;
  label: string;
  count: number;
}

/** Tags of a set of courses: slug, most common spelling, course count (most used first). */
function countTags(courses: Pick<Course, "tags">[]): TagCount[] {
  const tags = new Map<string, { labels: Map<string, number>; count: number }>();
  for (const c of courses) {
    const seen = new Set<string>();
    for (const t of c.tags) {
      const slug = tagSlug(t);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const entry = tags.get(slug) ?? { labels: new Map(), count: 0 };
      entry.count++;
      entry.labels.set(t, (entry.labels.get(t) ?? 0) + 1);
      tags.set(slug, entry);
    }
  }
  return [...tags]
    .map(([slug, e]) => ({ slug, label: [...e.labels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tagLabel(slug), count: e.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function countByCategory(courses: Pick<Course, "categoryId">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of courses) if (c.categoryId) counts.set(c.categoryId, (counts.get(c.categoryId) ?? 0) + 1);
  return counts;
}

export interface CategoryCard {
  id: string;
  name: string;
  slug: string;
  courseCount: number;
  /** One-line summary (the SEO description, else the start of the introduction). */
  blurb: string;
  /** A few course titles, most popular first. */
  sampleCourses: string[];
}

/** Categories that have public courses, largest first (the "Browse by category" page). */
export async function getCategoryDirectory(): Promise<CategoryCard[]> {
  const [db, courses] = await Promise.all([getDb(), getPublicCourseSummaries({ sort: "popular" })]);
  const counts = countByCategory(courses);
  return db.categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      courseCount: counts.get(c.id)!,
      blurb: clampText(plainText(c.seoDescription || c.intro), 160),
      sampleCourses: courses
        .filter((course) => course.categoryId === c.id)
        .slice(0, 3)
        .map((course) => course.title),
    }))
    .sort((a, b) => b.courseCount - a.courseCount || a.name.localeCompare(b.name));
}

type LandingInstructor = Pick<User, "id" | "name" | "username" | "avatarUrl" | "headline">;

export interface CategoryLanding {
  category: Category;
  courses: CourseSummary[];
  /** Learners enrolled across the category's courses. */
  learnerCount: number;
  otherCategories: (Category & { courseCount: number })[];
  topics: TagCount[];
  posts: PostListItem[];
  instructors: LandingInstructor[];
}

export async function getCategoryLanding(slug: string, sort: LandingSort = "popular", viewer: User | null = null): Promise<CategoryLanding | null> {
  const db = await getDb();
  const category = db.categories.find((c) => c.slug === slug);
  if (!category) return null;
  const [courses, all, settings] = await Promise.all([getPublicCourseSummaries({ categoryId: category.id, sort }, viewer), getPublicCourseSummaries(), getSettings()]);
  const counts = countByCategory(all);
  const otherCategories = db.categories
    .filter((c) => c.id !== category.id && counts.has(c.id))
    .map((c) => ({ ...c, courseCount: counts.get(c.id)! }))
    .sort((a, b) => b.courseCount - a.courseCount || a.name.localeCompare(b.name));
  const posts = settings.seo.blogEnabled ? (await getPublicPosts({ categoryId: category.id, pageSize: 3 })).items : [];
  const instructors = new Map<string, LandingInstructor>();
  for (const c of courses) for (const i of c.instructors) instructors.set(i.id, { id: i.id, name: i.name, username: i.username, avatarUrl: i.avatarUrl, headline: i.headline });
  return {
    category,
    courses,
    learnerCount: courses.reduce((total, c) => total + c.enrollmentCount, 0),
    otherCategories,
    topics: countTags(courses).slice(0, 12),
    posts,
    instructors: [...instructors.values()].slice(0, 8),
  };
}

/** Tags of public courses: slug, most common spelling, course count. */
export async function getCourseTags(): Promise<TagCount[]> {
  return countTags(await getPublicCourseSummaries());
}

export interface TagLanding {
  slug: string;
  label: string;
  courses: CourseSummary[];
  relatedTags: TagCount[];
  /** Categories the matching courses belong to, most courses first. */
  categories: (Pick<Category, "id" | "name" | "slug"> & { courseCount: number })[];
  posts: PostListItem[];
}

export async function getTagLanding(slug: string, sort: LandingSort = "popular", viewer: User | null = null): Promise<TagLanding | null> {
  const [all, settings] = await Promise.all([getPublicCourseSummaries({ sort }, viewer), getSettings()]);
  const courses = all.filter((c) => c.tags.some((t) => tagSlug(t) === slug));
  if (!courses.length) return null;
  const tags = countTags(all);
  const own = tags.find((t) => t.slug === slug);
  const coTags = new Map(countTags(courses).map((t) => [t.slug, t.count]));
  coTags.delete(slug);
  const relatedTags = tags
    .filter((t) => coTags.has(t.slug))
    .sort((a, b) => coTags.get(b.slug)! - coTags.get(a.slug)! || b.count - a.count)
    .slice(0, 12);
  const categories = new Map<string, TagLanding["categories"][number]>();
  for (const c of courses) {
    if (!c.category) continue;
    const entry = categories.get(c.category.id) ?? { id: c.category.id, name: c.category.name, slug: c.category.slug, courseCount: 0 };
    entry.courseCount++;
    categories.set(c.category.id, entry);
  }
  const posts = settings.seo.blogEnabled ? (await getPublicPosts({ tag: slug, pageSize: 3 })).items : [];
  return {
    slug,
    label: own?.label ?? tagLabel(slug),
    courses,
    relatedTags,
    categories: [...categories.values()].sort((a, b) => b.courseCount - a.courseCount || a.name.localeCompare(b.name)),
    posts,
  };
}

/* ------------------------------------------------------------------ */
/* Instructors                                                         */
/* ------------------------------------------------------------------ */

export interface InstructorCard {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  headline?: string;
  bio?: string;
  location?: string;
  skills: string[];
  courseCount: number;
  learnerCount: number;
  reviewCount: number;
  averageRating: number | null;
  categories: string[];
}

function instructorStats(db: Database, user: User, courses: CourseSummary[]): InstructorCard {
  const own = courses.filter((c) => c.instructorIds.includes(user.id));
  const ids = new Set(own.map((c) => c.id));
  const learners = new Set(db.enrollments.filter((e) => ids.has(e.courseId) && e.memberType === "student").map((e) => e.userId));
  // Ratings are only shown (and marked up) when reviews are switched on.
  const reviews = db.settings.features.reviews ? db.reviews.filter((r) => ids.has(r.courseId)) : [];
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    skills: user.skills ?? [],
    courseCount: own.length,
    learnerCount: learners.size,
    reviewCount: reviews.length,
    averageRating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : null,
    categories: [...new Set(own.map((c) => c.category?.name).filter((n): n is string => !!n))],
  };
}

/** Enabled users who teach at least one public course, most learners first. */
export async function getInstructorDirectory(search?: string): Promise<InstructorCard[]> {
  const [db, courses] = await Promise.all([getDb(), getPublicCourseSummaries()]);
  const teaching = new Set(courses.flatMap((c) => c.instructorIds));
  const q = search?.trim().toLowerCase();
  return db.users
    .filter((u) => u.enabled && teaching.has(u.id))
    .map((u) => instructorStats(db, u, courses))
    .filter((i) => !q || `${i.name} ${i.headline ?? ""} ${i.skills.join(" ")} ${i.categories.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => b.learnerCount - a.learnerCount || b.courseCount - a.courseCount || a.name.localeCompare(b.name));
}

export interface InstructorProfileData {
  instructor: InstructorCard;
  socials: User["socials"];
  courses: CourseSummary[];
  posts: PostListItem[];
  /** Other instructors teaching in the same categories (then the most followed ones). */
  colleagues: InstructorCard[];
  jsonLd: JsonLdObject;
}

export async function getInstructorProfile(username: string, viewer: User | null = null): Promise<InstructorProfileData | null> {
  const [db, courses, ctx] = await Promise.all([getDb(), getPublicCourseSummaries({ sort: "popular" }, viewer), getSeoContext()]);
  const lower = username.toLowerCase();
  const user = db.users.find((u) => u.username.toLowerCase() === lower && u.enabled);
  if (!user) return null;
  const own = courses.filter((c) => c.instructorIds.includes(user.id));
  if (!own.length) return null;
  const instructor = instructorStats(db, user, courses);
  const posts = db.settings.seo.blogEnabled ? (await getPublicPosts({ authorId: user.id, pageSize: 3 })).items : [];
  const shared = new Set(instructor.categories);
  const colleagues = (await getInstructorDirectory())
    .filter((i) => i.id !== user.id)
    .map((i) => ({ card: i, overlap: i.categories.filter((c) => shared.has(c)).length }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 4)
    .map((x) => x.card);
  const jsonLd = personJsonLd(
    {
      name: user.name,
      path: instructorPath(user.username),
      image: user.avatarUrl,
      jobTitle: user.headline,
      description: user.bio,
      // The community profile is the same person: tie the two pages together.
      sameAs: [...socialUrls(user), profilePath(user.username)],
      knowsAbout: [...new Set([...(user.skills ?? []), ...instructor.categories])],
      location: user.location,
    },
    ctx,
  );
  return { instructor, socials: user.socials, courses: own, posts, colleagues, jsonLd };
}

/** Absolute profile URLs from a user's social links (for sameAs and profile links). */
export function socialUrls(user: Pick<User, "socials">): string[] {
  const s = user.socials;
  if (!s) return [];
  return Object.values(s).filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim()));
}

/* ------------------------------------------------------------------ */
/* Related content                                                     */
/* ------------------------------------------------------------------ */

/** Articles that recommend a course, then recent ones from its category (the "From the blog" block of a course page). */
export async function getCourseArticles(course: Pick<Course, "id" | "categoryId">, limit = 3): Promise<PostListItem[]> {
  const settings = await getSettings();
  if (!settings.seo.blogEnabled) return [];
  const direct = await getPostsForCourse(course.id, limit);
  if (direct.length >= limit || !course.categoryId) return direct;
  const more = await getPublicPosts({ categoryId: course.categoryId, pageSize: limit, excludeIds: direct.map((p) => p.id) });
  return [...direct, ...more.items].slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Admin: indexing overview and redirects                              */
/* ------------------------------------------------------------------ */

export interface IndexingOverview {
  origin: string;
  noindexSite: boolean;
  /** False on localhost and private addresses: search engines cannot reach the site, so nothing is pinged. */
  reachable: boolean;
  sitemap: SitemapSummary;
  sitemapFiles: number;
  feeds: { url: string; title: string }[];
  indexNowKey?: string;
  lastSubmission: IndexNowResult | null;
  redirectCount: number;
}

export async function getIndexingOverview(): Promise<IndexingOverview> {
  const [settings, db] = await Promise.all([getSettings(), getDb()]);
  const origin = siteOrigin();
  const entries = buildSitemap(db, origin);
  return {
    origin,
    noindexSite: settings.seo.noindexSite,
    reachable: isPingableOrigin(origin),
    sitemap: summarizeSitemap(entries, origin),
    sitemapFiles: sitemapChunkCount(entries.length),
    feeds: feedAlternates(settings, origin),
    indexNowKey: isValidIndexNowKey(settings.seo.indexNowKey) ? settings.seo.indexNowKey : undefined,
    lastSubmission: lastIndexNowResult(),
    redirectCount: db.slugRedirects.length,
  };
}

export const REDIRECTS_PAGE_SIZE = 25;

export interface RedirectRow {
  id: string;
  fromPath: string;
  toPath: string;
  createdAt: string;
  status: RedirectTargetStatus;
}

export type RedirectFilter = "all" | "broken";

/** Redirect rows with the state of their destination, newest first. */
export async function listRedirects(query: { search?: string; filter?: RedirectFilter } = {}): Promise<{ rows: RedirectRow[]; total: number; broken: number }> {
  const db = await getDb();
  const index = buildContentIndex(db);
  const all: RedirectRow[] = db.slugRedirects
    .map((r) => ({ id: r.id, fromPath: r.fromPath, toPath: r.toPath, createdAt: r.createdAt, status: redirectTargetStatus(r.toPath, index) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.fromPath.localeCompare(b.fromPath));
  const q = query.search?.trim().toLowerCase();
  const rows = all.filter((r) => (query.filter !== "broken" || r.status === "missing") && (!q || r.fromPath.toLowerCase().includes(q) || r.toPath.toLowerCase().includes(q)));
  return { rows, total: all.length, broken: all.filter((r) => r.status === "missing").length };
}

/* ------------------------------------------------------------------ */
/* HTML sitemap                                                        */
/* ------------------------------------------------------------------ */

export interface HtmlSitemapSection {
  /** Anchor id of the section ("courses", "course-categories"…). */
  id: string;
  title: string;
  /** Where the full, browsable list lives. */
  href?: string;
  links: { label: string; href: string; hint?: string }[];
}

/** Every public page, grouped for the human-readable sitemap at `/sitemap`. */
export async function getHtmlSitemap(): Promise<HtmlSitemapSection[]> {
  const [settings, db] = await Promise.all([getSettings(), getDb()]);
  const guests = guestsCanBrowse(settings);
  const now = Date.now();
  const sections: HtmlSitemapSection[] = [];

  const main: HtmlSitemapSection["links"] = [{ label: "Home", href: "/" }];
  if (guests && settings.features.courses) main.push({ label: "All courses", href: "/courses" }, { label: "Instructors", href: "/instructors" });
  if (guests && settings.features.batches) main.push({ label: "Batches", href: "/batches" });
  if (guests && settings.features.programs) main.push({ label: "Programs", href: "/programs" });
  if (settings.seo.blogEnabled) main.push({ label: "Blog", href: "/blog" });
  if (guests && settings.features.jobs) main.push({ label: "Jobs", href: "/jobs" });
  if (settings.features.certifiedMembers) main.push({ label: "Certified members", href: "/certified-members" });
  main.push({ label: "Free resources", href: "/free" });
  sections.push({ id: "main-pages", title: "Main pages", links: main });

  if (guests && settings.features.courses) {
    const courses = await getPublicCourseSummaries({ sort: "title" });
    const counts = countByCategory(courses);
    const cats = db.categories.filter((c) => counts.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (cats.length) {
      sections.push({ id: "course-categories", title: "Course categories", href: "/courses/category", links: cats.map((c) => ({ label: c.name, href: categoryPath(c.slug), hint: `${counts.get(c.id)}` })) });
    }
    if (courses.length) sections.push({ id: "courses", title: "Courses", href: "/courses", links: courses.map((c) => ({ label: c.title, href: coursePath(c.slug) })) });
    const tags = countTags(courses).sort((a, b) => a.label.localeCompare(b.label));
    if (tags.length) sections.push({ id: "topics", title: "Topics", href: "/courses/tag", links: tags.map((t) => ({ label: t.label, href: tagPath(t.slug), hint: `${t.count}` })) });
    const instructors = (await getInstructorDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    if (instructors.length) sections.push({ id: "instructors", title: "Instructors", href: "/instructors", links: instructors.map((i) => ({ label: i.name, href: instructorPath(i.username) })) });
  }
  if (guests && settings.features.batches) {
    const batches = db.batches.filter(isBatchPublic).sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (batches.length) sections.push({ id: "batches", title: "Batches", href: "/batches", links: batches.map((b) => ({ label: b.title, href: batchPath(b.slug) })) });
  }
  if (guests && settings.features.programs) {
    const programs = db.programs.filter(isProgramPublic).sort((a, b) => a.title.localeCompare(b.title));
    if (programs.length) sections.push({ id: "programs", title: "Programs", href: "/programs", links: programs.map((p) => ({ label: p.title, href: programPath(p.slug) })) });
  }
  if (settings.seo.blogEnabled) {
    const posts = db.blogPosts.filter((p) => isPostPublic(p, now) && !p.noindex).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    if (posts.length) sections.push({ id: "articles", title: "Articles", href: "/blog", links: posts.map((p) => ({ label: p.title, href: postPath(p.slug) })) });
  }
  if (guests && settings.features.jobs) {
    const jobs = db.jobs.filter(isJobPublic).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (jobs.length) sections.push({ id: "jobs", title: "Open jobs", href: "/jobs", links: jobs.map((j) => ({ label: `${j.title} — ${j.company}`, href: jobPath(j.slug) })) });
  }
  const legal = await legalLinks();
  if (legal.length) sections.push({ id: "legal", title: "Legal", links: legal.map((l) => ({ label: l.title, href: l.href })) });
  return sections;
}

/* ------------------------------------------------------------------ */
/* Structured data for pages owned by other areas                      */
/* ------------------------------------------------------------------ */

/**
 * Course + preview video + sales-page FAQ for a public course page. The
 * BreadcrumbList comes from the page's visible `<Breadcrumbs>`.
 */
export async function getCourseJsonLd(course: Course, summary: CourseSummary): Promise<JsonLdObject[]> {
  const [db, ctx] = await Promise.all([getDb(), getSeoContext()]);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const today = new Date().toISOString().slice(0, 10);
  const instances = db.batches
    .filter((b) => isBatchPublic(b) && b.courseIds.includes(course.id) && b.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 5)
    .map((b) => ({
      name: b.title,
      path: batchPath(b.slug),
      startDate: b.startDate,
      endDate: b.endDate,
      startTime: b.startTime,
      endTime: b.endTime,
      medium: b.medium,
      instructors: b.instructorIds.map((id) => users.get(id)).filter((u): u is User => !!u).map((u) => ({ name: u.name, url: instructorPath(u.username) })),
    }));
  // Ratings are only marked up when the page shows them (Google requires visible reviews).
  const showReviews = db.settings.features.reviews;
  const reviews = (showReviews ? db.reviews : [])
    .filter((r) => r.courseId === course.id && r.review.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((r) => ({ author: users.get(r.userId)?.name ?? "Learner", rating: r.rating, body: r.review, date: r.createdAt }));
  const prerequisites = [
    ...course.requirements,
    ...(course.prerequisiteCourseIds ?? []).map((id) => db.courses.find((c) => c.id === id)?.title).filter((t): t is string => !!t),
  ];
  const description = course.metaDescription || course.shortIntroduction || plainText(course.description);
  const out: JsonLdObject[] = [
    courseJsonLd(
      {
        name: course.title,
        description,
        path: coursePath(course.slug),
        image: course.ogImageUrl || course.imageUrl || defaultShareImage(db.settings),
        instructors: summary.instructors.map((i) => ({ name: i.name, url: instructorPath(i.username), image: i.avatarUrl })),
        category: summary.category?.name,
        keywords: splitKeywords(course.metaKeywords, course.tags),
        teaches: course.outcomes,
        prerequisites,
        educationalLevel: inferEducationalLevel(course.tags, course.title),
        totalDurationSeconds: summary.totalDurationSeconds,
        lessonCount: summary.lessonCount,
        free: !course.paidCourse || course.price <= 0,
        price: course.price,
        currency: course.currency,
        upcoming: course.upcoming,
        averageRating: showReviews ? summary.averageRating : null,
        reviewCount: showReviews ? summary.reviewCount : 0,
        reviews,
        instances,
        datePublished: course.publishedOn ?? course.createdAt,
        dateModified: course.updatedAt,
      },
      ctx,
    ),
  ];
  if (course.videoUrl) {
    const path = course.videoUrl.split("?")[0]!;
    out.push(
      videoObjectJsonLd(
        {
          name: `${course.title} — course preview`,
          description,
          thumbnail: course.imageUrl || course.ogImageUrl || defaultShareImage(db.settings),
          uploadDate: course.publishedOn ?? course.createdAt,
          contentUrl: isProtectedVideoPath(path) ? undefined : course.videoUrl,
          embedPath: coursePath(course.slug),
        },
        ctx,
      ),
    );
  }
  const faq = course.salesPage?.faq?.length ? faqPageJsonLd(course.salesPage.faq) : null;
  if (faq) out.push(faq);
  return out;
}

/** The batch as an event plus its upcoming live classes (never the private join links). */
export async function getBatchJsonLd(batch: Batch): Promise<JsonLdObject[]> {
  if (!isBatchPublic(batch)) return [];
  const [db, ctx] = await Promise.all([getDb(), getSeoContext()]);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const performers = batch.instructorIds.map((id) => users.get(id)).filter((u): u is User => !!u).map((u) => ({ name: u.name, url: profilePath(u.username) }));
  const offer = { free: !batch.paidBatch || batch.amount <= 0, price: batch.amount, currency: batch.currency };
  const path = batchPath(batch.slug);
  const out: JsonLdObject[] = [
    educationEventJsonLd(
      {
        name: batch.title,
        description: batch.description || batch.details,
        startDate: new Date(zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone)).toISOString(),
        endDate: new Date(zonedTimeToUtc(batch.endDate, batch.endTime, batch.timezone)).toISOString(),
        path,
        image: batch.imageUrl,
        performers,
        online: batch.medium === "online",
        offer,
      },
      ctx,
    ),
  ];
  const now = Date.now();
  const classes = db.liveClasses
    .filter((c) => c.batchId === batch.id)
    .map((c) => ({ c, start: zonedTimeToUtc(c.date, c.time, c.timezone) }))
    .filter(({ start }) => Number.isFinite(start) && start >= now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 10);
  for (const { c, start } of classes) {
    const host = users.get(c.hostId);
    out.push(
      educationEventJsonLd(
        {
          name: `${c.title} · ${batch.title}`,
          description: c.description,
          startDate: new Date(start).toISOString(),
          endDate: new Date(start + c.durationMinutes * 60_000).toISOString(),
          path,
          image: batch.imageUrl,
          performers: host ? [{ name: host.name, url: profilePath(host.username) }] : performers,
          online: true,
        },
        ctx,
      ),
    );
  }
  return out;
}

/** ItemList of a program's public courses. */
export async function getProgramJsonLd(program: Program): Promise<JsonLdObject[]> {
  if (!isProgramPublic(program)) return [];
  const [db, ctx] = await Promise.all([getDb(), getSeoContext()]);
  const now = Date.now();
  const courses = program.courseIds.map((id) => db.courses.find((c) => c.id === id)).filter((c): c is Course => !!c && isCoursePublic(c, now));
  return [courseItemList(program.title, courses, ctx)];
}

/** JobPosting for an open job (closed jobs get none, so Google drops them from job search). */
export async function getJobJsonLd(job: JobOpening): Promise<JsonLdObject[]> {
  if (!isJobPublic(job)) return [];
  const [settings, ctx] = await Promise.all([getSettings(), getSeoContext()]);
  const validThrough = new Date(Date.parse(job.createdAt) + JOB_AUTO_CLOSE_DAYS * 86_400_000).toISOString();
  return [jobPostingJsonLd({ job, path: jobPath(job.slug), validThrough, currency: settings.commerce.defaultCurrency }, ctx)];
}

/** ProfilePage/Person for a member's public profile. */
export async function getProfileJsonLd(user: Pick<User, "name" | "username" | "avatarUrl" | "headline" | "bio" | "skills" | "location" | "socials">, path: string = profilePath(user.username)): Promise<JsonLdObject[]> {
  const ctx = await getSeoContext();
  return [
    personJsonLd(
      {
        name: user.name,
        path,
        image: user.avatarUrl,
        jobTitle: user.headline,
        description: user.bio,
        sameAs: socialUrls(user),
        knowsAbout: user.skills ?? [],
        location: user.location,
      },
      ctx,
    ),
  ];
}

/** ItemList for a list of courses (catalog, category, tag and instructor pages). */
export function courseItemList(name: string, courses: Pick<Course, "title" | "slug" | "imageUrl">[], ctx: Pick<SeoContext, "origin">): JsonLdObject {
  return itemListJsonLd(name, courses.map((c) => ({ name: c.title, path: coursePath(c.slug), image: c.imageUrl })), ctx);
}
