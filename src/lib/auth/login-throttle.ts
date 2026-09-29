import "server-only";
import type { Database, LoginThrottle, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { hmacHex } from "./crypto";
import { emailKey, type LockoutStatus } from "./rate-limit";

/**
 * Persistent sign-in lockout, keyed by email address.
 *
 * Every address — registered or not — gets the same record in
 * `db.loginThrottles`, keyed by an HMAC of the normalised address, with the
 * same threshold, lock length, decay and eviction. So a series of failures
 * behaves identically for unknown and real accounts, also across restarts,
 * and the lock message can't be used to find out which emails exist.
 *
 * For registered accounts the state is mirrored onto `User.failedLoginCount`
 * / `User.lockedUntil` (read by the admin screens); the decision itself is
 * always made from the throttle record.
 */

/** Failures are forgotten this long after the most recent one. */
export const LOGIN_FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;
/** Upper bound on stored records (oldest unlocked ones go first). */
export const MAX_LOGIN_THROTTLES = 10_000;

type SecuritySettings = Pick<Settings["security"], "maxLoginAttempts" | "lockoutMinutes">;

export interface FailureOutcome {
  /** True when this failure triggered (or the address was already in) a lockout. */
  locked: boolean;
  lockedUntil?: string;
  failures: number;
}

/** Record key for an email address (HMAC-SHA256, hex). */
export function loginThrottleKey(email: string): string {
  return hmacHex("login-throttle", emailKey(email));
}

/** Pure: the effective state of a record at `now` (locks expire, failures decay). */
export function evaluateThrottle(record: Pick<LoginThrottle, "failures" | "lastFailureAt" | "lockedUntil"> | undefined, now: number): LockoutStatus {
  if (!record) return { locked: false, failures: 0, lockedUntil: null };
  const until = record.lockedUntil ? Date.parse(record.lockedUntil) : Number.NaN;
  if (Number.isFinite(until) && until > now) return { locked: true, failures: record.failures, lockedUntil: until };
  const last = Date.parse(record.lastFailureAt);
  if (!Number.isFinite(last) || now - last >= LOGIN_FAILURE_MEMORY_MS) return { locked: false, failures: 0, lockedUntil: null };
  return { locked: false, failures: Math.max(0, Math.floor(record.failures)), lockedUntil: null };
}

/**
 * Pure: apply one failed attempt. Locks at `maxFailures` for `lockMs` (the
 * counter restarts after the lock); an active lock is never extended.
 */
export function applyThrottleFailure(
  record: Pick<LoginThrottle, "failures" | "lastFailureAt" | "lockedUntil"> | undefined,
  maxFailures: number,
  lockMs: number,
  now: number,
): { next: Pick<LoginThrottle, "failures" | "lastFailureAt" | "lockedUntil"> | null; outcome: FailureOutcome } {
  const current = evaluateThrottle(record, now);
  if (current.locked) {
    return { next: null, outcome: { locked: true, lockedUntil: new Date(current.lockedUntil!).toISOString(), failures: current.failures } };
  }
  const failures = current.failures + 1;
  const at = new Date(now).toISOString();
  if (failures >= Math.max(1, Math.floor(maxFailures))) {
    const lockedUntil = new Date(now + lockMs).toISOString();
    return { next: { failures: 0, lastFailureAt: at, lockedUntil }, outcome: { locked: true, lockedUntil, failures } };
  }
  return { next: { failures, lastFailureAt: at }, outcome: { locked: false, failures } };
}

function lockSettings(security: SecuritySettings): { max: number; lockMs: number } {
  return {
    max: Math.max(1, Math.floor(security.maxLoginAttempts)),
    lockMs: Math.max(1, Math.floor(security.lockoutMinutes)) * 60 * 1000,
  };
}

function userWithEmail(db: Database, email: string): User | undefined {
  const key = emailKey(email);
  return db.users.find((u) => u.email.toLowerCase() === key);
}

/** Drop decayed records and keep at most `MAX_LOGIN_THROTTLES` (oldest unlocked first). */
function prune(db: Database, now: number): void {
  let rows = db.loginThrottles.filter((t) => {
    const state = evaluateThrottle(t, now);
    return state.locked || state.failures > 0;
  });
  if (rows.length > MAX_LOGIN_THROTTLES) {
    const byAge = [...rows].sort((a, b) => a.lastFailureAt.localeCompare(b.lastFailureAt));
    const drop = new Set<LoginThrottle>();
    for (const lockedPass of [false, true]) {
      for (const row of byAge) {
        if (rows.length - drop.size <= MAX_LOGIN_THROTTLES) break;
        if (evaluateThrottle(row, now).locked === lockedPass) drop.add(row);
      }
    }
    rows = rows.filter((t) => !drop.has(t));
  }
  db.loginThrottles = rows;
}

/** Inside a `mutate`: record a failure for `email` (and mirror it onto the account, if any). */
export function recordFailureIn(db: Database, email: string, security: SecuritySettings, now: number): FailureOutcome {
  const keyHash = loginThrottleKey(email);
  const { max, lockMs } = lockSettings(security);
  const row = db.loginThrottles.find((t) => t.keyHash === keyHash);
  const { next, outcome } = applyThrottleFailure(row, max, lockMs, now);
  if (next) {
    if (row) {
      row.failures = next.failures;
      row.lastFailureAt = next.lastFailureAt;
      if (next.lockedUntil) row.lockedUntil = next.lockedUntil;
      else delete row.lockedUntil;
    } else {
      db.loginThrottles.push({ id: uid("lth"), keyHash, ...next });
    }
    const user = userWithEmail(db, email);
    if (user) {
      user.failedLoginCount = next.failures;
      if (next.lockedUntil) user.lockedUntil = next.lockedUntil;
      else delete user.lockedUntil;
    }
  }
  prune(db, now);
  return outcome;
}

/** Inside a `mutate`: forget the failures for `email` (and clear the account's mirror). */
export function clearThrottleIn(db: Database, email: string): void {
  const keyHash = loginThrottleKey(email);
  db.loginThrottles = db.loginThrottles.filter((t) => t.keyHash !== keyHash);
  const user = userWithEmail(db, email);
  if (user) {
    if (user.failedLoginCount) user.failedLoginCount = 0;
    if (user.lockedUntil) delete user.lockedUntil;
  }
}

/** Current state for an email from an already loaded database (e.g. admin views). */
export function throttleStatusIn(db: Pick<Database, "loginThrottles">, email: string, now: number = Date.now()): LockoutStatus {
  const keyHash = loginThrottleKey(email);
  return evaluateThrottle(
    db.loginThrottles.find((t) => t.keyHash === keyHash),
    now,
  );
}

/** Current lock state for an email address (same answer for registered and unknown addresses). */
export async function getLoginThrottleStatus(email: string, now: number = Date.now()): Promise<LockoutStatus> {
  return throttleStatusIn(await getDb(), email, now);
}

/** Record a failed sign-in (wrong password or second-factor code) for an email address. */
export async function recordLoginFailure(email: string, security: SecuritySettings, now: Date = new Date()): Promise<FailureOutcome> {
  return mutate((db) => recordFailureIn(db, email, security, now.getTime()));
}

/** Forget the failures for an email address (successful sign-in, reset, admin unlock). */
export async function clearLoginThrottle(email: string): Promise<void> {
  await mutate((db) => clearThrottleIn(db, email));
}
