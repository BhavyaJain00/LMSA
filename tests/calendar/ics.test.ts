import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CRLF,
  buildIcs,
  escapeText,
  foldLine,
  formatIcsDuration,
  icsFileName,
  safeUri,
  serializeEvent,
  unfold,
  utf8Length,
  zonedRange,
  type IcsEvent,
} from "@/lib/calendar/ics";

const STAMP = Date.UTC(2026, 0, 1, 12, 0, 0);

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "live-class-lc_1@lms.test",
    dtstamp: STAMP,
    start: { kind: "utc", epochMs: Date.UTC(2026, 2, 8, 14, 0) },
    end: { kind: "utc", epochMs: Date.UTC(2026, 2, 8, 15, 0) },
    summary: "Live class",
    ...overrides,
  };
}

/** Content lines of a (folded) iCalendar text. */
const contentLines = (ics: string) => unfold(ics).split(CRLF).filter(Boolean);

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    assert.equal(escapeText("a\\b;c,d"), "a\\\\b\\;c\\,d");
    assert.equal(escapeText("line 1\r\nline 2\rline 3\nline 4"), "line 1\\nline 2\\nline 3\\nline 4");
  });

  it("removes control characters and replaces lone surrogates", () => {
    assert.equal(escapeText("tab\there"), "tab here");
    assert.equal(escapeText("bell\u0007 nul\u0000 del\u007f"), "bell nul del");
    assert.equal(escapeText("a\ud800b"), "a�b");
    assert.equal(escapeText("emoji 🚀 ok"), "emoji 🚀 ok");
  });

  it("prevents injecting new properties through text values", () => {
    const ics = buildIcs({ prodId: "-//Test//EN", events: [event({ summary: "Evil\r\nATTENDEE:mailto:x@y.z\r\nEND:VEVENT" })] });
    const lines = contentLines(ics);
    assert.ok(!lines.some((l) => l.startsWith("ATTENDEE")));
    assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
    assert.ok(lines.includes("SUMMARY:Evil\\nATTENDEE:mailto:x@y.z\\nEND:VEVENT"));
  });
});

describe("foldLine", () => {
  it("leaves lines up to 75 octets alone", () => {
    const line = `SUMMARY:${"x".repeat(67)}`;
    assert.equal(utf8Length(line), 75);
    assert.equal(foldLine(line), line);
  });

  it("folds at 75 octets with a single leading space on continuation lines", () => {
    const line = `DESCRIPTION:${"a".repeat(200)}`;
    const folded = foldLine(line);
    const physical = folded.split(CRLF);
    assert.equal(physical[0]!.length, 75);
    for (const l of physical.slice(1)) {
      assert.ok(l.startsWith(" ") && !l.startsWith("  "));
      assert.ok(utf8Length(l) <= 75);
    }
    assert.equal(unfold(folded), line);
  });

  it("never splits a multi-byte character", () => {
    const line = `SUMMARY:${"x".repeat(66)}é${"ü".repeat(40)}🚀${"日本".repeat(30)}`;
    const folded = foldLine(line);
    for (const l of folded.split(CRLF)) {
      assert.ok(Buffer.byteLength(l, "utf8") <= 75, l);
      assert.ok(!l.includes("�"));
    }
    assert.equal(unfold(folded), line);
    // 74 ASCII octets + a 2-octet "é" would be 76: the é moves to the next line.
    assert.equal(folded.split(CRLF)[0], `SUMMARY:${"x".repeat(66)}`);
  });

  it("counts UTF-8 octets like Buffer", () => {
    for (const s of ["", "abc", "é", "€", "🚀", "日本語", "mixed é € 🚀"]) assert.equal(utf8Length(s), Buffer.byteLength(s, "utf8"), s);
  });
});

