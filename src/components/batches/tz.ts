/**
 * Pure date/time helpers for batches and live classes, shared by server and
 * client code (no runtime imports, no "server-only").
 *
 * Batches and live classes store a wall-clock date (`YYYY-MM-DD`), time
 * (`HH:mm`) and an IANA timezone. These helpers convert that wall-clock time
 * into an absolute instant and format it for display. Day keys are formatted
 * with hand-written month names so server and browser output is identical
 * (no hydration mismatches caused by ICU differences).
 */

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateKey(value: string | undefined | null): value is string {
  if (!value) return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isClock(value: string | undefined | null): value is string {
  return !!value && CLOCK_RE.test(value);
}

export function clockToMinutes(hhmm: string): number {
  const m = CLOCK_RE.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToClock(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** "14:30" + 90 → "16:00" (wraps past midnight). */
export function addMinutesToClock(hhmm: string, minutes: number): string {
  const start = clockToMinutes(hhmm);
  if (Number.isNaN(start)) return hhmm;
  return minutesToClock(start + minutes);
}

/** "14:30" → "2:30 PM" */
export function formatClock12(hhmm: string | undefined): string {
  if (!hhmm) return "";
  const mins = clockToMinutes(hhmm);
  if (Number.isNaN(mins)) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatClockRange(start: string | undefined, end: string | undefined): string {
  if (!start) return "";
  if (!end) return formatClock12(start);
  return `${formatClock12(start)} – ${formatClock12(end)}`;
}

function parseKey(dateKey: string): { y: number; m: number; d: number } | null {
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Day of week (0 = Sunday) for a YYYY-MM-DD key. */
export function weekdayOf(dateKey: string): number {
  const p = parseKey(dateKey);
  if (!p) return 0;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** "2026-10-12" → "12 Oct 2026" (short) or "12 October 2026" (long). */
export function formatDayKey(dateKey: string | undefined, style: "short" | "long" | "weekday" = "short"): string {
  if (!dateKey) return "";
  const p = parseKey(dateKey);
  if (!p) return dateKey;
  if (style === "long") return `${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`;
  if (style === "weekday") return `${WEEKDAYS_SHORT[weekdayOf(dateKey)]}, ${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** "12 Oct 2026 – 9 Nov 2026", or a single date when both are the same day. */
export function formatDateRange(start: string, end: string | undefined): string {
  if (!end || start === end) return formatDayKey(start);
  const a = parseKey(start);
  const b = parseKey(end);
  if (a && b && a.y === b.y) {
    if (a.m === b.m) return `${a.d} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
    return `${a.d} ${MONTHS_SHORT[a.m - 1]} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
  }
  return `${formatDayKey(start)} – ${formatDayKey(end)}`;
}

/** Add days to a YYYY-MM-DD key. */
export function shiftDayKey(dateKey: string, days: number): string {
  const p = parseKey(dateKey);
  if (!p) return dateKey;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Timezones                                                            */
/* ------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeZone(tz: string | undefined | null): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(epochMs: number, tz: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(safeZone(tz)).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour) % 24,
    mm: Number(parts.minute),
    ss: Number(parts.second),
  };
}

/** Offset of a timezone from UTC at an instant, in minutes (e.g. +330 for Asia/Kolkata). */
export function tzOffsetMinutes(tz: string, epochMs: number): number {
  const p = zonedParts(epochMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * Convert a wall-clock date + time in `tz` to an absolute epoch (ms).
 * Returns NaN for invalid input.
 */
export function zonedTimeToUtc(dateKey: string, hhmm: string, tz: string): number {
  const p = parseKey(dateKey);
  const mins = clockToMinutes(hhmm || "00:00");
  if (!p || Number.isNaN(mins)) return NaN;
  const zone = safeZone(tz);
  const guess = Date.UTC(p.y, p.m - 1, p.d, Math.floor(mins / 60), mins % 60);
  const first = tzOffsetMinutes(zone, guess);
  let result = guess - first * 60000;
  const second = tzOffsetMinutes(zone, result);
  if (second !== first) result = guess - second * 60000;
  return result;
}

/** "GMT+5:30", "GMT-4", "GMT" */
export function formatGmtOffset(tz: string, epochMs: number): string {
  const off = tzOffsetMinutes(safeZone(tz), epochMs);
  if (off === 0) return "GMT";
  const sign = off > 0 ? "+" : "-";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `GMT${sign}${h}:${String(m).padStart(2, "0")}` : `GMT${sign}${h}`;
}

/** "America/New_York" → "America/New York (GMT-4)" */
export function formatTzLabel(tz: string, epochMs: number): string {
  return `${tz.replace(/_/g, " ")} (${formatGmtOffset(tz, epochMs)})`;
}

/** Day key (YYYY-MM-DD) of an instant in a timezone. */
export function dayKeyInZone(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Clock (HH:mm) of an instant in a timezone. */
export function clockInZone(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

/** "in 2d 4h", "in 35m 10s", "now" – for countdowns. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Minutes around a live class's start time during which learners may join. */
export const JOIN_WINDOW_MINUTES = 15;

/**
 * - `early`: more than the join window before the start.
 * - `open`: within ±JOIN_WINDOW_MINUTES of the start; learners can join.
 * - `closed`: the join window has passed but the class is still running (or
 *   ended less than JOIN_WINDOW_MINUTES ago); learners can no longer join.
 * - `ended`: the class is over and belongs in the past list.
 */
export type JoinWindowState = "early" | "open" | "closed" | "ended";

/** Where a class starting at `startsAt` and ending at `endsAt` stands at `now`. */
export function joinWindowState(startsAt: number, endsAt: number, now: number): JoinWindowState {
  const margin = JOIN_WINDOW_MINUTES * 60000;
  if (now < startsAt - margin) return "early";
  if (now <= startsAt + margin) return "open";
  if (now <= endsAt + margin) return "closed";
  return "ended";
}
