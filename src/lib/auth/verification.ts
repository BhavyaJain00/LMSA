import "server-only";
import type { User } from "@/lib/types";
import { getSettings, mutate } from "@/lib/db/store";
import { isEmailVerified } from "./account-status";
import { sendVerificationEmail } from "./emails";
import { consumeAuthToken, checkAuthToken, issueAuthToken } from "./tokens";

export { isEmailVerified } from "./account-status";

/**
 * Email verification.
 *
 * Self-registered accounts get `emailVerificationRequired: true` and a
 * verification link. A user counts as verified when `emailVerifiedAt` is set
 * OR the flag is not true (seed/admin-created accounts). When
 * `settings.security.requireEmailVerification` is on, unverified users can
 * still sign in but are blocked from enrolling and purchasing — Server Actions
 * call `assertVerified(user)` (throws) or `verificationError(user)` (returns a
 * message) before doing so.
 */

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE = "Please confirm your email address first. We sent you a link — you can resend it from Settings → Security.";

export class EmailVerificationRequiredError extends Error {
  readonly code = "EMAIL_VERIFICATION_REQUIRED";
  constructor(message: string = EMAIL_VERIFICATION_REQUIRED_MESSAGE) {
    super(message);
    this.name = "EmailVerificationRequiredError";
  }
}

/** Whether the platform currently blocks unverified users from enrolling/purchasing. */
export async function isVerificationEnforced(): Promise<boolean> {
  const settings = await getSettings();
  return settings.security.requireEmailVerification === true;
}

/** True when this user is blocked by the verification requirement right now. */
export async function isBlockedByVerification(user: Pick<User, "emailVerifiedAt" | "emailVerificationRequired">): Promise<boolean> {
  return !isEmailVerified(user) && (await isVerificationEnforced());
}

/**
 * Throws `EmailVerificationRequiredError` when verification is enforced and the
 * user has not confirmed their email. Resolves otherwise.
 */
export async function assertVerified(user: Pick<User, "emailVerifiedAt" | "emailVerificationRequired">): Promise<void> {
  if (await isBlockedByVerification(user)) throw new EmailVerificationRequiredError();
}

/**
 * Non-throwing variant for Server Actions that return `ActionResult`:
 * `const blocked = await verificationError(user); if (blocked) return { ok: false, error: blocked };`
 */
export async function verificationError(user: Pick<User, "emailVerifiedAt" | "emailVerificationRequired">): Promise<string | null> {
  return (await isBlockedByVerification(user)) ? EMAIL_VERIFICATION_REQUIRED_MESSAGE : null;
}

/** Issue a fresh verification token and email it (older links stop working). */
export async function sendEmailVerification(user: Pick<User, "id" | "email" | "name">): Promise<void> {
  const { token } = await issueAuthToken(user.id, "email_verification");
  await sendVerificationEmail(user, token);
}

export type VerifyEmailOutcome =
  | { status: "verified"; user: User }
  | { status: "already_verified"; user: User }
  | { status: "expired"; user?: User }
  | { status: "invalid" };

/**
 * Confirm an email with a token from a verification link. Idempotent: a used
 * link for an account that is already verified reports "already_verified".
 */
export async function verifyEmailWithToken(raw: string | null | undefined): Promise<VerifyEmailOutcome> {
  const consumed = await consumeAuthToken(raw, "email_verification");
  if (consumed) {
    const now = new Date().toISOString();
    const user = await mutate((db) => {
      const found = db.users.find((u) => u.id === consumed.user.id);
      if (!found) return null;
      found.emailVerifiedAt ??= now;
      // The address is now confirmed, so any other outstanding links are moot.
      db.authTokens = db.authTokens.filter((t) => !(t.userId === found.id && t.purpose === "email_verification" && !t.usedAt));
      return found;
    });
    return user ? { status: "verified", user } : { status: "invalid" };
  }
  const check = await checkAuthToken(raw, "email_verification");
  if (check.status === "used" && check.user) {
    return isEmailVerified(check.user) ? { status: "already_verified", user: check.user } : { status: "expired", user: check.user };
  }
  if (check.status === "expired") return { status: "expired", user: check.user };
  return { status: "invalid" };
}

/** Mark an account verified (admin action, or after a successful password reset proves inbox access). */
export async function markEmailVerified(userId: string): Promise<User | null> {
  const now = new Date().toISOString();
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;
    user.emailVerifiedAt ??= now;
    db.authTokens = db.authTokens.filter((t) => !(t.userId === userId && t.purpose === "email_verification" && !t.usedAt));
    return user;
  });
}
