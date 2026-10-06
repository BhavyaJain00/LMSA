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
 *    The visitor's host is read from `X-Forwarded-Host` only when the
 *    deployment declares trusted reverse proxies (`TRUST_PROXY_HOPS`, the
 *    same switch as the client IP): otherwise any client could send the
 *    header and make a canonical URL answer with a redirect to itself;
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

/** `TRUST_PROXY_HOPS` as a whole number (0 when unset or invalid); mirrors `trustedProxyHops` in auth/request-info.ts. */
export function proxyHopsFromEnv(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  const value = (raw ?? "").trim();
  return /^\d{1,3}$/.test(value) ? Math.min(Number(value), 20) : 0;
}

/**
 * The visitor's host as the trusted proxies forwarded it, or "" when no proxy
 * is trusted (the header is then whatever the client sent). With N proxies
 * that each append to the header, the outermost one wrote the Nth entry from
 * the right; proxies that overwrite it leave a single entry.
 */
export function trustedForwardedHost(raw: string | null | undefined, hops: number): string {
  if (!raw || hops <= 0) return "";
  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);
  if (!entries.length) return "";
  return normalizeHost(entries[Math.max(0, entries.length - hops)]);
}

export interface CanonicalHostRequest {
  host: string | null | undefined;
  forwardedHost?: string | null;
  /** Trusted reverse proxies in front of the app (default: `TRUST_PROXY_HOPS`). */
  proxyHops?: number;
}

/** The host the visitor used: the trusted forwarded host, else the Host header. */
export function requestHost(request: CanonicalHostRequest): string {
  return trustedForwardedHost(request.forwardedHost, request.proxyHops ?? proxyHopsFromEnv()) || normalizeHost(request.host);
}

/**
 * The origin a request should be redirected to, or null when its host is
 * already canonical (or must be left alone).
 */
export function canonicalOriginFor(request: CanonicalHostRequest, origin: string = siteOrigin(), mode: CanonicalHostMode = canonicalHostMode()): string | null {
  if (mode === "off" || !isPingableOrigin(origin)) return null;
  let canonicalHost: string;
  try {
    canonicalHost = normalizeHost(new URL(origin).host);
  } catch {
    return null;
  }
  const host = requestHost(request);
  if (!host || host === canonicalHost || isInternalHost(host)) return null;
  if (mode === "www" && withoutWww(host) !== withoutWww(canonicalHost)) return null;
  return origin;
}

/** A path without trailing slashes (the root stays "/"). */
export function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

export interface SeoRedirectRequest extends CanonicalHostRequest {
  pathname: string;
  /** Query string including the leading "?", or "". */
  search: string;
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
