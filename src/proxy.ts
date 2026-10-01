import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guestLoginPath, isLoginOnlyPage } from "@/lib/auth/login-only-pages";
import { siteConfig } from "@/lib/config";
import { UNSUBSCRIBE_RECEIPT_COOKIE } from "@/lib/email/unsubscribe-cookie";
import { trackVisitor } from "@/lib/growth/visitor-cookies";
import { INDEXNOW_KEY_PATH, indexNowKeyFromPath } from "@/lib/seo/indexnow";
import { seoRedirectTarget } from "@/lib/seo/proxy-canonical";
import { isRedirectCandidate, slugRedirectFor } from "@/lib/seo/proxy-redirects";

/**
 * One-click unsubscribe links from emails (`/settings/notifications?unsubscribe=…&u=…&t=…`)
 * must work without a session: the page verifies the HMAC signature itself. So must the
 * token-free result page the confirmation redirects to (it carries a signed receipt cookie).
 */
function isSignedUnsubscribeLink(request: NextRequest, pathname: string, params: URLSearchParams): boolean {
  if (pathname !== "/settings/notifications") return false;
  return (params.has("unsubscribe") && params.has("u") && params.has("t")) || request.cookies.has(UNSUBSCRIBE_RECEIPT_COOKIE);
}

/**
 * SEO: one permanent redirect to the canonical host, without a trailing slash
 * and at the page's current slug (old slugs come from an in-memory map, see
 * `proxy-redirects.ts`; nothing here touches the database).
 */
function seoRedirect(request: NextRequest): NextResponse | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname, search } = request.nextUrl;
  const target = seoRedirectTarget(
    { pathname, search, host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host") },
    (path) => (isRedirectCandidate(path) ? slugRedirectFor(path) : null),
  );
  return target ? NextResponse.redirect(new URL(target, request.url), 301) : null;
}

export function proxy(request: NextRequest) {
  const moved = seoRedirect(request);
  if (moved) return moved;

  // IndexNow: `/<key>.txt` is served by the key-file route, which checks the key.
  const indexNowKey = indexNowKeyFromPath(request.nextUrl.pathname);
  if (indexNowKey) return NextResponse.rewrite(new URL(`${INDEXNOW_KEY_PATH}?key=${indexNowKey}`, request.url));

  // Growth: `?ref=CODE` referral cookie (last click) and the anonymous visitor id.
  const visitor = trackVisitor(request);

  // Optimistic auth check for login-only pages (exact page patterns, see
  // `login-only-pages.ts`): guests get a real 307 to the login page instead of
  // a streamed page that redirects in the browser. Only page loads (GET/HEAD)
  // are redirected; Server Action POSTs and route handlers check the session
  // themselves, and every page still authorizes on the server.
  const { pathname, search, searchParams } = request.nextUrl;
  if (request.method !== "GET" && request.method !== "HEAD") return visitor.next();
  if (!isLoginOnlyPage(pathname)) return visitor.next();
  if (isSignedUnsubscribeLink(request, pathname, searchParams)) return visitor.next();
  if (request.cookies.has(siteConfig.sessionCookie)) return visitor.next();

  return visitor.apply(NextResponse.redirect(new URL(guestLoginPath(pathname, search), request.url)));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|videos|uploads|images).*)"],
};
