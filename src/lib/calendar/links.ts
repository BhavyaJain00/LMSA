/**
 * "Add to calendar" and "subscribe" links for Google Calendar, Outlook.com
 * and Microsoft 365, plus webcal:// helpers. Pure: safe for client bundles.
 */

import { formatDateValue, formatUtcStamp, isDateKey, toIsoSeconds } from "./time";

export interface CalendarLinkEvent {
  title: string;
  description?: string;
  location?: string;
  /** Absolute page URL appended to the description. */
  url?: string;
  /** Epoch ms. For all-day events these are only used as a fallback. */
  start: number;
  end: number;
  /** All-day event: first day and EXCLUSIVE last day (YYYY-MM-DD). */
  allDay?: { startDate: string; endDate: string };
}

/** Calendar sites reject very long URLs; keep the description well under typical limits. */
const MAX_DETAILS = 1200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Description + trailing page link, trimmed to a URL-friendly length. */
export function linkDetails(event: Pick<CalendarLinkEvent, "description" | "url">): string {
  const parts: string[] = [];
  const url = event.url?.trim();
  const room = MAX_DETAILS - (url ? url.length + 2 : 0);
  if (event.description?.trim()) parts.push(truncate(event.description.trim(), Math.max(80, room)));
  if (url) parts.push(url);
  return parts.join("\n\n");
}

function query(params: [string, string | undefined][]): string {
  return params
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function validAllDay(event: CalendarLinkEvent): { startDate: string; endDate: string } | null {
  const a = event.allDay;
  if (!a || !isDateKey(a.startDate) || !isDateKey(a.endDate) || a.endDate <= a.startDate) return null;
  return a;
}

/** Google Calendar "create event" template URL. */
export function googleCalendarUrl(event: CalendarLinkEvent): string {
  const allDay = validAllDay(event);
  const dates = allDay
    ? `${formatDateValue(allDay.startDate)}/${formatDateValue(allDay.endDate)}`
    : `${formatUtcStamp(event.start)}/${formatUtcStamp(Math.max(event.end, event.start))}`;
  const rest = query([
    ["text", event.title],
    ["details", linkDetails(event)],
    ["location", event.location],
  ]);
  // `dates` only contains digits, "T", "Z" and "/", so it is safe unencoded.
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${dates}${rest ? `&${rest}` : ""}`;
}

function outlookUrl(host: string, event: CalendarLinkEvent): string {
  const allDay = validAllDay(event);
  const params = query([
    ["path", "/calendar/action/compose"],
    ["rru", "addevent"],
    ["subject", event.title],
    ["startdt", allDay ? allDay.startDate : toIsoSeconds(event.start)],
    ["enddt", allDay ? allDay.endDate : toIsoSeconds(Math.max(event.end, event.start))],
    ["allday", allDay ? "true" : "false"],
    ["body", linkDetails(event)],
    ["location", event.location],
  ]);
  return `https://${host}/calendar/0/deeplink/compose?${params}`;
}

/** Outlook.com (personal Microsoft accounts) compose URL. */
export function outlookComUrl(event: CalendarLinkEvent): string {
  return outlookUrl("outlook.live.com", event);
}

/** Outlook on the web for Microsoft 365 (work or school accounts). */
export function office365Url(event: CalendarLinkEvent): string {
  return outlookUrl("outlook.office.com", event);
}

/* ------------------------------------------------------------------ */
/* Feed subscriptions                                                  */
/* ------------------------------------------------------------------ */

/** https://host/path → webcal://host/path (opens the system calendar app). */
export function toWebcalUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//i, "webcal://");
}

/** Google Calendar "add by URL" link for a feed. */
export function googleSubscribeUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(toWebcalUrl(feedUrl))}`;
}

/** Outlook.com "subscribe from web" link for a feed. */
export function outlookSubscribeUrl(feedUrl: string, name: string, host: "outlook.live.com" | "outlook.office.com" = "outlook.live.com"): string {
  return `https://${host}/calendar/0/addfromweb?${query([
    ["url", feedUrl],
    ["name", name],
  ])}`;
}

/** Whether an origin can be reached by Google/Microsoft servers (not localhost or a private address). */
export function isPubliclyReachable(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (hostname === "[::1]" || hostname.startsWith("[fc") || hostname.startsWith("[fd") || hostname.startsWith("[fe80")) return false;
    return true;
  } catch {
    return false;
  }
}
