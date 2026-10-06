import { NextResponse, type NextRequest } from "next/server";
import { siteConfig } from "@/lib/config";
import { ANON_COOKIE, CONSENT_MAX_AGE, isValidAnonId } from "@/lib/legal/consent-shared";
import { REF_CLICK_HEADER, REF_COOKIE, REF_COOKIE_MAX_AGE, REF_PARAM, formatRefCookie, normalizeCode, parseRefClicks, sanitizeLandingPath } from "./affiliates-shared";

/**
 * Visitor cookies set by `src/proxy.ts` (growth area):
 *
 *  - `ll_ref`: `?ref=CODE` on any page stores `CODE.<click time>` in front
 *    of the previous clicks (the last few are kept, newest first). The code
 *    is only checked for shape here, so the server credits the newest click
 *    of an active affiliate inside the attribution window: a link with an
 *    unknown or paused code cannot wipe a valid referral.
 *  - `ll_anon`: random visitor id (the same cookie the consent evidence
 *    uses), created when missing. It links referral clicks to later
 *    sign-ups and purchases without any personal data.
 *
 * New values are also written into the forwarded request's Cookie header so
 * the page rendered for this very request already sees them, and the
 * request that carried `?ref=` gets the `x-ll-referral` header (the landing
 * path) so the click is recorded exactly once. A client-sent copy of that
 * header is always dropped, and prefetch requests never capture a referral.
 */

interface CookieWrite {
  name: string;
  value: string;
  maxAge: number;
}

export interface VisitorTracking {
  /** `NextResponse.next()` carrying the visitor cookies (and forwarded request changes). */
  next(): NextResponse;
  /** Add the visitor cookies to another response (e.g. a redirect). */
  apply<R extends NextResponse>(response: R): R;
}

function randomVisitorId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Replace or add cookies in a Cookie request header. */
function withCookies(header: string | null, writes: readonly CookieWrite[]): string {
  const names = new Set(writes.map((w) => w.name));
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !names.has(part.split("=", 1)[0].trim()));
  return [...kept, ...writes.map((w) => `${w.name}=${w.value}`)].join("; ");
}

export function trackVisitor(request: NextRequest): VisitorTracking {
  const writes: CookieWrite[] = [];
  // Router and browser prefetches are not visits: they never count as a referral click.
  const prefetch = request.headers.has("next-router-prefetch") || /prefetch/i.test(request.headers.get("purpose") ?? request.headers.get("sec-purpose") ?? "");
  const refCode = prefetch ? null : normalizeCode(request.nextUrl.searchParams.get(REF_PARAM));
  const anon = request.cookies.get(ANON_COOKIE)?.value;
  if (!isValidAnonId(anon)) writes.push({ name: ANON_COOKIE, value: randomVisitorId(), maxAge: CONSENT_MAX_AGE });
  if (refCode) {
    const previous = parseRefClicks(request.cookies.get(REF_COOKIE)?.value);
    writes.push({ name: REF_COOKIE, value: formatRefCookie(refCode, Date.now(), previous), maxAge: REF_COOKIE_MAX_AGE });
  }

  const spoofedClick = request.headers.has(REF_CLICK_HEADER);
  let forwarded: Headers | null = null;
  if (writes.length || spoofedClick) {
    forwarded = new Headers(request.headers);
    forwarded.delete(REF_CLICK_HEADER);
    if (writes.length) forwarded.set("cookie", withCookies(request.headers.get("cookie"), writes));
    if (refCode) forwarded.set(REF_CLICK_HEADER, sanitizeLandingPath(request.nextUrl.pathname));
  }

  const apply = <R extends NextResponse>(response: R): R => {
    for (const w of writes) {
      response.cookies.set({ name: w.name, value: w.value, httpOnly: true, sameSite: "lax", secure: siteConfig.cookieSecure, path: "/", maxAge: w.maxAge });
    }
    return response;
  };

  return {
    next: () => apply(forwarded ? NextResponse.next({ request: { headers: forwarded } }) : NextResponse.next()),
    apply,
  };
}
