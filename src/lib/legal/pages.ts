import "server-only";
import type { LegalPage, Settings } from "@/lib/types";
import { getDb, getSettings } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { buildSeedLegalPages } from "@/lib/db/seed-round3";
import { CORE_LEGAL_SLUGS, fillLegalPlaceholders, isCoreLegalSlug, sortLegalPages, type LegalPlaceholderValues } from "./pages-shared";

/**
 * Read access to legal pages. The four core pages (privacy, terms, refunds,
 * cookies) always exist: when a database predates them (or started without
 * demo data) the original starter templates are returned, unpublished, until
 * an administrator saves them.
 */

/** Starter templates keyed by slug (fresh objects on every call). */
function starterTemplates(now: Date = new Date()): Map<string, LegalPage> {
  return new Map(buildSeedLegalPages(now).map((p) => [p.slug, { ...p, version: 0 }]));
}

/** Stored pages plus a starter template for every missing core page, core pages first. */
export function mergeWithStarterPages(stored: LegalPage[], now: Date = new Date()): LegalPage[] {
  const bySlug = new Map(stored.map((p) => [p.slug, p]));
  const templates = starterTemplates(now);
  const out = [...stored];
  for (const slug of CORE_LEGAL_SLUGS) {
    if (!bySlug.has(slug)) {
      const template = templates.get(slug);
      if (template) out.push(template);
    }
  }
  return sortLegalPages(out);
}

export async function listLegalPages(): Promise<LegalPage[]> {
  const db = await getDb();
  return mergeWithStarterPages(db.legalPages);
}

/** A stored page, or the starter template for a missing core page, or null. */
export async function getLegalPage(slug: string): Promise<LegalPage | null> {
  const db = await getDb();
  const stored = db.legalPages.find((p) => p.slug === slug);
  if (stored) return stored;
  if (!isCoreLegalSlug(slug)) return null;
  return starterTemplates().get(slug) ?? null;
}

export async function listPublishedLegalPages(): Promise<LegalPage[]> {
  const db = await getDb();
  return sortLegalPages(db.legalPages.filter((p) => p.published));
}

/** Values for `{{placeholder}}` tokens in legal text. */
export function placeholderValues(settings: Settings, page: Pick<LegalPage, "updatedAt">): LegalPlaceholderValues {
  return {
    companyName: settings.legal.companyName || settings.brand.name,
    companyAddress: settings.legal.companyAddress,
    contactEmail: settings.legal.contactEmail || settings.contact.email,
    siteName: settings.brand.name,
    siteUrl: siteConfig.appUrl,
    updatedAt: page.updatedAt,
  };
}

/** Page markdown with placeholders filled in, ready to render. */
export async function renderLegalMarkdown(page: Pick<LegalPage, "content" | "updatedAt">): Promise<string> {
  const settings = await getSettings();
  return fillLegalPlaceholders(page.content, placeholderValues(settings, page));
}
