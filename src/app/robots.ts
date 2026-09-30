import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/db/store";
import { buildRobots } from "@/lib/seo/robots";
import { siteOrigin } from "@/lib/seo/site";

/**
 * GET /robots.txt — public content is open to crawlers; account, admin,
 * checkout and API areas are not. Rendered per request because the rules
 * depend on a setting (Admin → Settings → SEO → "Hide the whole site").
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return buildRobots(await getSettings(), siteOrigin());
}
