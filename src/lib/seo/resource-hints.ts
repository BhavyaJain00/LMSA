/**
 * Resource hints for third-party hosts that serve the site's media (pure).
 *
 * Opening a connection to another origin costs a DNS lookup, a TCP handshake
 * and a TLS negotiation before the first byte of a cover image or a video
 * segment arrives. `preconnect` does all three ahead of time and is reserved
 * for the one or two hosts almost every page needs (the CDN in front of the
 * media storage, the host most covers come from); the next few hosts only get
 * the cheap `dns-prefetch`.
 */

export interface ResourceHints {
  preconnect: string[];
  dnsPrefetch: string[];
}

/** Browsers keep only a handful of idle connections; more preconnects waste them. */
export const MAX_PRECONNECT = 2;
export const MAX_DNS_PREFETCH = 4;

/** Origin of an absolute http(s) URL on another host, or null (relative paths, same site, malformed). */
export function externalOrigin(url: string | undefined | null, siteOrigin: string): string | null {
  const value = url?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    const origin = new URL(value).origin;
    return origin === siteOrigin ? null : origin;
  } catch {
    return null;
  }
}

export function resourceHints(input: { siteOrigin: string; cdnBaseUrl?: string | null; mediaUrls: Iterable<string | undefined | null> }): ResourceHints {
  const cdn = externalOrigin(input.cdnBaseUrl, input.siteOrigin);
  const counts = new Map<string, number>();
  for (const url of input.mediaUrls) {
    const origin = externalOrigin(url, input.siteOrigin);
    if (origin && origin !== cdn) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([origin]) => origin);
  const preconnect = cdn ? [cdn] : [];
  while (preconnect.length < MAX_PRECONNECT && ranked.length) preconnect.push(ranked.shift()!);
  return { preconnect, dnsPrefetch: ranked.slice(0, MAX_DNS_PREFETCH) };
}
