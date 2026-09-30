import { SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";

/**
 * Rate limits of the public API.
 *
 * - Each key may make `API_KEY_RATE_LIMIT.limit` requests per fixed
 *   one-minute window. Fixed windows give clients an exact reset time for
 *   the `X-RateLimit-Reset` header (the GitHub/Stripe convention).
 * - Requests with a missing or wrong key are limited per client IP with the
 *   shared sliding-window limiter, so key guessing is throttled too.
 *
 * Counters are in memory, per server process (like the sign-in limits).
 * Pure module: no Node or Next APIs.
 */

export const API_KEY_RATE_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };

/** Failed authentications allowed per client IP. */
export const API_AUTH_FAILURE_LIMIT: RateLimitRule = { limit: 30, windowMs: 60_000 };
/** Failed authentications allowed from all clients whose IP is unknown, together (see `perIpLimit`). */
export const API_AUTH_FAILURE_SHARED_LIMIT: RateLimitRule = { limit: 300, windowMs: 60_000 };

export interface WindowResult {
  ok: boolean;
  limit: number;
  /** Requests left in the current window after this one. */
  remaining: number;
  /** Epoch ms when the current window ends and the counter resets. */
  resetAt: number;
  /** Whole seconds until a request is allowed again (0 when `ok`). */
  retryAfterSeconds: number;
}

const DEFAULT_MAX_KEYS = 10_000;

/** Fixed-window counter per key, bounded in memory (the oldest keys are evicted first). */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  get size(): number {
    return this.windows.size;
  }

  /** Count a request for `key` and report whether it is allowed. Rejected requests are not counted. */
  hit(key: string, rule: RateLimitRule, now: number = Date.now()): WindowResult {
    const start = now - (now % rule.windowMs);
    let entry = this.windows.get(key);
    if (!entry || entry.start !== start) {
      entry = { start, count: 0 };
      this.windows.delete(key);
      while (this.windows.size >= this.maxKeys) {
        const oldest = this.windows.keys().next();
        if (oldest.done) break;
        this.windows.delete(oldest.value);
      }
      this.windows.set(key, entry);
    }
    const resetAt = start + rule.windowMs;
    if (entry.count >= rule.limit) {
      return { ok: false, limit: rule.limit, remaining: 0, resetAt, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    }
    entry.count++;
    return { ok: true, limit: rule.limit, remaining: rule.limit - entry.count, resetAt, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}

/** `X-RateLimit-*` headers (and `Retry-After` when the request was refused). */
export function rateLimitHeaders(result: WindowResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.ok) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

type Globals = { __llApiKeyLimiter?: FixedWindowLimiter; __llApiAuthFailures?: SlidingWindowRateLimiter };
const g = globalThis as unknown as Globals;

/** Per-key request counter shared by every API route in this process. */
export const apiKeyLimiter: FixedWindowLimiter = (g.__llApiKeyLimiter ??= new FixedWindowLimiter());

/** Failed authentications per client IP. */
export const apiAuthFailures: SlidingWindowRateLimiter = (g.__llApiAuthFailures ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));
