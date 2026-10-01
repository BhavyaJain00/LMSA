import type { BlogPostStatus, FaqItem } from "@/lib/types";
import { readingTimeSeconds } from "@/lib/utils";
import { isValidSlug, plainText, suggestSlug } from "./text";

/**
 * Blog post rules shared by the editor (live checks) and the Server Actions
 * (validation). Pure and isomorphic.
 */

export const POST_LIMITS = {
  title: 150,
  excerpt: 300,
  content: 200_000,
  seoTitle: 70,
  seoDescription: 200,
  focusKeyword: 80,
  tags: 12,
  tag: 40,
  categories: 5,
  relatedCourses: 6,
  faq: 20,
  faqQuestion: 200,
  faqAnswer: 2000,
} as const;

/** Remove fenced code blocks so "# comments" inside code are not taken for headings. */
export function stripCodeFences(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m) {
      if (!fence) fence = m[1]!;
      else if (m[1] === fence) fence = null;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out.join("\n");
}

/** Excerpt from the post body when the author left it empty (first ~2 sentences of real text). */
export function autoExcerpt(markdown: string, max = 220): string {
  const text = plainText(stripCodeFences(markdown).replace(/^#{1,6}\s.*$/gm, ""));
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : max).replace(/[\s,;:.-]+$/, "")}…`;
}

export interface PublishState {
  status: BlogPostStatus;
  publishedAt?: string;
}

/**
 * Normalise the requested status and date:
 *  - "published" without a date is published now; a future date turns it into "scheduled";
 *  - "scheduled" needs a date; a date in the past publishes immediately;
 *  - drafts keep their date (it becomes the planned date).
 */
export function resolvePublishState(requested: BlogPostStatus, dateIso: string | undefined, now: number = Date.now()): PublishState | { error: string } {
  const at = dateIso ? Date.parse(dateIso) : NaN;
  const hasDate = Number.isFinite(at);
  if (requested === "draft") return { status: "draft", publishedAt: hasDate ? new Date(at).toISOString() : undefined };
  if (requested === "scheduled") {
    if (!hasDate) return { error: "Pick the date and time the post should go live." };
    return at > now ? { status: "scheduled", publishedAt: new Date(at).toISOString() } : { status: "published", publishedAt: new Date(at).toISOString() };
  }
  if (hasDate && at > now) return { status: "scheduled", publishedAt: new Date(at).toISOString() };
  return { status: "published", publishedAt: hasDate ? new Date(at).toISOString() : new Date(now).toISOString() };
}

/** Clean tag list: trimmed, de-duplicated case-insensitively, bounded. */
export function normalizeTags(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const tag = part.replace(/\s+/g, " ").trim().slice(0, POST_LIMITS.tag);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= POST_LIMITS.tags) break;
  }
  return out;
}

/** Parse FAQ items from untrusted JSON; drops empty rows and bounds lengths. */
export function normalizeFaq(raw: unknown): FaqItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FaqItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = typeof (item as FaqItem).question === "string" ? (item as FaqItem).question.trim().slice(0, POST_LIMITS.faqQuestion) : "";
    const a = typeof (item as FaqItem).answer === "string" ? (item as FaqItem).answer.trim().slice(0, POST_LIMITS.faqAnswer) : "";
    if (q && a) out.push({ question: q, answer: a });
    if (out.length >= POST_LIMITS.faq) break;
  }
  return out;
}

export interface PostDraftInput {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  focusKeyword: string;
}

/** Field errors for the text fields of a post (empty object when valid). */
export function validatePostFields(input: PostDraftInput, opts: { publishing: boolean }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.title.trim()) errors.title = "Give the post a title.";
  else if (input.title.length > POST_LIMITS.title) errors.title = `Keep the title under ${POST_LIMITS.title} characters.`;
  if (input.slug && !isValidSlug(input.slug)) errors.slug = "Use lowercase letters, numbers and single hyphens.";
  if (input.excerpt.length > POST_LIMITS.excerpt) errors.excerpt = `Keep the excerpt under ${POST_LIMITS.excerpt} characters.`;
  if (input.content.length > POST_LIMITS.content) errors.content = "The post is too long.";
  if (opts.publishing && plainText(input.content).length < 50) errors.content = "Write the article before publishing it.";
  if (input.coverImageUrl && !isAssetUrl(input.coverImageUrl)) errors.coverImageUrl = "Upload an image or enter a valid image URL.";
  if (input.seoTitle.length > POST_LIMITS.seoTitle) errors.seoTitle = `Search engines cut titles after about 60 characters — keep it under ${POST_LIMITS.seoTitle}.`;
  if (input.seoDescription.length > POST_LIMITS.seoDescription) errors.seoDescription = `Keep the meta description under ${POST_LIMITS.seoDescription} characters.`;
  if (input.canonicalUrl && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(input.canonicalUrl)) errors.canonicalUrl = "Enter the full URL, starting with https://.";
  if (input.focusKeyword.length > POST_LIMITS.focusKeyword) errors.focusKeyword = "Use a short phrase as the focus keyword.";
  return errors;
}

/** Site-relative path or http(s) URL (no protocol-relative or script URLs). */
export function isAssetUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//");
  return /^https?:\/\/[^\s]+$/i.test(value);
}

/** Slug to store: the typed one when valid, otherwise suggested from the title. */
export function chooseSlug(typed: string, title: string): string {
  const clean = typed.trim().toLowerCase();
  return clean && isValidSlug(clean) ? clean : suggestSlug(title);
}

export function postReadingTime(markdown: string): number {
  return readingTimeSeconds(stripCodeFences(markdown));
}

/** Share links for a post (no third-party scripts: plain URLs). */
export function shareLinks(url: string, title: string): { network: string; label: string; href: string }[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { network: "x", label: "Share on X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { network: "linkedin", label: "Share on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { network: "facebook", label: "Share on Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { network: "email", label: "Share by email", href: `mailto:?subject=${t}&body=${u}` },
  ];
}

/* ------------------------------------------------------------------ */
/* Editor form parsing                                                 */
/* ------------------------------------------------------------------ */

/** Raw editor values (strings straight from the form; lists already split). */
export interface RawPostInput {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  categoryIds: string[];
  tags: string;
  relatedCourseIds: string[];
  /** JSON array of { question, answer }. */
  faq: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  focusKeyword: string;
  noindex: boolean;
  status: string;
  /** ISO date-time (the editor converts the local date and time). */
  publishedAt: string;
}

export interface ParsedPost {
  title: string;
  /** Empty when the slug should be derived from the title. */
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl?: string;
  categoryIds: string[];
  tags: string[];
  relatedCourseIds: string[];
  faq: FaqItem[];
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  focusKeyword?: string;
  noindex: boolean;
  status: BlogPostStatus;
  publishedAt?: string;
}

export const POST_STATUSES: readonly BlogPostStatus[] = ["draft", "scheduled", "published"];

export function isPostStatus(value: unknown): value is BlogPostStatus {
  return typeof value === "string" && (POST_STATUSES as readonly string[]).includes(value);
}

function parseFaqJson(raw: string): unknown {
  if (!raw.trim()) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validate and normalise everything the editor sends. Unknown category and
 * course ids are dropped (they may have been deleted while the editor was
 * open), lists are bounded, and the status/date pair goes through
 * `resolvePublishState`.
 */
export function parsePostInput(
  raw: RawPostInput,
  ctx: { categoryIds: ReadonlySet<string>; courseIds: ReadonlySet<string>; now?: number },
): { value: ParsedPost; errors: Record<string, string> } {
  const requested: BlogPostStatus = isPostStatus(raw.status) ? raw.status : "draft";
  const title = raw.title.replace(/\s+/g, " ").trim();
  const slug = raw.slug.trim().toLowerCase();
  const fields: PostDraftInput = {
    title,
    slug,
    excerpt: raw.excerpt.trim(),
    content: raw.content,
    coverImageUrl: raw.coverImageUrl.trim(),
    seoTitle: raw.seoTitle.replace(/\s+/g, " ").trim(),
    seoDescription: raw.seoDescription.replace(/\s+/g, " ").trim(),
    canonicalUrl: raw.canonicalUrl.trim(),
    focusKeyword: raw.focusKeyword.replace(/\s+/g, " ").trim(),
  };
  const errors = validatePostFields(fields, { publishing: requested !== "draft" });

  const categoryIds = [...new Set(raw.categoryIds)].filter((id) => ctx.categoryIds.has(id));
  if (categoryIds.length > POST_LIMITS.categories) errors.categoryIds = `Pick at most ${POST_LIMITS.categories} categories.`;
  const relatedCourseIds = [...new Set(raw.relatedCourseIds)].filter((id) => ctx.courseIds.has(id));
  if (relatedCourseIds.length > POST_LIMITS.relatedCourses) errors.relatedCourseIds = `Pick at most ${POST_LIMITS.relatedCourses} courses.`;

  const faqRaw = parseFaqJson(raw.faq);
  if (faqRaw === null) errors.faq = "The FAQ could not be read. Reload the editor and try again.";
  const faq = normalizeFaq(faqRaw);

  const publish = resolvePublishState(requested, raw.publishedAt.trim() || undefined, ctx.now);
  if ("error" in publish) errors.publishedAt = publish.error;

  return {
    errors,
    value: {
      title,
      slug,
      excerpt: fields.excerpt,
      content: fields.content,
      coverImageUrl: fields.coverImageUrl || undefined,
      categoryIds: categoryIds.slice(0, POST_LIMITS.categories),
      tags: normalizeTags(raw.tags),
      relatedCourseIds: relatedCourseIds.slice(0, POST_LIMITS.relatedCourses),
      faq,
      seoTitle: fields.seoTitle || undefined,
      seoDescription: fields.seoDescription || undefined,
      canonicalUrl: fields.canonicalUrl || undefined,
      focusKeyword: fields.focusKeyword || undefined,
      noindex: raw.noindex,
      status: "error" in publish ? requested : publish.status,
      publishedAt: "error" in publish ? undefined : publish.publishedAt,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** The `<title>` of a post: its SEO title, else its headline. */
export function postDocumentTitle(post: { title: string; seoTitle?: string }): string {
  return post.seoTitle?.trim() || post.title;
}

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Table of contents from the headings the renderer outputs (H2 and H3 only;
 * H1 is the post title). `headings` comes from `extractHeadings` of the
 * markdown renderer so ids always match the rendered anchors; repeated ids
 * keep their first occurrence. Shown only when there are at least `min`
 * entries — a two-heading article does not need one.
 */
export function buildToc(headings: { level: number; text: string; id: string }[], min = 3): TocEntry[] {
  const seen = new Set<string>();
  const out: TocEntry[] = [];
  for (const h of headings) {
    if ((h.level !== 2 && h.level !== 3) || !h.id || seen.has(h.id)) continue;
    seen.add(h.id);
    const text = plainText(h.text);
    if (text) out.push({ id: h.id, text, level: h.level });
  }
  return out.length >= min ? out : [];
}

/** Crawlers, link unfurlers and monitoring probes do not count as readers. */
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|curl|wget|python|headless|lighthouse|monitor/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

/* ------------------------------------------------------------------ */
/* Admin list                                                          */
/* ------------------------------------------------------------------ */

export type AdminPostFilter = "all" | BlogPostStatus;

export function parseAdminPostFilter(raw: string | string[] | undefined): AdminPostFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isPostStatus(value) ? value : "all";
}

export type BulkPostOperation = "publish" | "draft" | "noindex" | "index" | "delete";
export const BULK_POST_OPERATIONS: readonly BulkPostOperation[] = ["publish", "draft", "noindex", "index", "delete"];

export function isBulkPostOperation(value: unknown): value is BulkPostOperation {
  return typeof value === "string" && (BULK_POST_OPERATIONS as readonly string[]).includes(value);
}

/** Status after a bulk "publish": scheduled posts keep their future date, drafts go live now. */
export function bulkPublishState(post: { status: BlogPostStatus; publishedAt?: string }, now: number = Date.now()): PublishState {
  const at = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
  if (Number.isFinite(at) && at > now) return { status: "scheduled", publishedAt: new Date(at).toISOString() };
  if (post.status === "published" && Number.isFinite(at)) return { status: "published", publishedAt: new Date(at).toISOString() };
  return { status: "published", publishedAt: new Date(now).toISOString() };
}

/** Problems that keep a post from being published by a bulk action. */
export function publishBlockers(post: { title: string; content: string }): string | null {
  if (!post.title.trim()) return "has no title";
  if (plainText(post.content).length < 50) return "has no content yet";
  return null;
}
