import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { Broadcast, EmailEvent } from "@/lib/types";
import {
  applyTracking,
  belongsToCampaign,
  broadcastTrackingId,
  clickSignature,
  clickUrl,
  decodeAttribute,
  injectPixel,
  isSafeRedirectUrl,
  isTrackableUrl,
  normalizeTrackingId,
  parsePixelParam,
  parseTrackingId,
  pixelUrl,
  planTrackingEvents,
  ratePercent,
  retainedEvents,
  rewriteLinks,
  sequenceTrackingId,
  stripTracking,
  summarizeEvents,
  TRACKING_RULES,
  verifyClickSignature,
  verifyOpenSignature,
} from "@/lib/comms/tracking-core";
import {
  getCampaignEventSummary,
  getTrackingOverview,
  listTrackingEvents,
  parseTrackingRange,
  pruneEmailEvents,
  recordEmailHit,
  verifyClickParams,
  verifyPixelParam,
} from "@/lib/comms/tracking";
import { deleteEmail, enqueueEmail, redactForView } from "@/lib/email/outbox";
import { findById, getDb, mutate } from "@/lib/db/store";
import { GET as clickGET, HEAD as clickHEAD } from "@/app/api/email/c/[id]/route";
import { GET as pixelGET } from "@/app/api/email/o/[id]/route";
import { resetDb } from "./helpers/db";

const KEY = "unit-test-key";
const APP = "https://learn.example.com";
const EMAIL = "eml_abc123";

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("tracking signatures", () => {
  it("click signatures bind the email id and the exact URL", () => {
    const url = "https://example.com/pricing?plan=pro";
    const sig = clickSignature(KEY, EMAIL, url);
    assert.match(sig, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(verifyClickSignature(KEY, EMAIL, url, sig), true);
    assert.equal(verifyClickSignature(KEY, EMAIL, "https://example.com/pricing?plan=free", sig), false, "changed query");
    assert.equal(verifyClickSignature(KEY, EMAIL, "https://evil.example/pricing?plan=pro", sig), false, "changed host");
    assert.equal(verifyClickSignature(KEY, "eml_other", url, sig), false, "other email");
    assert.equal(verifyClickSignature("other-key", EMAIL, url, sig), false, "other key");
    assert.equal(verifyClickSignature(KEY, EMAIL, url, `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`), false, "one char off");
    assert.equal(verifyClickSignature(KEY, EMAIL, url, `${sig}x`), false, "wrong length");
    assert.equal(verifyClickSignature(KEY, EMAIL, url, null), false);
    assert.equal(verifyClickSignature(KEY, "bad id.", url, sig), false);
  });

  it("a validly signed but unsafe destination is still refused", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "//evil.example", "/relative"]) {
      assert.equal(verifyClickSignature(KEY, EMAIL, url, clickSignature(KEY, EMAIL, url)), false, url);
    }
  });

  it("open signatures and pixel parameters", () => {
    const url = pixelUrl(`${APP}/`, KEY, EMAIL);
    assert.ok(url.startsWith(`${APP}/api/email/o/${EMAIL}.`));
    const param = url.split("/").pop()!;
    const parsed = parsePixelParam(param);
    assert.ok(parsed);
    assert.equal(parsed.emailId, EMAIL);
    assert.equal(verifyOpenSignature(KEY, parsed.emailId, parsed.signature), true);
    assert.equal(verifyOpenSignature(KEY, "eml_other", parsed.signature), false);
    assert.equal(parsePixelParam(`${EMAIL}.gif`), null);
    assert.equal(parsePixelParam(`${EMAIL}.${parsed.signature}.png`), null);
    assert.equal(parsePixelParam(`../x.${parsed.signature}.gif`), null);
  });
});

