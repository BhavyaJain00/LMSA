import { unstable_rethrow } from "next/navigation";
import { trackReferralVisit } from "@/lib/growth/attribution";

/**
 * First-party tracking mounted once in the app shell (`src/app/(app)/layout.tsx`).
 *
 * Server side it records affiliate referral clicks and links signed-in
 * members to the click in their `ll_ref` cookie (both written after the
 * response). It renders nothing visible, and tracking problems never break
 * the page.
 */
export async function AnalyticsBeacon() {
  try {
    await trackReferralVisit();
  } catch (error) {
    // Let Next.js handle its own control-flow errors (e.g. dynamic rendering bail-outs).
    unstable_rethrow(error);
    console.error("[growth] referral tracking failed:", error instanceof Error ? error.message : String(error));
  }
  return null;
}
