import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { perIpLimit, SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { getSettings } from "@/lib/db/store";
import { authorizeMediaAccess, siteOrigins } from "@/lib/media/access";
import { parseMediaSrc } from "@/lib/media/paths";
import { playerOptionsFor, signMediaForSubject, signedUrlTtlSeconds } from "@/lib/media/sign";
import { MediaSigningUnavailableError } from "@/lib/media/token";

/**
 * GET /api/media/sign?src=<upload url>&lesson=<lessonId>
 *
 * Issues a fresh signed URL for an uploaded video to the current viewer. The
 * player calls it when a pre-signed URL is about to expire, when a request
 * is rejected mid-playback, and for protected uploads rendered without a
 * token (course promo videos, class recordings, editor previews).
 *
 * The token is bound to the viewer's session (user id or "guest"), so the
 * returned URL does not play for anyone else.
 */

const g = globalThis as unknown as { __llMediaSignLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llMediaSignLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));
const RULE = { limit: 90, windowMs: 60_000 };
/** Guests whose IP is not known (no trusted proxy, TRUST_PROXY_HOPS=0) share one bucket. */
const SHARED_GUEST_RULE = { limit: 900, windowMs: 60_000 };
const LESSON_ID = /^[\w-]{1,64}$/;

const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

function fail(status: number, error: string, extra: Record<string, string> = {}) {
  return NextResponse.json({ ok: false, error }, { status, headers: { ...NO_STORE, ...extra } });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const src = (params.get("src") ?? "").trim();
  const lessonParam = (params.get("lesson") ?? "").trim();
  if (!src || src.length > 2048) return fail(400, "Missing video URL.");
  if (lessonParam && !LESSON_ID.test(lessonParam)) return fail(400, "Invalid lesson.");

  const origin = req.nextUrl.origin;
  const parsed = parseMediaSrc(src, siteOrigins(origin));
  if (!parsed || !parsed.isUpload) return fail(400, "Only videos uploaded to this site can be signed.");

  const user = await getCurrentUser();
  const bucket = user ? { key: `media-sign:u:${user.id}`, rule: RULE } : perIpLimit("media-sign:ip", clientIpFromHeaders(req.headers), RULE, SHARED_GUEST_RULE);
  const limited = limiter.hit(bucket.key, bucket.rule);
  if (!limited.ok) {
    return fail(429, "Too many requests. Please wait a moment.", { "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) });
  }

  const settings = await getSettings();
  const player = playerOptionsFor(user, settings);

  // Nothing to sign: other uploads, or protection is switched off.
  if (!parsed.isProtectedVideo || !settings.video.protectUploads) {
    return NextResponse.json({ ok: true, src: parsed.path, expiresAt: null, player }, { headers: NO_STORE });
  }

  const decision = await authorizeMediaAccess(user, parsed.path, { lessonId: lessonParam || null, requestOrigin: origin });
  if (!decision.ok) return fail(decision.status, decision.error);

  let signed: ReturnType<typeof signMediaForSubject>;
  try {
    signed = signMediaForSubject(parsed.path, user?.id ?? null, settings, origin);
  } catch (err) {
    // No usable APP_SECRET: the player shows "video unavailable" with a retry button.
    if (err instanceof MediaSigningUnavailableError) return fail(503, "This video is unavailable right now. Please try again later.", { "Retry-After": "300" });
    throw err;
  }
  // `ttlSeconds` lets the player schedule renewals from the lifetime, independent of its own clock.
  return NextResponse.json(
    { ok: true, src: signed.src, expiresAt: signed.expiresAt, ttlSeconds: signed.expiresAt ? signedUrlTtlSeconds(settings) : null, player },
    { headers: NO_STORE },
  );
}
