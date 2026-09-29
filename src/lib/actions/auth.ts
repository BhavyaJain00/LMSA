"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionResult, User } from "@/lib/types";
import { getSettings, insert, mutate } from "@/lib/db/store";
import { hashPassword, validatePasswordStrength, verifyPassword, verifyPasswordConstantTime } from "@/lib/auth/password";
import { createSession, destroyAllSessions, destroyOtherSessions, destroySession, getCurrentUser, touchActivity } from "@/lib/auth/session";
import { formatWait, isAccountLocked, isTwoFactorActive, lockRemainingMs, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { authRateLimiter, emailKey, RATE_LIMITS, unknownAccountLockouts, type RateLimitResult } from "@/lib/auth/rate-limit";
import { getRequestInfo, type RequestInfo } from "@/lib/auth/request-info";
import { recordLoginEvent } from "@/lib/auth/login-events";
import type { LoginEventReason } from "@/lib/auth/login-reasons";
import { clearLoginFailures, forgetAuthCounters, registerLoginFailure } from "@/lib/auth/lockout";
import { checkAuthToken, consumeAuthToken, issueAuthToken, revokeAuthToken, revokeAuthTokens } from "@/lib/auth/tokens";
import { sendPasswordResetEmail, sendSecurityNotice } from "@/lib/auth/emails";
import { sendEmailVerification } from "@/lib/auth/verification";
import {
  clearTwoFactorChallengeCookie,
  consumeSecondFactor,
  readSecondFactorInput,
  readTwoFactorChallengeCookie,
  setTwoFactorChallengeCookie,
} from "@/lib/auth/two-factor";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { getUserByEmail, getUserByUsername } from "@/lib/data/users";
import { evaluateBadges } from "@/lib/services/badges";
import { fd, isValidEmail, slugify, uid } from "@/lib/utils";
import { setFlash } from "@/lib/flash";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

function defaultHomeFor(user: User): string {
  if (user.roles.some((r) => r === "admin" || r === "moderator" || r === "course_creator")) return "/dashboard";
  return "/dashboard";
}

function lockedMessage(remainingMs: number): string {
  return `Too many failed sign-in attempts. For your security, sign-in is paused for ${formatWait(remainingMs)}. You can reset your password to get back in sooner.`;
}

function rateLimitedMessage(results: RateLimitResult[], what = "sign-in attempts"): string {
  const wait = Math.max(...results.filter((r) => !r.ok).map((r) => r.retryAfterMs), 1000);
  return `Too many ${what}. Please wait ${formatWait(wait)} and try again.`;
}

async function logEvent(reason: LoginEventReason, email: string, info: RequestInfo, userId?: string): Promise<void> {
  try {
    await recordLoginEvent({ reason, email, userId, ip: info.ip, userAgent: info.userAgent });
  } catch (err) {
    // History is best effort; never let it block or break a sign-in.
    console.error("[auth] could not record login event", err instanceof Error ? err.message : err);
  }
}

/** Where to send a user after they are signed in (staff without required 2FA go to setup first). */
async function destinationAfterSignIn(user: User, next: string): Promise<string> {
  const settings = await getSettings();
  if (mustSetUpTwoFactor(user, settings.security)) {
    const query = new URLSearchParams({ required: "2fa" });
    if (next !== "/") query.set("next", next);
    return `/settings/security?${query.toString()}`;
  }
  return next === "/" ? defaultHomeFor(user) : next;
}

/** Create the session and record the successful sign-in. Callers redirect afterwards. */
async function completeSignIn(user: User, reason: LoginEventReason, info: RequestInfo): Promise<void> {
  await clearLoginFailures(user.id);
  forgetAuthCounters(user.email, user.id);
  await createSession(user.id);
  await touchActivity(user.id);
  await logEvent(reason, user.email, info, user.id);
}

/** Start the second step for a 2FA account: short-lived challenge token in an httpOnly cookie. */
async function startTwoFactorChallenge(user: User, info: RequestInfo, next: string): Promise<never> {
  const { token } = await issueAuthToken(user.id, "two_factor_login");
  await setTwoFactorChallengeCookie(token);
  await logEvent("2fa_challenge", user.email, info, user.id);
  redirect(next !== "/" ? `/two-factor?next=${encodeURIComponent(next)}` : "/two-factor");
}

/* ------------------------------------------------------------------ */
/* Log in                                                               */
/* ------------------------------------------------------------------ */

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = safeNext(fd(formData, "next"));

  if (!email || !password) return { ok: false, error: "Please enter your email and password." };
  const info = await getRequestInfo();
  const key = emailKey(email);

  const limits = [
    authRateLimiter.hit(`login:ip:${info.ip}`, RATE_LIMITS.loginIp),
    authRateLimiter.hit(`login:acct:${key}|${info.ip}`, RATE_LIMITS.loginAccount),
    authRateLimiter.hit(`login:email:${key}`, RATE_LIMITS.loginEmail),
  ];
  const user = await getUserByEmail(email);
  if (limits.some((r) => !r.ok)) {
    await logEvent("rate_limited", email, info, user?.id);
    return { ok: false, error: rateLimitedMessage(limits) };
  }

  const settings = await getSettings();
  const lockMs = Math.max(1, settings.security.lockoutMinutes) * 60 * 1000;

  if (!user) {
    // Same work, same messages and the same lockout behaviour as a real account.
    const phantom = unknownAccountLockouts.status(key);
    if (phantom.locked && phantom.lockedUntil) {
      await logEvent("locked", email, info);
      return { ok: false, error: lockedMessage(phantom.lockedUntil - Date.now()) };
    }
    await verifyPasswordConstantTime(password, null);
    const outcome = unknownAccountLockouts.fail(key, settings.security.maxLoginAttempts, lockMs);
    await logEvent("unknown_email", email, info);
    if (outcome.locked && outcome.lockedUntil) return { ok: false, error: lockedMessage(outcome.lockedUntil - Date.now()) };
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  if (isAccountLocked(user)) {
    await logEvent("locked", email, info, user.id);
    return { ok: false, error: lockedMessage(lockRemainingMs(user)) };
  }

  if (!(await verifyPasswordConstantTime(password, user.passwordHash))) {
    const outcome = await registerLoginFailure(user.id, settings.security);
    await logEvent(outcome.locked ? "lockout" : "bad_password", email, info, user.id);
    if (outcome.locked && outcome.lockedUntil) return { ok: false, error: lockedMessage(new Date(outcome.lockedUntil).getTime() - Date.now()) };
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  if (!user.enabled) {
    await logEvent("disabled", email, info, user.id);
    return { ok: false, error: "This account has been disabled. Contact support." };
  }

  if (isTwoFactorActive(user)) await startTwoFactorChallenge(user, info, next);

  await completeSignIn(user, "ok", info);
  redirect(await destinationAfterSignIn(user, next));
}

/* ------------------------------------------------------------------ */
/* Second step (TOTP / recovery code)                                   */
/* ------------------------------------------------------------------ */

export async function verifyTwoFactorLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = safeNext(fd(formData, "next"));
  const raw = await readTwoFactorChallengeCookie();
  const check = await checkAuthToken(raw, "two_factor_login");
  if (check.status !== "valid") {
    await clearTwoFactorChallengeCookie();
    return { ok: false, error: "Your sign-in attempt expired. Please log in again.", fieldErrors: { session: "expired" } };
  }
  const { user } = check;
  const info = await getRequestInfo();

  if (isAccountLocked(user)) {
    await revokeAuthToken(raw, "two_factor_login");
    await clearTwoFactorChallengeCookie();
    await logEvent("locked", user.email, info, user.id);
    return { ok: false, error: lockedMessage(lockRemainingMs(user)), fieldErrors: { session: "expired" } };
  }

  const input = readSecondFactorInput(formData);
  if (!input.code) {
    return {
      ok: false,
      error: input.method === "recovery" ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app.",
      fieldErrors: { [input.method === "recovery" ? "recoveryCode" : "code"]: "Required" },
    };
  }

  const limits = [
    authRateLimiter.hit(`2fa:${user.id}|${info.ip}`, RATE_LIMITS.twoFactor),
    authRateLimiter.hit(`2fa-challenge:${check.token.id}`, RATE_LIMITS.twoFactorChallenge),
  ];
  if (!limits[0]!.ok) {
    await logEvent("rate_limited", user.email, info, user.id);
    return { ok: false, error: rateLimitedMessage([limits[0]!], "verification attempts") };
  }
  if (!limits[1]!.ok) {
    await revokeAuthToken(raw, "two_factor_login");
    await clearTwoFactorChallengeCookie();
    await logEvent("rate_limited", user.email, info, user.id);
    return { ok: false, error: "Too many incorrect codes. Please log in again.", fieldErrors: { session: "expired" } };
  }

  const result = await consumeSecondFactor(user.id, input);
  if (!result.ok) {
    const settings = await getSettings();
    const outcome = await registerLoginFailure(user.id, settings.security);
    await logEvent(outcome.locked ? "2fa_lockout" : "2fa_failed", user.email, info, user.id);
    if (outcome.locked && outcome.lockedUntil) {
      await revokeAuthToken(raw, "two_factor_login");
      await clearTwoFactorChallengeCookie();
      return { ok: false, error: lockedMessage(new Date(outcome.lockedUntil).getTime() - Date.now()), fieldErrors: { session: "expired" } };
    }
    if (limits[1]!.remaining === 0) {
      // That was the last code this challenge accepts.
      await revokeAuthToken(raw, "two_factor_login");
      await clearTwoFactorChallengeCookie();
      return { ok: false, error: "Too many incorrect codes. Please log in again.", fieldErrors: { session: "expired" } };
    }
    if (result.reason === "unreadable_secret") {
      return { ok: false, error: "Two-step verification can't be checked for this account right now. Use a recovery code or contact an administrator." };
    }
    return input.method === "recovery"
      ? { ok: false, error: "That recovery code isn't valid or was already used.", fieldErrors: { recoveryCode: "Invalid code" } }
      : { ok: false, error: "That code didn't work. Check the time on your phone and try the newest code.", fieldErrors: { code: "Invalid code" } };
  }

  // The challenge is single use: if another request consumed it first, stop here.
  const consumed = await consumeAuthToken(raw, "two_factor_login");
  await clearTwoFactorChallengeCookie();
  if (!consumed) return { ok: false, error: "Your sign-in attempt expired. Please log in again.", fieldErrors: { session: "expired" } };

  await completeSignIn(user, result.method === "recovery" ? "recovery_code" : "2fa_ok", info);
  if (result.method === "recovery") {
    await setFlash(
      result.remaining > 0
        ? `Signed in with a recovery code. You have ${result.remaining} left — generate new ones in Settings → Security if you're running low.`
        : "Signed in with your last recovery code. Generate new codes in Settings → Security now.",
      result.remaining > 2 ? "info" : "warning",
    );
  }
  redirect(await destinationAfterSignIn(user, next));
}

/** Abandon the second step and go back to the password form. */
export async function cancelTwoFactorLoginAction(): Promise<void> {
  const raw = await readTwoFactorChallengeCookie();
  if (raw) await revokeAuthToken(raw, "two_factor_login");
  await clearTwoFactorChallengeCookie();
  redirect("/login");
}

/* ------------------------------------------------------------------ */
/* Register                                                             */
/* ------------------------------------------------------------------ */

export async function registerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const settings = await getSettings();
  if (settings.learning.disableSignup) return { ok: false, error: "Sign up is disabled. Ask an administrator for an account." };

  const name = fd(formData, "name");
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = safeNext(fd(formData, "next"));

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Please enter your full name.";
  else if (name.length > 120) fieldErrors.name = "Please keep your name under 120 characters.";
  if (!isValidEmail(email) || email.length > 254) fieldErrors.email = "Please enter a valid email address.";
  const pwErr = validatePasswordStrength(password, settings.security.passwordMinLength);
  if (pwErr) fieldErrors.password = pwErr;
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the errors below.", fieldErrors };

  const info = await getRequestInfo();
  const limit = authRateLimiter.hit(`register:ip:${info.ip}`, RATE_LIMITS.registerIp);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage([limit], "sign-ups from this network") };

  if (await getUserByEmail(email)) return { ok: false, error: "An account with this email already exists.", fieldErrors: { email: "Already registered" } };

  // Derive a unique username from the email local part.
  let username = slugify(email.split("@")[0] ?? name) || "user";
  let suffix = 1;
  while (await getUserByUsername(username)) username = `${slugify(email.split("@")[0] ?? name)}-${++suffix}`;

  const now = new Date().toISOString();
  const user: User = {
    id: uid("usr"),
    username,
    name,
    email,
    passwordHash: await hashPassword(password),
    roles: ["student"],
    enabled: true,
    personaCaptured: false,
    emailVerificationRequired: true,
    createdAt: now,
    lastActiveAt: now,
  };
  await insert("users", user);

  let emailSent = true;
  try {
    await sendEmailVerification(user);
  } catch (err) {
    emailSent = false;
    console.error("[auth] could not queue the verification email", err instanceof Error ? err.message : err);
  }

  await createSession(user.id);
  await touchActivity(user.id);
  await logEvent("signup", user.email, info, user.id);
  await evaluateBadges(user.id, "manual");
  const first = user.name.split(" ")[0];
  await setFlash(
    emailSent
      ? `Welcome to ${settings.brand.name}, ${first}! We sent a confirmation link to ${user.email}.`
      : `Welcome to ${settings.brand.name}, ${first}! Confirm your email from Settings → Security.`,
  );
  redirect(next === "/" ? "/persona" : next);
}

