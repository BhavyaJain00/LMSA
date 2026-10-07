import type { Role, User } from "@/lib/types";

/**
 * Pure account-status helpers (no I/O, safe on server and client).
 *
 * They answer questions about a user record — is the email verified, is two-
 * step verification active, is the account locked — without touching the
 * store, so pages, actions and tests can share one definition.
 */

type VerificationFields = Pick<User, "emailVerifiedAt" | "emailVerificationRequired">;
type TwoFactorFields = Pick<User, "twoFactorEnabled" | "twoFactorSecretEnc">;
type LockFields = Pick<User, "lockedUntil">;

/**
 * A user counts as verified when they confirmed their address, or when their
 * account never needed confirming (seed and admin-created accounts leave
 * `emailVerificationRequired` unset).
 */
export function isEmailVerified(user: VerificationFields): boolean {
  return Boolean(user.emailVerifiedAt) || user.emailVerificationRequired !== true;
}

/** Two-step verification is active only when it was confirmed and a secret is stored. */
export function isTwoFactorActive(user: TwoFactorFields): boolean {
  return user.twoFactorEnabled === true && Boolean(user.twoFactorSecretEnc);
}

/** A secret was generated but the user has not confirmed it with a code yet. */
export function hasPendingTwoFactorSetup(user: TwoFactorFields): boolean {
  return user.twoFactorEnabled !== true && Boolean(user.twoFactorSecretEnc);
}

/** Milliseconds until a temporary lockout ends (0 when not locked). */
export function lockRemainingMs(user: LockFields, now: number = Date.now()): number {
  if (!user.lockedUntil) return 0;
  const until = new Date(user.lockedUntil).getTime();
  if (Number.isNaN(until)) return 0;
  return Math.max(0, until - now);
}

export function isAccountLocked(user: LockFields, now: number = Date.now()): boolean {
  return lockRemainingMs(user, now) > 0;
}

/** Roles that count as "staff" for the enforce-2FA policy (mirrors `isStaff` in session.ts). */
export const STAFF_ROLES: readonly Role[] = ["admin", "moderator", "course_creator", "batch_evaluator"];

export function hasStaffRole(user: Pick<User, "roles">): boolean {
  return user.roles.some((r) => STAFF_ROLES.includes(r));
}

/**
 * Whether the platform requires this user to turn on two-step verification
 * before using staff areas (`settings.security.enforceTwoFactorForStaff`).
 */
export function mustSetUpTwoFactor(
  user: Pick<User, "roles" | "twoFactorEnabled" | "twoFactorSecretEnc">,
  security: { allowTwoFactor: boolean; enforceTwoFactorForStaff: boolean },
): boolean {
  return security.allowTwoFactor && security.enforceTwoFactorForStaff && hasStaffRole(user) && !isTwoFactorActive(user);
}

/** A wait rounded up for people: "a few seconds" (under 45 s), whole minutes, or whole hours. */
export type WaitAmount = { unit: "seconds" } | { unit: "minutes" | "hours"; count: number };

/** Round a wait the way lockout and rate-limit messages show it (shared by `formatWait` and translated messages). */
export function waitAmount(ms: number): WaitAmount {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds < 45) return { unit: "seconds" };
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  return { unit: "hours", count: Math.ceil(minutes / 60) };
}

/** "3 minutes", "1 hour", "a few seconds" — for lockout and rate-limit messages (English). */
export function formatWait(ms: number): string {
  const wait = waitAmount(ms);
  if (wait.unit === "seconds") return "a few seconds";
  const unit = wait.unit === "minutes" ? "minute" : "hour";
  return `${wait.count} ${wait.count === 1 ? unit : `${unit}s`}`;
}

/** "a•••@example.com" — shows enough of an address to recognise it without echoing it in full. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email.length > 2 ? `${email[0]}•••` : "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}•••@${domain}`;
}
