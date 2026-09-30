import { siteConfig } from "@/lib/config";

/**
 * URL helpers for canonical links, Open Graph, JSON-LD and sitemaps.
 *
 * Every absolute URL the SEO layer emits is built from `APP_URL`
 * (`siteConfig.appUrl`), never from the request's Host header, so crawlers
 * always see one canonical origin. Pure and isomorphic (no Node or Next APIs).
 */

/** Query parameters that only carry campaign / click / referral tracking and never change the page. */
const TRACKING_PARAM = /^(?:utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|li_fat_id|ref|via|aff|affiliate)$/i;

export function isTrackingParam(name: string): boolean {
  return TRACKING_PARAM.test(name);
}

/** The canonical origin (scheme + host, no trailing slash), falling back to localhost when APP_URL is malformed. */
export function siteOrigin(appUrl: string = siteConfig.appUrl): string {
  try {
    return new URL(appUrl).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * Normalise a site path: leading slash, no trailing slash (except the root),
 * no duplicate slashes, no query or hash.
 */
export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? "";
  const collapsed = `/${bare}`.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : "/";
}

/**
 * Absolute URL for a path or URL. Absolute http(s) URLs are returned as they
 * are; site-relative paths are resolved against the canonical origin; anything
 * else (javascript:, data:, protocol-relative) yields `undefined`.
 */
export function absoluteUrl(pathOrUrl: string | undefined | null, origin: string = siteOrigin()): string | undefined {
  const value = pathOrUrl?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href;
    } catch {
      return undefined;
    }
  }
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  try {
    return new URL(value, `${origin}/`).href;
  } catch {
    return undefined;
  }
}

/**
 * Canonical URL of a page: canonical origin + normalised path + only the
 * `keep` parameters that have a value (sorted, so equivalent URLs match).
 * Tracking parameters are always dropped.
 */
export function canonicalUrl(path: string, keep: Record<string, string | number | undefined | null> = {}, origin: string = siteOrigin()): string {
  const url = new URL(normalizePath(path), `${origin}/`);
  const entries = Object.entries(keep)
    .filter(([name, value]) => value !== undefined && value !== null && String(value) !== "" && !isTrackingParam(name))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of entries) url.searchParams.set(name, String(value));
  const href = url.href;
  // `new URL("/", origin).href` ends with "/"; the home page canonical is the bare origin.
  return url.pathname === "/" && !url.search ? origin : href;
}

/** Remove tracking parameters from a URL (returns a new URL). */
export function stripTrackingParams(input: URL): URL {
  const url = new URL(input.href);
  for (const name of [...url.searchParams.keys()]) if (isTrackingParam(name)) url.searchParams.delete(name);
  return url;
}

/** Whether a URL string points at this site (same origin as APP_URL, or a site-relative path). */
export function isSameSiteUrl(value: string, origin: string = siteOrigin()): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/** Decode a path segment received in route params; returns null for malformed encodings. */
export function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
