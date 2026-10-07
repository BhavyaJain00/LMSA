import "server-only";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { ANON_COOKIE, CONSENT_COOKIE, isValidAnonId, parseConsentValue } from "@/lib/legal/consent-shared";
import { optedOut } from "./analytics-shared";
import { recordCheckoutStarted } from "./analytics";

/**
 * `checkout_started` from the order server action (growth area).
 *
 * The beacon reports a checkout when the checkout page is viewed, which
 * misses buyers whose browser does not run it. The order action calls
 * `trackCheckoutStarted()` so such a checkout still reaches the funnel.
 * The same rules as the beacon apply: nothing is recorded when the browser
 * asks not to be tracked (Do-Not-Track / Global Privacy Control) or without
 * analytics consent (a server-side event cannot be anonymous and also be
 * told apart from the beacon's). A checkout the beacon already reported for
 * this visitor or member is not counted twice (`recordCheckoutStarted`
 * deduplicates). The write happens after the response; it never fails the
 * checkout.
 */
export async function trackCheckoutStarted(input: { userId: string; itemType: string; itemId: string }): Promise<void> {
  let anonId: string | undefined;
  try {
    const [jar, h] = await Promise.all([cookies(), headers()]);
    if (optedOut(h) || !parseConsentValue(jar.get(CONSENT_COOKIE)?.value).analytics) return;
    const anon = jar.get(ANON_COOKIE)?.value;
    if (isValidAnonId(anon)) anonId = anon;
  } catch {
    // Outside a request: there is no consent to read, so nothing is recorded.
    return;
  }
  const event = { userId: input.userId, anonId, itemType: input.itemType, itemId: input.itemId };
  after(async () => {
    try {
      await recordCheckoutStarted(event);
    } catch (error) {
      console.error("[analytics] could not record a checkout:", error instanceof Error ? error.message : String(error));
    }
  });
}
