import "server-only";
import type { Settings, User } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { authRateLimiter, emailKey } from "./rate-limit";
import { clearThrottleIn, recordFailureIn, type FailureOutcome } from "./login-throttle";

/**
 * Account lockout after repeated failures.
 *
 * `maxLoginAttempts` consecutive failures (wrong password or wrong second-
 * factor code) lock sign-in for `lockoutMinutes`. The counter lives in the
 * persisted, email-keyed throttle (`login-throttle.ts`), which treats unknown
 * addresses exactly like registered ones; for accounts it is mirrored onto
 * `failedLoginCount` / `lockedUntil`. It resets on a successful sign-in, a
 * password reset, or when an admin unlocks the account.
 */

export type { FailureOutcome } from "./login-throttle";

type SecuritySettings = Pick<Settings["security"], "maxLoginAttempts" | "lockoutMinutes">;

/** Record a failed attempt for an existing account (by id). Unknown ids change nothing. */
export async function registerLoginFailure(userId: string, security: SecuritySettings, now: Date = new Date()): Promise<FailureOutcome> {
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { locked: false, failures: 0 };
    return recordFailureIn(db, user.email, security, now.getTime());
  });
}

/** Reset the failure counter and any lock (successful sign-in or password reset). */
export async function clearLoginFailures(userId: string): Promise<void> {
  await mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;
    clearThrottleIn(db, user.email);
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
    clearThrottleIn(db, found.email);
    found.failedLoginCount = 0;
    delete found.lockedUntil;
    return found;
  });
  if (user) forgetAuthCounters(user.email, user.id);
  return user;
}

/** Drop in-memory limiter state tied to an email / user. */
export function forgetAuthCounters(email: string, userId?: string): void {
  const key = emailKey(email);
  authRateLimiter.reset(`login:email:${key}`);
  authRateLimiter.resetPrefix(`login:acct:${key}|`);
  if (userId) authRateLimiter.resetPrefix(`2fa:${userId}|`);
}
