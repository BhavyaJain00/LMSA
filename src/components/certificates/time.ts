/**
 * Time-zone helpers shared by the server (slot generation, booking checks)
 * and the client (local-time hints). No runtime imports: safe everywhere.
 *
 * Evaluator slots are stored as bare wall-clock times ("10:00") in the
 * platform time zone (the server's zone). Bookings store the zone they were
 * made in, so a request can always be converted to an absolute instant.
 *
 * The display helpers take an optional interface language (`f.locale` /
 * `useLocale()`); without one they keep their English output, which emails,
 * logs and server actions rely on.
 */

import { intlLocale } from "@/i18n/config";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Monday-first order used by the availability editor. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Length of one bookable evaluation slot, in minutes. */
export const EVALUATION_SLOT_MINUTES = 30;

/** How many days ahead learners can book an evaluation. */
export const BOOKING_WINDOW_DAYS = 14;

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidClock(value: string): boolean {
  return CLOCK_RE.test(value);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "10:30" → 630 */
export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 630 → "10:30" (wraps past midnight). */
export function minutesToClock(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD key, independent of any time zone. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add days to a YYYY-MM-DD key using calendar arithmetic (no DST surprises). */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Monday of the week that contains the given day. */
export function startOfWeekKey(dateKey: string): string {
  const weekday = weekdayOfDateKey(dateKey);
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return addDaysToKey(dateKey, diff);
}

function utcDateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "2 October 2026" — stable across server and client (formatted in UTC). */
export function formatLongDate(dateKey: string, locale?: string): string {
  if (!isValidDateKey(dateKey)) return dateKey;
  return utcDateFromKey(dateKey).toLocaleDateString(locale ? intlLocale(locale) : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Oct 2, 2026" — stable across server and client (formatted in UTC). */
export function formatShortDate(dateKey: string, locale?: string): string {
  if (!isValidDateKey(dateKey)) return dateKey;
  return utcDateFromKey(dateKey).toLocaleDateString(locale ? intlLocale(locale) : "en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "October 2026" for calendar headers. */
export function formatMonthYear(dateKey: string, locale?: string): string {
  if (!isValidDateKey(dateKey)) return dateKey;
  return utcDateFromKey(dateKey).toLocaleDateString(locale ? intlLocale(locale) : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function weekdayName(dateKey: string, locale?: string): string {
  if (locale && isValidDateKey(dateKey)) return utcDateFromKey(dateKey).toLocaleDateString(intlLocale(locale), { weekday: "long", timeZone: "UTC" });
  return WEEKDAYS[weekdayOfDateKey(dateKey)] ?? "";
}

/** Name of a weekday (0 = Sunday) in the given language; English without one. */
export function localWeekdayName(day: number, locale?: string, width: "long" | "short" = "long"): string {
  if (!locale) return width === "long" ? (WEEKDAYS[day] ?? "") : (WEEKDAYS[day] ?? "").slice(0, 3);
  // 2023-01-01 was a Sunday.
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(intlLocale(locale), { weekday: width, timeZone: "UTC" });
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Offset (minutes east of UTC) of a time zone at a given instant. */
export function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/** Convert a wall-clock date + time in `timeZone` into an ISO instant. */
export function zonedToUtcIso(dateKey: string, hhmm: string, timeZone: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = timeZoneOffsetMinutes(timeZone, new Date(guess));
  let ts = guess - offset * 60000;
  const corrected = timeZoneOffsetMinutes(timeZone, new Date(ts));
  if (corrected !== offset) ts = guess - corrected * 60000;
  return new Date(ts).toISOString();
}

/** "GMT+5:30" / "GMT-4" / "GMT" */
export function gmtOffsetLabel(timeZone: string, at: Date = new Date()): string {
  const offset = timeZoneOffsetMinutes(timeZone, at);
  if (offset === 0) return "GMT";
  const sign = offset > 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "Asia/Kolkata (GMT+5:30)" */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  return `${timeZone} (${gmtOffsetLabel(timeZone, at)})`;
}

/** "14:30" → "2:30 PM" */
export function formatClock12(hhmm: string | undefined, locale?: string): string {
  if (!hhmm || !isValidClock(hhmm)) return hhmm ?? "";
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  if (locale) return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(intlLocale(locale), { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Evaluator unavailability                                            */
/* ------------------------------------------------------------------ */

export interface UnavailabilityRange {
  /** YYYY-MM-DD, inclusive */
  from: string;
  /** YYYY-MM-DD, inclusive */
  to: string;
}

/**
 * The evaluator's unavailability as stored on their slot rows (every row
 * carries the same values). Returns the raw From/To (either may be empty).
 */
export function unavailabilityOf(slots: readonly { unavailableFrom?: string; unavailableTo?: string }[]): { from: string; to: string } {
  const row = slots.find((s) => s.unavailableFrom || s.unavailableTo);
  return { from: row?.unavailableFrom ?? "", to: row?.unavailableTo ?? "" };
}

/** The blocking range: only when both dates are set (as in Frappe). */
export function activeUnavailability(slots: readonly { unavailableFrom?: string; unavailableTo?: string }[]): UnavailabilityRange | null {
  const { from, to } = unavailabilityOf(slots);
  if (!from || !to || !isValidDateKey(from) || !isValidDateKey(to) || from > to) return null;
  return { from, to };
}

export function isDateInRange(dateKey: string, range: UnavailabilityRange | null | undefined): boolean {
  return !!range && dateKey >= range.from && dateKey <= range.to;
}
