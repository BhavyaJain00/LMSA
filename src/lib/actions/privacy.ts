"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, DataRequest, User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { getDb, mutate } from "@/lib/db/store";
import { destroySession, getCurrentUser, isAdmin } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { formatWait, isTwoFactorActive } from "@/lib/auth/account-status";
import { consumeSecondFactor } from "@/lib/auth/two-factor";
import { authRateLimiter, perIpLimit, RATE_LIMITS, SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { getRequestInfo } from "@/lib/auth/request-info";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notifyMany } from "@/lib/services/notifications";
import { recordConsent } from "@/lib/legal/consent";
import { ANON_COOKIE, CONSENT_MAX_AGE, isValidAnonId, normalizeConsentInput } from "@/lib/legal/consent-shared";
import { billedSubscriptions, eraseAccountInDb, isDeletedAccount, isLastAdmin, type ErasureSummary } from "@/lib/legal/erase";
import { fd, uid } from "@/lib/utils";

/**
 * Privacy actions: cookie-consent evidence, "Delete my account" (GDPR
 * erasure, as an anonymization) and the administrator's erasure tool for
 * requests received by email. Downloads of personal data are served by
 * `/api/privacy/export`.
 */

type Errors = Record<string, string>;

/** Written for every visitor, so kept in its own bucket (not the sign-in limiter). */
const g = globalThis as unknown as { __llConsentLimiter?: SlidingWindowRateLimiter };
const consentLimiter: SlidingWindowRateLimiter = (g.__llConsentLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 50_000 }));
const CONSENT_RULE = { limit: 30, windowMs: 10 * 60 * 1000 };
const CONSENT_SHARED_RULE = { limit: 3_000, windowMs: 10 * 60 * 1000 };

/** Confirmation word typed in the delete dialog. */
const CONFIRM_WORD = "DELETE";

/* ------------------------------------------------------------------ */
/* Cookie consent                                                      */
/* ------------------------------------------------------------------ */

/**
 * Keep evidence of the visitor's cookie decision. The browser has already
 * stored the `ll_consent` cookie; this adds a `ConsentRecord` tied to a
 * random, httpOnly visitor id (`ll_anon`) and, when signed in, the member.
 */
export async function recordConsentAction(input: unknown): Promise<ActionResult> {
  const decision = normalizeConsentInput(input);
  if (!decision) return { ok: false, error: "Invalid cookie choice." };

  const info = await getRequestInfo();
  const bucket = perIpLimit("consent", info.ip, CONSENT_RULE, CONSENT_SHARED_RULE);
  if (!consentLimiter.hit(bucket.key, bucket.rule).ok) return { ok: false, error: "Too many changes. Your choice is saved in this browser." };

  const jar = await cookies();
  let anonId = jar.get(ANON_COOKIE)?.value;
  if (!isValidAnonId(anonId)) {
    anonId = randomBytes(18).toString("base64url");
    jar.set({ name: ANON_COOKIE, value: anonId, httpOnly: true, sameSite: "lax", secure: siteConfig.cookieSecure, path: "/", maxAge: CONSENT_MAX_AGE });
  }
  const user = await getCurrentUser();
  await recordConsent(decision, { anonId, userId: user?.id });
  return { ok: true, data: undefined };
}

/* ------------------------------------------------------------------ */
/* Account deletion                                                    */
/* ------------------------------------------------------------------ */

function newDeletedUsername(): string {
  return `deleted-${randomBytes(6).toString("hex")}`;
}

function totals(summary: ErasureSummary): { removed: number; anonymized: number } {
  const add = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
  return { removed: add(summary.removed), anonymized: add(summary.anonymized) };
}

/** Why an account cannot be erased right now (null = it can). `self` words the message for the account owner. */
async function erasureBlocker(userId: string, self: boolean): Promise<string | null> {
  const db = await getDb();
  if (isLastAdmin(db, userId)) return "This is the only administrator account. Make another member an administrator before deleting it.";
  const billed = billedSubscriptions(db, userId);
  if (!billed.length) return null;
  const what = billed.length === 1 ? "A membership is" : `${billed.length} memberships are`;
  const them = billed.length === 1 ? "it" : "them";
  return self
    ? `${what} still billed automatically. Cancel ${them} under Billing first so you are not charged again.`
    : `${what} still billed automatically for this member. Cancel ${them} first so the member is not charged again.`;
}

/**
 * Anonymize an account in one transaction and record the completed request.
 * Returns null when the account no longer exists or became un-erasable.
 */
