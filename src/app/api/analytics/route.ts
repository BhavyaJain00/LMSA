import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { siteConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { perIpLimit, SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { ANON_COOKIE, CONSENT_COOKIE, isValidAnonId, parseConsentValue } from "@/lib/legal/consent-shared";
import { isBot } from "@/lib/growth/bots";
import { optedOut, parseBeaconPayload } from "@/lib/growth/analytics-shared";
import { maybeCompactAnalytics, recordPageView, type PageViewContext } from "@/lib/growth/analytics";

/**
 * POST /api/analytics — first-party page-view beacon (sent with
 * `navigator.sendBeacon` by `<AnalyticsBeacon />`).
 *
 * Same-origin only, no bots, honours Do-Not-Track / Global Privacy Control,
 * rate-limited per client IP. Without analytics consent the page view is
 * stored anonymously (no visitor or member id); with consent it carries the
 * `ll_anon` visitor id and the signed-in member. Always answers 204 for
 * requests it chooses not to record, so the browser has nothing to retry.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const MINUTE = 60 * 1000;
/** Page views from one IP (fast clicking through pages stays well below this). */
const PER_IP: RateLimitRule = { limit: 60, windowMs: MINUTE };
/** Page views from every client whose IP is not known, together. */
const SHARED: RateLimitRule = { limit: 3000, windowMs: MINUTE };

const g = globalThis as unknown as { __llAnalyticsLimiter?: SlidingWindowRateLimiter };
const limiter = (g.__llAnalyticsLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

const noContent = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(req.url).origin]);
  try {
    allowed.add(new URL(siteConfig.appUrl).origin);
  } catch {
    /* malformed APP_URL: only the request origin counts */
  }
  return allowed.has(origin);
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("Cross-site analytics requests are not accepted.", { status: 403 });
  const h = req.headers;
  if (optedOut(h) || isBot(h.get("user-agent"))) return noContent();

  const bucket = perIpLimit("analytics", clientIpFromHeaders(h), PER_IP, SHARED);
  if (!limiter.hit(bucket.key, bucket.rule).ok) return new NextResponse(null, { status: 429, headers: { "Retry-After": "60" } });

  const declared = Number(h.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const payload = parseBeaconPayload(body);
  if (!payload) return new NextResponse(null, { status: 400 });

  const jar = await cookies();
  const ctx: PageViewContext = { host: h.get("host") };
  if (payload.consent && parseConsentValue(jar.get(CONSENT_COOKIE)?.value).analytics) {
    const anon = jar.get(ANON_COOKIE)?.value;
    if (isValidAnonId(anon)) ctx.anonId = anon;
    const user = await getCurrentUser();
    if (user) ctx.userId = user.id;
  }

  after(async () => {
    try {
      await recordPageView(payload, ctx);
      await maybeCompactAnalytics();
    } catch (error) {
      console.error("[analytics] could not record a page view:", error instanceof Error ? error.message : String(error));
    }
  });
  return noContent();
}
