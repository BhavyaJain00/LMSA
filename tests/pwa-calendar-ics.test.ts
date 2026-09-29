import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CRLF, buildIcs, escapeText, foldLine, unfold, utf8Length, zonedRange, type IcsEvent } from "@/lib/calendar/ics";

/** Reverse of escapeText (RFC 5545 §3.3.11), used for round-trip checks. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

const octets = (s: string) => Buffer.byteLength(s, "utf8");

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "live-class-lc_1@lms.test",
    dtstamp: Date.UTC(2026, 0, 1, 12, 0),
    start: { kind: "utc", epochMs: Date.UTC(2026, 4, 1, 4, 15) },
    end: { kind: "utc", epochMs: Date.UTC(2026, 4, 1, 5, 45) },
    summary: "Live class",
    ...overrides,
  };
}

/** Unfolded content lines of a document. */
const contentLines = (ics: string) => unfold(ics).split(CRLF).filter(Boolean);

/** The (still escaped) value of the first content line with this property name. */
function valueOf(ics: string, name: string): string | undefined {
  const line = contentLines(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line?.slice(line.indexOf(":") + 1);
}

/** Invariants of a folded content line (RFC 5545 §3.1). */
function assertFolded(folded: string, original: string) {
  const physical = folded.split(CRLF);
  physical.forEach((line, i) => {
    assert.ok(octets(line) <= 75, `line ${i} has ${octets(line)} octets`);
    if (i > 0) assert.ok(line.startsWith(" "), `continuation line ${i} starts with a space`);
    // No character (surrogate pair) is split across lines.
    assert.ok(!/[\uD800-\uDBFF]$/.test(line) && !/^ ?[\uDC00-\uDFFF]/.test(line), `line ${i} splits a character`);
    if (i < physical.length - 1) {
      // Greedy: the next character would not have fitted on this line.
      const next = Array.from(physical[i + 1]!.slice(1))[0]!;
      assert.ok(octets(line) + octets(next) > 75, `line ${i} was folded early`);
    }
  });
  assert.equal(unfold(folded), original);
}

describe("TEXT escaping", () => {
  it("round-trips tricky text through escape and unescape", () => {
    const samples = [
      "a\\b",
      "\\n is not a newline",
      "semi;colon,comma",
      "C:\\path\\to\\file;v=1,2",
      "ends with a backslash\\",
      "\\\\,;;,,",
      "mixed\nnew\r\nlines\rhere",
      "日本語; émoji 🚀, done",
    ];
    for (const sample of samples) {
      const escaped = escapeText(sample);
      assert.equal(unescapeText(escaped), sample.replace(/\r\n|\r/g, "\n"), sample);
      // Once the escape sequences are removed, no delimiter or line break is left over.
      assert.doesNotMatch(escaped.replace(/\\[\\;,n]/g, ""), /[\\;,\r\n]/, sample);
    }
  });

  it("escapes a literal backslash-n so calendars do not read it as a line break", () => {
    assert.equal(escapeText("\\n"), "\\\\n");
  });

  it("keeps hostile input inside its value", () => {
    const ics = buildIcs({
      prodId: "-//Test//EN",
      events: [
        event({
          summary: "x\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:evil\r\nSUMMARY:pwned",
          location: 'Room 1;ALTREP="http://evil.test"',
          categories: ["A,B", "C;D"],
        }),
      ],
    });
    const lines = contentLines(ics);
    assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
    assert.equal(lines.filter((l) => l === "END:VEVENT").length, 1);
    assert.equal(lines.filter((l) => l.startsWith("UID:")).length, 1);
    assert.equal(unescapeText(valueOf(ics, "SUMMARY")!), "x\nEND:VEVENT\nBEGIN:VEVENT\nUID:evil\nSUMMARY:pwned");
    assert.ok(lines.includes('LOCATION:Room 1\\;ALTREP="http://evil.test"'), "no parameter can be injected");
    assert.ok(lines.includes("CATEGORIES:A\\,B,C\\;D"));
  });

  it("drops control characters, turns tabs into spaces and keeps other Unicode", () => {
    assert.equal(escapeText("a\u0000b\u0001c\u001fd\u007fe\tf"), "abcde f");
    assert.equal(escapeText("Ünïcödé 日本 🚀"), "Ünïcödé 日本 🚀");
  });
});

describe("75-octet UTF-8 folding", () => {
  it("folds greedily at every boundary alignment without splitting characters", () => {
    for (const ch of ["a", "é", "€", "日", "🚀"]) {
      for (let pad = 0; pad < 80; pad++) {
        const line = `DESCRIPTION:${"x".repeat(pad)}${ch.repeat(90)}`;
        assertFolded(foldLine(line), line);
      }
    }
  });

  it("leaves a 75-octet line alone and folds a 76-octet one, whatever character ends it", () => {
    for (const ch of ["a", "é", "€", "🚀"]) {
      const exact = `${"S".repeat(75 - octets(ch))}${ch}`;
      assert.equal(utf8Length(exact), 75);
      assert.equal(foldLine(exact), exact, `75 octets ending in ${ch}`);
      const over = `${"S".repeat(76 - octets(ch))}${ch}`;
      assert.equal(foldLine(over), `${"S".repeat(76 - octets(ch))}${CRLF} ${ch}`, `76 octets ending in ${ch}`);
    }
  });

  it("puts at most 74 octets of content on continuation lines", () => {
    const line = "X".repeat(75 + 74 + 74 + 10);
    assert.deepEqual(foldLine(line).split(CRLF).map(octets), [75, 75, 75, 11]);
  });

  it("keeps every physical line of a whole document within 75 octets", () => {
    const description = `Préparez vos questions — 日本語の説明 🚀, ${"ümlaut; ".repeat(40)}\nZweite Zeile`;
    const ics = buildIcs({ prodId: "-//LearnLoop//LMS Calendar 1.0//EN", name: "Kalender ✓".repeat(12), events: [event({ description, location: "https://meet.example.com/".padEnd(120, "x") })] });
    for (const line of ics.split(CRLF)) assert.ok(octets(line) <= 75, line);
    assert.equal(unescapeText(valueOf(ics, "DESCRIPTION")!), description);
  });
});

describe("CRLF line endings", () => {
  it("separates and terminates every line with CRLF, with no bare CR or LF", () => {
    const ics = buildIcs({
      prodId: "-//Test//EN",
      description: "Line one\nline two",
      events: [event({ description: "a\nb\r\nc\rd", location: "Zoom", alarms: [{ minutesBefore: 15, description: "Soon\nnow" }] })],
    });
    assert.ok(ics.endsWith(CRLF));
    assert.doesNotMatch(ics, /\r(?!\n)/, "bare CR");
    assert.doesNotMatch(ics, /(?<!\r)\n/, "bare LF");
    const parts = ics.split(CRLF);
    assert.equal(parts.at(-1), "");
    for (const part of parts) assert.doesNotMatch(part, /[\r\n]/);
  });

  it("writes only well-formed content lines", () => {
    const ics = buildIcs({ prodId: "-//Test//EN", name: "LMS", refreshMinutes: 60, events: [event({ url: "https://lms.test/batches/b?tab=classes#class-1", categories: ["Live class"] })] });
    for (const line of contentLines(ics)) assert.match(line, /^[A-Z][A-Z0-9-]*(;[^:]+)?:/, line);
  });
});

describe("UTC values from 30- and 45-minute zones", () => {
  it("writes DTSTART/DTEND in UTC for quarter- and half-hour offsets and DST changes", () => {
    const cases: [string, string, string, string, string, string][] = [
      ["2026-05-01", "10:00", "11:30", "Asia/Kathmandu", "20260501T041500Z", "20260501T054500Z"],
      ["2026-09-27", "02:00", "04:00", "Pacific/Chatham", "20260926T131500Z", "20260926T141500Z"],
      ["2026-10-04", "01:00", "03:00", "Australia/Lord_Howe", "20261003T143000Z", "20261003T160000Z"],
      ["2026-11-01", "01:30", "02:30", "America/St_Johns", "20261101T040000Z", "20261101T060000Z"],
    ];
    for (const [date, start, end, tz, dtstart, dtend] of cases) {
      const range = zonedRange(date, start, end, tz);
      assert.ok(range);
      const ics = buildIcs({ prodId: "-//Test//EN", events: [event({ start: range.start, end: range.end })] });
      assert.equal(valueOf(ics, "DTSTART"), dtstart, `${tz} start`);
      assert.equal(valueOf(ics, "DTEND"), dtend, `${tz} end`);
    }
  });
});
