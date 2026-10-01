import type { Metadata } from "next";
import type { Settings } from "@/lib/types";
import { DEFAULT_LOCALE, LOCALES, ogLocaleFor, type Locale } from "@/i18n/config";
import { absoluteUrl, canonicalUrl, siteOrigin } from "./site";
import { clampText, explicitDescription, metaDescription } from "./text";

/**
 * Page metadata builders. Every public page builds its `<head>` through
 * `pageMetadata()` so titles, descriptions, canonicals, Open Graph, Twitter
 * cards, robots and language alternates stay consistent.
 *
 * Notes on how Next merges metadata: top-level keys are replaced, not merged,
 * between the root layout and a page. So `alternates` always carries the RSS
 * feed links next to the canonical, and `openGraph` always repeats the site
 * name and locale. A segment's `opengraph-image` file only fills in the image
 * when the page's `openGraph` has no `images` key at all, so pages with a
 * generated image (`generatedImage: true`) leave the key out and every other
 * page names its image explicitly (falling back to the site's share image).
 */

/** Robots value for private pages (account, admin, checkout, search permutations). */
export const NOINDEX: NonNullable<Metadata["robots"]> = { index: false, follow: false };
/** Robots value for thin/duplicate public pages whose links are still worth following. */
export const NOINDEX_FOLLOW: NonNullable<Metadata["robots"]> = { index: false, follow: true };

/** Open Graph image size recommended by Facebook, LinkedIn and X (1.91:1). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/* ------------------------------------------------------------------ */
/* Languages (hreflang)                                                */
/* ------------------------------------------------------------------ */

/**
 * Languages the content is published in, with the URL builder for each.
 *
 * The interface language (menus, buttons, messages: `src/i18n`) is chosen per
 * visitor by account preference, the `ll_locale` cookie or `Accept-Language`,
 * and every URL serves the same content in every interface language. Course,
 * lesson and blog content keeps the language it was written in. So today each
 * page has a single language version: hreflang lists the content language and
 * `x-default`, both pointing at the canonical URL (pointing several hreflang
 * values at one URL would tell search engines nothing).
 *
 * Per-language URLs are the future step: add entries here (e.g.
 * `{ lang: "es", ogLocale: ogLocaleFor("es"), path: (p) => `/es${p}` }`) and
 * every page's hreflang tags and `og:locale:alternate` values follow.
 */
export const CONTENT_LANGUAGES: { lang: string; ogLocale: string; path: (path: string) => string }[] = [
  { lang: DEFAULT_LOCALE, ogLocale: ogLocaleFor(DEFAULT_LOCALE), path: (p) => p },
];

export function languageAlternates(path: string, origin: string = siteOrigin()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of CONTENT_LANGUAGES) out[l.lang] = canonicalUrl(l.path(path), {}, origin);
  out["x-default"] = canonicalUrl(path, {}, origin);
  return out;
}

export const DEFAULT_OG_LOCALE = CONTENT_LANGUAGES[0]!.ogLocale;
const ALTERNATE_OG_LOCALES = CONTENT_LANGUAGES.slice(1).map((l) => l.ogLocale);

/**
 * `og:locale` for a page rendered in an interface language. Content pages
 * describe themselves in their content language unless the caller passes
 * the active interface locale (e.g. a page whose text is fully translated).
 */
export function openGraphLocale(locale?: Locale | string): string {
  return locale && (LOCALES as readonly string[]).includes(locale) ? ogLocaleFor(locale) : DEFAULT_OG_LOCALE;
}

/** `og:locale:alternate` values: the other content languages (none while every language shares one URL). */
function alternateOgLocales(current: string): string[] {
  return ALTERNATE_OG_LOCALES.filter((l) => l !== current);
}

/* ------------------------------------------------------------------ */
/* Feeds and share images                                              */
/* ------------------------------------------------------------------ */

/** RSS feeds advertised in every page head (`<link rel="alternate" type="application/rss+xml">`). */
export function feedAlternates(settings: Pick<Settings, "seo" | "brand">, origin: string = siteOrigin()): { url: string; title: string }[] {
  const feeds = [{ url: `${origin}/rss.xml`, title: `New courses · ${settings.brand.name}` }];
  if (settings.seo.blogEnabled) feeds.push({ url: `${origin}/blog/rss.xml`, title: `Blog · ${settings.brand.name}` });
  return feeds;
}

