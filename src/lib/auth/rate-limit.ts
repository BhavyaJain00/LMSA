/**
 * In-memory brute-force protection.
 *
 * - `SlidingWindowRateLimiter` keeps, per key, the timestamps of recent
 *   attempts and allows at most `limit` inside any rolling `windowMs`
 *   (a sliding-window log — no burst at window boundaries).
 * - `FailureLockout` counts consecutive failures per key and locks the key for
 *   a while once a threshold is reached. The login flow uses it for emails
 *   that have no account, so unknown and real accounts lock out identically
 *   and the response never reveals whether an email is registered.
 *
 * Both are bounded TTL maps: entries expire on their own, a sweep runs
 * periodically, and the oldest keys are evicted past `maxKeys`, so a flood of
 * random keys cannot exhaust memory. Instances live on `globalThis` so hot
 * reloading in development does not reset them.
 *
 * This module is pure (no Node or Next APIs) so it can be unit tested.
 */

export interface RateLimitRule {
  /** Attempts allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  /** Attempts left in the current window after this one. */
  remaining: number;
  /** When `ok` is false: how long until the next attempt is allowed. */
  retryAfterMs: number;
}

const DEFAULT_MAX_KEYS = 50_000;
const SWEEP_EVERY = 500;

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, { stamps: number[]; windowMs: number }>();
  private readonly maxKeys: number;
  private ops = 0;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  /** Number of tracked keys (for diagnostics and tests). */
  get size(): number {
    return this.hits.size;
  }

  private recent(key: string, windowMs: number, now: number): number[] {
    const entry = this.hits.get(key);
    if (!entry) return [];
    const cutoff = now - windowMs;
    const stamps = entry.stamps.filter((t) => t > cutoff && t <= now + 1000);
    if (stamps.length === 0) this.hits.delete(key);
    else entry.stamps = stamps;
    return stamps;
  }

  private result(stamps: number[], rule: RateLimitRule, now: number, ok: boolean): RateLimitResult {
    const remaining = Math.max(0, rule.limit - stamps.length);
    let retryAfterMs = 0;
    if (!ok) {
      // The oldest attempt that still counts decides when a slot frees up.
      const oldest = stamps[stamps.length - rule.limit] ?? stamps[0] ?? now;
      retryAfterMs = Math.max(0, oldest + rule.windowMs - now);
    }
    return { ok, limit: rule.limit, remaining, retryAfterMs };
  }

  /** Report the state for a key without recording an attempt. */
  check(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
    const stamps = this.recent(key, rule.windowMs, now);
    return this.result(stamps, rule, now, stamps.length < rule.limit);
  }

  /**
   * Record an attempt. Rejected attempts are not recorded, so a blocked
   * client regains access exactly when its oldest counted attempt expires.
   */
  hit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
    this.maintain(now);
    const stamps = this.recent(key, rule.windowMs, now);
    if (stamps.length >= rule.limit) return this.result(stamps, rule, now, false);
    stamps.push(now);
    // Re-insert so Map order reflects recency (oldest keys are evicted first).
    this.hits.delete(key);
    this.hits.set(key, { stamps, windowMs: rule.windowMs });
    return this.result(stamps, rule, now, true);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Remove every key starting with `prefix` (e.g. all counters for one email). */
  resetPrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.hits.keys()]) {
      if (key.startsWith(prefix)) {
        this.hits.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Drop keys whose attempts have all expired. */
  sweep(now: number = Date.now()): void {
    for (const [key, entry] of this.hits) {
      if (!entry.stamps.some((t) => t > now - entry.windowMs)) this.hits.delete(key);
    }
  }

  private maintain(now: number): void {
    if (++this.ops % SWEEP_EVERY === 0) this.sweep(now);
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}

export interface LockoutStatus {
  locked: boolean;
  /** Consecutive failures recorded since the last lock or success. */
  failures: number;
  /** Epoch ms when the lock ends (null when not locked). */
  lockedUntil: number | null;
}

export class FailureLockout {
  private readonly entries = new Map<string, { failures: number; lockedUntil: number; expiresAt: number }>();
  private readonly maxKeys: number;
  /** Failure counters are forgotten after this long without a new failure. */
  private readonly memoryMs: number;

  constructor(options: { maxKeys?: number; memoryMs?: number } = {}) {
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
    this.memoryMs = options.memoryMs ?? 24 * 60 * 60 * 1000;
  }

  get size(): number {
    return this.entries.size;
  }

  status(key: string, now: number = Date.now()): LockoutStatus {
    const entry = this.entries.get(key);
    if (!entry) return { locked: false, failures: 0, lockedUntil: null };
    if (entry.expiresAt <= now && entry.lockedUntil <= now) {
      this.entries.delete(key);
      return { locked: false, failures: 0, lockedUntil: null };
    }
    const locked = entry.lockedUntil > now;
    return { locked, failures: entry.failures, lockedUntil: locked ? entry.lockedUntil : null };
  }

  /** Record a failure; locks the key for `lockMs` once `maxFailures` is reached. */
  fail(key: string, maxFailures: number, lockMs: number, now: number = Date.now()): LockoutStatus {
    const current = this.status(key, now);
    if (current.locked) return current;
    const failures = current.failures + 1;
    const lock = failures >= Math.max(1, maxFailures);
    const entry = {
      failures: lock ? 0 : failures,
      lockedUntil: lock ? now + lockMs : 0,
      expiresAt: now + Math.max(this.memoryMs, lockMs),
    };
    this.entries.delete(key);
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, entry);
    return { locked: lock, failures: entry.failures, lockedUntil: lock ? entry.lockedUntil : null };
  }

  clear(key: string): void {
    this.entries.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Shared instances and rules                                           */
/* ------------------------------------------------------------------ */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Limits for the account-security flows. */
export const RATE_LIMITS = {
  /** Sign-in attempts from one IP across all accounts. */
  loginIp: { limit: 40, windowMs: 15 * MINUTE },
  /** Sign-in attempts for one email from one IP. */
  loginAccount: { limit: 10, windowMs: 15 * MINUTE },
  /** Sign-in attempts for one email from anywhere (distributed guessing). */
  loginEmail: { limit: 30, windowMs: 15 * MINUTE },
  /** Password-reset requests for one email. */
  forgotEmail: { limit: 3, windowMs: HOUR },
  /** Password-reset requests from one IP. */
  forgotIp: { limit: 10, windowMs: HOUR },
  /** Reset-password form submissions from one IP. */
  resetIp: { limit: 20, windowMs: 15 * MINUTE },
  /** Second-factor attempts for one account from one IP. */
  twoFactor: { limit: 10, windowMs: 15 * MINUTE },
  /** Codes tried against a single sign-in challenge before it is revoked. */
  twoFactorChallenge: { limit: 5, windowMs: 15 * MINUTE },
  /** Verification-email resends per account. */
  verificationResend: { limit: 3, windowMs: HOUR },
  /** Sign-ups from one IP. */
  registerIp: { limit: 10, windowMs: HOUR },
  /** Password / code confirmations inside account settings (change password, 2FA setup/disable). */
  accountChange: { limit: 10, windowMs: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

type Globals = { __llAuthRateLimiter?: SlidingWindowRateLimiter; __llAuthLockouts?: FailureLockout };
const g = globalThis as unknown as Globals;

/** Process-wide limiter for the auth flows. */
export const authRateLimiter: SlidingWindowRateLimiter = (g.__llAuthRateLimiter ??= new SlidingWindowRateLimiter());

/** Lockout counters for emails without an account (mirrors the per-user lockout). */
export const unknownAccountLockouts: FailureLockout = (g.__llAuthLockouts ??= new FailureLockout());

/** Normalised key fragment for an email address. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
