import "server-only";
import { CORE_LEGAL_META, isCoreLegalSlug, legalHref } from "./pages-shared";
import { listPublishedLegalPages } from "./pages";

export interface LegalLink {
  slug: string;
  /** Short label for footers ("Privacy", "Terms", …); custom pages use their title. */
  label: string;
  title: string;
  href: string;
  /** ISO date of the last published change (for sitemaps). */
  updatedAt: string;
}

/**
 * Links to every published legal page, core pages first (privacy, terms,
 * refunds, cookies), for the site footer, sitemaps and consent notices.
 * Unpublished pages are left out so no link ever points at a 404.
 */
export async function legalLinks(): Promise<LegalLink[]> {
  const pages = await listPublishedLegalPages();
  return pages.map((p) => ({
    slug: p.slug,
    label: isCoreLegalSlug(p.slug) ? CORE_LEGAL_META[p.slug].label : p.title,
    title: p.title,
    href: legalHref(p.slug),
    updatedAt: p.updatedAt,
  }));
}