/** Path of the generated site-wide share card (`src/app/opengraph-image.tsx`). */
export const SITE_OG_IMAGE_PATH = "/opengraph-image";

/** The site's default share image: the uploaded one from settings, else the generated card. */
export function defaultShareImage(settings: Pick<Settings, "seo" | "brand">): string {
  return settings.seo.defaultOgImageUrl || settings.brand.metaImageUrl || SITE_OG_IMAGE_PATH;
}

/* ------------------------------------------------------------------ */
/* Listing pages (catalog, blog, tags)                                 */
/* ------------------------------------------------------------------ */

export interface ListingState {
  search?: string;
  sort?: string;
  /** Other filters narrowing the list (level, price, category query…). */
  filters?: (string | undefined | null)[];
  page?: number;
}

/**
 * Search, sort, filter and page permutations of a list all canonicalise to the
 * unfiltered first page and are kept out of the index (links still followed),
 * so the index holds exactly one URL per list.
 */
export function listingIndexing(state: ListingState): { noindex: boolean; follow: boolean } {
  const permutation = !!state.search?.trim() || !!state.sort?.trim() || (state.filters ?? []).some((f) => !!f?.trim()) || (state.page ?? 1) > 1;
  return { noindex: permutation, follow: true };
}

/* ------------------------------------------------------------------ */
/* Page metadata                                                       */
/* ------------------------------------------------------------------ */

export interface PageMetadataInput {
  /** Page title (the site template is applied by the root layout unless `absoluteTitle`). */
  title: string;
  absoluteTitle?: boolean;
  /**
   * A string is an author-written description, used as written (only clamped).
   * An array lists candidates, best first (excerpt, body…): the description is
   * composed from them to fill the 150–160 characters search engines show.
   * Empty results fall back to the site's default description.
   */
  description?: (string | undefined | null)[] | string;
  /** Canonical path of the page. */
  path: string;
  /** Query parameters that are part of the canonical URL. */
  canonicalQuery?: Record<string, string | number | undefined>;
  /** Explicit canonical URL (e.g. a cross-posted article). Must be absolute. */
  canonicalOverride?: string;
  /** Social image for pages without a generated one (defaults to the site share image). */
  image?: { url: string; width?: number; height?: number; alt?: string };
  /** The route has its own `opengraph-image` file: leave `images` out so Next uses it. */
  generatedImage?: boolean;
  type?: "website" | "article" | "profile";
  noindex?: boolean;
  /** Keep `follow` when noindexing (search/filter permutations). */
  follow?: boolean;
  keywords?: string[];
  /**
   * Interface language the page is rendered in (`await getLocale()`), for `og:locale`.
   * Leave it out for pages whose main content is in the content language.
   */
  locale?: Locale;
  article?: { publishedTime?: string; modifiedTime?: string; authors?: string[]; section?: string; tags?: string[] };
}

/** Robots for a page given the site-wide switch. */
export function robotsFor(settings: Pick<Settings, "seo">, noindex = false, follow = false): Metadata["robots"] {
  if (settings.seo.noindexSite) return NOINDEX;
  if (noindex) return follow ? NOINDEX_FOLLOW : NOINDEX;
  return { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } };
}

