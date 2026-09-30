import { getDb } from "@/lib/db/store";
import { siteOrigin } from "@/lib/seo/site";
import { buildSitemap } from "@/lib/seo/sitemap";
import { parseSitemapChunk, renderUrlset, sitemapChunk, sitemapChunkCount, xmlResponse } from "@/lib/seo/sitemap-xml";

/**
 * GET /sitemaps/<n>.xml — the n-th part of a sitemap that outgrew one file
 * (see /sitemap.xml, which lists these parts in a sitemap index).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/sitemaps/[file]">) {
  const { file } = await ctx.params;
  const n = parseSitemapChunk(file);
  if (n === null) return new Response("Not found", { status: 404 });
  const entries = buildSitemap(await getDb(), siteOrigin());
  if (n > sitemapChunkCount(entries.length)) return new Response("Not found", { status: 404 });
  return xmlResponse(renderUrlset(sitemapChunk(entries, n)));
}
