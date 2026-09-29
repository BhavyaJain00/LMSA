"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Settings, User } from "@/lib/types";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { destroyAllSessions, getCurrentUser, isAdmin } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { formatWait, hasPendingTwoFactorSetup, isEmailVerified, isTwoFactorActive, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { authRateLimiter, RATE_LIMITS, type RateLimitResult } from "@/lib/auth/rate-limit";
import { getRequestInfo } from "@/lib/auth/request-info";
import { unlockAccount } from "@/lib/auth/lockout";
import { issueAuthToken, revokeAuthTokens } from "@/lib/auth/tokens";
import { sendPasswordResetEmail, sendSecurityNotice } from "@/lib/auth/emails";
import { markEmailVerified, sendEmailVerification, verificationError } from "@/lib/auth/verification";
import { consumeSecondFactor, generateRecoveryCodes, hashRecoveryCode, newTotpSecret, openTotpSecret, readSecondFactorInput, sealTotpSecret } from "@/lib/auth/two-factor";
import { normalizeTotpInput } from "@/lib/auth/totp";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { PASSWORD_MIN_LENGTH_CEILING, PASSWORD_MIN_LENGTH_FLOOR } from "@/lib/auth/password-policy";
import { fd, fdBool } from "@/lib/utils";

/**
 * Account-security actions: email verification resend, two-step verification
 * (setup, confirm, disable, recovery codes), the admin security settings and
 * admin account tools (unlock, reset 2FA, verify email, send reset link,
 * sign out everywhere). Every action re-checks the signed-in user.
 */

const SECURITY_PATH = "/settings/security";

type Errors = Record<string, string>;

function limited(result: RateLimitResult, what = "attempts"): ActionResult<never> {
  return { ok: false, error: `Too many ${what}. Please wait ${formatWait(result.retryAfterMs)} and try again.` };
}

async function requestContext() {
  const info = await getRequestInfo();
  return { ip: info.ip, device: describeUserAgent(info.userAgent).label };
}

/* ------------------------------------------------------------------ */
/* Email verification                                                   */
/* ------------------------------------------------------------------ */

export async function resendVerificationEmailAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (isEmailVerified(user)) return { ok: true, data: undefined, message: "Your email address is already confirmed." };
  const limit = authRateLimiter.hit(`verify-resend:${user.id}`, RATE_LIMITS.verificationResend);
  if (!limit.ok) return limited(limit, "verification emails");
  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.error("[security] could not queue verification email", err instanceof Error ? err.message : err);
    return { ok: false, error: "We couldn't send the email right now. Please try again in a few minutes." };
  }
  return { ok: true, data: undefined, message: `We sent a new confirmation link to ${user.email}. It expires in 24 hours.` };
}

/* ------------------------------------------------------------------ */
/* Two-step verification: setup                                          */
/* ------------------------------------------------------------------ */

export async function beginTwoFactorSetupAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const settings = await getSettings();
  if (!settings.security.allowTwoFactor) return { ok: false, error: "Two-step verification is turned off on this site." };
  if (isTwoFactorActive(user)) return { ok: false, error: "Two-step verification is already on." };
  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: "Confirm your email address before turning on two-step verification — it's how you'd recover your account." };

  const sealed = sealTotpSecret(newTotpSecret());
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (!row || row.twoFactorEnabled === true) return;
    row.twoFactorSecretEnc = sealed;
    row.twoFactorEnabled = false;
    delete row.twoFactorLastStep;
    delete row.recoveryCodeHashes;
  });
  revalidatePath(SECURITY_PATH);
  return { ok: true, data: undefined, message: "Scan the QR code with your authenticator app." };
}

export async function cancelTwoFactorSetupAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!hasPendingTwoFactorSetup(user)) return { ok: true, data: undefined, message: "Setup cancelled." };
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (!row || row.twoFactorEnabled === true) return;
    delete row.twoFactorSecretEnc;
    delete row.twoFactorLastStep;
    row.twoFactorEnabled = false;
  });
  revalidatePath(SECURITY_PATH);
  return { ok: true, data: undefined, message: "Setup cancelled." };
}

/**
 * Confirm the pending secret with a code from the app. Returns the recovery
 * codes (shown exactly once). The client refreshes the page when the member
 * has saved them, so this action does not revalidate.
 */
