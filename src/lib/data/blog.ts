import "server-only";
import type { BlogPost, BlogPostStatus, Category, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { hasRole, isModerator } from "@/lib/auth/session";
import { effectivePostStatus, isPostPublic } from "@/lib/seo/visibility";
import { tagLabel, tagSlug } from "@/lib/seo/text";

/**
 * Blog queries (round 3). Posts use the shared course categories. Scheduled
 * posts become public once `publishedAt` passes: reads treat them as
 * published immediately (`effectivePostStatus`) and `publishDuePosts()`
 * writes the status change lazily, so no cron job is needed.
 */

export const BLOG_PAGE_SIZE = 9;
export const ADMIN_BLOG_PAGE_SIZE = 20;

/** Author details safe to render publicly (no email address). */
export interface PostAuthor {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  headline?: string;
  bio?: string;
}

export interface PostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl?: string;
  publishedAt?: string;
  updatedAt: string;
  readingTimeSeconds: number;
  tags: string[];
  categories: Pick<Category, "id" | "name" | "slug">[];
  author: PostAuthor | null;
}

export interface PostPage {
  items: PostListItem[];
  total: number;
  page: number;
  pages: number;
}

function toAuthor(user: User | undefined): PostAuthor | null {
  if (!user) return null;
  return { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl, headline: user.headline, bio: user.bio };
}

function toListItem(post: BlogPost, users: Map<string, User>, categories: Map<string, Category>): PostListItem {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImageUrl: post.coverImageUrl,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    readingTimeSeconds: post.readingTimeSeconds,
    tags: post.tags,
    categories: post.categoryIds
      .map((id) => categories.get(id))
      .filter((c): c is Category => !!c)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    author: toAuthor(users.get(post.authorId)),
  };
}

/** Move scheduled posts whose time has come to "published" (idempotent, cheap when nothing is due). */
export async function publishDuePosts(now: number = Date.now()): Promise<number> {
  const db = await getDb();
  if (!db.blogPosts.some((p) => p.status === "scheduled" && effectivePostStatus(p, now) === "published")) return 0;
  return mutate((d) => {
    let changed = 0;
    for (const post of d.blogPosts) {
      if (post.status === "scheduled" && effectivePostStatus(post, now) === "published") {
        post.status = "published";
        changed++;
      }
    }
    return changed;
  });
}

export interface PublicPostQuery {
  search?: string;
  categoryId?: string;
  tag?: string;
  authorId?: string;
  page?: number;
  pageSize?: number;
  excludeIds?: string[];
}

function matchesSearch(post: BlogPost, q: string): boolean {
  return `${post.title} ${post.excerpt} ${post.tags.join(" ")} ${post.content}`.toLowerCase().includes(q);
}

/** Public posts, newest first, filtered and paginated. */
export async function getPublicPosts(query: PublicPostQuery = {}, now: number = Date.now()): Promise<PostPage> {
  const db = await getDb();
  const q = query.search?.trim().toLowerCase();
  const exclude = new Set(query.excludeIds ?? []);
  const list = db.blogPosts
    .filter((p) => isPostPublic(p, now) && !exclude.has(p.id))
    .filter((p) => !query.categoryId || p.categoryIds.includes(query.categoryId))
    .filter((p) => !query.tag || p.tags.some((t) => tagSlug(t) === query.tag))
    .filter((p) => !query.authorId || p.authorId === query.authorId)
    .filter((p) => !q || matchesSearch(p, q))
    .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  const pageSize = query.pageSize ?? BLOG_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  return {
    items: list.slice((page - 1) * pageSize, page * pageSize).map((p) => toListItem(p, users, categories)),
    total: list.length,
    page,
    pages,
  };
}

export interface PostDetail {
  post: BlogPost;
  author: PostAuthor | null;
  categories: Category[];
  status: BlogPostStatus;
  isPublic: boolean;
}

export async function getPostBySlug(slug: string, now: number = Date.now()): Promise<PostDetail | null> {
  const db = await getDb();
  const post = db.blogPosts.find((p) => p.slug === slug);
  if (!post) return null;
  const author = db.users.find((u) => u.id === post.authorId);
  return {
    post,
    author: toAuthor(author),
    categories: post.categoryIds.map((id) => db.categories.find((c) => c.id === id)).filter((c): c is Category => !!c),
    status: effectivePostStatus(post, now),
    isPublic: isPostPublic(post, now),
  };
}

/** Staff who may read drafts and edit posts (authors of their own posts, moderators and admins everything). */
export function canEditPost(user: Pick<User, "id" | "roles"> | null | undefined, post: Pick<BlogPost, "authorId">): boolean {
  if (!user) return false;
  if (isModerator(user)) return true;
  return hasRole(user, "course_creator") && post.authorId === user.id;
}

export function canWritePosts(user: Pick<User, "roles"> | null | undefined): boolean {
  return hasRole(user, "course_creator", "moderator");
}

