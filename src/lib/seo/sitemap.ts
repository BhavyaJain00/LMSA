import type { MetadataRoute } from "next";
import type { Course, Database } from "@/lib/types";
import { isProtectedVideoPath } from "@/lib/media/paths";
import {
  batchPath,
  blogCategoryPath,
  blogTagPath,
  categoryPath,
  coursePath,
  instructorPath,
  jobPath,
  legalPath,
  postPath,
  programPath,
  tagPath,
} from "./content-index";
import { defaultShareImage } from "./metadata";
import { absoluteUrl } from "./site";
import { plainText, tagSlug } from "./text";
import { guestsCanBrowse, isBatchPublic, isCoursePublic, isJobPublic, isLegalPagePublic, isPostIndexable, isProgramPublic } from "./visibility";

/**
 * sitemap.xml entries (pure). Only pages an anonymous visitor can open and
 * that are meant to be indexed are listed: published courses (scheduled ones
 * once their time has come), published batches (private ones are
 * unpublished), published programs, public blog posts that are not
 * noindexed or canonicalised elsewhere, open jobs, published legal pages, and
 * the landing pages that have content. Course covers are listed as images and
 * public preview videos as videos.
 */

export type SitemapEntry = MetadataRoute.Sitemap[number];
type SitemapDb = Pick<Database, "courses" | "batches" | "programs" | "jobs" | "blogPosts" | "categories" | "users" | "legalPages" | "settings">;

/** Google's per-file limit; larger sitemaps are split behind a sitemap index (see sitemap-xml.ts). */
export const SITEMAP_MAX_URLS = 50_000;