export async function confirmTwoFactorSetupAction(_prev: ActionResult<{ recoveryCodes: string[] }> | null, formData: FormData): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const settings = await getSettings();
  if (!settings.security.allowTwoFactor) return { ok: false, error: "Two-step verification is turned off on this site." };
  if (isTwoFactorActive(user)) return { ok: false, error: "Two-step verification is already on." };
  if (!hasPendingTwoFactorSetup(user)) return { ok: false, error: "Start the setup again — the setup key is missing." };

  const code = fd(formData, "code");
  if (!normalizeTotpInput(code)) return { ok: false, error: "Enter the 6-digit code shown in your authenticator app.", fieldErrors: { code: "Enter 6 digits" } };

  const limit = authRateLimiter.hit(`account-change:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return limited(limit);

  if (!openTotpSecret(user)) return { ok: false, error: "The setup key can't be read any more. Cancel and start the setup again." };
  const result = await consumeSecondFactor(user.id, { method: "totp", code }, { requireEnabled: false });
  if (!result.ok) {
    return {
      ok: false,
      error: "That code didn't match. Make sure you scanned the latest QR code and that your phone's clock is set automatically.",
      fieldErrors: { code: "Invalid code" },
    };
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodes.map(hashRecoveryCode);
  const enabled = await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (!row || !row.twoFactorSecretEnc || row.twoFactorEnabled === true) return false;
    row.twoFactorEnabled = true;
    row.recoveryCodeHashes = hashes;
    return true;
  });
  if (!enabled) return { ok: false, error: "Two-step verification was changed in another window. Reload the page and try again." };

  await revokeAuthTokens(user.id, "two_factor_login");
  await sendSecurityNotice(user, "two_factor_enabled", await requestContext());
  return { ok: true, data: { recoveryCodes }, message: "Two-step verification is on." };
}

/* ------------------------------------------------------------------ */
/* Two-step verification: manage                                        */
/* ------------------------------------------------------------------ */

export async function disableTwoFactorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!isTwoFactorActive(user)) return { ok: false, error: "Two-step verification is not on." };
  const settings = await getSettings();
  if (mustSetUpTwoFactor({ ...user, twoFactorEnabled: false }, settings.security)) {
    return { ok: false, error: "Your role requires two-step verification, so it can't be turned off." };
  }

  const limit = authRateLimiter.hit(`account-change:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return limited(limit);

  const password = fd(formData, "password");
  const input = readSecondFactorInput(formData);
  const errors: Errors = {};
  if (!password) errors.password = "Enter your password";
  if (!input.code) errors[input.method === "recovery" ? "recoveryCode" : "code"] = "Enter a code";
  if (Object.keys(errors).length) return { ok: false, error: "Enter your password and a verification code.", fieldErrors: errors };

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "Your password is incorrect.", fieldErrors: { password: "Incorrect password" } };
  }
  const result = await consumeSecondFactor(user.id, input);
  if (!result.ok) {
    const field = input.method === "recovery" ? "recoveryCode" : "code";
    return { ok: false, error: "That verification code didn't work.", fieldErrors: { [field]: "Invalid code" } };
  }

  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (!row) return;
    row.twoFactorEnabled = false;
    delete row.twoFactorSecretEnc;
    delete row.twoFactorLastStep;
    delete row.recoveryCodeHashes;
  });
  await revokeAuthTokens(user.id, "two_factor_login");
  await sendSecurityNotice(user, "two_factor_disabled", await requestContext());
  revalidatePath(SECURITY_PATH);
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: "Two-step verification is off." };
}

