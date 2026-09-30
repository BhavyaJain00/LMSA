import type { SitemapEntry } from "./sitemap";
import { SITEMAP_MAX_URLS } from "./sitemap";
import { escapeXml } from "./rss";

/**
 * XML for `/sitemap.xml` (pure). Small sites get one `<urlset>`; past
 * `SITEMAP_MAX_URLS` entries `/sitemap.xml` becomes a `<sitemapindex>` that
 * points at `/sitemaps/<n>.xml` chunks, each a `<urlset>` of its own. Image and
 * video extensions follow Google's sitemap schemas.
 */

/** Path of the n-th chunk (1-based) of a split sitemap. */
export function sitemapChunkPath(n: number): string {
  return `/sitemaps/${n}.xml`;
}

/** Parse a chunk file name ("3.xml") into its 1-based number, or null. */
export function parseSitemapChunk(file: string): number | null {
  const m = /^([1-9]\d{0,5})\.xml$/.exec(file);
  return m ? Number(m[1]) : null;
}

export function sitemapChunkCount(total: number, perFile: number = SITEMAP_MAX_URLS): number {
  return Math.max(1, Math.ceil(total / perFile));
}

/** Entries of chunk `n` (1-based). */
export function sitemapChunk(entries: SitemapEntry[], n: number, perFile: number = SITEMAP_MAX_URLS): SitemapEntry[] {
  return entries.slice((n - 1) * perFile, n * perFile);
}

function isoDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function tag(name: string, value: string | number | undefined, indent: string): string {
  return value === undefined || value === "" ? "" : `${indent}<${name}>${escapeXml(String(value))}</${name}>`;
}

function videoXml(video: NonNullable<SitemapEntry["videos"]>[number]): string {
  const lines = [
    "    <video:video>",
    tag("video:thumbnail_loc", video.thumbnail_loc, "      "),
    tag("video:title", video.title, "      "),
    tag("video:description", video.description.slice(0, 2048), "      "),
    tag("video:content_loc", video.content_loc, "      "),
    tag("video:player_loc", video.player_loc, "      "),
    tag("video:duration", video.duration !== undefined ? Math.max(1, Math.min(28_800, Math.round(video.duration))) : undefined, "      "),
    tag("video:publication_date", isoDate(video.publication_date), "      "),
    tag("video:family_friendly", video.family_friendly, "      "),
    tag("video:requires_subscription", video.requires_subscription, "      "),
    "    </video:video>",
  ];
  return lines.filter(Boolean).join("\n");
}

function urlXml(entry: SitemapEntry): string {
  const lines = [
    "  <url>",
    tag("loc", entry.url, "    "),
    tag("lastmod", isoDate(entry.lastModified), "    "),
    tag("changefreq", entry.changeFrequency, "    "),
    tag("priority", entry.priority !== undefined ? entry.priority.toFixed(1) : undefined, "    "),
    ...Object.entries(entry.alternates?.languages ?? {}).map(([lang, href]) => (href ? `    <xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(String(href))}" />` : "")),
    ...(entry.images ?? []).map((src) => `    <image:image>\n      <image:loc>${escapeXml(src)}</image:loc>\n    </image:image>`),
    ...(entry.videos ?? []).map(videoXml),
    "  </url>",
  ];
  return lines.filter(Boolean).join("\n");
}

export function renderUrlset(entries: SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map(urlXml),
    "</urlset>",
    "",
  ].join("\n");
}

export function renderSitemapIndex(files: { url: string; lastModified?: string }[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...files.map((f) => ["  <sitemap>", tag("loc", f.url, "    "), tag("lastmod", isoDate(f.lastModified), "    "), "  </sitemap>"].filter(Boolean).join("\n")),
    "</sitemapindex>",
    "",
  ].join("\n");
}

/** Newest `lastModified` of a set of entries (for the index). */
export function newestModified(entries: SitemapEntry[]): string | undefined {
  let best: string | undefined;
  for (const e of entries) {
    const d = isoDate(e.lastModified);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

export function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
