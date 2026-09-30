import { DESCRIPTION_MAX, DESCRIPTION_MIN, TITLE_MAX, TITLE_MIN, plainText, wordCount } from "./text";

/**
 * On-page SEO checks for the blog editor and the course sales-page editor:
 * where the focus keyword appears (SEO title, H1, first paragraph, slug,
 * meta description, a subheading), how dense it is, and whether the title,
 * description and body have sensible lengths. Pure and isomorphic, so the
 * editor runs it live in the browser.
 */

export type SeoCheckStatus = "pass" | "warn" | "fail";

export interface SeoCheck {
  id: string;
  label: string;
  status: SeoCheckStatus;
  detail: string;
}

export interface FocusKeywordInput {
  keyword: string;
  /** The `<title>` text (SEO title, or the page title when no SEO title is set). */
  seoTitle: string;
  /** The visible H1. */
  h1: string;
  /** Markdown body. */
  content: string;
  slug: string;
  metaDescription: string;
}

/** Lower-case, strip accents and punctuation, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whether `keyword` appears in `text` as whole words (case, accent and punctuation insensitive). */
export function containsKeyword(text: string, keyword: string): boolean {
  const k = normalizeForMatch(keyword);
  if (!k) return false;
  return ` ${normalizeForMatch(text)} `.includes(` ${k} `);
}

/** Number of whole-word occurrences of `keyword` in `text`. */
export function countKeyword(text: string, keyword: string): number {
  const k = normalizeForMatch(keyword);
  if (!k) return 0;
  const hay = ` ${normalizeForMatch(text)} `;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(` ${k} `, from);
    if (at === -1) return count;
    count++;
    from = at + k.length + 1;
  }
}

/** First paragraph of markdown (skipping headings, images, lists markers and blank lines). */
export function firstParagraph(markdown: string): string {
  const blocks = markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^!\[/.test(trimmed) || /^```/.test(trimmed)) continue;
    return plainText(trimmed);
  }
  return "";
}

/** Text of the markdown's subheadings (H2–H6). */
export function subheadings(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^(#{2,6})\s+(.*?)\s*#*$/.exec(line.trim());
    if (m) out.push(m[2]!);
  }
  return out;
}

function check(id: string, label: string, status: SeoCheckStatus, detail: string): SeoCheck {
  return { id, label, status, detail };
}

/** Run every on-page check. The keyword checks are skipped (one "fail") when no keyword is set. */
export function analyzeSeo(input: FocusKeywordInput): SeoCheck[] {
  const keyword = input.keyword.trim();
  const checks: SeoCheck[] = [];
  const words = wordCount(input.content);

  const titleLength = input.seoTitle.trim().length;
  checks.push(
    titleLength === 0
      ? check("title-length", "Title length", "fail", "Add a title.")
      : titleLength > TITLE_MAX
        ? check("title-length", "Title length", "warn", `${titleLength} characters — search results cut titles after about ${TITLE_MAX}.`)
        : titleLength < TITLE_MIN
          ? check("title-length", "Title length", "warn", `${titleLength} characters — a slightly longer, more descriptive title usually earns more clicks.`)
          : check("title-length", "Title length", "pass", `${titleLength} characters.`),
  );

  const descLength = input.metaDescription.trim().length;
  checks.push(
    descLength === 0
      ? check("description-length", "Meta description", "warn", "No description set — one will be generated from the content.")
      : descLength > DESCRIPTION_MAX
        ? check("description-length", "Meta description", "warn", `${descLength} characters — keep it under ${DESCRIPTION_MAX} so it is not cut off.`)
        : descLength < DESCRIPTION_MIN
          ? check("description-length", "Meta description", "warn", `${descLength} characters — aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}.`)
          : check("description-length", "Meta description", "pass", `${descLength} characters.`),
  );

  checks.push(
    words >= 600
      ? check("content-length", "Content length", "pass", `${words} words.`)
      : words >= 300
        ? check("content-length", "Content length", "warn", `${words} words — in-depth articles (600+ words) tend to rank better.`)
        : check("content-length", "Content length", "fail", `${words} words — thin content rarely ranks; aim for at least 300.`),
  );

  const headings = subheadings(input.content);
  checks.push(
    headings.length >= 2
      ? check("structure", "Subheadings", "pass", `${headings.length} subheadings structure the page.`)
      : check("structure", "Subheadings", "warn", "Break the content up with subheadings (## Heading) so readers and search engines can scan it."),
  );

  if (!keyword) {
    checks.unshift(check("keyword", "Focus keyword", "fail", "Set a focus keyword to check how well the page targets it."));
    return checks;
  }

  const inTitle = containsKeyword(input.seoTitle, keyword);
  const titleStartsWith = normalizeForMatch(input.seoTitle).startsWith(normalizeForMatch(keyword));
  checks.unshift(
    check("keyword-title", "Keyword in SEO title", inTitle ? "pass" : "fail", inTitle ? (titleStartsWith ? "Leads the title — ideal." : "Found in the title.") : "Add the keyword to the title, ideally near the start."),
    check("keyword-h1", "Keyword in H1", containsKeyword(input.h1, keyword) ? "pass" : "warn", containsKeyword(input.h1, keyword) ? "Found in the main heading." : "Use the keyword in the main heading."),
    check(
      "keyword-intro",
      "Keyword in first paragraph",
      containsKeyword(firstParagraph(input.content), keyword) ? "pass" : "warn",
      containsKeyword(firstParagraph(input.content), keyword) ? "Found in the introduction." : "Mention the keyword early, in the first paragraph.",
    ),
    check(
      "keyword-slug",
      "Keyword in URL",
      containsKeyword(input.slug.replace(/-/g, " "), keyword) ? "pass" : "warn",
      containsKeyword(input.slug.replace(/-/g, " "), keyword) ? "Found in the slug." : "Include the keyword in the slug.",
    ),
    check(
      "keyword-description",
      "Keyword in meta description",
      containsKeyword(input.metaDescription, keyword) ? "pass" : "warn",
      containsKeyword(input.metaDescription, keyword) ? "Found in the description." : "Use the keyword in the meta description — search engines bold it in results.",
    ),
    check(
      "keyword-subheading",
      "Keyword in a subheading",
      headings.some((h) => containsKeyword(h, keyword)) ? "pass" : "warn",
      headings.some((h) => containsKeyword(h, keyword)) ? "Found in a subheading." : "Use the keyword (or a close variant) in at least one subheading.",
    ),
  );

  const occurrences = countKeyword(plainText(input.content), keyword);
  const keywordWords = normalizeForMatch(keyword).split(" ").length;
  const density = words ? (occurrences * keywordWords * 100) / words : 0;
  const densityLabel = `${occurrences} ${occurrences === 1 ? "time" : "times"} (${density.toFixed(1)}%)`;
  checks.push(
    occurrences === 0
      ? check("keyword-density", "Keyword density", "fail", "The keyword does not appear in the content.")
      : density > 3
        ? check("keyword-density", "Keyword density", "warn", `${densityLabel} — this reads as keyword stuffing; use synonyms instead.`)
        : density < 0.5
          ? check("keyword-density", "Keyword density", "warn", `${densityLabel} — mention it a few more times where it reads naturally.`)
          : check("keyword-density", "Keyword density", "pass", densityLabel),
  );
  return checks;
}

/** 0–100 score: passes count fully, warnings half. */
export function seoScore(checks: SeoCheck[]): number {
  if (!checks.length) return 0;
  const points = checks.reduce((sum, c) => sum + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
}