/* ------------------------------------------------------------------ */
/* Log out                                                              */
/* ------------------------------------------------------------------ */

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/* ------------------------------------------------------------------ */
/* Change password (signed in)                                          */
/* ------------------------------------------------------------------ */

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const current = fd(formData, "current");
  const next = fd(formData, "password");
  const confirm = fd(formData, "confirm");

  const limit = authRateLimiter.hit(`account-change:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage([limit], "attempts") };

  if (!current || !(await verifyPassword(current, user.passwordHash))) {
    return { ok: false, error: "Current password is incorrect.", fieldErrors: { current: "Incorrect" } };
  }
  const settings = await getSettings();
  const pwErr = validatePasswordStrength(next, settings.security.passwordMinLength);
  if (pwErr) return { ok: false, error: pwErr, fieldErrors: { password: pwErr } };
  if (next !== confirm) return { ok: false, error: "Passwords do not match.", fieldErrors: { confirm: "Does not match" } };
  if (await verifyPassword(next, user.passwordHash)) {
    return { ok: false, error: "Choose a password that's different from your current one.", fieldErrors: { password: "Same as current password" } };
  }

  const passwordHash = await hashPassword(next);
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (row) row.passwordHash = passwordHash;
  });
  // Outstanding reset links were issued for the old password.
  await revokeAuthTokens(user.id, "password_reset");
  const removed = await destroyOtherSessions(user.id);
  const info = await getRequestInfo();
  await sendSecurityNotice(user, "password_changed", { ip: info.ip, device: describeUserAgent(info.userAgent).label });
  revalidatePath("/settings");
  revalidatePath("/settings/security");
  return {
    ok: true,
    data: undefined,
    message: removed ? `Password updated. You were signed out on ${removed} other ${removed === 1 ? "device" : "devices"}.` : "Password updated.",
  };
}

/* ------------------------------------------------------------------ */
/* Forgot / reset password                                              */
/* ------------------------------------------------------------------ */

export async function forgotPasswordAction(_prev: ActionResult<{ email: string }> | null, formData: FormData): Promise<ActionResult<{ email: string }>> {
  const email = fd(formData, "email").toLowerCase();
  if (!isValidEmail(email) || email.length > 254) {
    return { ok: false, error: "Please enter a valid email address.", fieldErrors: { email: "Enter a valid email address" } };
  }
  const info = await getRequestInfo();
  const limits = [
    authRateLimiter.hit(`forgot:email:${emailKey(email)}`, RATE_LIMITS.forgotEmail),
    authRateLimiter.hit(`forgot:ip:${info.ip}`, RATE_LIMITS.forgotIp),
  ];
  if (limits.some((r) => !r.ok)) return { ok: false, error: rateLimitedMessage(limits, "reset requests") };

  // Look up and send after the response, so timing is identical whether or not the account exists.
  after(async () => {
    try {
      const user = await getUserByEmail(email);
      if (!user || !user.enabled) return;
      const { token } = await issueAuthToken(user.id, "password_reset");
      await sendPasswordResetEmail(user, token, { ip: info.ip });
    } catch (err) {
      console.error("[auth] password reset email failed", err instanceof Error ? err.message : err);
    }
  });

  return {
    ok: true,
    data: { email },
    message: `If an account exists for ${email}, we've sent a link to reset the password. It expires in 1 hour.`,
  };
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const raw = fd(formData, "token");
  const password = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  const info = await getRequestInfo();

  const limit = authRateLimiter.hit(`reset:ip:${info.ip}`, RATE_LIMITS.resetIp);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage([limit], "attempts") };

  const INVALID_LINK = "This reset link is invalid or has expired. Request a new one.";
  const check = await checkAuthToken(raw, "password_reset");
  if (check.status !== "valid") return { ok: false, error: INVALID_LINK, fieldErrors: { token: check.status } };

  const settings = await getSettings();
  const pwErr = validatePasswordStrength(password, settings.security.passwordMinLength);
  if (pwErr) return { ok: false, error: pwErr, fieldErrors: { password: pwErr } };
  if (password !== confirm) return { ok: false, error: "Passwords do not match.", fieldErrors: { confirm: "Does not match" } };

  const passwordHash = await hashPassword(password);
  const consumed = await consumeAuthToken(raw, "password_reset");
  if (!consumed) return { ok: false, error: INVALID_LINK, fieldErrors: { token: "used" } };

  const now = new Date().toISOString();
  const user = await mutate((db) => {
    const row = db.users.find((u) => u.id === consumed.user.id);
    if (!row) return null;
    row.passwordHash = passwordHash;
    row.failedLoginCount = 0;
    delete row.lockedUntil;
    // Following the emailed link proves the member controls the inbox.
    if (row.emailVerificationRequired && !row.emailVerifiedAt) row.emailVerifiedAt = now;
    return row;
  });
  if (!user) return { ok: false, error: INVALID_LINK };

  await revokeAuthTokens(user.id, "password_reset");
  await destroyAllSessions(user.id);
  forgetAuthCounters(user.email, user.id);
  await sendSecurityNotice(user, "password_changed", { ip: info.ip, device: describeUserAgent(info.userAgent).label });

  if (!user.enabled) redirect("/login");

  // Resetting the password must not bypass two-step verification.
  if (isTwoFactorActive(user)) {
    await setFlash("Your password was reset. Enter a verification code to finish signing in.", "success");
    await startTwoFactorChallenge(user, info, "/");
  }

  await completeSignIn(user, "password_reset", info);
  await setFlash("Your password was reset and you're signed in.", "success");
  redirect(await destinationAfterSignIn(user, "/"));
}
