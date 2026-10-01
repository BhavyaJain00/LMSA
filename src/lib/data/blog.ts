import "server-only";
import type { BlogPost, BlogPostStatus, Category, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { hasRole, isModerator } from "@/lib/auth/session";
import { effectivePostStatus, isCoursePublic, isPostPublic } from "@/lib/seo/visibility";
import { tagLabel, tagSlug } from "@/lib/seo/text";
import { instructorPath, postPath, profilePath } from "@/lib/seo/content-index";
import type { AdminPostFilter } from "@/lib/seo/blog";
import { notify } from "@/lib/services/notifications";

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

/**
 * Move scheduled posts whose time has come to "published" (idempotent, cheap
 * when nothing is due) and tell each author their article is live.
 */
export async function publishDuePosts(now: number = Date.now()): Promise<number> {
  const db = await getDb();
  if (!db.blogPosts.some((p) => p.status === "scheduled" && effectivePostStatus(p, now) === "published")) return 0;
  const published = await mutate((d) => {
    const out: Pick<BlogPost, "id" | "slug" | "title" | "authorId">[] = [];
    for (const post of d.blogPosts) {
      if (post.status === "scheduled" && effectivePostStatus(post, now) === "published") {
        post.status = "published";
        out.push({ id: post.id, slug: post.slug, title: post.title, authorId: post.authorId });
      }
    }
    return out;
  });
  for (const post of published) {
    await notify(post.authorId, {
      type: "system",
      subject: `Your article “${post.title}” is now live`,
      message: "The scheduled publication time has passed, so the article is now on the blog and in the sitemap.",
      link: postPath(post.slug),
      dedupeKey: `blog-live:${post.id}`,
    }).catch(() => undefined);
  }
  return published.length;
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
  /** Rows per page (the CSV export asks for every row). */
  pageSize?: number;
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
  const pageSize = query.pageSize ?? ADMIN_BLOG_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  const rows: AdminPostRow[] = list.slice((page - 1) * pageSize, page * pageSize).map((p) => ({
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

/* ------------------------------------------------------------------ */
/* Archive pages                                                       */
/* ------------------------------------------------------------------ */

export interface BlogCategoryLanding {
  category: Category;
  posts: PostPage;
  /** Other categories with public posts (internal links). */
  otherCategories: (Category & { postCount: number })[];
}

/** /blog/category/[slug]: the category (only when it has public posts) and one page of them. */
export async function getBlogCategoryLanding(slug: string, page = 1, now: number = Date.now()): Promise<BlogCategoryLanding | null> {
  const categories = await getBlogCategories(now);
  const category = categories.find((c) => c.slug === slug);
  if (!category) return null;
  const posts = await getPublicPosts({ categoryId: category.id, page }, now);
  return { category, posts, otherCategories: categories.filter((c) => c.id !== category.id) };
}

export interface BlogTagLanding {
  slug: string;
  label: string;
  posts: PostPage;
  relatedTags: { slug: string; label: string; count: number }[];
}

/** /blog/tag/[tag]: the most common spelling of the tag and one page of its posts. */
export async function getBlogTagLanding(slug: string, page = 1, now: number = Date.now()): Promise<BlogTagLanding | null> {
  const tags = await getBlogTags(now);
  const tag = tags.find((t) => t.slug === slug);
  if (!tag) return null;
  const posts = await getPublicPosts({ tag: slug, page }, now);
  // Tags that appear on the same posts, most shared first.
  const db = await getDb();
  const shared = new Map<string, number>();
  for (const p of db.blogPosts) {
    if (!isPostPublic(p, now) || !p.tags.some((t) => tagSlug(t) === slug)) continue;
    for (const t of p.tags) {
      const s = tagSlug(t);
      if (s && s !== slug) shared.set(s, (shared.get(s) ?? 0) + 1);
    }
  }
  const relatedTags = tags
    .filter((t) => shared.has(t.slug))
    .sort((a, b) => shared.get(b.slug)! - shared.get(a.slug)! || b.count - a.count)
    .slice(0, 12);
  return { slug, label: tag.label, posts, relatedTags };
}

/* ------------------------------------------------------------------ */
/* Post page extras                                                    */
/* ------------------------------------------------------------------ */

/** Count a read. Called after the response for visitors who are not bots or the post's editors. */
export async function recordPostView(postId: string): Promise<void> {
  await mutate((d) => {
    const post = d.blogPosts.find((p) => p.id === postId);
    if (post) post.views = (post.views ?? 0) + 1;
  });
}

/** Public profile path for an author: the teaching profile when they teach a public course. */
export async function authorProfilePath(authorId: string): Promise<string | null> {
  const db = await getDb();
  const user = db.users.find((u) => u.id === authorId);
  if (!user) return null;
  const now = Date.now();
  const teaches = db.courses.some((c) => isCoursePublic(c, now) && c.instructorIds.includes(authorId));
  return teaches ? instructorPath(user.username) : profilePath(user.username);
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export interface PostEditorOptions {
  categories: Pick<Category, "id" | "name">[];
  courses: { id: string; title: string; published: boolean }[];
  /** Staff the post can be attributed to (moderators only; empty for creators). */
  authors: { id: string; name: string }[];
}

export async function getPostEditorOptions(viewer: User): Promise<PostEditorOptions> {
  const db = await getDb();
  return {
    categories: db.categories.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    courses: db.courses
      .map((c) => ({ id: c.id, title: c.title, published: c.published }))
      .sort((a, b) => Number(b.published) - Number(a.published) || a.title.localeCompare(b.title)),
    authors: isModerator(viewer)
      ? db.users
          .filter((u) => canWritePosts(u) && u.enabled !== false)
          .map((u) => ({ id: u.id, name: u.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
  };
}