describe("values", () => {
  it("formats durations", () => {
    assert.equal(formatIcsDuration(15), "PT15M");
    assert.equal(formatIcsDuration(60), "PT1H");
    assert.equal(formatIcsDuration(90), "PT1H30M");
    assert.equal(formatIcsDuration(1440), "P1D");
    assert.equal(formatIcsDuration(1500), "P1DT1H");
    assert.equal(formatIcsDuration(0), "PT0M");
    assert.equal(formatIcsDuration(-15), "-PT15M");
  });

  it("accepts only absolute http(s) URIs", () => {
    assert.equal(safeUri(" https://lms.test/batches/x?tab=live "), "https://lms.test/batches/x?tab=live");
    assert.equal(safeUri("http://lms.test"), "http://lms.test/");
    for (const bad of ["javascript:alert(1)", "/relative", "https://lms.test/a b", "mailto:a@b.co", "", null, undefined, "not a url"]) {
      assert.equal(safeUri(bad), undefined, String(bad));
    }
  });

  it("builds safe download names", () => {
    assert.equal(icsFileName("Intro to Python"), "intro-to-python.ics");
    assert.equal(icsFileName("Crème brûlée: live Q&A!"), "creme-brulee-live-q-a.ics");
    assert.equal(icsFileName("日本語"), "event.ics");
    assert.equal(icsFileName("", "batch"), "batch.ics");
    const long = icsFileName(`${"word ".repeat(30)}end`);
    assert.ok(long.length <= 64 && !long.includes("-.ics"), long);
  });
});