/** Posts sharing categories or tags with `post`, best matches first, then newest. */
export async function getRelatedPosts(post: Pick<BlogPost, "id" | "categoryIds" | "tags">, limit = 3, now: number = Date.now()): Promise<PostListItem[]> {
  const db = await getDb();
  const tags = new Set(post.tags.map(tagSlug));
  const cats = new Set(post.categoryIds);
  const scored = db.blogPosts
    .filter((p) => p.id !== post.id && isPostPublic(p, now))
    .map((p) => ({
      post: p,
      score: p.categoryIds.filter((c) => cats.has(c)).length * 2 + p.tags.filter((t) => tags.has(tagSlug(t))).length,
    }))
    .sort((a, b) => b.score - a.score || (b.post.publishedAt ?? "").localeCompare(a.post.publishedAt ?? ""));
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  return scored.slice(0, limit).map((s) => toListItem(s.post, users, categories));
}

/** Categories that have public posts, with counts. */
export async function getBlogCategories(now: number = Date.now()): Promise<(Category & { postCount: number })[]> {
  const db = await getDb();
  const counts = new Map<string, number>();
  for (const p of db.blogPosts) if (isPostPublic(p, now)) for (const id of p.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return db.categories
    .filter((c) => counts.has(c.id))
    .map((c) => ({ ...c, postCount: counts.get(c.id)! }))
    .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name));
}

/** Tags used by public posts: slug, the most common spelling, count. */
export async function getBlogTags(now: number = Date.now()): Promise<{ slug: string; label: string; count: number }[]> {
  const db = await getDb();
  const byTag = new Map<string, { labels: Map<string, number>; count: number }>();
  for (const p of db.blogPosts) {
    if (!isPostPublic(p, now)) continue;
    for (const t of p.tags) {
      const slug = tagSlug(t);
      if (!slug) continue;
      const entry = byTag.get(slug) ?? { labels: new Map(), count: 0 };
      entry.count++;
      entry.labels.set(t, (entry.labels.get(t) ?? 0) + 1);
      byTag.set(slug, entry);
    }
  }
  return [...byTag]
    .map(([slug, e]) => ({ slug, label: [...e.labels].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tagLabel(slug), count: e.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Latest public posts for the footer, HTML sitemap and course pages. */
export async function getLatestPosts(limit = 4): Promise<PostListItem[]> {
  return (await getPublicPosts({ pageSize: limit })).items;
}

/** Public posts that recommend a course (shown on its course page). */
export async function getPostsForCourse(courseId: string, limit = 3, now: number = Date.now()): Promise<PostListItem[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  return db.blogPosts
    .filter((p) => isPostPublic(p, now) && p.relatedCourseIds.includes(courseId))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit)
    .map((p) => toListItem(p, users, categories));
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type AdminPostFilter = "all" | BlogPostStatus;

export interface AdminPostRow extends PostListItem {
  status: BlogPostStatus;
  views: number;
  focusKeyword?: string;
  noindex: boolean;
}

export interface AdminPostQuery {
  status: AdminPostFilter;
  search?: string;
  authorId?: string;
  categoryId?: string;
  page?: number;
}

/** Posts visible in /admin/blog for `viewer` (creators see their own posts, moderators all). */
export async function getAdminPosts(viewer: User, query: AdminPostQuery, now: number = Date.now()) {
  const db = await getDb();
  const q = query.search?.trim().toLowerCase();
  const own = db.blogPosts.filter((p) => isModerator(viewer) || p.authorId === viewer.id);
  const counts: Record<AdminPostFilter, number> = { all: own.length, draft: 0, scheduled: 0, published: 0 };
  for (const p of own) counts[effectivePostStatus(p, now)]++;
  const list = own
    .filter((p) => query.status === "all" || effectivePostStatus(p, now) === query.status)
    .filter((p) => !query.authorId || p.authorId === query.authorId)
    .filter((p) => !query.categoryId || p.categoryIds.includes(query.categoryId))
    .filter((p) => !q || `${p.title} ${p.slug} ${p.tags.join(" ")} ${p.focusKeyword ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pages = Math.max(1, Math.ceil(list.length / ADMIN_BLOG_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  const rows: AdminPostRow[] = list.slice((page - 1) * ADMIN_BLOG_PAGE_SIZE, page * ADMIN_BLOG_PAGE_SIZE).map((p) => ({
    ...toListItem(p, users, categories),
    status: effectivePostStatus(p, now),
    views: p.views,
    focusKeyword: p.focusKeyword,
    noindex: !!p.noindex,
  }));
  const authors = [...new Set(own.map((p) => p.authorId))]
    .map((id) => users.get(id))
    .filter((u): u is User => !!u)
    .map((u) => ({ id: u.id, name: u.name }));
  return { rows, total: list.length, page, pages, counts, authors };
}

export async function getPostById(id: string): Promise<BlogPost | null> {
  const db = await getDb();
  return db.blogPosts.find((p) => p.id === id) ?? null;
}
