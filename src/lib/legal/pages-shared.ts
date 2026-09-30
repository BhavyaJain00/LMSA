import type { LegalPage } from "@/lib/types";

/**
 * Legal pages: slugs, placeholders and template detection. Pure (no server
 * imports, no seed text) so the admin editor preview and the tests can use it.
 */

export const CORE_LEGAL_SLUGS = ["privacy", "terms", "refunds", "cookies"] as const;
export type CoreLegalSlug = (typeof CORE_LEGAL_SLUGS)[number];

export const CORE_LEGAL_META: Record<CoreLegalSlug, { title: string; label: string; description: string }> = {
  privacy: {
    title: "Privacy Policy",
    label: "Privacy",
    description: "What personal information you collect, why, how long you keep it and the rights members have.",
  },
  terms: {
    title: "Terms of Service",
    label: "Terms",
    description: "The agreement members accept when they create an account or buy a course.",
  },
  refunds: {
    title: "Refund Policy",
    label: "Refunds",
    description: "When and how buyers can get their money back. Linked from checkout.",
  },
  cookies: {
    title: "Cookie Policy",
    label: "Cookies",
    description: "Which cookies the site sets and how visitors change their choice. Linked from the cookie banner.",
  },
};

export const LEGAL_SLUG_MAX = 60;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LEGAL_TITLE_MAX = 120;
/** Legal text can be long, but not unbounded (the whole page is rendered on every visit). */
export const LEGAL_CONTENT_MAX = 100_000;

export function isCoreLegalSlug(slug: string): slug is CoreLegalSlug {
  return (CORE_LEGAL_SLUGS as readonly string[]).includes(slug);
}

/** Lower-case, hyphenated, 1–60 characters. */
export function isValidLegalSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= LEGAL_SLUG_MAX && SLUG_PATTERN.test(slug);
}

export function legalHref(slug: string): string {
  return `/legal/${slug}`;
}

/**
 * True while the page still carries the starter-template notice: the admin
 * editor shows a "review with a lawyer" banner and publishing asks for an
 * explicit confirmation.
 */
export function isTemplateContent(content: string): boolean {
  return /template\s*[—–-]\s*review with a lawyer/i.test(content);
}

/** Core pages first in their fixed order, then custom pages by title. */
export function sortLegalPages<T extends Pick<LegalPage, "slug" | "title">>(pages: T[]): T[] {
  const rank = (slug: string) => {
    const i = (CORE_LEGAL_SLUGS as readonly string[]).indexOf(slug);
    return i === -1 ? CORE_LEGAL_SLUGS.length : i;
  };
  return [...pages].sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title));
}

export interface LegalPlaceholderValues {
  companyName: string;
  companyAddress?: string;
  contactEmail?: string;
  siteName: string;
  siteUrl: string;
  /** ISO date-time of the page's last published change. */
  updatedAt: string;
}

/** Placeholders an administrator can use in legal text, with what they become. */
export const LEGAL_PLACEHOLDERS: { token: string; description: string }[] = [
  { token: "{{companyName}}", description: "Company name from the legal settings" },
  { token: "{{companyAddress}}", description: "Registered address" },
  { token: "{{contactEmail}}", description: "Privacy / legal contact email" },
  { token: "{{siteName}}", description: "Your platform's name" },
  { token: "{{siteUrl}}", description: "Public address of the site" },
  { token: "{{lastUpdated}}", description: "Date of the last published change" },
];

function formatLegalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Replace `{{placeholder}}` tokens (case-insensitive, optional inner spaces).
 * Unknown tokens are left untouched so a typo is visible in the preview.
 */
export function fillLegalPlaceholders(content: string, values: LegalPlaceholderValues): string {
  const map: Record<string, string> = {
    companyname: values.companyName,
    companyaddress: values.companyAddress?.trim() || "",
    contactemail: values.contactEmail?.trim() || "",
    sitename: values.siteName,
    siteurl: values.siteUrl,
    lastupdated: formatLegalDate(values.updatedAt),
  };
  return content.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (whole, name: string) => {
    const key = name.toLowerCase();
    return key in map ? map[key]! : whole;
  });
}

