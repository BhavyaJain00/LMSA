import type { WebhookEndpoint } from "@/lib/types";
import "./types";

/**
 * Delivery rules for outgoing webhooks. Pure module (no Node or Next APIs):
 * shared by the delivery worker, the admin pages and the developer docs,
 * so the documented numbers are the ones the worker uses.
 *
 *   attempt 1 ── fails ──▶ wait 1 min ──▶ attempt 2 ──▶ 5 min ──▶ 3 ──▶ 15 min
 *   ──▶ 4 ──▶ 1 h ──▶ 5 ──▶ 3 h ──▶ 6 ──▶ 6 h ──▶ 7 ──▶ 12 h ──▶ attempt 8
 *
 * A delivery that fails its 8th attempt (about 22 hours after the first) is
 * marked failed. An endpoint whose attempts have all failed for 24 hours is
 * switched off and administrators are notified.
 */

/** Attempts per delivery: the first try plus one retry per delay below. */
export const MAX_DELIVERY_ATTEMPTS = 8;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Wait after the n-th failed attempt (index n-1). Exponential-style backoff, each delay used once. */
export const RETRY_DELAYS_MS: readonly number[] = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR];

/** Time allowed for one attempt, from connecting to the last byte of the response. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** Characters of the response body kept in the delivery log. */
export const RESPONSE_BODY_LIMIT = 2_000;

/** An endpoint is switched off once every attempt has failed for this long… */
export const AUTO_DISABLE_AFTER_MS = 24 * HOUR;
/** …and at least this many attempts failed in a row (one delivery's full retry schedule). */
export const AUTO_DISABLE_MIN_FAILURES = MAX_DELIVERY_ATTEMPTS;

/** Finished deliveries are kept in the log this long. */
export const DELIVERY_RETENTION_DAYS = 30;
/** Upper bound on log rows (the oldest finished deliveries go first). */
export const MAX_DELIVERY_ROWS = 10_000;

/** Endpoints a site may have. */
export const MAX_WEBHOOK_ENDPOINTS = 25;
export const MAX_WEBHOOK_URL_LENGTH = 2_000;
export const MAX_WEBHOOK_DESCRIPTION_LENGTH = 120;

/** Delay before the next try after `attempts` failed attempts (1-based). */
export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(Math.floor(attempts), 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index]!;
}

/** When to try again after the `attempts`-th attempt failed at `now`, or null when no attempts are left. */
export function nextAttemptAt(attempts: number, now: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  return now + retryDelayMs(attempts);
}

/** Longest time between the first and the last attempt of one delivery. */
export const RETRY_WINDOW_MS: number = RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0);

/**
 * Whether an endpoint that just failed again should be switched off:
 * nothing has succeeded for `AUTO_DISABLE_AFTER_MS` and at least
 * `AUTO_DISABLE_MIN_FAILURES` attempts failed in a row. A short outage
 * during a burst of events therefore never disables an endpoint.
 */
export function shouldAutoDisable(endpoint: Pick<WebhookEndpoint, "active" | "failureCount" | "failingSince">, now: number): boolean {
  if (!endpoint.active || endpoint.failureCount < AUTO_DISABLE_MIN_FAILURES || !endpoint.failingSince) return false;
  const since = Date.parse(endpoint.failingSince);
  return Number.isFinite(since) && now - since >= AUTO_DISABLE_AFTER_MS;
}

/** "1 minute", "3 hours" — for the docs and the admin page. */
export function describeDelay(ms: number): string {
  if (ms % HOUR === 0) return `${ms / HOUR} ${ms === HOUR ? "hour" : "hours"}`;
  const minutes = Math.round(ms / MINUTE);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
