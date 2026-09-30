import { isPingableOrigin } from "./indexnow";
import { siteOrigin } from "./site";

/**
 * Canonical address decisions for `src/proxy.ts` (pure, no I/O).
 *
 * Search engines treat `www.example.com/x`, `example.com/x` and
 * `example.com/x/` as three different pages. Every page already names its
 * canonical URL (built from `APP_URL`); the proxy also sends visitors and
 * crawlers there with one permanent redirect that combines:
 *
 *  - the canonical host: by default only the `www.` twin of the `APP_URL`
 *    host is redirected (`www.example.com` ⇄ `example.com`), which is safe
 *    behind any reverse proxy. `SEO_CANONICAL_HOST=all` redirects every other
 *    public host name as well (platform sub-domains, old domains); use it
 *    only when the reverse proxy forwards the visitor's Host header, or the
 *    redirect loops. `SEO_CANONICAL_HOST=off` disables host redirects.
 *    Local and internal hosts (localhost, IP addresses, single-label and
 *    `.internal`/`.local` names) are never redirected, so health checks and
 *    container networking keep working;
 *  - no trailing slash;
 *  - the page's current slug (see `proxy-redirects.ts`).
 *
 * The scheme is left to the reverse proxy and HSTS: the app cannot reliably
 * tell whether the visitor used HTTPS when TLS ends in front of it.
 */

export type CanonicalHostMode = "www" | "all" | "off";

export function canonicalHostMode(raw: string | undefined = process.env.SEO_CANONICAL_HOST): CanonicalHostMode {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "all" || value === "off" ? value : "www";
}

/** Host header value → lower-case host without a default port. */
export function normalizeHost(raw: string | null | undefined): string {
  const first = (raw ?? "").split(",", 1)[0]!.trim().toLowerCase();
  return first.replace(/:(?:80|443)$/, "");
}

/** Hosts that only exist inside a machine or a private network. */
export function isInternalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  if (!name) return true;
  if (name.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) return true;
  if (!name.includes(".")) return true;
  return /\.(?:localhost|local|internal|test|lan)$/.test(name);
}

const withoutWww = (host: string) => host.replace(/^www\./, "");

/**
 * The origin a request should be redirected to, or null when its host is
 * already canonical (or must be left alone).
 */
export function canonicalOriginFor(
  request: { host: string | null | undefined; forwardedHost?: string | null },
  origin: string = siteOrigin(),
  mode: CanonicalHostMode = canonicalHostMode(),
): string | null {
  if (mode === "off" || !isPingableOrigin(origin)) return null;
  let canonicalHost: string;
  try {
    canonicalHost = normalizeHost(new URL(origin).host);
  } catch {
    return null;
  }
  const host = normalizeHost(request.forwardedHost) || normalizeHost(request.host);
  if (!host || host === canonicalHost || isInternalHost(host)) return null;
  if (mode === "www" && withoutWww(host) !== withoutWww(canonicalHost)) return null;
  return origin;
}

/** A path without trailing slashes (the root stays "/"). */
export function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

export interface SeoRedirectRequest {
  pathname: string;
  /** Query string including the leading "?", or "". */
  search: string;
  host: string | null | undefined;
  forwardedHost?: string | null;
}

/**
 * Where a GET request should be permanently redirected, or null. The result
 * is an absolute URL when the host changes and a path otherwise; the query
 * string is kept. `lookup` resolves slug redirects for a path.
 */
export function seoRedirectTarget(
  request: SeoRedirectRequest,
  lookup: (pathname: string) => string | null,
  origin: string = siteOrigin(),
  mode: CanonicalHostMode = canonicalHostMode(),
): string | null {
  // Leading "//" or "/\" would turn the redirect target into another host: collapse them first.
  const trimmed = stripTrailingSlash(request.pathname.replace(/^[/\\]+/, "/"));
  const moved = lookup(trimmed);
  const path = moved && /^\/(?![/\\])/.test(moved) ? moved : trimmed;
  const targetOrigin = canonicalOriginFor(request, origin, mode);
  if (!targetOrigin && path === request.pathname) return null;
  return `${targetOrigin ?? ""}${path}${request.search}`;
}
