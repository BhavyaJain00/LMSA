import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, searchTranscripts } from "@/lib/transcripts/search";

/**
 * GET /api/transcripts/search?q=<text>[&courseId=<id>][&limit=<n>]
 *
 * Finds spoken words in lesson video transcripts: `{ ok, query, results }`
 * with the lessons the viewer can open, the matching lines and their
 * timestamps, and links that start the video at the first match. Guests
 * see free-preview lessons only. Limited to 60 searches a minute per client.
 */

export const dynamic = "force-dynamic";

const RULE = { limit: 60, windowMs: 60_000 };
const g = globalThis as unknown as { __llTranscriptSearchLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llTranscriptSearchLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return NextResponse.json({ ok: true, query, results: [] }, { headers: HEADERS });

  const user = await getCurrentUser();
  const rate = limiter.hit(user ? `u:${user.id}` : `ip:${clientIpFromHeaders(req.headers)}`, RULE);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many searches. Wait a moment and try again." },
      { status: 429, headers: { ...HEADERS, "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const limit = Number(params.get("limit"));
  const courseId = params.get("courseId")?.trim() || undefined;
  const results = await searchTranscripts(query, user, { courseId, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined });
  return NextResponse.json({ ok: true, query, results }, { headers: HEADERS });
}
