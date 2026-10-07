"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionResult, Settings, User } from "@/lib/types";
import { getSettings, mutate } from "@/lib/db/store";
import { hashPassword, verifyPassword, verifyPasswordConstantTime } from "@/lib/auth/password";
import { createSession, destroyAllSessions, destroyOtherSessions, destroySession, getCurrentUser, touchActivity } from "@/lib/auth/session";
import { isTwoFactorActive, mustSetUpTwoFactor } from "@/lib/auth/account-status";
import { lockedText, passwordPolicyText, rateLimitedText, type AuthTranslator, type RateLimitedAction } from "@/lib/auth/auth-messages";
import { authRateLimiter, emailKey, loginAttemptLock, perIpLimit, RATE_LIMITS, type RateLimitResult } from "@/lib/auth/rate-limit";
import { getRequestInfo, type RequestInfo } from "@/lib/auth/request-info";
import { recordLoginEvent } from "@/lib/auth/login-events";
import type { LoginEventReason } from "@/lib/auth/login-reasons";
import { clearLoginFailures, forgetAuthCounters } from "@/lib/auth/lockout";
import { getLoginThrottleStatus, recordLoginFailure } from "@/lib/auth/login-throttle";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { checkAuthToken, consumeAuthToken, issueAuthToken, revokeAuthToken, revokeAuthTokens } from "@/lib/auth/tokens";
import { sendPasswordResetEmail, sendSecurityNotice } from "@/lib/auth/emails";
import { sendEmailVerification } from "@/lib/auth/verification";
import {
  clearTwoFactorChallengeCookie,
  consumeSecondFactor,
  readSecondFactorInput,
  readTwoFactorChallengeCookie,
  setTwoFactorChallengeCookie,
  type SecondFactorResult,
} from "@/lib/auth/two-factor";
import { describeUserAgent } from "@/lib/auth/user-agent";
import { getUserByEmail } from "@/lib/data/users";
import { evaluateBadges } from "@/lib/services/badges";
import { emit } from "@/lib/events";
import { fd, isValidEmail, slugify, uid } from "@/lib/utils";
import { setFlash } from "@/lib/flash";
import { getT } from "@/i18n/server";
import { isLocale } from "@/i18n/config";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const NAME_MAX_LENGTH = 120;

/** The posted `next` as a safe same-origin path ("/" when missing or unsafe). */
function nextFrom(formData: FormData): string {
  return safeRedirectPath(fd(formData, "next"), "/");
}

function defaultHomeFor(user: User): string {
  if (user.roles.some((r) => r === "admin" || r === "moderator" || r === "course_creator")) return "/dashboard";
  return "/dashboard";
}

/**
 * The translator for a flash shown after sign-in. The next page renders in the account's saved
 * language (it wins over the cookie), so the toast must use it too.
 */
async function signedInT(user: User, fallback: AuthTranslator): Promise<AuthTranslator> {
  return isLocale(user.locale) && user.locale !== fallback.locale ? getT("auth", user.locale) : fallback;
}

