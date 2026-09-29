/**
 * iCalendar (RFC 5545) serializer.
 *
 * Pure and dependency-free (it only imports the time helpers next to it), so
 * it runs on the server, in the browser and in plain Node test scripts.
 *
 * What it guarantees:
 *  - CRLF line endings everywhere, including after the last line.
 *  - Content lines folded at 75 octets of UTF-8 (continuation lines start with
 *    a single space and carry at most 74 octets), never splitting a
 *    multi-byte character.
 *  - TEXT values escaped (backslash, semicolon, comma, newlines) with other
 *    control characters removed.
 *  - Timed events use UTC DATE-TIME values (`20260308T130000Z`) computed from
 *    the wall-clock time and IANA zone with `zonedTimeToUtc`, so calendar
 *    apps never need VTIMEZONE definitions and DST is always right.
 *  - All-day events use DATE values with an exclusive DTEND.
 *  - Optional VALARM reminders (e.g. 15 minutes before a live class).
 */

import { addDaysToKey, clockToMinutes, formatDateValue, formatUtcStamp, isDateKey, zonedTimeToUtc } from "./time";

export type IcsTime = { kind: "utc"; epochMs: number } | { kind: "date"; dateKey: string };

export interface IcsAlarm {
  /** Minutes before the event start at which the reminder fires. */
  minutesBefore: number;
  /** Text shown by the reminder. */
  description: string;
}

export type IcsStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

export interface IcsEvent {
  /** Globally unique, stable identifier (e.g. "live-class-lc_123@example.com"). */
  uid: string;
  /** When this representation was generated (epoch ms). */
  dtstamp: number;
  start: IcsTime;
  /** Exclusive end. Must be the same kind as `start`. */
  end?: IcsTime;
  summary: string;
  description?: string;
  location?: string;
  /** Absolute http(s) URL; anything else is dropped. */
  url?: string;
  status?: IcsStatus;
  categories?: string[];
  /** TRANSPARENT events do not block time (e.g. "batch starts" markers). */
  transparency?: "OPAQUE" | "TRANSPARENT";
  created?: number;
  lastModified?: number;
  alarms?: IcsAlarm[];
}

export interface IcsCalendar {
  /** e.g. "-//LearnLoop//LMS Calendar//EN" */
  prodId: string;
  name?: string;
  description?: string;
  /** How often subscribers should refresh (RFC 7986 REFRESH-INTERVAL), in minutes. */
  refreshMinutes?: number;
  /** Hex color hint for Apple Calendar, e.g. "#4f46e5". */
  color?: string;
  events: IcsEvent[];
}

export const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

/* ------------------------------------------------------------------ */
/* Escaping & folding                                                  */
/* ------------------------------------------------------------------ */

/**
 * Escape a TEXT value (RFC 5545 §3.3.11): backslash, semicolon and comma are
 * backslash-escaped and line breaks become the two characters `\n`. Other
 * control characters and unpaired surrogates are not allowed in iCalendar
 * text and are removed / replaced.
 */
export function escapeText(value: string): string {
  let out = "";
  const normalized = value.replace(/\r\n|\r/g, "\n");
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === ";") out += "\\;";
    else if (ch === ",") out += "\\,";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += " ";
    else if (code < 0x20 || code === 0x7f) continue;
    else if (code >= 0xd800 && code <= 0xdfff) out += "�";
    else out += ch;
  }
  return out;
}

