import type { NextRequest } from "next/server";
import { getDb, getSettings } from "@/lib/db/store";
import { getPublicBaseUrl } from "@/lib/data/certificates";
import { findUserByFeedToken } from "@/lib/calendar/token";
import { collectUserEvents, eventsToIcs } from "@/lib/calendar/events";
import { etagMatches, feedCalendarMeta, feedEtag, icsResponse, notModified, textResponse } from "@/lib/calendar/http";
import { icsFileName } from "@/lib/calendar/ics";

/**
 * Personal calendar feed: GET /api/calendar/<token>.ics
 *
 * Calendar apps poll this URL without cookies, so the unguessable token is
 * the only credential. Unknown, revoked or malformed tokens get the same 404
 * so the endpoint reveals nothing about which accounts exist. Responses carry
 * an ETag so well-behaved clients get cheap 304s between changes.
 */

const CACHE_CONTROL = "private, no-cache";
const REFRESH_MINUTES = 60;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token } = await ctx.params;
  try {
    const user = await findUserByFeedToken(token);
    if (!user) return textResponse(404, "Calendar feed not found. Copy a fresh link from Settings → Calendar.");

    const [db, settings] = await Promise.all([getDb(), getSettings()]);
    const events = collectUserEvents(db, user, settings);
    const meta = feedCalendarMeta(settings);
    const baseUrl = await getPublicBaseUrl();
    const etag = feedEtag(events, { meta, baseUrl, v: 1 });
    if (etagMatches(request.headers.get("if-none-match"), etag)) return notModified(etag, CACHE_CONTROL);

    const body = eventsToIcs(events, {
      baseUrl,
      now: Date.now(),
      calendarName: meta.name,
      calendarDescription: meta.description,
      color: meta.color,
      refreshMinutes: REFRESH_MINUTES,
    });
    const download = request.nextUrl.searchParams.get("download") === "1";
    return icsResponse(body, {
      filename: icsFileName(meta.name, "calendar"),
      disposition: download ? "attachment" : "inline",
      etag,
      cacheControl: CACHE_CONTROL,
    });
  } catch (err) {
    // Never log the token: it is a credential.
    console.error("[calendar] feed failed:", err instanceof Error ? err.message : err);
    return textResponse(500, "The calendar feed is temporarily unavailable. Please try again later.");
  }
}

export async function HEAD(request: NextRequest, ctx: RouteContext<"/api/calendar/[token]">) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
