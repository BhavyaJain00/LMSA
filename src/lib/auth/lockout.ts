import "server-only";
import type { Settings, User } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { authRateLimiter, emailKey, unknownAccountLockouts } from "./rate-limit";

/**
 * Account lockout after repeated failures.
 *
 * `maxLoginAttempts` consecutive failures (wrong password or wrong second-
 * factor code) lock the account for `lockoutMinutes`. The counter resets on a
 * successful sign-in, a password reset, or when an admin unlocks the account.
 * While locked, sign-in is refused before the password is checked.
 */

type SecuritySettings = Pick<Settings["security"], "maxLoginAttempts" | "lockoutMinutes">;

export interface FailureOutcome {
  /** True when this failure triggered (or the account was already in) a lockout. */
  locked: boolean;
  lockedUntil?: string;
  failures: number;
}

/** Record a failed attempt for an existing account. */
export async function registerLoginFailure(userId: string, security: SecuritySettings, now: Date = new Date()): Promise<FailureOutcome> {
  const max = Math.max(1, Math.floor(security.maxLoginAttempts));
  const lockMs = Math.max(1, Math.floor(security.lockoutMinutes)) * 60 * 1000;
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { locked: false, failures: 0 };
    const nowMs = now.getTime();
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > nowMs) {
      return { locked: true, lockedUntil: user.lockedUntil, failures: user.failedLoginCount ?? 0 };
    }
    const failures = (user.failedLoginCount ?? 0) + 1;
    if (failures >= max) {
      user.failedLoginCount = 0;
      user.lockedUntil = new Date(nowMs + lockMs).toISOString();
      return { locked: true, lockedUntil: user.lockedUntil, failures };
    }
    user.failedLoginCount = failures;
    if (user.lockedUntil) delete user.lockedUntil;
    return { locked: false, failures };
  });
}

/** Reset the failure counter and any lock (successful sign-in or password reset). */
export async function clearLoginFailures(userId: string): Promise<void> {
  await mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    if (user.failedLoginCount) user.failedLoginCount = 0;
    if (user.lockedUntil) delete user.lockedUntil;
  });
}

/**
 * Admin unlock: clears the stored lock and the in-memory rate-limit counters
 * for the account's email, so the member can try again immediately.
 */
export async function unlockAccount(userId: string): Promise<User | null> {
  const user = await mutate((db) => {
    const found = db.users.find((u) => u.id === userId);
    if (!found) return null;
    found.failedLoginCount = 0;
    delete found.lockedUntil;
    return found;
  });
  if (user) forgetAuthCounters(user.email, user.id);
  return user;
}

/** Drop in-memory limiter and lockout state tied to an email / user. */
export function forgetAuthCounters(email: string, userId?: string): void {
  const key = emailKey(email);
  authRateLimiter.reset(`login:email:${key}`);
  authRateLimiter.resetPrefix(`login:acct:${key}|`);
  unknownAccountLockouts.clear(key);
  if (userId) authRateLimiter.resetPrefix(`2fa:${userId}|`);
}
