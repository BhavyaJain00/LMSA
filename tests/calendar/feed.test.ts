import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Database, TimetableItem } from "@/lib/types";
import { feedPathFor, feedTokenFor, findUserByFeedToken, newCalendarSecret, parseFeedToken } from "@/lib/calendar/token";
import {
  googleCalendarUrl,
  googleSubscribeUrl,
  isPubliclyReachable,
  linkDetails,
  office365Url,
  outlookComUrl,
  outlookSubscribeUrl,
  toWebcalUrl,
} from "@/lib/calendar/links";
import { etagMatches, feedEtag } from "@/lib/calendar/http";
import { batchDateEvents, eventsToIcs, timetableEvent } from "@/lib/calendar/events";
import { unfold } from "@/lib/calendar/ics";
import { makeBatch, makeUser, resetDb } from "../helpers/db";

describe("personal feed tokens (store)", () => {
  const secret = newCalendarSecret();
  const ada = makeUser({ id: "usr_ada", calendarToken: secret });
  const off = makeUser({ id: "usr_off", calendarToken: newCalendarSecret(), enabled: false });
  const none = makeUser({ id: "usr_none" });

  beforeEach(async () => {
    await resetDb({ users: [ada, off, none] });
  });

  it("derives an HMAC token from the stored secret", () => {
    assert.match(secret, /^[A-Za-z0-9_-]{32}$/);
    const token = feedTokenFor(ada);
    assert.match(token!, /^usr_ada\.[A-Za-z0-9_-]{43}$/);
    assert.ok(!token!.includes(secret), "the stored secret never appears in the URL");
    assert.equal(feedPathFor(ada), `/api/calendar/${token}.ics`);
    assert.equal(feedTokenFor(none), null);
    assert.equal(feedPathFor(none), null);
  });

  it("parses route parameters", () => {
    const token = feedTokenFor(ada)!;
    assert.deepEqual(parseFeedToken(`${token}.ics`), { userId: "usr_ada", signature: token.split(".")[1] });
    assert.deepEqual(parseFeedToken(encodeURIComponent(`${token}.ICS`)), parseFeedToken(token));
    for (const bad of ["", "nodot", ".sig", `usr_ada.${"x".repeat(42)}`, `usr ada.${token.split(".")[1]}`, "%E0%A4%A", `${"a".repeat(120)}.${token.split(".")[1]}`]) {
      assert.equal(parseFeedToken(bad), null, bad);
    }
  });

  it("resolves only valid tokens of enabled users with an active feed", async () => {
    assert.equal((await findUserByFeedToken(`${feedTokenFor(ada)}.ics`))?.id, "usr_ada");
    const [id, sig] = feedTokenFor(ada)!.split(".");
    const tampered = `${id}.${sig![0] === "A" ? "B" : "A"}${sig!.slice(1)}`;
    assert.equal(await findUserByFeedToken(tampered), null);
    assert.equal(await findUserByFeedToken(feedTokenFor(off)!), null);
    assert.equal(await findUserByFeedToken(`usr_ghost.${sig}`), null);
    // Regenerating the secret revokes old URLs.
    const old = feedTokenFor(ada)!;
    await resetDb({ users: [{ ...ada, calendarToken: newCalendarSecret() }] });
    assert.equal(await findUserByFeedToken(old), null);
  });
});

describe("add-to-calendar links", () => {
  const event = {
    title: "Live class: Q&A",
    description: "Bring your questions",
    location: "Zoom",
    url: "https://lms.test/batches/b?tab=live",
    start: Date.UTC(2026, 2, 8, 14, 0),
    end: Date.UTC(2026, 2, 8, 15, 0),
  };

  it("builds a Google Calendar template URL", () => {
    const url = new URL(googleCalendarUrl(event));
    assert.equal(url.origin, "https://calendar.google.com");
    assert.equal(url.searchParams.get("action"), "TEMPLATE");
    assert.equal(url.searchParams.get("dates"), "20260308T140000Z/20260308T150000Z");
    assert.equal(url.searchParams.get("text"), "Live class: Q&A");
    assert.equal(url.searchParams.get("details"), "Bring your questions\n\nhttps://lms.test/batches/b?tab=live");
    assert.equal(url.searchParams.get("location"), "Zoom");
  });

  it("uses DATE values for all-day events and never ends before the start", () => {
    const allDay = new URL(googleCalendarUrl({ ...event, allDay: { startDate: "2026-03-08", endDate: "2026-03-09" } }));
    assert.equal(allDay.searchParams.get("dates"), "20260308/20260309");
    const backwards = new URL(googleCalendarUrl({ ...event, end: event.start - 1 }));
    assert.equal(backwards.searchParams.get("dates"), "20260308T140000Z/20260308T140000Z");
  });

  it("builds Outlook compose URLs", () => {
    const live = new URL(outlookComUrl(event));
    assert.equal(live.host, "outlook.live.com");
    assert.equal(live.searchParams.get("startdt"), "2026-03-08T14:00:00Z");
    assert.equal(live.searchParams.get("enddt"), "2026-03-08T15:00:00Z");
    assert.equal(live.searchParams.get("allday"), "false");
    assert.equal(live.searchParams.get("subject"), "Live class: Q&A");
    assert.equal(new URL(office365Url(event)).host, "outlook.office.com");
  });

  it("truncates long descriptions but keeps the page link", () => {
    const details = linkDetails({ description: "x".repeat(5000), url: "https://lms.test/x" });
    assert.ok(details.length <= 1200);
    assert.ok(details.endsWith("…\n\nhttps://lms.test/x"));
  });

  it("builds subscription links", () => {
    assert.equal(toWebcalUrl("https://lms.test/api/calendar/t.ics"), "webcal://lms.test/api/calendar/t.ics");
    assert.equal(toWebcalUrl("HTTP://lms.test/a"), "webcal://lms.test/a");
    assert.equal(googleSubscribeUrl("https://lms.test/f.ics"), `https://calendar.google.com/calendar/render?cid=${encodeURIComponent("webcal://lms.test/f.ics")}`);
    const outlook = new URL(outlookSubscribeUrl("https://lms.test/f.ics", "My LMS"));
    assert.equal(outlook.searchParams.get("url"), "https://lms.test/f.ics");
    assert.equal(outlook.searchParams.get("name"), "My LMS");
  });

  it("knows which feed URLs calendar providers can reach", () => {
    assert.equal(isPubliclyReachable("https://learn.example.com/api/calendar/x.ics"), true);
    for (const url of ["http://localhost:3000/x", "http://app.localhost/x", "http://192.168.1.4/x", "http://10.0.0.2/x", "http://172.20.1.1/x", "http://127.0.0.1/x", "http://[::1]/x", "ftp://example.com", "nonsense"]) {
      assert.equal(isPubliclyReachable(url), false, url);
    }
    assert.equal(isPubliclyReachable("http://172.32.0.1/x"), true);
  });
});

