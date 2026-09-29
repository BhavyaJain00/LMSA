import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { getPublicBaseUrl } from "@/lib/data/certificates";
import { SINGLE_EVENT_TYPES, eventsToIcs, resolveSingleEvent, type SingleEventType } from "@/lib/calendar/events";
import { feedCalendarMeta, icsResponse, textResponse } from "@/lib/calendar/http";
import { icsFileName } from "@/lib/calendar/ics";

/**
 * Single-event download: GET /api/calendar/event?type=live_class&id=…
 * (also `timetable`, `evaluation` and `batch`). Requires a signed-in member
 * with the same access as the page that shows the event; the .ics opens in
 * Apple Calendar, Outlook and most other calendar apps.
 */

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "";
  const id = params.get("id") ?? "";
  if (!(SINGLE_EVENT_TYPES as readonly string[]).includes(type) || !ID_RE.test(id)) {
    return textResponse(400, "Unknown calendar event.");
  }

  const user = await getCurrentUser();
  if (!user) return textResponse(401, "Sign in to add this event to your calendar.");

  try {
    const [db, settings] = await Promise.all([getDb(), getSettings()]);
    const result = resolveSingleEvent(db, user, settings, type as SingleEventType, id);
    if (!result.ok) return textResponse(result.status, result.error);

    const meta = feedCalendarMeta(settings);
    const body = eventsToIcs(result.events, {
      baseUrl: await getPublicBaseUrl(),
      now: Date.now(),
      calendarName: meta.name,
    });
    return icsResponse(body, {
      filename: icsFileName(result.name, "event"),
      disposition: "attachment",
      cacheControl: "private, no-store",
    });
  } catch (err) {
    console.error("[calendar] event download failed:", err instanceof Error ? err.message : err);
    return textResponse(500, "This event couldn't be exported. Please try again.");
  }
}