/** UTF-8 length of a single code point. */
function utf8Octets(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** UTF-8 byte length of a string (lone surrogates count as U+FFFD, like TextEncoder). */
export function utf8Length(value: string): number {
  let total = 0;
  for (const ch of value) total += utf8Octets(ch.codePointAt(0) ?? 0);
  return total;
}

/**
 * Fold a content line so no physical line exceeds 75 octets (RFC 5545 §3.1).
 * Continuation lines begin with one space, which counts towards their 75
 * octets. Characters are never split across lines.
 */
export function foldLine(line: string): string {
  let out = "";
  let current = "";
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const ch of line) {
    const size = utf8Octets(ch.codePointAt(0) ?? 0);
    if (octets + size > limit) {
      out += current + CRLF + " ";
      current = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += ch;
    octets += size;
  }
  return out + current;
}

/** Undo folding (useful for parsing and tests). */
export function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

/** Only absolute http(s) URLs without whitespace are emitted as URI values. */
export function safeUri(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** A folded `NAME;PARAMS:value` line. `value` must already be escaped. */
function line(name: string, value: string, params?: string): string {
  return foldLine(`${name}${params ? `;${params}` : ""}:${value}`);
}

/* ------------------------------------------------------------------ */
/* Value formatting                                                    */
/* ------------------------------------------------------------------ */

/** Minutes → RFC 5545 DURATION, e.g. 15 → "PT15M", 90 → "PT1H30M", 1440 → "P1D". */
export function formatIcsDuration(minutes: number): string {
  const total = Math.max(0, Math.round(Math.abs(minutes)));
  const sign = minutes < 0 ? "-" : "";
  if (total === 0) return "PT0M";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  let out = `${sign}P`;
  if (days) out += `${days}D`;
  if (hours || mins) {
    out += "T";
    if (hours) out += `${hours}H`;
    if (mins) out += `${mins}M`;
  }
  return out;
}

function timeLine(name: "DTSTART" | "DTEND", time: IcsTime): string | null {
  if (time.kind === "date") {
    if (!isDateKey(time.dateKey)) return null;
    return line(name, formatDateValue(time.dateKey), "VALUE=DATE");
  }
  if (!Number.isFinite(time.epochMs)) return null;
  return line(name, formatUtcStamp(time.epochMs));
}

/** A valid end for the event, or null when DTEND should be omitted. */
function normalizedEnd(start: IcsTime, end: IcsTime | undefined): IcsTime | null {
  if (start.kind === "date") {
    // All-day: DTEND is exclusive and must be after DTSTART; default to one day.
    if (end && end.kind === "date" && isDateKey(end.dateKey) && end.dateKey > start.dateKey) return end;
    return { kind: "date", dateKey: addDaysToKey(start.dateKey, 1) };
  }
  if (end && end.kind === "utc" && Number.isFinite(end.epochMs) && end.epochMs > start.epochMs) return end;
  // A date-time event without DTEND ends when it starts (RFC 5545 §3.6.1).
  return null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/** Serialize one VEVENT (without a trailing CRLF). Returns null for events with an invalid start. */
export function serializeEvent(event: IcsEvent): string | null {
  const start = timeLine("DTSTART", event.start);
  if (!start) return null;
  const end = normalizedEnd(event.start, event.end);
  const lines: string[] = ["BEGIN:VEVENT", line("UID", escapeText(event.uid)), line("DTSTAMP", formatUtcStamp(event.dtstamp)), start];
  if (end) {
    const endLine = timeLine("DTEND", end);
    if (endLine) lines.push(endLine);
  }
  lines.push(line("SUMMARY", escapeText(event.summary || "Untitled event")));
  if (event.description) lines.push(line("DESCRIPTION", escapeText(event.description)));
  if (event.location) lines.push(line("LOCATION", escapeText(event.location)));
  const url = safeUri(event.url);
  if (url) lines.push(line("URL", url, "VALUE=URI"));
  if (event.status) lines.push(line("STATUS", event.status));
  lines.push(line("TRANSP", event.transparency ?? "OPAQUE"));
  const categories = (event.categories ?? []).map((c) => c.trim()).filter(Boolean);
  if (categories.length) lines.push(line("CATEGORIES", categories.map(escapeText).join(",")));
  if (event.created && Number.isFinite(event.created)) lines.push(line("CREATED", formatUtcStamp(event.created)));
  if (event.lastModified && Number.isFinite(event.lastModified)) lines.push(line("LAST-MODIFIED", formatUtcStamp(event.lastModified)));
  if (event.status !== "CANCELLED") {
    for (const alarm of event.alarms ?? []) {
      if (!Number.isFinite(alarm.minutesBefore) || alarm.minutesBefore < 0) continue;
      lines.push(
        "BEGIN:VALARM",
        line("ACTION", "DISPLAY"),
        line("DESCRIPTION", escapeText(alarm.description || event.summary || "Reminder")),
        line("TRIGGER", formatIcsDuration(-alarm.minutesBefore)),
        "END:VALARM",
      );
    }
  }
  lines.push("END:VEVENT");
  return lines.join(CRLF);
}

/** Serialize a whole VCALENDAR document (CRLF-terminated). */
export function buildIcs(calendar: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    line("PRODID", escapeText(calendar.prodId)),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (calendar.name) {
    lines.push(line("NAME", escapeText(calendar.name)));
    lines.push(line("X-WR-CALNAME", escapeText(calendar.name)));
  }
  if (calendar.description) {
    lines.push(line("DESCRIPTION", escapeText(calendar.description)));
    lines.push(line("X-WR-CALDESC", escapeText(calendar.description)));
  }
  if (calendar.refreshMinutes && calendar.refreshMinutes > 0) {
    const duration = formatIcsDuration(calendar.refreshMinutes);
    lines.push(line("REFRESH-INTERVAL", duration, "VALUE=DURATION"));
    lines.push(line("X-PUBLISHED-TTL", duration));
  }
  if (calendar.color && HEX_COLOR_RE.test(calendar.color)) lines.push(line("X-APPLE-CALENDAR-COLOR", calendar.color.toUpperCase()));
  for (const event of calendar.events) {
    const serialized = serializeEvent(event);
    if (serialized) lines.push(serialized);
  }
  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}

/* ------------------------------------------------------------------ */
/* Helpers for callers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Wall-clock start/end in an IANA zone → UTC IcsTime values. `endTime`
 * earlier than `startTime` means the session runs past midnight. When there
 * is no end time, `fallbackMinutes` is used (0 = no DTEND).
 */
export function zonedRange(
  dateKey: string,
  startTime: string,
  endTime: string | undefined,
  timeZone: string,
  fallbackMinutes = 60,
): { start: IcsTime; end?: IcsTime } | null {
  const startMs = zonedTimeToUtc(dateKey, startTime, timeZone);
  if (Number.isNaN(startMs)) return null;
  let endMs = endTime ? zonedTimeToUtc(dateKey, endTime, timeZone) : NaN;
  if (!Number.isNaN(endMs) && endMs <= startMs) {
    // Only an end time at or before the start time crosses midnight; a later end time whose instant
    // collapsed onto the start (a DST gap moved the start forward) keeps its scheduled length.
    const scheduled = clockToMinutes(endTime!) - clockToMinutes(startTime || "00:00");
    endMs = scheduled > 0 ? startMs + scheduled * 60_000 : zonedTimeToUtc(addDaysToKey(dateKey, 1), endTime!, timeZone);
  }
  if (Number.isNaN(endMs) && fallbackMinutes > 0) endMs = startMs + fallbackMinutes * 60_000;
  return {
    start: { kind: "utc", epochMs: startMs },
    end: Number.isNaN(endMs) ? undefined : { kind: "utc", epochMs: endMs },
  };
}

/** A safe download file name for an .ics file ("Intro to Python" → "intro-to-python.ics"). */
export function icsFileName(title: string, fallback = "event"): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || fallback}.ics`;
}