describe("safe redirect destinations", () => {
  it("accepts absolute http(s) URLs only", () => {
    assert.equal(isSafeRedirectUrl("https://example.com/a?b=c#d"), true);
    assert.equal(isSafeRedirectUrl("http://example.com"), true);
    for (const bad of [
      "",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html;base64,AAAA",
      "//evil.example/path",
      "/local/path",
      "https://user:pass@example.com/",
      "https://example.com/a b",
      "https://example.com/\nSet-Cookie:x",
      "https:\\\\evil.example",
      "ftp://example.com/file",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      assert.equal(isSafeRedirectUrl(bad), false, JSON.stringify(bad.slice(0, 40)));
    }
  });

  it("never tracks unsubscribe, preference, confirmation or one-time token links", () => {
    assert.equal(isTrackableUrl("https://example.com/blog", APP), true);
    assert.equal(isTrackableUrl(`${APP}/courses/python`, APP), true);
    assert.equal(isTrackableUrl(`${APP}/settings/notifications?unsubscribe=announcements&u=x&t=y`, APP), false);
    assert.equal(isTrackableUrl(`${APP}/api/email/unsubscribe?u=1`, APP), false);
    assert.equal(isTrackableUrl(`${APP}/free/unsubscribe?l=1&t=2`, APP), false);
    assert.equal(isTrackableUrl(`${APP}/free/confirm?l=1`, APP), false);
    assert.equal(isTrackableUrl(`${APP}/reset-password?token=abc`, APP), false);
    assert.equal(isTrackableUrl("https://other.example/x?token=abc", APP), false);
    assert.equal(isTrackableUrl("mailto:hi@example.com", APP), false);
    // Same path on another site is an ordinary link.
    assert.equal(isTrackableUrl("https://other.example/settings/notifications", APP), true);
  });
});

describe("HTML rewriting", () => {
  it("rewrites anchor hrefs with decoded URLs and re-escapes them", () => {
    const html = `<p><a href="https://example.com/?a=1&amp;b=2" style="x">One</a> <a class="c" href='https://example.com/two'>Two</a> <a href="mailto:x@example.com">Mail</a> <img src="https://example.com/i.png"></p>`;
    const seen: string[] = [];
    const out = rewriteLinks(html, (url) => {
      seen.push(url);
      return url.startsWith("https://") ? `https://t.example/c?u=${encodeURIComponent(url)}&s=1` : null;
    });
    assert.deepEqual(seen, ["https://example.com/?a=1&b=2", "https://example.com/two", "mailto:x@example.com"]);
    assert.match(out, /href="https:\/\/t\.example\/c\?u=https%3A%2F%2Fexample\.com%2F%3Fa%3D1%26b%3D2&amp;s=1" style="x"/);
    assert.match(out, /<a class="c" href="https:\/\/t\.example\/c\?u=https%3A%2F%2Fexample\.com%2Ftwo&amp;s=1">/);
    assert.ok(out.includes(`<a href="mailto:x@example.com">`));
    assert.ok(out.includes(`<img src="https://example.com/i.png">`), "images are untouched");
  });

  it("decodes numeric and named entities", () => {
    assert.equal(decodeAttribute("a&amp;b&#38;c&#x26;d&quot;e&unknown;"), 'a&b&c&d"e&unknown;');
  });

  it("puts the pixel before the last </body>", () => {
    assert.equal(injectPixel("<html><body><p>x</p></body></html>", "https://t/p.gif").indexOf("<img"), "<html><body><p>x</p>".length);
    assert.ok(injectPixel("<p>fragment</p>", "https://t/p.gif").startsWith("<p>fragment</p><img"));
  });

  it("applyTracking + stripTracking round-trip for previews", () => {
    const html = `<html><body><a href="https://example.com/a?x=1&amp;y=2">A</a><a href="${APP}/settings/notifications">Prefs</a></body></html>`;
    const tracked = applyTracking(html, { baseUrl: APP, key: KEY, emailId: EMAIL, opens: true, clicks: true });
    assert.ok(tracked.includes(`${APP}/api/email/c/${EMAIL}?u=`));
    assert.ok(tracked.includes(`${APP}/api/email/o/${EMAIL}.`));
    assert.ok(tracked.includes(`href="${APP}/settings/notifications"`), "preferences link stays direct");
    const stripped = stripTracking(tracked);
    assert.ok(!stripped.includes("/api/email/"));
    assert.ok(stripped.includes(`href="https://example.com/a?x=1&amp;y=2"`));

    const opensOnly = applyTracking(html, { baseUrl: APP, key: KEY, emailId: EMAIL, opens: true, clicks: false });
    assert.ok(!opensOnly.includes("/api/email/c/"));
    assert.ok(opensOnly.includes("/api/email/o/"));
    assert.equal(applyTracking(html, { baseUrl: APP, key: KEY, emailId: "bad id", opens: true, clicks: true }), html);
  });

  it("the click URL carries the exact destination", () => {
    const dest = "https://example.com/über?q=a b";
    const url = new URL(clickUrl(APP, KEY, EMAIL, dest));
    assert.equal(url.searchParams.get("u"), dest);
    assert.equal(verifyClickSignature(KEY, EMAIL, dest, url.searchParams.get("s")), false, "whitespace in the destination is refused");
    const clean = "https://example.com/%C3%BCber?q=a%20b";
    const ok = new URL(clickUrl(APP, KEY, EMAIL, clean));
    assert.equal(verifyClickSignature(KEY, EMAIL, ok.searchParams.get("u"), ok.searchParams.get("s")), true);
  });
});

describe("campaign references", () => {
  it("builds and parses tracking ids", () => {
    assert.deepEqual(parseTrackingId(broadcastTrackingId("brd_1")), { kind: "broadcast", broadcastId: "brd_1" });
    assert.deepEqual(parseTrackingId(sequenceTrackingId("seq_1", "stp_2")), { kind: "sequence", sequenceId: "seq_1", stepId: "stp_2" });
    for (const bad of ["broadcast:", "broadcast:a:b", "sequence:a", "other:x", "broadcast:a b", undefined]) {
      assert.equal(parseTrackingId(bad), null, String(bad));
      assert.equal(normalizeTrackingId(bad), undefined);
    }
  });

  it("matches a tracking id against a broadcast, a sequence step or a whole sequence", () => {
    assert.equal(belongsToCampaign("broadcast:brd_1", broadcastTrackingId("brd_1")), true);
    assert.equal(belongsToCampaign("broadcast:brd_10", broadcastTrackingId("brd_1")), false, "no prefix confusion between ids");
    assert.equal(belongsToCampaign(sequenceTrackingId("seq_1", "stp_2"), "sequence:seq_1"), true);
    assert.equal(belongsToCampaign(sequenceTrackingId("seq_1", "stp_2"), sequenceTrackingId("seq_1", "stp_2")), true);
    assert.equal(belongsToCampaign(sequenceTrackingId("seq_1", "stp_2"), sequenceTrackingId("seq_1", "stp_3")), false);
    assert.equal(belongsToCampaign(undefined, "sequence:seq_1"), false);
    assert.equal(belongsToCampaign("broadcast:brd_1", ""), false);
  });
});

describe("recording rules", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const T = Date.parse("2026-03-01T10:00:00.000Z");

  it("first open counts once; repeat opens are throttled", () => {
    const first = planTrackingEvents([], { type: "open" }, T);
    assert.deepEqual(first, { add: [{ type: "open" }], firstOpen: true, firstClick: false });
    const existing = [{ type: "open" as const, createdAt: at(T) }];
    assert.deepEqual(planTrackingEvents(existing, { type: "open" }, T + 60_000).add, []);
    const later = planTrackingEvents(existing, { type: "open" }, T + TRACKING_RULES.reopenGapMs);
    assert.deepEqual(later, { add: [{ type: "open" }], firstOpen: false, firstClick: false });
  });

  it("a click implies an open; repeat clicks on the same link are throttled", () => {
    const first = planTrackingEvents([], { type: "click", url: "https://a" }, T);
    assert.deepEqual(first, { add: [{ type: "open" }, { type: "click", url: "https://a" }], firstOpen: true, firstClick: true });
    const existing = [
      { type: "open" as const, createdAt: at(T) },
      { type: "click" as const, url: "https://a", createdAt: at(T) },
    ];
    assert.deepEqual(planTrackingEvents(existing, { type: "click", url: "https://a" }, T + 1000).add, []);
    const other = planTrackingEvents(existing, { type: "click", url: "https://b" }, T + 1000);
    assert.deepEqual(other, { add: [{ type: "click", url: "https://b" }], firstOpen: false, firstClick: false });
    assert.equal(planTrackingEvents(existing, { type: "click", url: "https://a" }, T + TRACKING_RULES.reclickGapMs).add.length, 1);
  });

  it("stops storing events for an email past the cap", () => {
    const many = Array.from({ length: TRACKING_RULES.maxEventsPerEmail }, (_, i) => ({ type: "click" as const, url: `https://x/${i}`, createdAt: at(T) }));
    assert.deepEqual(planTrackingEvents(many, { type: "click", url: "https://new" }, T + 10 * 60_000).add, []);
  });

  it("plans nothing for a kind of event that is switched off", () => {
    assert.deepEqual(planTrackingEvents([], { type: "open" }, T, { opens: false, clicks: true }).add, []);
    assert.deepEqual(planTrackingEvents([], { type: "click", url: "https://a" }, T, { opens: true, clicks: false }).add, []);
    // Clicks on, opens off: the click is stored without the implied open.
    assert.deepEqual(planTrackingEvents([], { type: "click", url: "https://a" }, T, { opens: false, clicks: true }), {
      add: [{ type: "click", url: "https://a" }],
      firstOpen: false,
      firstClick: true,
    });
  });

  it("keeps events while their email or their campaign exists", () => {
    const events = [
      { id: "1", emailId: "e_live" },
      { id: "2", emailId: "e_gone", trackingId: "broadcast:brd_live" },
      { id: "3", emailId: "e_gone", trackingId: "broadcast:brd_deleted" },
      { id: "4", emailId: "e_gone", trackingId: "sequence:seq_live:stp_1" },
      { id: "5", emailId: "e_gone" },
      { id: "6", emailId: "e_gone", trackingId: "not a campaign" },
    ];
    const emailExists = (id: string) => id === "e_live";
    const kept = retainedEvents(events, emailExists, (ref) => (ref.kind === "broadcast" ? ref.broadcastId === "brd_live" : ref.sequenceId === "seq_live"));
    assert.deepEqual(kept.map((e) => e.id), ["1", "2", "4"]);
    const allLive = events.slice(0, 2);
    assert.equal(retainedEvents(allLive, emailExists, () => true), allLive, "same array when nothing has to go");
  });

  it("summarizes unique and total counts per link", () => {
    const events = [
      { emailId: "e1", type: "open" as const },
      { emailId: "e1", type: "open" as const },
      { emailId: "e2", type: "open" as const },
      { emailId: "e1", type: "click" as const, url: "https://a" },
      { emailId: "e1", type: "click" as const, url: "https://a" },
      { emailId: "e2", type: "click" as const, url: "https://a" },
      { emailId: "e2", type: "click" as const, url: "https://b" },
    ];
    const s = summarizeEvents(events);
    assert.equal(s.totalOpens, 3);
    assert.equal(s.uniqueOpens, 2);
    assert.equal(s.totalClicks, 4);
    assert.equal(s.uniqueClicks, 2);
    assert.deepEqual(s.links, [
      { url: "https://a", clicks: 3, uniqueClicks: 2 },
      { url: "https://b", clicks: 1, uniqueClicks: 1 },
    ]);
    assert.equal(ratePercent(1, 3), 33.3);
    assert.equal(ratePercent(5, 0), 0);
    assert.equal(ratePercent(5, 4), 100);
  });
});

