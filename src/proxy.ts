import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { siteConfig } from "@/lib/config";

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
 * must work without a session: the page verifies the HMAC signature itself.
 */
function isSignedUnsubscribeLink(pathname: string, params: URLSearchParams): boolean {
  return pathname === "/settings/notifications" && params.has("unsubscribe") && params.has("u") && params.has("t");
}

export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) return NextResponse.next();
  if (isSignedUnsubscribeLink(pathname, searchParams)) return NextResponse.next();

  const hasSession = request.cookies.has(siteConfig.sessionCookie);
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|videos|uploads|images).*)"],
};
