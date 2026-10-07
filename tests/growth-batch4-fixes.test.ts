import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Affiliate } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { ANON_COOKIE } from "@/lib/legal/consent-shared";
import { MAX_REF_CLICKS, REF_CLICK_HEADER, REF_COOKIE, formatRefCookie, parseRefClicks } from "@/lib/growth/affiliates-shared";
import { attributedAffiliateId } from "@/lib/growth/affiliates";
import { referralAffiliateIdForCheckout, trackReferralVisit } from "@/lib/growth/attribution";
import { isBot } from "@/lib/growth/bots";
import { trackVisitor } from "@/lib/growth/visitor-cookies";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Growth review fixes, batch 4: a `?ref=` link with an unknown or paused
 * code cannot wipe an active affiliate's referral, and the bot filter keeps
 * real browsers whose user agent mentions a crawler's brand.
 */

const DAY = 24 * 60 * 60 * 1000;
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const VISITOR = "visitor-0123456789abcdef";

const promoter = makeUser({ id: "usr_b4ada", name: "Ada Promoter", email: "ada@example.com" });
const rival = makeUser({ id: "usr_b4bob", name: "Bob Rival", email: "bob@example.com" });
const buyer = makeUser({ id: "usr_b4buyer", name: "Bea Buyer", email: "bea@example.com" });

const ada: Affiliate = { id: "aff_b4ada", userId: promoter.id, code: "ADAB4", commissionPercent: 20, status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const bob: Affiliate = { id: "aff_b4bob", userId: rival.id, code: "BOBB4", commissionPercent: 10, status: "paused", createdAt: "2026-01-02T00:00:00.000Z" };

async function setup() {
  await resetDb({
    users: [promoter, rival, buyer],
    affiliates: [ada, bob],
    settings: { email: { enabled: false }, gamification: { enabled: false } },
  });
  resetRequest();
}

async function afterTasks() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** The parts of a `NextRequest` the visitor tracking reads. */
function proxyRequest(url: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieHeader) h.set("cookie", cookieHeader);
  return {
    headers: h,
    nextUrl: new URL(url),
    cookies: { get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined) },
  } as unknown as NextRequest;
}

function refCookieWritten(request: NextRequest): string | undefined {
  return trackVisitor(request).apply(NextResponse.next()).cookies.get(REF_COOKIE)?.value;
}

before(() => {
  mock.method(console, "error", () => undefined);
});
after(() => mock.restoreAll());

describe("a ?ref= link cannot wipe an earlier, valid referral", () => {
  it("keeps the earlier clicks behind a new one in the cookie the proxy writes", () => {
    const earlier = Date.now() - 2 * DAY;
    const written = refCookieWritten(proxyRequest("https://lms.test/courses/js?ref=junk", { [REF_COOKIE]: formatRefCookie(ada.code, earlier), [ANON_COOKIE]: VISITOR }));
    assert.ok(written);
    const clicks = parseRefClicks(written);
    assert.deepEqual(
      clicks.map((c) => c.code),
      ["JUNK", ada.code],
      "the new click goes first, the earlier one is kept",
    );
    assert.equal(clicks[1]!.at, Math.floor(earlier / 1000) * 1000);
  });

  it("keeps a bounded number of clicks and never repeats a code", () => {
    const now = Date.now();
    const value = formatRefCookie("NEW", now, [
      { code: "AAA", at: now - 1000 },
      { code: "NEW", at: now - 2000 },
      { code: "BBB", at: now - 3000 },
      { code: "CCC", at: now - 4000 },
    ]);
    assert.deepEqual(
      parseRefClicks(value).map((c) => c.code),
      ["NEW", "AAA", "BBB"].slice(0, MAX_REF_CLICKS),
    );
  });

  it("does not touch the referral cookie on a prefetch", () => {
    const request = proxyRequest("https://lms.test/courses/js?ref=junk", { [REF_COOKIE]: formatRefCookie(ada.code, Date.now()), [ANON_COOKIE]: VISITOR }, { "next-router-prefetch": "1" });
    assert.equal(refCookieWritten(request), undefined);
  });

  it("credits the active affiliate at checkout when a newer click has an unknown or paused code", async () => {
    await setup();
    const now = Date.now();
    resetRequest({ cookies: { [REF_COOKIE]: formatRefCookie("NOSUCH", now - 1000, [{ code: bob.code, at: now - 2000 }, { code: ada.code, at: now - DAY }]) } });
    assert.equal(await referralAffiliateIdForCheckout(buyer.id), ada.id);
  });

  it("links a signed-in guest to the active affiliate's click, not to the newer bogus one", async () => {
    await setup();
    const now = Date.now();
    const adaClick = now - DAY;
    resetRequest({
      cookies: { [REF_COOKIE]: formatRefCookie("NOSUCH", now - 1000, [{ code: ada.code, at: adaClick }]), [ANON_COOKIE]: VISITOR },
      headers: { [REF_CLICK_HEADER]: "/courses/js", "user-agent": BROWSER },
    });
    await createSession(buyer.id);
    await trackReferralVisit();
    await afterTasks();
    const db = await getDb();
    assert.equal(db.affiliateReferrals.length, 0, "the landing belongs to the bogus code: no click is recorded for the earlier affiliate");
    assert.equal(attributedAffiliateId(db, buyer.id, Date.now()), ada.id, "the member is still linked to the active affiliate");
  });
});

describe("bot filtering keeps real browsers that mention a crawler's brand", () => {
  it("keeps Cubot phones, the DuckDuckGo browser, in-app browsers and desktop chat apps", () => {
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 DuckDuckGo/5",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]",
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Telegram-Android/11.0.0 (Samsung SM-S911B; Android 13; SDK 33; HIGH)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.38.125 Chrome/124.0.0.0 Electron/30.0.0 Safari/537.36 Sonic Slack_SSB/4.38.125",
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9147 Chrome/120.0.6099.291 Electron/28.2.10 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0 YandexSearch/7.16 Mobile Safari/537.36",
    ]) {
      assert.equal(isBot(ua), false, ua);
    }
  });

  it("still drops the crawlers and unfurlers of those brands", () => {
    for (const ua of [
      "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; DuckAssistBot/1.0; +http://duckduckgo.com/duckassistbot.html)",
      "Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Slack-ImgProxy (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "WhatsApp/2.23.20.0 A",
      "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      "Mozilla/5.0 (compatible; YandexImages/3.0; +http://yandex.com/bots)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
    ]) {
      assert.equal(isBot(ua), true, ua);
    }
  });
});