/** Messages below are worded in the reader's language (`auth` namespace, English fallback). */
function rateLimitedMessage(t: AuthTranslator, results: RateLimitResult[], what: RateLimitedAction): string {
  return rateLimitedText(t, results.filter((r) => !r.ok).map((r) => r.retryAfterMs), what);
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

function remainingUntil(epochMs: number | string | null | undefined): number {
  if (epochMs === null || epochMs === undefined) return 0;
  const at = typeof epochMs === "number" ? epochMs : Date.parse(epochMs);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

/* ------------------------------------------------------------------ */
/* Log in                                                               */
/* ------------------------------------------------------------------ */

type PasswordStep =
  | { kind: "locked"; user: User | null; remainingMs: number }
  | { kind: "failed"; user: User | null; locked: boolean; remainingMs: number }
  | { kind: "disabled"; user: User }
  | { kind: "two_factor"; user: User }
  | { kind: "ok"; user: User };

/**
 * Check the lock, verify the password and record the outcome as one step per
 * email address (`loginAttemptLock`), so parallel requests see each other's
 * failures and can't get more than `maxLoginAttempts` guesses. Unknown and
 * registered addresses go through exactly the same throttle.
 */
async function passwordStep(email: string, password: string, security: Settings["security"]): Promise<PasswordStep> {
  return loginAttemptLock.run(emailKey(email), async (): Promise<PasswordStep> => {
    const [status, user] = await Promise.all([getLoginThrottleStatus(email), getUserByEmail(email)]);
    if (status.locked) return { kind: "locked", user, remainingMs: remainingUntil(status.lockedUntil) };

    // Unknown emails burn the same scrypt work as real ones.
    const ok = await verifyPasswordConstantTime(password, user?.passwordHash);
    if (!ok || !user) {
      const outcome = await recordLoginFailure(email, security);
      return { kind: "failed", user, locked: outcome.locked, remainingMs: remainingUntil(outcome.lockedUntil) };
    }
    if (!user.enabled) return { kind: "disabled", user };
    // The failure counter is only cleared once sign-in is complete (after the second factor for 2FA accounts).
    if (isTwoFactorActive(user)) return { kind: "two_factor", user };
    await clearLoginFailures(user.id);
    return { kind: "ok", user };
  });
}

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = nextFrom(formData);
  const t = await getT("auth");

  if (!email || !password) return { ok: false, error: t("errors.missingCredentials") };
  const info = await getRequestInfo();
  const key = emailKey(email);

  // The per-IP (or shared, when the IP isn't trusted) limit goes first: a blocked client creates no further limiter keys.
  const ipLimit = perIpLimit("login:ip", info.ip, RATE_LIMITS.loginIp, RATE_LIMITS.loginIpShared);
  const byIp = authRateLimiter.hit(ipLimit.key, ipLimit.rule);
  const limits = byIp.ok
    ? [byIp, authRateLimiter.hit(`login:acct:${key}|${info.ip}`, RATE_LIMITS.loginAccount), authRateLimiter.hit(`login:email:${key}`, RATE_LIMITS.loginEmail)]
    : [byIp];
  if (limits.some((r) => !r.ok)) {
    const user = await getUserByEmail(email);
    await logEvent("rate_limited", email, info, user?.id);
    return { ok: false, error: rateLimitedMessage(t, limits, "signIn") };
  }

  const settings = await getSettings();
  const step = await passwordStep(email, password, settings.security);

  switch (step.kind) {
    case "locked":
      await logEvent("locked", email, info, step.user?.id);
      return { ok: false, error: lockedText(t, step.remainingMs) };
    case "failed":
      await logEvent(!step.user ? "unknown_email" : step.locked ? "lockout" : "bad_password", email, info, step.user?.id);
      return { ok: false, error: step.locked ? lockedText(t, step.remainingMs) : t("errors.invalidCredentials") };
    case "disabled":
      await logEvent("disabled", email, info, step.user.id);
      return { ok: false, error: t("errors.accountDisabled") };
    case "two_factor":
      return startTwoFactorChallenge(step.user, info, next);
    case "ok":
      await completeSignIn(step.user, "ok", info);
      redirect(await destinationAfterSignIn(step.user, next));
  }
}

/* ------------------------------------------------------------------ */
/* Second step (TOTP / recovery code)                                   */
/* ------------------------------------------------------------------ */

type SecondStep =
  | { kind: "locked"; remainingMs: number }
  | { kind: "failed"; result: Extract<SecondFactorResult, { ok: false }>; locked: boolean; remainingMs: number }
  | { kind: "expired" }
  | { kind: "ok"; result: Extract<SecondFactorResult, { ok: true }> };

export async function verifyTwoFactorLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = nextFrom(formData);
  const t = await getT("auth");
  const raw = await readTwoFactorChallengeCookie();
  const check = await checkAuthToken(raw, "two_factor_login");
  if (check.status !== "valid") {
    await clearTwoFactorChallengeCookie();
    return { ok: false, error: t("errors.challengeExpired"), fieldErrors: { session: "expired" } };
  }
  const { user } = check;
  const info = await getRequestInfo();

  const input = readSecondFactorInput(formData);
  if (!input.code) {
    return {
      ok: false,
      error: input.method === "recovery" ? t("errors.enterRecoveryCode") : t("errors.enterCode"),
      fieldErrors: { [input.method === "recovery" ? "recoveryCode" : "code"]: t("fieldErrors.required") },
    };
  }

  const limits = [
    authRateLimiter.hit(`2fa:${user.id}|${info.ip}`, RATE_LIMITS.twoFactor),
    authRateLimiter.hit(`2fa-challenge:${check.token.id}`, RATE_LIMITS.twoFactorChallenge),
  ];
  if (!limits[0]!.ok) {
    await logEvent("rate_limited", user.email, info, user.id);
    return { ok: false, error: rateLimitedMessage(t, [limits[0]!], "verification") };
  }
  if (!limits[1]!.ok) {
    await revokeAuthToken(raw, "two_factor_login");
    await clearTwoFactorChallengeCookie();
    await logEvent("rate_limited", user.email, info, user.id);
    return { ok: false, error: t("errors.tooManyCodes"), fieldErrors: { session: "expired" } };
  }

  // Same per-address serialization as the password step: lock check, code check and failure count happen together.
  const settings = await getSettings();
  const step = await loginAttemptLock.run(emailKey(user.email), async (): Promise<SecondStep> => {
    const status = await getLoginThrottleStatus(user.email);
    if (status.locked) return { kind: "locked", remainingMs: remainingUntil(status.lockedUntil) };
    const result = await consumeSecondFactor(user.id, input);
    if (!result.ok) {
      const outcome = await recordLoginFailure(user.email, settings.security);
      return { kind: "failed", result, locked: outcome.locked, remainingMs: remainingUntil(outcome.lockedUntil) };
    }
    // The challenge is single use: if another request consumed it first, stop here.
    const consumed = await consumeAuthToken(raw, "two_factor_login");
    if (!consumed) return { kind: "expired" };
    await clearLoginFailures(user.id);
    return { kind: "ok", result };
  });

  if (step.kind === "locked") {
    await revokeAuthToken(raw, "two_factor_login");
    await clearTwoFactorChallengeCookie();
    await logEvent("locked", user.email, info, user.id);
    return { ok: false, error: lockedText(t, step.remainingMs), fieldErrors: { session: "expired" } };
  }
  if (step.kind === "expired") {
    await clearTwoFactorChallengeCookie();
    return { ok: false, error: t("errors.challengeExpired"), fieldErrors: { session: "expired" } };
  }
  if (step.kind === "failed") {
    await logEvent(step.locked ? "2fa_lockout" : "2fa_failed", user.email, info, user.id);
    if (step.locked) {
      await revokeAuthToken(raw, "two_factor_login");
      await clearTwoFactorChallengeCookie();
      return { ok: false, error: lockedText(t, step.remainingMs), fieldErrors: { session: "expired" } };
    }
    if (limits[1]!.remaining === 0) {
      // That was the last code this challenge accepts.
      await revokeAuthToken(raw, "two_factor_login");
      await clearTwoFactorChallengeCookie();
      return { ok: false, error: t("errors.tooManyCodes"), fieldErrors: { session: "expired" } };
    }
    if (step.result.reason === "unreadable_secret") {
      return { ok: false, error: t("errors.secretUnreadable") };
    }
    return input.method === "recovery"
      ? { ok: false, error: t("errors.recoveryCodeInvalid"), fieldErrors: { recoveryCode: t("fieldErrors.invalidCode") } }
      : { ok: false, error: t("errors.codeInvalid"), fieldErrors: { code: t("fieldErrors.invalidCode") } };
  }

  const { result } = step;
  await clearTwoFactorChallengeCookie();
  await completeSignIn(user, result.method === "recovery" ? "recovery_code" : "2fa_ok", info);
  if (result.method === "recovery") {
    const ft = await signedInT(user, t);
    await setFlash(
      result.remaining > 0 ? ft("flash.recoveryCodeUsed", { count: result.remaining }) : ft("flash.lastRecoveryCode"),
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
  const [settings, t] = await Promise.all([getSettings(), getT("auth")]);
  if (settings.learning.disableSignup) return { ok: false, error: t("errors.signupDisabled") };

  const name = fd(formData, "name");
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = nextFrom(formData);

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = t("errors.nameRequired");
  else if (name.length > NAME_MAX_LENGTH) fieldErrors.name = t("errors.nameTooLong", { max: NAME_MAX_LENGTH });
  if (!isValidEmail(email) || email.length > 254) fieldErrors.email = t("errors.emailInvalid");
  const pwErr = passwordPolicyText(t, password, settings.security.passwordMinLength);
  if (pwErr) fieldErrors.password = pwErr;
  if (Object.keys(fieldErrors).length) return { ok: false, error: t("errors.fixBelow"), fieldErrors };

  const info = await getRequestInfo();
  const ipLimit = perIpLimit("register:ip", info.ip, RATE_LIMITS.registerIp, RATE_LIMITS.registerIpShared);
  const limit = authRateLimiter.hit(ipLimit.key, ipLimit.rule);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage(t, [limit], "signUp") };

  const DUPLICATE: ActionResult = { ok: false, error: t("errors.emailTaken"), fieldErrors: { email: t("fieldErrors.alreadyRegistered") } };
  if (await getUserByEmail(email)) return DUPLICATE;

  const passwordHash = await hashPassword(password);
  const base = slugify(email.split("@")[0] ?? name) || "user";
  const now = new Date().toISOString();

  // Uniqueness of the email (and a free username) is decided in the same serialized write as the insert,
  // so two concurrent sign-ups can't both create an account for one address.
  const user = await mutate((db): User | null => {
    if (db.users.some((u) => u.email.toLowerCase() === email)) return null;
    const taken = new Set(db.users.map((u) => u.username.toLowerCase()));
    let username = base;
    for (let suffix = 2; taken.has(username); suffix++) username = `${base}-${suffix}`;
    const row: User = {
      id: uid("usr"),
      username,
      name,
      email,
      passwordHash,
      roles: ["student"],
      enabled: true,
      personaCaptured: false,
      emailVerificationRequired: true,
      createdAt: now,
      lastActiveAt: now,
    };
    db.users.push(row);
    return row;
  });
  if (!user) return DUPLICATE;
  emit("user.registered", { userId: user.id, email: user.email, name: user.name, source: "signup" });

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
  const vars = { brand: settings.brand.name, name: user.name.split(" ")[0] ?? user.name, email: user.email };
  await setFlash(emailSent ? t("flash.welcomeConfirmSent", vars) : t("flash.welcomeConfirmLater", vars));
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
  const [user, t] = await Promise.all([getCurrentUser(), getT("auth")]);
  if (!user) return { ok: false, error: t("errors.notSignedIn") };
  const current = fd(formData, "current");
  const next = fd(formData, "password");
  const confirm = fd(formData, "confirm");

  const limit = authRateLimiter.hit(`account-change:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage(t, [limit], "attempts") };

  if (!current || !(await verifyPassword(current, user.passwordHash))) {
    return { ok: false, error: t("errors.currentPasswordIncorrect"), fieldErrors: { current: t("fieldErrors.incorrect") } };
  }
  const settings = await getSettings();
  const pwErr = passwordPolicyText(t, next, settings.security.passwordMinLength);
  if (pwErr) return { ok: false, error: pwErr, fieldErrors: { password: pwErr } };
  if (next !== confirm) return { ok: false, error: t("errors.passwordMismatch"), fieldErrors: { confirm: t("fieldErrors.mismatch") } };
  if (await verifyPassword(next, user.passwordHash)) {
    return { ok: false, error: t("errors.passwordUnchanged"), fieldErrors: { password: t("fieldErrors.samePassword") } };
  }

  const passwordHash = await hashPassword(next);
  await mutate((db) => {
    const row = db.users.find((u) => u.id === user.id);
    if (row) row.passwordHash = passwordHash;
  });
  // Outstanding reset links and half-finished sign-ins were issued for the old password.
  await revokeAuthTokens(user.id, "password_reset");
  await revokeAuthTokens(user.id, "two_factor_login");
  const removed = await destroyOtherSessions(user.id);
  const info = await getRequestInfo();
  await sendSecurityNotice(user, "password_changed", { ip: info.ip, device: describeUserAgent(info.userAgent).label });
  revalidatePath("/settings");
  revalidatePath("/settings/security");
  return {
    ok: true,
    data: undefined,
    message: removed ? t("notices.passwordUpdatedSignedOut", { count: removed }) : t("notices.passwordUpdated"),
  };
}

/* ------------------------------------------------------------------ */
/* Forgot / reset password                                              */
/* ------------------------------------------------------------------ */

export async function forgotPasswordAction(_prev: ActionResult<{ email: string }> | null, formData: FormData): Promise<ActionResult<{ email: string }>> {
  const email = fd(formData, "email").toLowerCase();
  const t = await getT("auth");
  if (!isValidEmail(email) || email.length > 254) {
    return { ok: false, error: t("errors.emailInvalid"), fieldErrors: { email: t("fieldErrors.emailInvalid") } };
  }
  const info = await getRequestInfo();
  const ipLimit = perIpLimit("forgot:ip", info.ip, RATE_LIMITS.forgotIp, RATE_LIMITS.forgotIpShared);
  const byIp = authRateLimiter.hit(ipLimit.key, ipLimit.rule);
  const limits = byIp.ok ? [byIp, authRateLimiter.hit(`forgot:email:${emailKey(email)}`, RATE_LIMITS.forgotEmail)] : [byIp];
  if (limits.some((r) => !r.ok)) return { ok: false, error: rateLimitedMessage(t, limits, "reset") };

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
    message: t("notices.resetSent", { email }),
  };
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const raw = fd(formData, "token");
  const password = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  const [info, t] = await Promise.all([getRequestInfo(), getT("auth")]);

  const ipLimit = perIpLimit("reset:ip", info.ip, RATE_LIMITS.resetIp, RATE_LIMITS.resetIpShared);
  const limit = authRateLimiter.hit(ipLimit.key, ipLimit.rule);
  if (!limit.ok) return { ok: false, error: rateLimitedMessage(t, [limit], "attempts") };

  // `fieldErrors.token` carries the token status (a code the form checks), not display text.
  const INVALID_LINK = t("errors.resetLinkInvalid");
  const check = await checkAuthToken(raw, "password_reset");
  if (check.status !== "valid") return { ok: false, error: INVALID_LINK, fieldErrors: { token: check.status } };

  const settings = await getSettings();
  const pwErr = passwordPolicyText(t, password, settings.security.passwordMinLength);
  if (pwErr) return { ok: false, error: pwErr, fieldErrors: { password: pwErr } };
  if (password !== confirm) return { ok: false, error: t("errors.passwordMismatch"), fieldErrors: { confirm: t("fieldErrors.mismatch") } };

  const passwordHash = await hashPassword(password);
  const consumed = await consumeAuthToken(raw, "password_reset");
  if (!consumed) return { ok: false, error: INVALID_LINK, fieldErrors: { token: "used" } };

  const now = new Date().toISOString();
  const user = await mutate((db) => {
    const row = db.users.find((u) => u.id === consumed.user.id);
    if (!row) return null;
    row.passwordHash = passwordHash;
    // Following the emailed link proves the member controls the inbox.
    if (row.emailVerificationRequired && !row.emailVerifiedAt) row.emailVerifiedAt = now;
    return row;
  });
  if (!user) return { ok: false, error: INVALID_LINK };

  // The lock and failure counter end with the reset; so does everything issued for the old password.
  await clearLoginFailures(user.id);
  await revokeAuthTokens(user.id, "password_reset");
  await revokeAuthTokens(user.id, "two_factor_login");
  await destroyAllSessions(user.id);
  forgetAuthCounters(user.email, user.id);
  await sendSecurityNotice(user, "password_changed", { ip: info.ip, device: describeUserAgent(info.userAgent).label });

  if (!user.enabled) redirect("/login");

  // Resetting the password must not bypass two-step verification.
  if (isTwoFactorActive(user)) {
    await setFlash(t("flash.resetNeedsCode"), "success");
    await startTwoFactorChallenge(user, info, "/");
  }

  await completeSignIn(user, "password_reset", info);
  await setFlash((await signedInT(user, t))("flash.resetSignedIn"), "success");
  redirect(await destinationAfterSignIn(user, "/"));
}