export function pageMetadata(input: PageMetadataInput, settings: Settings, origin: string = siteOrigin()): Metadata {
  const description = Array.isArray(input.description) ? metaDescription(...input.description) : explicitDescription(input.description);
  const finalDescription = description || metaDescription(settings.seo.defaultDescription, settings.brand.metaDescription) || undefined;
  const canonical = input.canonicalOverride || canonicalUrl(input.path, input.canonicalQuery, origin);
  const title = clampText(input.title, 120);
  const feeds = feedAlternates(settings, origin);
  const ogLocale = openGraphLocale(input.locale);

  const openGraph: NonNullable<Metadata["openGraph"]> & Record<string, unknown> = {
    type: input.type ?? "website",
    url: canonical,
    title,
    description: finalDescription,
    siteName: settings.brand.name,
    locale: ogLocale,
    ...(alternateOgLocales(ogLocale).length ? { alternateLocale: alternateOgLocales(ogLocale) } : {}),
  };
  const twitter: NonNullable<Metadata["twitter"]> & Record<string, unknown> = {
    card: "summary_large_image",
    site: settings.seo.twitterHandle || undefined,
    title,
    description: finalDescription,
  };
  if (!input.generatedImage) {
    const source = input.image ?? { url: defaultShareImage(settings), ...OG_IMAGE_SIZE, alt: settings.brand.name };
    const url = absoluteUrl(source.url, origin);
    if (url) {
      openGraph.images = [{ url, width: source.width, height: source.height, alt: source.alt ?? title }];
      twitter.images = [url];
    }
  }
  if (input.type === "article" && input.article) {
    Object.assign(openGraph, {
      publishedTime: input.article.publishedTime,
      modifiedTime: input.article.modifiedTime,
      authors: input.article.authors,
      section: input.article.section,
      tags: input.article.tags,
    });
  }

  return {
    title: input.absoluteTitle ? { absolute: title } : title,
    description: finalDescription,
    keywords: input.keywords?.length ? input.keywords : undefined,
    alternates: {
      canonical,
      languages: input.canonicalOverride ? undefined : languageAlternates(input.path, origin),
      types: { "application/rss+xml": feeds },
    },
    robots: robotsFor(settings, input.noindex, input.follow),
    openGraph: openGraph as Metadata["openGraph"],
    twitter: twitter as Metadata["twitter"],
  };
}

/** Metadata for a page that must never be indexed (account, admin, checkout, error states). */
export function privatePageMetadata(title: string): Metadata {
  return { title, robots: NOINDEX };
}

/** Metadata for a public item that does not exist or is not visible (keeps soft-404s out of the index). */
export function notFoundMetadata(title = "Page not found"): Metadata {
  return { title, robots: NOINDEX };
}

/**
 * Site-wide defaults for the root layout. Robots default to noindex: every
 * page is private (admin, dashboard, settings, billing, auth, learning
 * player, error pages…) unless it opts in by returning `pageMetadata()`,
 * which sets `index, follow` (or noindex for drafts and list permutations).
 * A public page that forgets its metadata therefore fails closed.
 *
 * `locale` is the visitor's interface language: it sets the default
 * `og:locale` of pages that do not build their own Open Graph data.
 */
export function rootMetadata(settings: Settings, origin: string = siteOrigin(), locale?: Locale): Metadata {
  const description = metaDescription(settings.seo.defaultDescription, settings.brand.metaDescription);
  const template = settings.seo.siteTitleTemplate?.includes("%s") ? settings.seo.siteTitleTemplate : `%s · ${settings.brand.name}`;
  const keywords = (settings.brand.metaKeywords ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const other: Record<string, string> = {};
  if (settings.seo.bingVerification) other["msvalidate.01"] = settings.seo.bingVerification;
  let base: URL;
  try {
    base = new URL(`${origin}/`);
  } catch {
    base = new URL("http://localhost:3000/");
  }
  const uploadedImage = settings.seo.defaultOgImageUrl || settings.brand.metaImageUrl;
  const imageUrl = uploadedImage ? absoluteUrl(uploadedImage, origin) : undefined;
  return {
    metadataBase: base,
    title: { default: settings.brand.name, template },
    description: description || undefined,
    applicationName: settings.brand.name,
    keywords: keywords.length ? keywords : undefined,
    icons: settings.brand.faviconUrl ? { icon: settings.brand.faviconUrl } : undefined,
    robots: NOINDEX,
    verification: {
      google: settings.seo.googleVerification || undefined,
      other: Object.keys(other).length ? other : undefined,
    },
    alternates: { types: { "application/rss+xml": feedAlternates(settings, origin) } },
    // Without an uploaded image the `images` key stays out so the generated root card is used.
    openGraph: {
      type: "website",
      siteName: settings.brand.name,
      locale: openGraphLocale(locale),
      description: description || undefined,
      ...(imageUrl ? { images: [{ url: imageUrl, ...OG_IMAGE_SIZE, alt: settings.brand.name }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      site: settings.seo.twitterHandle || undefined,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
    formatDetection: { telephone: false, address: false, email: false },
  };
}