async function eraseAccount(userId: string): Promise<ErasureSummary | null> {
  const now = new Date();
  return mutate((db) => {
    if (isLastAdmin(db, userId) || billedSubscriptions(db, userId).length) return null;
    const summary = eraseAccountInDb(db, userId, { now, username: newDeletedUsername() });
    if (!summary) return null;
    const request: DataRequest = { id: uid("dreq"), userId, type: "delete", status: "completed", createdAt: now.toISOString(), completedAt: now.toISOString() };
    db.dataRequests.push(request);
    return summary;
  });
}

async function tellAdmins(subject: string, message: string, exceptId?: string): Promise<void> {
  const db = await getDb();
  const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin") && u.id !== exceptId).map((u) => u.id);
  await notifyMany(admins, { type: "system", subject, message, link: "/admin/audit?tab=requests", email: false });
}

/**
 * "Delete my account": confirm with the password (and a two-step code when
 * it is on) plus the word DELETE, then anonymize the account, sign out
 * everywhere and return to the home page.
 */
export async function deleteAccountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };

  const limit = authRateLimiter.hit(`account-delete:${user.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return { ok: false, error: `Too many attempts. Please wait ${formatWait(limit.retryAfterMs)} and try again.` };

  const password = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  const code = fd(formData, "code").slice(0, 64);
  const needsCode = isTwoFactorActive(user);
  const errors: Errors = {};
  if (!password) errors.password = "Enter your password.";
  if (confirm.toUpperCase() !== CONFIRM_WORD) errors.confirm = `Type ${CONFIRM_WORD} to confirm.`;
  if (needsCode && !code) errors.code = "Enter a code from your authenticator app or a recovery code.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "Your password is incorrect.", fieldErrors: { password: "Incorrect password." } };
  }
  const blocker = await erasureBlocker(user.id, true);
  if (blocker) return { ok: false, error: blocker };
  if (needsCode) {
    const method = /^\d{6}$/.test(code.replace(/\s+/g, "")) ? "totp" : "recovery";
    const second = await consumeSecondFactor(user.id, { method, code: method === "totp" ? code.replace(/\s+/g, "") : code });
    if (!second.ok) return { ok: false, error: "That verification code didn't work.", fieldErrors: { code: "Invalid code." } };
  }

  const summary = await eraseAccount(user.id);
  if (!summary) return { ok: false, error: "Your account could not be deleted right now. Please reload the page and try again." };

  const { removed, anonymized } = totals(summary);
  await audit({ id: user.id }, "account.delete", { type: "user", id: user.id }, { removed, anonymized, byOwner: true });
  await tellAdmins("A member deleted their account", `Their personal data was removed (${removed} records deleted, ${anonymized} anonymized). Orders keep their amounts and invoice numbers.`, user.id);
  await destroySession();
  revalidatePath("/", "layout");
  await setFlash("Your account has been deleted. Thank you for learning with us.", "info");
  redirect("/");
}

/**
 * Admin tool for erasure requests received outside the app (email, letter):
 * anonymize another member's account after confirming the admin's password.
 */
export async function adminEraseAccountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await getCurrentUser();
  if (!admin || !isAdmin(admin)) return { ok: false, error: "Only administrators can erase member accounts." };

  const limit = authRateLimiter.hit(`account-erase:${admin.id}`, RATE_LIMITS.accountChange);
  if (!limit.ok) return { ok: false, error: `Too many attempts. Please wait ${formatWait(limit.retryAfterMs)} and try again.` };

  const userId = fd(formData, "userId");
  const password = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  const errors: Errors = {};
  if (!userId) errors.userId = "Choose the member whose account should be erased.";
  if (!password) errors.password = "Enter your own password to confirm.";
  if (confirm.toUpperCase() !== CONFIRM_WORD) errors.confirm = `Type ${CONFIRM_WORD} to confirm.`;
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };
  if (userId === admin.id) return { ok: false, error: "Delete your own account from Settings → Privacy & data.", fieldErrors: { userId: "That's your own account." } };

  const db = await getDb();
  const target: User | undefined = db.users.find((u) => u.id === userId);
  if (!target || isDeletedAccount(target)) return { ok: false, error: "That member no longer exists or was already erased.", fieldErrors: { userId: "Not found." } };
  if (!(await verifyPassword(password, admin.passwordHash))) {
    return { ok: false, error: "Your password is incorrect.", fieldErrors: { password: "Incorrect password." } };
  }
  const blocker = await erasureBlocker(userId, false);
  if (blocker) return { ok: false, error: blocker };

  const summary = await eraseAccount(userId);
  if (!summary) return { ok: false, error: "The account could not be erased right now. Please try again." };
  const { removed, anonymized } = totals(summary);
  await audit(admin, "account.erase", { type: "user", id: userId }, { removed, anonymized, byOwner: false });
  revalidatePath("/admin/audit");
  revalidatePath("/admin/members");
  return { ok: true, data: undefined, message: `The account was erased: ${removed} records deleted and ${anonymized} anonymized.` };
}