function latest(dates: (string | undefined)[]): string | undefined {
  let best: string | undefined;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

/** Public courses, newest first. */
export function publicCourses(db: Pick<Database, "courses" | "settings">, now: number): Course[] {
  if (!guestsCanBrowse(db.settings) || !db.settings.features.courses) return [];
  return db.courses.filter((c) => isCoursePublic(c, now)).sort((a, b) => (b.publishedOn ?? b.createdAt).localeCompare(a.publishedOn ?? a.createdAt));
}

export function buildSitemap(db: SitemapDb, origin: string, now: number = Date.now()): SitemapEntry[] {
  const { settings } = db;
  if (settings.seo.noindexSite) return [];
  const url = (path: string) => absoluteUrl(path, origin)!;
  const entries: SitemapEntry[] = [];
  const guests = guestsCanBrowse(settings);
  const courses = publicCourses(db, now);
  const coursesUpdated = latest(courses.map((c) => c.updatedAt));

  entries.push({ url: origin, lastModified: coursesUpdated, changeFrequency: "daily", priority: 1 });

  /* Courses, categories, tags */
  if (courses.length) {
    entries.push({ url: url("/courses"), lastModified: coursesUpdated, changeFrequency: "daily", priority: 0.9 });
    for (const c of courses) {
      const image = absoluteUrl(c.imageUrl, origin);
      const promo = c.videoUrl && !isProtectedVideoPath(c.videoUrl.split("?")[0]!) ? absoluteUrl(c.videoUrl, origin) : undefined;
      entries.push({
        url: url(coursePath(c.slug)),
        lastModified: c.updatedAt,
        changeFrequency: "weekly",
        priority: c.featured ? 0.9 : 0.8,
        images: image ? [image] : undefined,
        videos: promo
          ? [
              {
                title: c.title,
                description: plainText(c.metaDescription || c.shortIntroduction || c.description).slice(0, 2048) || c.title,
                thumbnail_loc: image ?? url(defaultShareImage(settings)),
                content_loc: promo,
                publication_date: c.publishedOn ?? c.createdAt,
                family_friendly: "yes",
              },
            ]
          : undefined,
      });
    }
    const usedCategories = new Map<string, string>();
    for (const c of courses) if (c.categoryId) usedCategories.set(c.categoryId, latest([usedCategories.get(c.categoryId), c.updatedAt])!);
    for (const cat of db.categories) {
      const updated = usedCategories.get(cat.id);
      if (updated) entries.push({ url: url(categoryPath(cat.slug)), lastModified: updated, changeFrequency: "weekly", priority: 0.7 });
    }
    const tags = new Map<string, string>();
    for (const c of courses) for (const t of c.tags) if (tagSlug(t)) tags.set(tagSlug(t), latest([tags.get(tagSlug(t)), c.updatedAt])!);
    for (const [slug, updated] of [...tags].sort(([a], [b]) => a.localeCompare(b))) {
      entries.push({ url: url(tagPath(slug)), lastModified: updated, changeFrequency: "weekly", priority: 0.5 });
    }

    /* Instructors teaching at least one public course */
    const teaching = new Map<string, string>();
    for (const c of courses) for (const id of c.instructorIds) teaching.set(id, latest([teaching.get(id), c.updatedAt])!);
    const instructors = db.users.filter((u) => u.enabled && teaching.has(u.id));
    if (instructors.length) {
      entries.push({ url: url("/instructors"), changeFrequency: "weekly", priority: 0.6 });
      for (const u of instructors) {
        entries.push({ url: url(instructorPath(u.username)), lastModified: teaching.get(u.id), changeFrequency: "monthly", priority: 0.5, images: u.avatarUrl && absoluteUrl(u.avatarUrl, origin) ? [absoluteUrl(u.avatarUrl, origin)!] : undefined });
      }
    }
  }

  /* Batches and programs */
  if (guests && settings.features.batches) {
    const batches = db.batches.filter(isBatchPublic);
    if (batches.length) {
      entries.push({ url: url("/batches"), lastModified: latest(batches.map((b) => b.updatedAt)), changeFrequency: "weekly", priority: 0.7 });
      for (const b of batches) {
        const ended = Date.parse(`${b.endDate}T23:59:59Z`) < now;
        const image = absoluteUrl(b.imageUrl, origin);
        entries.push({ url: url(batchPath(b.slug)), lastModified: b.updatedAt, changeFrequency: ended ? "yearly" : "weekly", priority: ended ? 0.3 : 0.7, images: image ? [image] : undefined });
      }
    }
  }
  if (guests && settings.features.programs) {
    const programs = db.programs.filter(isProgramPublic);
    if (programs.length) {
      entries.push({ url: url("/programs"), lastModified: latest(programs.map((p) => p.updatedAt)), changeFrequency: "weekly", priority: 0.6 });
      for (const p of programs) entries.push({ url: url(programPath(p.slug)), lastModified: p.updatedAt, changeFrequency: "weekly", priority: 0.6 });
    }
  }

  /* Blog */
  if (settings.seo.blogEnabled) {
    const posts = db.blogPosts
      .filter((p) => isPostIndexable(p, url(postPath(p.slug)), now))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    entries.push({ url: url("/blog"), lastModified: latest(posts.map((p) => p.updatedAt)), changeFrequency: "daily", priority: 0.8 });
    const blogCats = new Map<string, string>();
    const blogTags = new Map<string, string>();
    for (const p of posts) {
      const recent = now - Date.parse(p.publishedAt ?? p.createdAt) < 30 * 86_400_000;
      const image = absoluteUrl(p.coverImageUrl, origin);
      entries.push({ url: url(postPath(p.slug)), lastModified: p.updatedAt, changeFrequency: recent ? "weekly" : "monthly", priority: 0.7, images: image ? [image] : undefined });
      for (const id of p.categoryIds) blogCats.set(id, latest([blogCats.get(id), p.updatedAt])!);
      for (const t of p.tags) if (tagSlug(t)) blogTags.set(tagSlug(t), latest([blogTags.get(tagSlug(t)), p.updatedAt])!);
    }
    for (const cat of db.categories) {
      const updated = blogCats.get(cat.id);
      if (updated) entries.push({ url: url(blogCategoryPath(cat.slug)), lastModified: updated, changeFrequency: "weekly", priority: 0.5 });
    }
    for (const [slug, updated] of [...blogTags].sort(([a], [b]) => a.localeCompare(b))) {
      entries.push({ url: url(blogTagPath(slug)), lastModified: updated, changeFrequency: "weekly", priority: 0.4 });
    }
  }

  /* Jobs */
  if (guests && settings.features.jobs) {
    const jobs = db.jobs.filter(isJobPublic);
    if (jobs.length) {
      entries.push({ url: url("/jobs"), lastModified: latest(jobs.map((j) => j.updatedAt)), changeFrequency: "daily", priority: 0.6 });
      for (const j of jobs) entries.push({ url: url(jobPath(j.slug)), lastModified: j.updatedAt, changeFrequency: "weekly", priority: 0.5 });
    }
  }

  /* Evergreen pages */
  entries.push({ url: url("/free"), changeFrequency: "monthly", priority: 0.6 });
  entries.push({ url: url("/sitemap"), changeFrequency: "weekly", priority: 0.3 });
  for (const page of db.legalPages.filter(isLegalPagePublic)) {
    entries.push({ url: url(legalPath(page.slug)), lastModified: page.updatedAt, changeFrequency: "yearly", priority: 0.2 });
  }

  return entries;
}
