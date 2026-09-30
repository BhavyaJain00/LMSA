import { getDb } from "@/lib/db/store";
import { courseFeed } from "@/lib/seo/feeds";
import { buildRss, rssResponse } from "@/lib/seo/rss";
import { siteOrigin } from "@/lib/seo/site";

/** GET /rss.xml — the most recently published courses (advertised in every page head). */
export const dynamic = "force-dynamic";

export async function GET() {
  return rssResponse(buildRss(courseFeed(await getDb(), siteOrigin())));
}