/** Everything after the template notice line is the reviewed text; used to strip the notice in one click. */
export function removeTemplateNotice(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !isTemplateContent(line))
    .join("\n")
    .replace(/^\s*\n+/, "");
}

/* ------------------------------------------------------------------ */
/* Editing rules (admin editor)                                        */
/* ------------------------------------------------------------------ */

/** What the editor asks for: keep a draft, make the text live, or take the page offline. */
export type LegalPageIntent = "save" | "publish" | "unpublish";

export interface LegalPageInput {
  title: string;
  content: string;
}

export type LegalFieldErrors = Partial<Record<"title" | "content" | "slug", string>>;

/** Field errors for a page's title and text (empty object = valid). */
export function validateLegalPageInput(input: LegalPageInput, intent: LegalPageIntent): LegalFieldErrors {
  const errors: LegalFieldErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = "Give the page a title.";
  else if (title.length > LEGAL_TITLE_MAX) errors.title = `Keep the title under ${LEGAL_TITLE_MAX} characters.`;
  if (input.content.length > LEGAL_CONTENT_MAX) errors.content = `The text is too long (maximum ${LEGAL_CONTENT_MAX.toLocaleString("en-US")} characters).`;
  else if (intent === "publish" && !input.content.trim()) errors.content = "Write the page before publishing it.";
  else if (intent === "publish" && isTemplateContent(input.content)) {
    errors.content = "Remove the template notice once the text has been reviewed (ideally by a lawyer), then publish.";
  }
  return errors;
}

/** Field error for the address of a new custom page, or null when it is free. */
export function validateNewLegalSlug(slug: string, taken: Iterable<string>): string | null {
  if (!isValidLegalSlug(slug)) return `Use lower-case letters, numbers and hyphens (up to ${LEGAL_SLUG_MAX} characters).`;
  if (isCoreLegalSlug(slug)) return "That address belongs to one of the standard legal pages.";
  for (const existing of taken) if (existing === slug) return "Another legal page already uses this address.";
  return null;
}

export interface LegalPageChange {
  page: LegalPage;
  /** Nothing would change (e.g. publishing an already published, unchanged page). */
  unchanged: boolean;
  /** A new public version went live. */
  publishedVersion: boolean;
}

/**
 * Apply an editor submission to a page (pure).
 *
 * - Published pages have no separate draft: saving them publishes the change
 *   as a new version, so visitors never see text that was not meant for them
 *   and "Last updated" is always the date of the text on screen.
 * - Every published change increments `version` and moves `updatedAt`.
 * - Unpublishing keeps the version and date of the text that was live.
 */
export function applyLegalPageChange(page: LegalPage, input: LegalPageInput, intent: LegalPageIntent, now: Date): LegalPageChange {
  const title = input.title.trim();
  const content = input.content.replace(/\r\n?/g, "\n");
  const edited = title !== page.title || content !== page.content;

  if (intent === "unpublish") {
    const next: LegalPage = { ...page, title, content, published: false };
    if (edited) next.updatedAt = now.toISOString();
    return { page: next, unchanged: !edited && !page.published, publishedVersion: false };
  }
  if (intent === "publish" || page.published) {
    if (page.published && !edited) return { page, unchanged: true, publishedVersion: false };
    return {
      page: { ...page, title, content, published: true, version: Math.max(0, page.version) + 1, updatedAt: now.toISOString() },
      unchanged: false,
      publishedVersion: true,
    };
  }
  if (!edited) return { page, unchanged: true, publishedVersion: false };
  return { page: { ...page, title, content, updatedAt: now.toISOString() }, unchanged: false, publishedVersion: false };
}
