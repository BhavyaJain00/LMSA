import type { Database } from "@/lib/types";
import type { ContentIndex } from "./redirects";
import { guestsCanBrowse, isBatchPublic, isCoursePublic, isJobPublic, isPostPublic, isProgramPublic } from "./visibility";

/**
 * Snapshot of every page whose URL is derived from a slug: the content sync
 * compares consecutive snapshots to detect slug changes (→ permanent
 * redirects) and new or updated public pages (→ IndexNow pings), so no
 * editor has to remember to call anything. Pure.
 */

export const coursePath = (slug: string) => `/courses/${slug}`;
export const batchPath = (slug: string) => `/batches/${slug}`;
export const programPath = (slug: string) => `/programs/${slug}`;
export const jobPath = (slug: string) => `/jobs/${slug}`;
export const postPath = (slug: string) => `/blog/${slug}`;
export const categoryPath = (slug: string) => `/courses/category/${slug}`;
export const blogCategoryPath = (slug: string) => `/blog/category/${slug}`;
export const tagPath = (tagSlug: string) => `/courses/tag/${tagSlug}`;
export const blogTagPath = (tagSlug: string) => `/blog/tag/${tagSlug}`;
export const instructorPath = (username: string) => `/instructors/${encodeURIComponent(username)}`;
export const profilePath = (username: string) => `/user/${encodeURIComponent(username)}`;
export const legalPath = (slug: string) => `/legal/${slug}`;
export const certificatePath = (code: string) => `/certificates/${encodeURIComponent(code)}`;

/** FNV-1a hash (hex) — a cheap change detector for rows without an `updatedAt`. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function buildContentIndex(db: Pick<Database, "courses" | "batches" | "programs" | "jobs" | "blogPosts" | "categories" | "settings">, now: number = Date.now()): ContentIndex {
  const guests = guestsCanBrowse(db.settings);
  const index: ContentIndex = {};
  for (const c of db.courses) {
    index[`course:${c.id}`] = { path: coursePath(c.slug), public: guests && db.settings.features.courses && isCoursePublic(c, now), stamp: `${c.updatedAt}|${c.publishAt ?? ""}` };
  }
  for (const b of db.batches) {
    index[`batch:${b.id}`] = { path: batchPath(b.slug), public: guests && db.settings.features.batches && isBatchPublic(b), stamp: b.updatedAt };
  }
  for (const p of db.programs) {
    index[`program:${p.id}`] = { path: programPath(p.slug), public: guests && db.settings.features.programs && isProgramPublic(p), stamp: p.updatedAt };
  }
  for (const j of db.jobs) {
    index[`job:${j.id}`] = { path: jobPath(j.slug), public: guests && db.settings.features.jobs && isJobPublic(j), stamp: j.updatedAt };
  }
  for (const post of db.blogPosts) {
    index[`post:${post.id}`] = {
      path: postPath(post.slug),
      public: db.settings.seo.blogEnabled && isPostPublic(post, now) && !post.noindex,
      stamp: `${post.updatedAt}|${post.publishedAt ?? ""}`,
    };
  }
  for (const cat of db.categories) {
    index[`category:${cat.id}`] = {
      path: categoryPath(cat.slug),
      public: guests && db.settings.features.courses,
      stamp: fingerprint([cat.name, cat.intro ?? "", cat.seoTitle ?? "", cat.seoDescription ?? ""].join("|")),
    };
  }
  return index;
}