describe("serializeEvent / buildIcs", () => {
  it("writes a complete VCALENDAR with CRLF line endings only", () => {
    const ics = buildIcs({
      prodId: "-//LearnLoop//LMS Calendar//EN",
      name: "LearnLoop, Inc.",
      description: "Classes; evaluations",
      refreshMinutes: 60,
      color: "#4f46e5",
      events: [event({ description: "Bring questions, please", location: "Zoom", url: "https://lms.test/batches/b", status: "CONFIRMED", categories: ["Live class", "Batch; A"], alarms: [{ minutesBefore: 15, description: "Starts soon" }] })],
    });
    assert.ok(ics.endsWith(CRLF));
    assert.ok(!/[^\r]\n/.test(ics), "no bare LF");
    const lines = contentLines(ics);
    assert.deepEqual(lines.slice(0, 5), ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LearnLoop//LMS Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]);
    assert.ok(lines.includes("NAME:LearnLoop\\, Inc."));
    assert.ok(lines.includes("X-WR-CALNAME:LearnLoop\\, Inc."));
    assert.ok(lines.includes("X-WR-CALDESC:Classes\\; evaluations"));
    assert.ok(lines.includes("REFRESH-INTERVAL;VALUE=DURATION:PT1H"));
    assert.ok(lines.includes("X-PUBLISHED-TTL:PT1H"));
    assert.ok(lines.includes("X-APPLE-CALENDAR-COLOR:#4F46E5"));
    assert.ok(lines.includes("DTSTAMP:20260101T120000Z"));
    assert.ok(lines.includes("DTSTART:20260308T140000Z"));
    assert.ok(lines.includes("DTEND:20260308T150000Z"));
    assert.ok(lines.includes("DESCRIPTION:Bring questions\\, please"));
    assert.ok(lines.includes("URL;VALUE=URI:https://lms.test/batches/b"));
    assert.ok(lines.includes("CATEGORIES:Live class,Batch\\; A"));
    assert.ok(lines.includes("TRANSP:OPAQUE"));
    assert.ok(lines.includes("TRIGGER:-PT15M"));
    assert.equal(lines.at(-1), "END:VCALENDAR");
    for (const physical of ics.split(CRLF)) assert.ok(Buffer.byteLength(physical, "utf8") <= 75);
  });

  it("writes all-day events with an exclusive DATE end", () => {
    const lines = contentLines(serializeEvent(event({ start: { kind: "date", dateKey: "2026-03-08" }, end: undefined, transparency: "TRANSPARENT" }))!);
    assert.ok(lines.includes("DTSTART;VALUE=DATE:20260308"));
    assert.ok(lines.includes("DTEND;VALUE=DATE:20260309"));
    assert.ok(lines.includes("TRANSP:TRANSPARENT"));
    const multi = contentLines(serializeEvent(event({ start: { kind: "date", dateKey: "2026-03-08" }, end: { kind: "date", dateKey: "2026-03-11" } }))!);
    assert.ok(multi.includes("DTEND;VALUE=DATE:20260311"));
    const backwards = contentLines(serializeEvent(event({ start: { kind: "date", dateKey: "2026-03-08" }, end: { kind: "date", dateKey: "2026-03-01" } }))!);
    assert.ok(backwards.includes("DTEND;VALUE=DATE:20260309"));
  });

  it("omits DTEND when a timed event has no valid end", () => {
    assert.ok(!serializeEvent(event({ end: undefined }))!.includes("DTEND"));
    assert.ok(!serializeEvent(event({ end: { kind: "utc", epochMs: Date.UTC(2026, 2, 8, 13, 0) } }))!.includes("DTEND"));
  });

  it("skips events without a valid start and fills in a missing summary", () => {
    assert.equal(serializeEvent(event({ start: { kind: "utc", epochMs: Number.NaN } })), null);
    assert.equal(serializeEvent(event({ start: { kind: "date", dateKey: "2026-02-30" } })), null);
    assert.ok(serializeEvent(event({ summary: "" }))!.includes("SUMMARY:Untitled event"));
    const ics = buildIcs({ prodId: "x", events: [event({ start: { kind: "utc", epochMs: Number.NaN } }), event()] });
    assert.equal(contentLines(ics).filter((l) => l === "BEGIN:VEVENT").length, 1);
  });

  it("drops unsafe URLs, bad colors and alarms of cancelled events", () => {
    const text = buildIcs({ prodId: "x", color: "red", events: [event({ url: "javascript:alert(1)", status: "CANCELLED", alarms: [{ minutesBefore: 10, description: "x" }] })] });
    assert.ok(!text.includes("URL"));
    assert.ok(!text.includes("X-APPLE-CALENDAR-COLOR"));
    assert.ok(!text.includes("VALARM"));
    assert.ok(text.includes("STATUS:CANCELLED"));
    const negative = serializeEvent(event({ alarms: [{ minutesBefore: -5, description: "x" }, { minutesBefore: 0, description: "" }] }))!;
    assert.equal((negative.match(/BEGIN:VALARM/g) ?? []).length, 1);
    assert.ok(negative.includes("TRIGGER:PT0M"));
    assert.ok(unfold(negative).includes("DESCRIPTION:Live class"));
  });
});

describe("zonedRange", () => {
  it("converts a wall-clock range in a zone to UTC", () => {
    const range = zonedRange("2026-01-15", "09:00", "10:30", "America/New_York");
    assert.deepEqual(range, { start: { kind: "utc", epochMs: Date.UTC(2026, 0, 15, 14, 0) }, end: { kind: "utc", epochMs: Date.UTC(2026, 0, 15, 15, 30) } });
  });

  it("treats an end time before the start time as crossing midnight", () => {
    const range = zonedRange("2026-01-15", "22:00", "01:00", "UTC");
    assert.equal(range?.end && range.end.kind === "utc" ? range.end.epochMs : null, Date.UTC(2026, 0, 16, 1, 0));
  });

  it("uses the fallback length without an end time, or none at all", () => {
    const withFallback = zonedRange("2026-01-15", "09:00", undefined, "UTC", 45);
    assert.equal(withFallback?.end && withFallback.end.kind === "utc" ? withFallback.end.epochMs : null, Date.UTC(2026, 0, 15, 9, 45));
    assert.equal(zonedRange("2026-01-15", "09:00", undefined, "UTC", 0)?.end, undefined);
    assert.equal(zonedRange("2026-02-30", "09:00", "10:00", "UTC"), null);
  });

  it("keeps the scheduled length when a DST gap swallows the start", () => {
    // 02:30–03:30 on the New York spring-forward day: 02:30 does not exist (→ 03:30 EDT).
    const range = zonedRange("2026-03-08", "02:30", "03:30", "America/New_York");
    assert.ok(range?.end && range.end.kind === "utc" && range.start.kind === "utc");
    assert.equal(range.start.epochMs, Date.UTC(2026, 2, 8, 7, 30));
    assert.equal(range.end.epochMs - range.start.epochMs, 60 * 60_000);
  });

  it("spans the real elapsed time across a DST change", () => {
    const range = zonedRange("2026-03-08", "01:00", "04:00", "America/New_York");
    assert.ok(range?.end && range.end.kind === "utc" && range.start.kind === "utc");
    assert.equal(range.end.epochMs - range.start.epochMs, 2 * 60 * 60_000);
  });
});
