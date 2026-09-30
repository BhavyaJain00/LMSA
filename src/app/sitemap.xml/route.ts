import { getDb } from "@/lib/db/store";
import { siteOrigin } from "@/lib/seo/site";
import { buildSitemap } from "@/lib/seo/sitemap";
import { newestModified, renderSitemapIndex, renderUrlset, sitemapChunk, sitemapChunkCount, sitemapChunkPath, xmlResponse } from "@/lib/seo/sitemap-xml";

/**
 * GET /sitemap.xml — every public, indexable URL with its last modification
 * date, change frequency, priority, cover images and preview videos. Past
 * 50,000 URLs this becomes a sitemap index pointing at `/sitemaps/<n>.xml`.
 * Built from the database on each request (cached by browsers and CDNs for
 * 15 minutes), so newly published content shows up without a rebuild.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const origin = siteOrigin();
  const entries = buildSitemap(await getDb(), origin);
  const chunks = sitemapChunkCount(entries.length);
  if (chunks === 1) return xmlResponse(renderUrlset(entries));
  const files = Array.from({ length: chunks }, (_, i) => ({
    url: `${origin}${sitemapChunkPath(i + 1)}`,
    lastModified: newestModified(sitemapChunk(entries, i + 1)),
  }));
  return xmlResponse(renderSitemapIndex(files));
}