/** Replace the recovery codes (needs a current authenticator code). Returns the new codes once. */
export async function regenerateRecoveryCodesAction(
  _prev: ActionResult<{ recoveryCodes: string[] }> | null,
  formData: FormData,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!isTwoFactorActive(user)) return { ok: false, error: "Turn on two-step verification first." };

  const code = fd(formData, "code");
  if (!normalizeTotpInput(code)) return { ok: false, error: "Enter the 6-digit code from your authenticator app.", fieldErrors: { code: "Enter 6 digits" } };
  const limit = authRateLimiter.hit(`account-change:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return limited(limit);

  const result = await consumeSecondFactor(user.id, { method: "totp", code });
  if (!result.ok) return { ok: false, error: "That code didn't work. Try the newest code in your app.", fieldErrors: { code: "Invalid code" } };

  const recoveryCodes = generateRecoveryCodes();
  const hashes = recoveryCodes.map(hashRecoveryCode);
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (row) row.recoveryCodeHashes = hashes;
  });
  await sendSecurityNotice(user, "recovery_codes_regenerated", await requestContext());
  return { ok: true, data: { recoveryCodes }, message: "New recovery codes generated. Your old codes no longer work." };
}

/* ------------------------------------------------------------------ */
/* Admin: security settings                                             */
/* ------------------------------------------------------------------ */

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

const ADMIN_ONLY: ActionResult<never> = { ok: false, error: "Only administrators can do that." };

function intField(formData: FormData, key: string): number | null {
  const raw = fd(formData, key);
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export async function saveSecuritySettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return ADMIN_ONLY;

  const requireEmailVerification = fdBool(formData, "requireEmailVerification");
  const allowTwoFactor = fdBool(formData, "allowTwoFactor");
  const enforceTwoFactorForStaff = fdBool(formData, "enforceTwoFactorForStaff");
  const maxLoginAttempts = intField(formData, "maxLoginAttempts");
  const lockoutMinutes = intField(formData, "lockoutMinutes");
  const passwordMinLength = intField(formData, "passwordMinLength");

  const errors: Errors = {};
  if (maxLoginAttempts === null || maxLoginAttempts < 3 || maxLoginAttempts > 20) errors.maxLoginAttempts = "Enter a whole number from 3 to 20.";
  if (lockoutMinutes === null || lockoutMinutes < 1 || lockoutMinutes > 1440) errors.lockoutMinutes = "Enter a whole number of minutes from 1 to 1440 (24 hours).";
  if (passwordMinLength === null || passwordMinLength < PASSWORD_MIN_LENGTH_FLOOR || passwordMinLength > PASSWORD_MIN_LENGTH_CEILING) {
    errors.passwordMinLength = `Enter a whole number from ${PASSWORD_MIN_LENGTH_FLOOR} to ${PASSWORD_MIN_LENGTH_CEILING}.`;
  }
  if (enforceTwoFactorForStaff && !allowTwoFactor) errors.enforceTwoFactorForStaff = "Allow two-step verification to require it for staff.";
  else if (enforceTwoFactorForStaff && !isTwoFactorActive(admin)) {
    errors.enforceTwoFactorForStaff = "Turn on two-step verification for your own account first, so you aren't locked out of admin pages.";
  }
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };

  const next: Settings["security"] = {
    requireEmailVerification,
    allowTwoFactor,
    enforceTwoFactorForStaff,
    maxLoginAttempts: maxLoginAttempts!,
    lockoutMinutes: lockoutMinutes!,
    passwordMinLength: passwordMinLength!,
  };
  await mutate((db) => {
    db.settings.security = next;
    db.settings.updatedAt = new Date().toISOString();
  });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Security settings saved" };
}

/* ------------------------------------------------------------------ */
/* Admin: account tools                                                 */
/* ------------------------------------------------------------------ */

async function adminTarget(userId: string): Promise<{ admin: User; target: User } | ActionResult<never>> {
  const admin = await requireAdmin();
  if (!admin) return ADMIN_ONLY;
  if (typeof userId !== "string" || !userId) return { ok: false, error: "Member not found." };
  const db = await getDb();
  const target = db.users.find((u) => u.id === userId);
  if (!target) return { ok: false, error: "Member not found." };
  return { admin, target };
}

function revalidateAdmin() {
  revalidatePath("/admin/security");
  revalidatePath("/admin/settings/security");
}

export async function unlockAccountAction(userId: string): Promise<ActionResult> {
  const ctx = await adminTarget(userId);
  if ("ok" in ctx) return ctx;
  await unlockAccount(ctx.target.id);
  revalidateAdmin();
  return { ok: true, data: undefined, message: `${ctx.target.name} can sign in again.` };
}

export async function adminResetTwoFactorAction(userId: string): Promise<ActionResult> {
  const ctx = await adminTarget(userId);
  if ("ok" in ctx) return ctx;
  if (ctx.target.id === ctx.admin.id) return { ok: false, error: "Manage your own two-step verification from Settings → Security." };
  if (!ctx.target.twoFactorSecretEnc && !ctx.target.twoFactorEnabled) return { ok: false, error: `${ctx.target.name} doesn't use two-step verification.` };
  await mutate((db) => {
    const row = db.users.find((u) => u.id === ctx.target.id);
    if (!row) return;
    row.twoFactorEnabled = false;
    delete row.twoFactorSecretEnc;
    delete row.twoFactorLastStep;
    delete row.recoveryCodeHashes;
  });
  await revokeAuthTokens(ctx.target.id, "two_factor_login");
  await destroyAllSessions(ctx.target.id);
  await sendSecurityNotice(ctx.target, "two_factor_reset");
  revalidateAdmin();
  return { ok: true, data: undefined, message: `Two-step verification was reset for ${ctx.target.name}. They were signed out everywhere.` };
}

export async function adminMarkEmailVerifiedAction(userId: string): Promise<ActionResult> {
  const ctx = await adminTarget(userId);
  if ("ok" in ctx) return ctx;
  if (isEmailVerified(ctx.target) && ctx.target.emailVerifiedAt) return { ok: true, data: undefined, message: "This email address is already confirmed." };
  await markEmailVerified(ctx.target.id);
  revalidateAdmin();
  return { ok: true, data: undefined, message: `${ctx.target.email} is now marked as confirmed.` };
}

export async function adminSendPasswordResetAction(userId: string): Promise<ActionResult> {
  const ctx = await adminTarget(userId);
  if ("ok" in ctx) return ctx;
  if (!ctx.target.enabled) return { ok: false, error: "Enable this account before sending a reset link." };
  try {
    const { token } = await issueAuthToken(ctx.target.id, "password_reset");
    await sendPasswordResetEmail(ctx.target, token);
  } catch (err) {
    console.error("[security] could not queue reset email", err instanceof Error ? err.message : err);
    return { ok: false, error: "We couldn't send the email right now. Please try again." };
  }
  return { ok: true, data: undefined, message: `A password reset link was sent to ${ctx.target.email}.` };
}

export async function adminSignOutEverywhereAction(userId: string): Promise<ActionResult> {
  const ctx = await adminTarget(userId);
  if ("ok" in ctx) return ctx;
  if (ctx.target.id === ctx.admin.id) return { ok: false, error: "Use Settings → Security to sign yourself out of other devices." };
  await destroyAllSessions(ctx.target.id);
  await revokeAuthTokens(ctx.target.id, "two_factor_login");
  revalidateAdmin();
  return { ok: true, data: undefined, message: `${ctx.target.name} was signed out on every device.` };
}
