import "server-only";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { perIpLimit, SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { ANON_COOKIE, isValidAnonId } from "@/lib/legal/consent-shared";
import type { Affiliate, Database } from "@/lib/types";
import { REF_CLICK_HEADER, REF_COOKIE, parseRefClicks, pickLastClick, withinWindow, type RefCookie } from "./affiliates-shared";
import { isBot } from "./bots";
import { REFERRAL_EVENT, findAffiliateByCode, linkMemberToReferral, memberClicks, recordReferralClick } from "./affiliates";

/**
 * Request-side referral attribution (growth area).
 *
 * `src/proxy.ts` stores the `ll_ref` cookie; the app shell renders
 * `<AnalyticsBeacon />`, which calls `trackReferralVisit()` to record the
 * click (on the request that carried `?ref=`) and to link a signed-in
 * member to it. Checkout calls `referralAffiliateIdForCheckout()` to stamp
 * the order with the affiliate that gets the commission.
 */

const MINUTE = 60 * 1000;
/** Referral clicks recorded from one IP. */
const CLICK_RULE: RateLimitRule = { limit: 30, windowMs: 60 * MINUTE };
/** Referral clicks from every client whose IP is not known, together. */
const CLICK_SHARED_RULE: RateLimitRule = { limit: 600, windowMs: 60 * MINUTE };

const g = globalThis as unknown as { __llReferralClickLimiter?: SlidingWindowRateLimiter };
const clickLimiter = (g.__llReferralClickLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

/** An affiliate that may be credited for `userId` (active, and not the member themselves). */
function creditable(affiliate: Affiliate | undefined, userId: string | undefined): affiliate is Affiliate {
  return affiliate?.status === "active" && affiliate.userId !== userId;
}

/**
 * The cookie's clicks that can still be credited (inside the window, on an
 * active affiliate who is not the member), newest first.
 */
function creditableCookieClicks(
  db: Pick<Database, "affiliates" | "settings">,
  clicks: readonly RefCookie[],
  userId: string | undefined,
  nowMs: number,
): { click: RefCookie; affiliate: Affiliate }[] {
  const out: { click: RefCookie; affiliate: Affiliate }[] = [];
  for (const click of clicks) {
    if (!withinWindow(click.at, nowMs, db.settings.growth.cookieDays)) continue;
    const affiliate = findAffiliateByCode(db, click.code);
    if (creditable(affiliate, userId)) out.push({ click, affiliate });
  }
  return out;
}

/**
 * Record the referral click of this request and link the signed-in member
 * to the click in their cookie. Writes happen after the response is sent;
 * bots, unknown or inactive codes, clicks outside the window and the
 * affiliate's own visits are ignored.
 */
export async function trackReferralVisit(): Promise<void> {
  const jar = await cookies();
  const clicks = parseRefClicks(jar.get(REF_COOKIE)?.value);
  if (!clicks.length) return;
  const h = await headers();
  const [db, user] = await Promise.all([getDb(), getCurrentUser()]);
  if (!db.settings.growth.affiliatesEnabled) return;
  // The newest click of an active affiliate; a newer one with an unknown or paused code is skipped.
  const chosen = creditableCookieClicks(db, clicks, user?.id, Date.now())[0];
  if (!chosen) return;
  const { click: ref, affiliate } = chosen;
  // The click header marks the request that carried `?ref=`, which is the cookie's newest click.
  const landingPath = ref === clicks[0] ? h.get(REF_CLICK_HEADER) : null;

  const alreadyLinked =
    !user ||
    db.analyticsEvents.some((e) => e.name === REFERRAL_EVENT && e.userId === user.id && e.itemId === affiliate.id && e.createdAt === new Date(ref.at).toISOString());
  const recordClick = landingPath !== null && !isBot(h.get("user-agent"));
  if (!recordClick && alreadyLinked) return;

  const anon = jar.get(ANON_COOKIE)?.value;
  const visitorId = isValidAnonId(anon) ? anon : undefined;
  const bucket = perIpLimit("referral-click", clientIpFromHeaders(h), CLICK_RULE, CLICK_SHARED_RULE);
  const clickAllowed = recordClick && clickLimiter.hit(bucket.key, bucket.rule).ok;

  after(async () => {
    try {
      if (clickAllowed) await recordReferralClick({ code: ref.code, at: ref.at, visitorId, landingPath: landingPath ?? "/", userId: user?.id });
      if (user && !alreadyLinked) await linkMemberToReferral({ userId: user.id, code: ref.code, at: ref.at });
    } catch (error) {
      console.error("[growth] could not record a referral visit:", error instanceof Error ? error.message : String(error));
    }
  });
}

/**
 * The affiliate to credit for an order `userId` is placing now: the latest
 * click (last click wins) among the clicks in this browser's referral cookie
 * and the clicks linked to the member on any device, counting only clicks
 * inside the window on an active affiliate who is not the buyer. Undefined
 * when nobody should be credited.
 */
export async function referralAffiliateIdForCheckout(userId: string): Promise<string | undefined> {
  const db = await getDb();
  if (!db.settings.growth.affiliatesEnabled) return undefined;
  const now = Date.now();
  let cookieClicks: RefCookie[] = [];
  try {
    cookieClicks = parseRefClicks((await cookies()).get(REF_COOKIE)?.value, now);
  } catch {
    // Outside a request (background job): only linked clicks count.
  }
  const candidates: { affiliateId: string; at: number }[] = creditableCookieClicks(db, cookieClicks, userId, now).map(({ click, affiliate }) => ({ affiliateId: affiliate.id, at: click.at }));
  for (const click of memberClicks(db, userId)) {
    if (creditable(db.affiliates.find((a) => a.id === click.affiliateId), userId)) candidates.push(click);
  }
  return pickLastClick(candidates, now, db.settings.growth.cookieDays)?.affiliateId;
}
