import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { siteConfig } from "@/lib/config";
import { UNSUBSCRIBE_RECEIPT_COOKIE } from "@/lib/email/unsubscribe-cookie";
import { trackVisitor } from "@/lib/growth/visitor-cookies";

/**
 * Optimistic auth check: routes under these prefixes need a session cookie.
 * Real authorization happens server-side in each page/action; this only
 * avoids rendering protected pages for obviously anonymous visitors.
 * Pages that also serve guests (for example `/you`) are not listed here and
 * handle the signed-out state themselves.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/settings", "/billing", "/notifications", "/persona"];

/**
 * One-click unsubscribe links from emails (`/settings/notifications?unsubscribe=…&u=…&t=…`)
 * must work without a session: the page verifies the HMAC signature itself. So must the
 * token-free result page the confirmation redirects to (it carries a signed receipt cookie).
 */
function isSignedUnsubscribeLink(request: NextRequest, pathname: string, params: URLSearchParams): boolean {
  if (pathname !== "/settings/notifications") return false;
  return (params.has("unsubscribe") && params.has("u") && params.has("t")) || request.cookies.has(UNSUBSCRIBE_RECEIPT_COOKIE);
}

export function proxy(request: NextRequest) {
  // Growth: `?ref=CODE` referral cookie (last click) and the anonymous visitor id.
  const visitor = trackVisitor(request);
  const { pathname, search, searchParams } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) return visitor.next();
  if (isSignedUnsubscribeLink(request, pathname, searchParams)) return visitor.next();

  const hasSession = request.cookies.has(siteConfig.sessionCookie);
  if (hasSession) return visitor.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return visitor.apply(NextResponse.redirect(login));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|videos|uploads|images).*)"],
};
