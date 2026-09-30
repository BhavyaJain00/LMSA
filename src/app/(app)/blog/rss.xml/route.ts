import { getDb } from "@/lib/db/store";
import { blogFeed } from "@/lib/seo/feeds";
import { buildRss, rssResponse } from "@/lib/seo/rss";
import { siteOrigin } from "@/lib/seo/site";

/** GET /blog/rss.xml — the latest blog posts (404 while the blog is switched off). */
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  if (!db.settings.seo.blogEnabled) return new Response("Not found", { status: 404 });
  return rssResponse(buildRss(blogFeed(db, siteOrigin())));
}
