import type { Batch, BlogPost, Course, JobOpening, LegalPage, Program, Settings } from "@/lib/types";

/**
 * What anonymous visitors (and therefore search engines) can see. Shared by
 * the sitemap, RSS feeds, landing pages, internal links and IndexNow so a
 * draft, a scheduled item or a private batch never leaks into any of them.
 * Pure: every function takes `now` for tests.
 */

/** Whether guests may browse the catalog pages at all (otherwise they are sent to the login page). */
export function guestsCanBrowse(settings: Pick<Settings, "learning">): boolean {
  return settings.learning.allowGuestAccess;
}

/** A published course whose scheduled publish time (if any) has passed. */
export function isCoursePublic(course: Pick<Course, "published" | "publishAt">, now: number = Date.now()): boolean {
  if (!course.published) return false;
  if (course.publishAt) {
    const at = Date.parse(course.publishAt);
    if (Number.isFinite(at) && at > now) return false;
  }
  return true;
}

/** Published batches are public; unpublished ones are private (enrolled learners and staff only). */
export function isBatchPublic(batch: Pick<Batch, "published">): boolean {
  return batch.published;
}

export function isProgramPublic(program: Pick<Program, "published">): boolean {
  return program.published;
}

export function isJobPublic(job: Pick<JobOpening, "status">): boolean {
  return job.status === "open";
}

export function isLegalPagePublic(page: Pick<LegalPage, "published">): boolean {
  return page.published;
}

/**
 * Effective status of a post: a scheduled post whose time has come counts as
 * published even before the lazy status update has been written.
 */
export function effectivePostStatus(post: Pick<BlogPost, "status" | "publishedAt">, now: number = Date.now()): BlogPost["status"] {
  if (post.status === "scheduled" && post.publishedAt && Date.parse(post.publishedAt) <= now) return "published";
  return post.status;
}

/** Readable by anyone (published, publication time reached). */
export function isPostPublic(post: Pick<BlogPost, "status" | "publishedAt">, now: number = Date.now()): boolean {
  if (effectivePostStatus(post, now) !== "published") return false;
  if (post.publishedAt && Date.parse(post.publishedAt) > now) return false;
  return true;
}

/** Public and meant for search engines (not noindexed, not canonicalised to another URL). */
export function isPostIndexable(post: Pick<BlogPost, "status" | "publishedAt" | "noindex" | "canonicalUrl">, ownUrl: string, now: number = Date.now()): boolean {
  if (!isPostPublic(post, now) || post.noindex) return false;
  const canonical = post.canonicalUrl?.trim();
  return !canonical || canonical === ownUrl;
}
