/**
 * In-memory brute-force protection.
 *
 * - `SlidingWindowRateLimiter` keeps, per key, the timestamps of recent
 *   attempts and allows at most `limit` inside any rolling `windowMs`
 *   (a sliding-window log — no burst at window boundaries).
 * - `FailureLockout` counts consecutive failures per key and locks the key for
 *   a while once a threshold is reached (a generic in-memory helper; sign-in
 *   lockouts are persisted instead, see `login-throttle.ts`).
 * - `KeyedMutex` runs async work one at a time per key; the login flow uses
 *   it so parallel attempts for one email can't slip past the lockout.
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
  /** Sign-in attempts from every client whose IP isn't known (TRUST_PROXY_HOPS=0), together. */
  loginIpShared: { limit: 400, windowMs: 15 * MINUTE },
  /** Sign-in attempts for one email from one IP. */
  loginAccount: { limit: 10, windowMs: 15 * MINUTE },
  /** Sign-in attempts for one email from anywhere (distributed guessing). */
  loginEmail: { limit: 30, windowMs: 15 * MINUTE },
  /** Password-reset requests for one email. */
  forgotEmail: { limit: 3, windowMs: HOUR },
  /** Password-reset requests from one IP. */
  forgotIp: { limit: 10, windowMs: HOUR },
  /** Password-reset requests from every client whose IP isn't known, together. */
  forgotIpShared: { limit: 100, windowMs: HOUR },
  /** Reset-password form submissions from one IP. */
  resetIp: { limit: 20, windowMs: 15 * MINUTE },
  /** Reset-password form submissions from every client whose IP isn't known, together. */
  resetIpShared: { limit: 200, windowMs: 15 * MINUTE },
  /** Second-factor attempts for one account from one IP. */
  twoFactor: { limit: 10, windowMs: 15 * MINUTE },
  /** Codes tried against a single sign-in challenge before it is revoked. */
  twoFactorChallenge: { limit: 5, windowMs: 15 * MINUTE },
  /** Verification-email resends per account. */
  verificationResend: { limit: 3, windowMs: HOUR },
  /** Sign-ups from one IP. */
  registerIp: { limit: 10, windowMs: HOUR },
  /** Sign-ups from every client whose IP isn't known, together. */
  registerIpShared: { limit: 100, windowMs: HOUR },
  /** Password / code confirmations inside account settings (change password, 2FA setup/disable). */
  accountChange: { limit: 10, windowMs: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Key and rule for a per-IP limit. When the client IP isn't known (no trusted
 * proxy, see request-info.ts) every such client shares one bucket, with a
 * site-wide rule sized for all of them together, so per-IP limits degrade to
 * a global limit instead of trusting spoofable headers.
 */
export function perIpLimit(scope: string, ip: string | null | undefined, perIp: RateLimitRule, shared: RateLimitRule): { key: string; rule: RateLimitRule } {
  const known = !!ip && ip !== "unknown";
  return known ? { key: `${scope}:${ip}`, rule: perIp } : { key: `${scope}:unknown`, rule: shared };
}

/**
 * Serialises async work per key: `run(key, fn)` starts `fn` only after every
 * earlier task for the same key has settled. Idle keys are dropped, so memory
 * is bounded by the number of keys with work in flight.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  /** Keys with work queued or running (for diagnostics and tests). */
  get size(): number {
    return this.tails.size;
  }

  async run<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => done);
    this.tails.set(key, tail);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

type Globals = { __llAuthRateLimiter?: SlidingWindowRateLimiter; __llLoginAttemptLock?: KeyedMutex };
const g = globalThis as unknown as Globals;

/** Process-wide limiter for the auth flows. */
export const authRateLimiter: SlidingWindowRateLimiter = (g.__llAuthRateLimiter ??= new SlidingWindowRateLimiter());

/** One sign-in attempt (password or second factor) at a time per email address. */
export const loginAttemptLock: KeyedMutex = (g.__llLoginAttemptLock ??= new KeyedMutex());

/** Normalised key fragment for an email address. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
