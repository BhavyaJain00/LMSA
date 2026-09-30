import type { MetadataRoute } from "next";
import type { Settings } from "@/lib/types";

/**
 * robots.txt rules (pure). Public content is open to every crawler; account,
 * admin, checkout and API areas are not (generated share images and the
 * sitemap live outside /api). With `settings.seo.noindexSite` everything is disallowed
 * (staging sites).
 */

/** Private areas: never useful in search results and mostly behind a login. */
export const DISALLOWED_PATHS = [
  "/admin",
  "/api/",
  "/dashboard",
  "/settings",
  "/billing",
  "/notifications",
  "/persona",
  "/you",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/two-factor",
  "/verify-email",
  "/offline",
  "/forbidden",
  "/free/confirm",
  "/quiz/",
  "/assignments/",
  "/exercises/",
  "/jobs/new",
  "/jobs/mine",
  "/jobs/applications",
  "/*/learn/",
  "/*?*search=",
  "/*?*sort=",
] as const;

export function buildRobots(settings: Pick<Settings, "seo">, origin: string): MetadataRoute.Robots {
  if (settings.seo.noindexSite) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
