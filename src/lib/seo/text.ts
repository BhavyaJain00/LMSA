import { slugify, stripMarkdown } from "@/lib/utils";

/**
 * Text helpers for titles, meta descriptions and slugs. Pure and isomorphic
 * (used by pages, Server Actions and the editors' live previews).
 */

/** Google shows roughly 50–60 characters of a title. */
export const TITLE_MAX = 60;
export const TITLE_MIN = 30;
/** Meta descriptions: 150–160 characters is the sweet spot; below ~120 wastes space. */
export const DESCRIPTION_MAX = 160;
export const DESCRIPTION_TARGET = 155;
export const DESCRIPTION_MIN = 120;
/** Slugs past this length get cut at a word boundary. */
export const SLUG_MAX = 60;

/** Markdown or HTML-ish text → one line of plain text. */
export function plainText(markdown: string | undefined | null): string {
  if (!markdown) return "";
  return stripMarkdown(markdown.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Shorten text to at most `max` characters, cutting at a word boundary and
 * adding an ellipsis when something was removed.
 */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * Meta description from the first usable candidate (explicit description,
 * excerpt, body…): markdown stripped, whitespace collapsed and cut to
 * `DESCRIPTION_TARGET` characters at a word boundary. When the first candidate
 * is very short, the next ones are appended so the snippet uses the space.
 */
export function metaDescription(...candidates: (string | undefined | null)[]): string {
  const texts = candidates.map(plainText).filter(Boolean);
  if (!texts.length) return "";
  let out = texts[0]!;
  for (const next of texts.slice(1)) {
    if (out.length >= DESCRIPTION_MIN) break;
    if (next.startsWith(out)) out = next;
    else out = `${out.replace(/[.!?]?$/, ".")} ${next}`;
  }
  return clampText(out, DESCRIPTION_TARGET);
}

/** An author-written meta description: plain text, cut to `DESCRIPTION_MAX` characters, nothing appended. */
export function explicitDescription(text: string | undefined | null): string {
  return clampText(plainText(text), DESCRIPTION_MAX);
}

/** Comma- or newline-separated keywords → unique trimmed list, or `fallback` when none are given. */
export function splitKeywords(raw: string | undefined | null, fallback: string[] = []): string[] {
  const list = [...new Set((raw ?? "").split(/[,\n]/).map((k) => k.trim()).filter(Boolean))];
  return list.length ? list : [...new Set(fallback.map((k) => k.trim()).filter(Boolean))];
}

/** Apply a `%s` title template (e.g. "%s · LearnLoop"); templates without `%s` get the title prepended. */
export function applyTitleTemplate(template: string, title: string): string {
  const t = template.trim();
  if (!t) return title;
  return t.includes("%s") ? t.replace("%s", title) : `${title} ${t}`;
}

/** Words dropped from suggested slugs (kept when the slug would otherwise be too short). */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "you",
  "your",
]);

/**
 * Suggest a clean slug for a title: lowercase ASCII, hyphen separated, stop
 * words trimmed (unless fewer than three words would remain) and cut to
 * `SLUG_MAX` characters at a word boundary.
 */
export function suggestSlug(title: string): string {
  const words = slugify(title).split("-").filter(Boolean);
  if (!words.length) return "item";
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  const chosen = meaningful.length >= Math.min(3, words.length) ? meaningful : words;
  let slug = "";
  for (const word of chosen) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug || chosen[0]!.slice(0, SLUG_MAX);
}

/** Whether a value is a well-formed slug (lowercase letters, digits, single hyphens). */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/** URL form of a free-text tag ("Web Development" → "web-development"). */
export function tagSlug(tag: string): string {
  return slugify(tag);
}

/** Display form of a tag slug when no original spelling is at hand ("web-development" → "Web development"). */
export function tagLabel(slug: string): string {
  const text = slug.replace(/-/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : slug;
}

/** Word count of markdown content. */
export function wordCount(markdown: string): number {
  return plainText(markdown).split(" ").filter(Boolean).length;
}

/** "N min read" label (at least one minute). */
export function readingTimeLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min read`;
}

/** ISO 8601 duration for seconds, e.g. 5400 → "PT1H30M" (schema.org timeRequired / duration). */
export function isoDuration(totalSeconds: number): string | undefined {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return undefined;
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec || (!h && !m) ? `${sec}S` : ""}`;
}