describe("feed caching", () => {
  it("compares weak ETags", () => {
    const etag = feedEtag([], { name: "LMS" });
    assert.match(etag, /^W\/"[A-Za-z0-9_-]{32}"$/);
    assert.equal(feedEtag([], { name: "LMS" }), etag);
    assert.notEqual(feedEtag([], { name: "Other" }), etag);
    assert.equal(etagMatches(etag, etag), true);
    assert.equal(etagMatches(`"abc", ${etag.slice(2)}`, etag), true);
    assert.equal(etagMatches("*", etag), true);
    assert.equal(etagMatches('"other"', etag), false);
    assert.equal(etagMatches(null, etag), false);
  });
});

describe("batch timetable events", () => {
  const db = { lessons: [], chapters: [], courses: [], quizzes: [], assignments: [], exercises: [], liveClasses: [], users: [] } as unknown as Database;
  const batch = makeBatch({ id: "bat_ny", slug: "spring", title: "Spring cohort", timezone: "America/New_York", startDate: "2026-03-01", endDate: "2026-03-31" });
  const item = (overrides: Partial<TimetableItem>): TimetableItem => ({ id: "tt_1", type: "custom", title: "Office hours", date: "2026-01-15", milestone: false, ...overrides });

  it("converts timed items from the batch timezone", () => {
    const ev = timetableEvent(db, batch, item({ startTime: "09:00", endTime: "10:30" }))!;
    assert.equal(ev.allDay, false);
    assert.equal(ev.start, Date.UTC(2026, 0, 15, 14, 0));
    assert.equal(ev.end, Date.UTC(2026, 0, 15, 15, 30));
    assert.equal(ev.startTime, "09:00");
  });

  it("crosses midnight when the end is before the start", () => {
    const ev = timetableEvent(db, batch, item({ startTime: "23:00", endTime: "00:30" }))!;
    assert.equal(ev.end - ev.start, 90 * 60_000);
    assert.equal(ev.endDate, "2026-01-16");
  });

  it("keeps the scheduled length when a DST gap swallows the start", () => {
    const ev = timetableEvent(db, batch, item({ date: "2026-03-08", startTime: "02:30", endTime: "03:30" }))!;
    assert.equal(ev.end - ev.start, 60 * 60_000);
    assert.equal(ev.endDate, "2026-03-08");
  });

  it("makes untimed items all-day, transparent events", () => {
    const ev = timetableEvent(db, batch, item({ milestone: true }))!;
    assert.equal(ev.allDay, true);
    assert.equal(ev.transparent, true);
    assert.equal(ev.startDate, "2026-01-15");
    assert.equal(ev.endDate, "2026-01-16");
    assert.equal(ev.title, "★ Office hours");
    assert.equal(timetableEvent(db, batch, item({ date: "2026-02-30" })), null);
  });

  it("marks the batch start and end days and serializes them", () => {
    const events = batchDateEvents(batch);
    assert.deepEqual(
      events.map((e) => [e.kind, e.title, e.startDate, e.endDate]),
      [
        ["batch_start", "Spring cohort starts", "2026-03-01", "2026-03-02"],
        ["batch_end", "Spring cohort ends", "2026-03-31", "2026-04-01"],
      ],
    );
    const ics = unfold(eventsToIcs(events, { baseUrl: "https://lms.test", now: Date.UTC(2026, 0, 1), calendarName: "LearnLoop" }));
    assert.ok(ics.includes("UID:batch-bat_ny-start@lms.test"));
    assert.ok(ics.includes("DTSTART;VALUE=DATE:20260301"));
    assert.ok(ics.includes("URL;VALUE=URI:https://lms.test/batches/spring"));
    assert.equal(batchDateEvents({ ...batch, endDate: batch.startDate }).length, 1);
    assert.deepEqual(batchDateEvents({ ...batch, startDate: "bad" }), []);
  });
});
