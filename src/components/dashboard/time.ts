/**
 * Timezone helpers shared by server data loaders and client cards.
 *
 * Live classes and evaluations are stored as a wall-clock date + time in an
 * IANA timezone (e.g. "2026-10-08" "18:00" "America/New_York"). These pure
 * helpers turn that into a real instant so the UI can show the viewer's
 * local time and decide whether a class is upcoming, live or over. They use
 * only `Intl`, so they run identically on the server and in the browser.
 */

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (formatters.has(timeZone)) return formatters.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Offset of `timeZone` from UTC (in ms) at the given instant. Unknown zones are treated as UTC. */
export function timeZoneOffsetMs(timeZone: string, instant: number): number {
  const formatter = formatterFor(timeZone);
  if (!formatter || !Number.isFinite(instant)) return 0;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Convert a wall-clock date (YYYY-MM-DD) and time (HH:mm) in an IANA zone to a UTC Date. */
export function zonedDateTimeToUtc(date: string, time: string | undefined, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  if (!Number.isFinite(guess)) return new Date(NaN);
  // Two passes handle instants close to a DST transition.
  const first = guess - timeZoneOffsetMs(timeZone, guess);
  const second = guess - timeZoneOffsetMs(timeZone, first);
  return new Date(second);
}

export interface SessionWindow {
  start: Date;
  end: Date;
}

/** Start/end instants of a live class. */
export function classWindow(c: { date: string; time: string; durationMinutes: number; timezone: string }): SessionWindow {
  const start = zonedDateTimeToUtc(c.date, c.time, c.timezone || "UTC");
  const end = new Date(start.getTime() + Math.max(0, c.durationMinutes) * 60_000);
  return { start, end };
}

/** Start/end instants of an evaluation slot (end falls back to start + 30 minutes). */
export function slotWindow(s: { date: string; startTime: string; endTime?: string; timezone?: string }): SessionWindow {
  const tz = s.timezone || "UTC";
  const start = zonedDateTimeToUtc(s.date, s.startTime, tz);
  let end = s.endTime ? zonedDateTimeToUtc(s.date, s.endTime, tz) : new Date(start.getTime() + 30 * 60_000);
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 30 * 60_000);
  return { start, end };
}

export type LiveState = "upcoming" | "today" | "live" | "ended";

/** Local (viewer) calendar day key for an instant. */
export function localDayKey(instant: number): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Where a session stands relative to `now`, in the viewer's local calendar:
 * - "live": between start and end
 * - "today": starts later today
 * - "ended": already over
 * - "upcoming": a later day
 */
export function sessionState(window: SessionWindow, now: number): LiveState {
  const start = window.start.getTime();
  const end = window.end.getTime();
  if (now > end) return "ended";
  if (now >= start) return "live";
  return localDayKey(start) === localDayKey(now) ? "today" : "upcoming";
}

/** "in 3 hours", "in 2 days", "in 5 minutes". */
export function timeUntil(target: number, now: number): string {
  const diff = Math.max(0, target - now);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return rtf.format(Math.max(1, minutes), "minute");
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return rtf.format(hours, "hour");
  const days = Math.round(diff / 86_400_000);
  return rtf.format(days, "day");
}

/** Short time in the class's own zone, e.g. "6:00 PM EDT". Used for the server render before hydration. */
export function formatInZone(instant: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(instant.getTime())) return "";
  try {
    return instant.toLocaleString("en-US", { ...opts, timeZone });
  } catch {
    return instant.toLocaleString("en-US", { ...opts, timeZone: "UTC" });
  }
}
