import "server-only";
import { parseItemType } from "@/lib/data/commerce";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";

/**
 * Glue between the team pages and their neighbours (growth area): the
 * checkout hand-off and the rate limit on invitation links. Kept apart from
 * `teams.ts` so the checkout can import the team service without a cycle.
 */

/** Checkout page of a seats order (`ref` from `seatsOrderRef`). */
export function seatsCheckoutPath(ref: string): string {
  return `/billing/seats/${encodeURIComponent(ref)}`;
}

/**
 * Whether the checkout sells team seats online. Until it does, `/team/buy`
 * offers the invoice route only (administrators add the seats by hand).
 */
export function seatsCheckoutReady(): boolean {
  return parseItemType("seats") === "seats";
}

const g = globalThis as unknown as { __llTeamJoinLimiter?: SlidingWindowRateLimiter };
const joinLimiter: SlidingWindowRateLimiter = (g.__llTeamJoinLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));
const JOIN_RULE = { limit: 30, windowMs: 10 * 60 * 1000 };

/** Invitation links opened or accepted from one IP address: 30 per 10 minutes, so tokens cannot be guessed in bulk. */
export function joinAttemptAllowed(ip: string): boolean {
  return joinLimiter.hit(`join:${ip}`, JOIN_RULE).ok;
}
