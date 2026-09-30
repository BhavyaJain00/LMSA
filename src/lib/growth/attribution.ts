import "server-only";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { perIpLimit, SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { ANON_COOKIE, isValidAnonId } from "@/lib/legal/consent-shared";
import { REF_CLICK_HEADER, REF_COOKIE, parseRefCookie, withinWindow } from "./affiliates-shared";
import { isBot } from "./bots";
import { REFERRAL_EVENT, attributedAffiliateId, findAffiliateByCode, linkMemberToReferral, recordReferralClick } from "./affiliates";

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

/**
 * Record the referral click of this request and link the signed-in member
 * to the click in their cookie. Writes happen after the response is sent;
 * bots, unknown or inactive codes, clicks outside the window and the
 * affiliate's own visits are ignored.
 */
export async function trackReferralVisit(): Promise<void> {
  const jar = await cookies();
  const ref = parseRefCookie(jar.get(REF_COOKIE)?.value);
  if (!ref) return;
  const h = await headers();
  const landingPath = h.get(REF_CLICK_HEADER);
  const [db, user] = await Promise.all([getDb(), getCurrentUser()]);
  if (!db.settings.growth.affiliatesEnabled || !withinWindow(ref.at, Date.now(), db.settings.growth.cookieDays)) return;
  const affiliate = findAffiliateByCode(db, ref.code);
  if (!affiliate || affiliate.status !== "active" || affiliate.userId === user?.id) return;

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
 * The affiliate to credit for an order `userId` is placing now: the code in
 * the referral cookie when it is inside the window, active and not the
 * buyer's own, otherwise the member's last linked click inside the window.
 * Undefined when nobody should be credited.
 */
export async function referralAffiliateIdForCheckout(userId: string): Promise<string | undefined> {
  const db = await getDb();
  const g = db.settings.growth;
  if (!g.affiliatesEnabled) return undefined;
  const now = Date.now();
  let ref: ReturnType<typeof parseRefCookie> = null;
  try {
    ref = parseRefCookie((await cookies()).get(REF_COOKIE)?.value, now);
  } catch {
    // Outside a request (background job): fall back to linked clicks.
  }
  if (ref && withinWindow(ref.at, now, g.cookieDays)) {
    const affiliate = findAffiliateByCode(db, ref.code);
    if (affiliate?.status === "active" && affiliate.userId !== userId) return affiliate.id;
  }
  const linked = attributedAffiliateId(db, userId, now);
  const affiliate = linked ? db.affiliates.find((a) => a.id === linked) : undefined;
  return affiliate?.status === "active" && affiliate.userId !== userId ? affiliate.id : undefined;
}