/* ------------------------------------------------------------------ */
/* Outbox, recording and routes                                        */
/* ------------------------------------------------------------------ */

function broadcast(overrides: Partial<Broadcast> = {}): Broadcast {
  const now = new Date().toISOString();
  return {
    id: "brd_1",
    subject: "Spring news",
    body: "Hello",
    segment: {},
    status: "sent",
    recipients: 2,
    opens: 0,
    clicks: 0,
    createdById: "usr_admin",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return Object.assign(new Request(url, { headers }), { nextUrl: new URL(url) }) as unknown as NextRequest;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Let detached `after()` work finish (used before asserting that nothing was recorded). */
const settle = () => sleep(150);
/** Wait until the recorded events reach `count` (`after()` runs detached from the response). */
async function eventsReach(count: number): Promise<EmailEvent[]> {
  for (let i = 0; i < 100; i++) {
    const events = (await getDb()).emailEvents;
    if (events.length >= count) return events;
    await sleep(20);
  }
  return (await getDb()).emailEvents;
}

async function trackedEmail(opts: { opens?: boolean; clicks?: boolean } = {}) {
  return enqueueEmail({
    to: "ada@example.com",
    toName: "Ada",
    subject: "Spring news",
    html: `<p>Read <a href="https://example.com/post?id=7&amp;ref=mail">the post</a> or <a href="http://localhost:3000/settings/notifications">change preferences</a>.</p>`,
    text: "Read the post: https://example.com/post?id=7&ref=mail",
    category: "announcement",
    trackingId: broadcastTrackingId("brd_1"),
    trackOpens: opts.opens ?? true,
    trackClicks: opts.clicks ?? true,
  });
}

const POST_URL = "https://example.com/post?id=7&ref=mail";

/** The tracked link that leads to `destination` (the branded layout adds its own links too). */
function clickHref(html: string, destination: string = POST_URL): string {
  for (const match of html.matchAll(/href="(http:\/\/localhost:3000\/api\/email\/c\/[^"]+)"/g)) {
    const href = match[1]!.replace(/&amp;/g, "&");
    if (new URL(href).searchParams.get("u") === destination) return href;
  }
  assert.fail(`no tracked link to ${destination}`);
}

describe("tracked emails end to end", () => {
  before(() => {
    mock.method(console, "info", () => undefined);
    mock.method(console, "log", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    await resetDb({ broadcasts: [broadcast()] });
  });

  it("enqueueEmail injects the pixel and wraps links for that outbox id, keeping the text part direct", async () => {
    const message = await trackedEmail();
    assert.equal(message.trackingId, "broadcast:brd_1");
    assert.ok(message.html.includes(`/api/email/o/${message.id}.`), "pixel uses the outbox id");
    const href = clickHref(message.html);
    const url = new URL(href);
    assert.equal(url.pathname, `/api/email/c/${message.id}`);
    assert.equal(url.searchParams.get("u"), "https://example.com/post?id=7&ref=mail");
    assert.ok(verifyClickParams(message.id, url.searchParams.get("u"), url.searchParams.get("s")));
    assert.ok(message.html.includes(`href="http://localhost:3000/settings/notifications"`), "preferences link untouched");
    assert.ok(!message.text.includes("/api/email/"), "plain-text part is not rewritten");
    const pixel = /\/api\/email\/o\/([^"]+)"/.exec(message.html)![1]!;
    assert.equal(verifyPixelParam(pixel), message.id);
  });

  it("respects the global tracking switches", async () => {
    await resetDb({ broadcasts: [broadcast()], settings: { email: { trackOpens: false, trackClicks: false } as never } });
    const message = await trackedEmail();
    assert.ok(!message.html.includes("/api/email/"));
    assert.equal(message.trackingId, "broadcast:brd_1", "the campaign is still recorded");

    await resetDb({ broadcasts: [broadcast()], settings: { email: { trackOpens: true, trackClicks: false } as never } });
    const opensOnly = await trackedEmail();
    assert.ok(opensOnly.html.includes("/api/email/o/"));
    assert.ok(!opensOnly.html.includes("/api/email/c/"));
  });

  it("emails that don't ask for tracking are never tracked", async () => {
    const message = await enqueueEmail({ to: "ada@example.com", subject: "Receipt", html: `<a href="https://example.com/x">x</a>`, category: "payment" });
    assert.ok(!message.html.includes("/api/email/"));
    assert.equal(message.trackingId, undefined);
  });

  it("admin previews never carry live trackers", async () => {
    const message = await trackedEmail();
    const view = redactForView(message.html);
    assert.ok(!view.includes("/api/email/o/"));
    assert.ok(!view.includes("/api/email/c/"));
    assert.ok(view.includes(`href="https://example.com/post?id=7&amp;ref=mail"`));
  });

  it("the click route redirects to the exact recorded URL and records one unique click", async () => {
    const message = await trackedEmail();
    const href = clickHref(message.html);
    const res = await clickGET(request(href), ctx(message.id) as never);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://example.com/post?id=7&ref=mail");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    const events = (await eventsReach(2)).filter((e) => e.emailId === message.id);
    assert.deepEqual(events.map((e) => e.type).sort(), ["click", "open"]);
    const b = await findById("broadcasts", "brd_1");
    assert.equal(b?.opens, 1);
    assert.equal(b?.clicks, 1);

    // A second click right away is not stored again and doesn't change the unique counts.
    await clickGET(request(href), ctx(message.id) as never);
    await settle();
    assert.equal((await getDb()).emailEvents.length, 2);
    assert.equal((await findById("broadcasts", "brd_1"))?.clicks, 1);
  });

  it("the click route refuses tampered destinations instead of redirecting (no open redirect)", async () => {
    const message = await trackedEmail();
    const href = new URL(clickHref(message.html));
    const sig = href.searchParams.get("s")!;
    const cases = [
      `http://localhost:3000/api/email/c/${message.id}?u=${encodeURIComponent("https://evil.example/")}&s=${sig}`,
      `http://localhost:3000/api/email/c/${message.id}?u=${encodeURIComponent("https://example.com/post?id=8&ref=mail")}&s=${sig}`,
      `http://localhost:3000/api/email/c/${message.id}?u=${encodeURIComponent("https://example.com/post?id=7&ref=mail")}`,
      `http://localhost:3000/api/email/c/eml_someoneelse?u=${encodeURIComponent("https://example.com/post?id=7&ref=mail")}&s=${sig}`,
    ];
    for (const url of cases) {
      const id = new URL(url).pathname.split("/").pop()!;
      const res = await clickGET(request(url), ctx(id) as never);
      assert.equal(res.status, 400, url);
      assert.equal(res.headers.get("location"), null);
      assert.match(await res.text(), /can&#39;t be opened|can't be opened/);
    }
    const head = await clickHEAD(request(cases[0]!), ctx(message.id) as never);
    assert.equal(head.status, 400);
    await settle();
    assert.equal((await getDb()).emailEvents.length, 0, "nothing recorded for tampered links");
  });

  it("in-app (same-origin) clicks and opens are not recorded", async () => {
    const message = await trackedEmail();
    const res = await clickGET(request(clickHref(message.html), { "sec-fetch-site": "same-origin" }), ctx(message.id) as never);
    assert.equal(res.status, 302);
    const pixel = /\/api\/email\/o\/([^"]+)"/.exec(message.html)![1]!;
    await pixelGET(request(`http://localhost:3000/api/email/o/${pixel}`, { "sec-fetch-site": "same-origin" }), ctx(pixel) as never);
    await settle();
    assert.equal((await getDb()).emailEvents.length, 0);
  });

  it("the pixel always answers with a GIF and records valid opens once", async () => {
    const message = await trackedEmail();
    const pixel = /\/api\/email\/o\/([^"]+)"/.exec(message.html)![1]!;
    const res = await pixelGET(request(`http://localhost:3000/api/email/o/${pixel}`), ctx(pixel) as never);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/gif");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a");

    const forged = `${message.id}.${"A".repeat(22)}.gif`;
    const bad = await pixelGET(request(`http://localhost:3000/api/email/o/${forged}`), ctx(forged) as never);
    assert.equal(bad.status, 200, "a bad signature looks the same");
    await eventsReach(1);
    await pixelGET(request(`http://localhost:3000/api/email/o/${pixel}`), ctx(pixel) as never);
    await settle();
    const events = (await getDb()).emailEvents;
    assert.equal(events.length, 1, "the repeat open within the hour is not stored");
    assert.equal(events[0]!.type, "open");
    assert.equal((await findById("broadcasts", "brd_1"))?.opens, 1);
  });

  it("recording ignores emails that no longer exist", async () => {
    assert.equal(await recordEmailHit("eml_missing", { type: "open" }), null);
  });

  it("a replayed link is throttled per email", async () => {
    const message = await trackedEmail();
    const results = [];
    for (let i = 0; i < 21; i++) results.push(await recordEmailHit(message.id, { type: "open" }));
    assert.ok(results[0]?.firstOpen);
    assert.deepEqual(results[19]?.add, [], "within the limit: processed, nothing new to store");
    assert.equal(results[20], null, "over the limit: not processed");
  });

  it("stops recording for already sent emails once tracking is switched off", async () => {
    const message = await trackedEmail();
    await mutate((db) => {
      db.settings.email = { ...db.settings.email, trackOpens: false };
    });
    assert.deepEqual((await recordEmailHit(message.id, { type: "open" }))?.add, []);
    // The link still works; only the click is stored (no implied open) and counted.
    const res = await clickGET(request(clickHref(message.html)), ctx(message.id) as never);
    assert.equal(res.status, 302);
    const events = await eventsReach(1);
    assert.deepEqual(events.map((e) => e.type), ["click"]);
    const b = await findById("broadcasts", "brd_1");
    assert.equal(b?.opens, 0);
    assert.equal(b?.clicks, 1);

    await mutate((db) => {
      db.settings.email = { ...db.settings.email, trackClicks: false };
    });
    const other = await recordEmailHit(message.id, { type: "click", url: "https://example.com/other" });
    assert.deepEqual(other?.add, []);
    assert.equal((await getDb()).emailEvents.length, 1);
  });

  it("campaign statistics survive the outbox clean-up; orphaned events are pruned", async () => {
    const a = await trackedEmail();
    const plain = await enqueueEmail({ to: "ada@example.com", subject: "One-off", html: `<a href="https://example.com/x">x</a>`, category: "announcement", trackOpens: true });
    await recordEmailHit(a.id, { type: "click", url: POST_URL });
    await recordEmailHit(plain.id, { type: "open" });
    const stored = (await getDb()).emailEvents;
    assert.deepEqual(stored.map((e) => e.trackingId), ["broadcast:brd_1", "broadcast:brd_1", undefined], "events carry their campaign");
    assert.equal(await pruneEmailEvents(), 0, "nothing to remove while the emails exist");

    assert.equal((await deleteEmail(a.id)).ok, true);
    assert.equal((await deleteEmail(plain.id)).ok, true);
    assert.equal(await pruneEmailEvents(), 1, "the event of the deleted one-off email goes");
    const summary = await getCampaignEventSummary(broadcastTrackingId("brd_1"));
    assert.equal(summary.uniqueOpens, 1);
    assert.equal(summary.uniqueClicks, 1);
    assert.deepEqual(summary.links, [{ url: POST_URL, clicks: 1, uniqueClicks: 1 }]);
    assert.equal((await getCampaignEventSummary(broadcastTrackingId("brd_2"))).totalOpens, 0);

    // Deleting the broadcast leaves nothing to report on.
    await mutate((db) => {
      db.broadcasts = [];
    });
    assert.equal(await pruneEmailEvents(), 2);
    assert.equal((await getDb()).emailEvents.length, 0);
  });

  it("offers periods within the outbox retention only", () => {
    assert.equal(parseTrackingRange("90"), 90);
    assert.equal(parseTrackingRange("365"), 30);
    assert.equal(parseTrackingRange(["7", "90"]), 7);
    assert.equal(parseTrackingRange(undefined), 30);
  });

  it("reports per campaign, per link and as an event list", async () => {
    const a = await trackedEmail();
    const b = await trackedEmail();
    await recordEmailHit(a.id, { type: "click", url: "https://example.com/post?id=7&ref=mail" });
    await recordEmailHit(b.id, { type: "open" });
    const overview = await getTrackingOverview(30);
    assert.equal(overview.tracked, 2);
    assert.equal(overview.summary.uniqueOpens, 2);
    assert.equal(overview.summary.uniqueClicks, 1);
    assert.equal(overview.campaigns.length, 1);
    assert.equal(overview.campaigns[0]!.label, "Spring news");
    assert.equal(overview.campaigns[0]!.uniqueOpens, 2);
    assert.deepEqual(overview.topLinks, [{ url: "https://example.com/post?id=7&ref=mail", clicks: 1, uniqueClicks: 1 }]);

    const clicks = await listTrackingEvents({ range: 30, type: "click", q: "", page: 1 });
    assert.equal(clicks.total, 1);
    assert.equal(clicks.rows[0]!.campaign.kind, "broadcast");
    const search = await listTrackingEvents({ range: 30, type: "all", q: "nobody@", page: 1 });
    assert.equal(search.total, 0);
  });
});
