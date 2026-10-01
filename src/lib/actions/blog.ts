"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionResult, BlogPost } from "@/lib/types";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { canEditPost, canWritePosts } from "@/lib/data/blog";
import {
  autoExcerpt,
  bulkPublishState,
  chooseSlug,
  isBulkPostOperation,
  parsePostInput,
  postReadingTime,
  publishBlockers,
  type BulkPostOperation,
} from "@/lib/seo/blog";
import { syncContentIndex } from "@/lib/seo/content-sync";
import { postPath } from "@/lib/seo/content-index";
import { effectivePostStatus } from "@/lib/seo/visibility";
import { fd, fdBool, uid, uniqueSlug } from "@/lib/utils";

/**
 * Blog Server Actions (round 3). Course creators write and publish their own
 * articles; moderators and admins manage every article and may attribute a
 * post to another author. Every action re-checks the permission on the row it
 * touches. After a change the content index is synced (after the response):
 * a changed slug becomes a 301 redirect and new, updated or removed public
 * posts are submitted to IndexNow (the key is generated on first use).
 */

const NOT_ALLOWED = "You don't have permission to manage blog articles.";
const MAX_BULK = 100;

function afterContentChange(slugs: string[]): void {
  revalidatePath("/", "layout");
  for (const slug of slugs) revalidatePath(postPath(slug));
  revalidatePath("/admin/blog");
  try {
    after(() => syncContentIndex({ force: true }));
  } catch {
    // Outside a request (tests): run the sync now.
    void syncContentIndex({ force: true });
  }
}

function strings(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function raw(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Create or update an article from the editor. Returns its id and slug (the new-post page moves to the edit URL). */
export async function savePostAction(_prev: ActionResult<{ id: string; slug: string }> | null, formData: FormData): Promise<ActionResult<{ id: string; slug: string }>> {
  const user = await getCurrentUser();
  if (!user || !canWritePosts(user)) return { ok: false, error: NOT_ALLOWED };

  const db = await getDb();
  const id = fd(formData, "id");
  const existing = id ? db.blogPosts.find((p) => p.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "This article no longer exists. It may have been deleted." };
  if (existing && !canEditPost(user, existing)) return { ok: false, error: "You can only edit your own articles." };

  const now = Date.now();
  const { value, errors } = parsePostInput(
    {
      title: raw(formData, "title"),
      slug: raw(formData, "slug"),
      excerpt: raw(formData, "excerpt"),
      content: raw(formData, "content"),
      coverImageUrl: raw(formData, "coverImageUrl"),
      categoryIds: strings(formData, "categoryIds"),
      tags: raw(formData, "tags"),
      relatedCourseIds: strings(formData, "relatedCourseIds"),
      faq: raw(formData, "faq"),
      seoTitle: raw(formData, "seoTitle"),
      seoDescription: raw(formData, "seoDescription"),
      canonicalUrl: raw(formData, "canonicalUrl"),
      focusKeyword: raw(formData, "focusKeyword"),
      noindex: fdBool(formData, "noindex"),
      status: fd(formData, "status"),
      publishedAt: fd(formData, "publishedAt"),
    },
    { categoryIds: new Set(db.categories.map((c) => c.id)), courseIds: new Set(db.courses.map((c) => c.id)), now },
  );

  // Slug: a typed slug must be free; one derived from the title is made unique.
  const taken = new Set(db.blogPosts.filter((p) => p.id !== existing?.id).map((p) => p.slug));
  let slug = chooseSlug(value.slug, value.title);
  if (value.slug && !errors.slug && taken.has(slug)) errors.slug = "Another article already uses this address. Pick a different slug.";
  else if (!value.slug) slug = uniqueSlug(slug, taken);

  // Attribution: moderators may credit another writer; everyone else writes as themselves.
  const requestedAuthor = fd(formData, "authorId");
  let authorId = existing?.authorId ?? user.id;
  if (requestedAuthor && isModerator(user)) {
    const author = db.users.find((u) => u.id === requestedAuthor);
    if (!author || !canWritePosts(author)) errors.authorId = "Pick a staff member who can write articles.";
    else authorId = author.id;
  }

  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const nowIso = new Date(now).toISOString();
  const fields = {
    slug,
    title: value.title,
    excerpt: value.excerpt || autoExcerpt(value.content),
    content: value.content,
    coverImageUrl: value.coverImageUrl,
    authorId,
    categoryIds: value.categoryIds,
    tags: value.tags,
    status: value.status,
    publishedAt: value.publishedAt,
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    canonicalUrl: value.canonicalUrl,
    noindex: value.noindex || undefined,
    focusKeyword: value.focusKeyword,
    faq: value.faq.length ? value.faq : undefined,
    relatedCourseIds: value.relatedCourseIds,
    readingTimeSeconds: postReadingTime(value.content),
    updatedAt: nowIso,
  } satisfies Partial<BlogPost>;

  // Captured before the write: `existing` may be the live row that the mutation changes.
  const before = existing ? effectivePostStatus(existing, now) : null;
  const previousSlug = existing?.slug;
  const saved = await mutate((d) => {
    if (existing) {
      const row = d.blogPosts.find((p) => p.id === existing.id);
      if (!row) return null;
      Object.assign(row, fields);
      return row;
    }
    const row: BlogPost = { id: uid("post"), ...fields, views: 0, createdAt: nowIso };
    d.blogPosts.push(row);
    return row;
  });
  if (!saved) return { ok: false, error: "This article no longer exists. It may have been deleted." };

  const status = effectivePostStatus(saved, now);
  await audit(user, existing ? "blog.update" : "blog.create", { type: "blog_post", id: saved.id }, {
    title: saved.title,
    status,
    ...(before && before !== status ? { previousStatus: before } : {}),
    ...(previousSlug && previousSlug !== saved.slug ? { previousSlug } : {}),
    ...(saved.authorId !== user.id ? { authorId: saved.authorId } : {}),
  });

  afterContentChange(previousSlug && previousSlug !== saved.slug ? [previousSlug, saved.slug] : [saved.slug]);

  const message =
    status === "published"
      ? before === "published"
        ? "Article updated"
        : "Article published"
      : status === "scheduled"
        ? "Article scheduled"
        : "Draft saved";
  return { ok: true, data: { id: saved.id, slug: saved.slug }, message };
}

/** Delete one article (the editor and the list ask for confirmation first). */
export async function deletePostAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !canWritePosts(user)) return { ok: false, error: NOT_ALLOWED };
  const db = await getDb();
  const post = db.blogPosts.find((p) => p.id === id);
  if (!post) return { ok: false, error: "This article was already deleted." };
  if (!canEditPost(user, post)) return { ok: false, error: "You can only delete your own articles." };
  await mutate((d) => {
    d.blogPosts = d.blogPosts.filter((p) => p.id !== id);
  });
  await audit(user, "blog.delete", { type: "blog_post", id }, { title: post.title, slug: post.slug });
  afterContentChange([post.slug]);
  return { ok: true, data: undefined, message: "Article deleted" };
}

