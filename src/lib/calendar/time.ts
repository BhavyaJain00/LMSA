/**
 * Pure, dependency-free date/time helpers for calendar exports.
 *
 * Events in the LMS are stored as a wall-clock date (`YYYY-MM-DD`), a time
 * (`HH:mm`) and an IANA timezone. Calendar files and "add to calendar" links
 * need absolute UTC instants, so these helpers convert wall-clock times to
 * epoch milliseconds using `Intl.DateTimeFormat` (no date library), including
 * correct handling of daylight-saving transitions:
 *
 *  - Ambiguous times (the repeated hour when clocks fall back) resolve to the
 *    EARLIER instant.
 *  - Non-existent times (the skipped hour when clocks spring forward) are
 *    pushed forward by the length of the gap, e.g. 02:30 on the day New York
 *    springs forward becomes 03:30 EDT.
 *
 * This matches the "compatible" disambiguation used by Temporal and by most
 * calendar applications. The module has no runtime imports so it can run on
 * the server, in the browser and in plain Node test scripts.
 */

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface WallClock {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

export function isDateKey(value: string | undefined | null): value is string {
  if (!value) return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isClock(value: string | undefined | null): value is string {
  return !!value && CLOCK_RE.test(value);
}

/** "14:30" → 870. NaN when invalid. */
export function clockToMinutes(hhmm: string): number {
  const m = CLOCK_RE.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

const zoneCache = new Map<string, boolean>();

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  const cached = zoneCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  zoneCache.set(tz, ok);
  return ok;
}

/** The zone itself when valid, otherwise UTC. */
export function safeTimeZone(tz: string | undefined | null): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

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
      era: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant as seen in `tz`. */
export function wallClockInZone(epochMs: number, tz: string): WallClock {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter(safeTimeZone(tz)).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  let y = Number(parts.year);
  // Years before 1 CE are reported as positive years in the BC era.
  if (parts.era === "BC" || parts.era === "B") y = 1 - y;
  return {
    y,
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour) % 24,
    mm: Number(parts.minute),
    ss: Number(parts.second),
  };
}

/** UTC offset of `tz` at an instant, in minutes (e.g. +330 for Asia/Kolkata, -240 for New York in summer). */
export function tzOffsetMinutes(tz: string, epochMs: number): number {
  const w = wallClockInZone(epochMs, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  const truncated = Math.floor(epochMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / MINUTE);
}

/**
 * Convert a wall-clock date + time in `tz` into an absolute epoch (ms).
 * Invalid zones fall back to UTC; invalid dates/times return NaN.
 */
export function zonedTimeToUtc(dateKey: string, hhmm: string | undefined, tz: string | undefined | null): number {
  if (!isDateKey(dateKey)) return NaN;
  const mins = clockToMinutes(hhmm && hhmm.length ? hhmm : "00:00");
  if (Number.isNaN(mins)) return NaN;
  const zone = safeTimeZone(tz);
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  // The wall-clock time interpreted as if it were UTC.
  const local = Date.UTC(y, m - 1, d, hh, mm);

  // Offsets a day either side of the target cover any single DST transition.
  const offBefore = tzOffsetMinutes(zone, local - DAY);
  const offAfter = tzOffsetMinutes(zone, local + DAY);
  const candidates = Array.from(new Set([local - offBefore * MINUTE, local - offAfter * MINUTE]));
  const matches = candidates.filter((t) => {
    const w = wallClockInZone(t, zone);
    return w.y === y && w.m === m && w.d === d && w.hh === hh && w.mm === mm;
  });
  if (matches.length) return Math.min(...matches);

  // The time does not exist (spring-forward gap). Interpreting it with the
  // offset in force before the transition moves it forward by the gap.
  return local - offBefore * MINUTE;
}

/** Add days to a YYYY-MM-DD key. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** YYYY-MM-DD of an instant in a timezone. */
export function dateKeyInZone(epochMs: number, tz: string): string {
  const w = wallClockInZone(epochMs, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/** HH:mm of an instant in a timezone. */
export function clockInZone(epochMs: number, tz: string): string {
  const w = wallClockInZone(epochMs, tz);
  return `${pad(w.hh)}:${pad(w.mm)}`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** 1767261600000 → "20260101T100000Z" (RFC 5545 UTC DATE-TIME). */
export function formatUtcStamp(epochMs: number): string {
  const d = new Date(epochMs);
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** "2026-01-01" → "20260101" (RFC 5545 DATE). */
export function formatDateValue(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

/** Epoch ms → "2026-01-01T10:00:00Z" (ISO without milliseconds). */
export function toIsoSeconds(epochMs: number): string {
  return new Date(Math.floor(epochMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}