/** Copy an article as a new draft (same body, categories and SEO fields). */
export async function duplicatePostAction(id: string): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user || !canWritePosts(user)) return { ok: false, error: NOT_ALLOWED };
  const db = await getDb();
  const source = db.blogPosts.find((p) => p.id === id);
  if (!source || !canEditPost(user, source)) return { ok: false, error: "This article is not available." };
  const nowIso = new Date().toISOString();
  const copy: BlogPost = {
    ...source,
    id: uid("post"),
    slug: uniqueSlug(`${source.slug}-copy`, db.blogPosts.map((p) => p.slug)),
    title: `Copy of ${source.title}`.slice(0, 150),
    authorId: isModerator(user) ? source.authorId : user.id,
    status: "draft",
    publishedAt: undefined,
    views: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await mutate((d) => {
    d.blogPosts.push(copy);
  });
  await audit(user, "blog.duplicate", { type: "blog_post", id: copy.id }, { sourceId: source.id });
  revalidatePath("/admin/blog");
  return { ok: true, data: { id: copy.id }, message: "Copy created as a draft" };
}

const BULK_DONE: Record<BulkPostOperation, string> = {
  publish: "published",
  draft: "moved to drafts",
  noindex: "hidden from search engines",
  index: "shown to search engines",
  delete: "deleted",
};

/** Publish, unpublish, (no)index or delete several articles at once. Rows the user may not edit are skipped. */
export async function bulkPostAction(ids: string[], operation: BulkPostOperation): Promise<ActionResult<{ changed: number; skipped: number }>> {
  const user = await getCurrentUser();
  if (!user || !canWritePosts(user)) return { ok: false, error: NOT_ALLOWED };
  if (!isBulkPostOperation(operation)) return { ok: false, error: "Unknown action." };
  const wanted = new Set(ids.filter((id) => typeof id === "string").slice(0, MAX_BULK));
  if (!wanted.size) return { ok: false, error: "Select at least one article." };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const blocked: string[] = [];
  const touched = await mutate((d) => {
    const rows = d.blogPosts.filter((p) => wanted.has(p.id) && canEditPost(user, p));
    const changed: { id: string; slug: string; title: string }[] = [];
    for (const post of rows) {
      if (operation === "publish") {
        const problem = publishBlockers(post);
        if (problem) {
          blocked.push(`“${post.title || "Untitled"}” ${problem}`);
          continue;
        }
        Object.assign(post, bulkPublishState(post, now));
      } else if (operation === "draft") post.status = "draft";
      else if (operation === "noindex") post.noindex = true;
      else if (operation === "index") post.noindex = undefined;
      if (operation !== "delete") post.updatedAt = nowIso;
      changed.push({ id: post.id, slug: post.slug, title: post.title });
    }
    if (operation === "delete") {
      const remove = new Set(changed.map((c) => c.id));
      d.blogPosts = d.blogPosts.filter((p) => !remove.has(p.id));
    }
    return changed;
  });

  const skipped = wanted.size - touched.length;
  if (touched.length) {
    await audit(user, `blog.bulk_${operation}`, undefined, { count: touched.length, ids: touched.map((t) => t.id).join(",") });
    afterContentChange(touched.map((t) => t.slug));
  }
  if (!touched.length) return { ok: false, error: blocked[0] ? `Nothing changed: ${blocked[0]}.` : "None of the selected articles can be changed." };
  const noun = touched.length === 1 ? "1 article" : `${touched.length} articles`;
  const extra = skipped ? ` ${skipped} skipped${blocked[0] ? ` (${blocked[0]})` : ""}.` : "";
  return { ok: true, data: { changed: touched.length, skipped }, message: `${noun} ${BULK_DONE[operation]}.${extra}` };
}
