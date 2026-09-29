import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppSecret } from "@/lib/server-env";
import { siteConfig } from "@/lib/config";
import { type EmailPreferenceKey, isEmailPreferenceKey } from "./preferences";

/**
 * Signed links for the email system, all derived from APP_SECRET with
 * separate sub-keys so a token for one purpose can never be replayed for
 * another:
 *  - one-click unsubscribe links (per user + category, no login needed),
 *  - the cron key that authorizes `/api/cron/emails`.
 */

export type UnsubscribeScope = EmailPreferenceKey | "all";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function subKey(purpose: string): Buffer {
  return createHmac("sha256", getAppSecret()).update(`learnloop:${purpose}`).digest();
}

function sign(purpose: string, payload: string): string {
  return createHmac("sha256", subKey(purpose)).update(payload).digest("base64url");
}

/** Constant-time comparison of two base64url tokens (false on any format mismatch). */
function tokensEqual(expected: string, candidate: string | null | undefined): boolean {
  if (!candidate || !TOKEN_RE.test(candidate)) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isUnsubscribeScope(value: unknown): value is UnsubscribeScope {
  return value === "all" || isEmailPreferenceKey(value);
}

/** HMAC over (user id, category). */
export function unsubscribeToken(userId: string, scope: UnsubscribeScope): string {
  return sign("email-unsubscribe:v1", `${userId}\n${scope}`);
}

export function verifyUnsubscribeToken(userId: string | null | undefined, scope: string | null | undefined, token: string | null | undefined): scope is UnsubscribeScope {
  if (!userId || userId.length > 100 || !isUnsubscribeScope(scope)) return false;
  return tokensEqual(unsubscribeToken(userId, scope), token);
}

/** Absolute one-click unsubscribe link (works without logging in). */
export function unsubscribeUrl(userId: string, scope: UnsubscribeScope): string {
  const q = new URLSearchParams({ unsubscribe: scope, u: userId, t: unsubscribeToken(userId, scope) });
  return `${siteConfig.appUrl}/settings/notifications?${q.toString()}`;
}

/** Absolute link to the preferences page. */
export function preferencesUrl(): string {
  return `${siteConfig.appUrl}/settings/notifications`;
}

/**
 * Find a valid unsubscribe link for `userId` inside a rendered email body
 * (used to build the List-Unsubscribe header at send time).
 */
export function findUnsubscribeLink(body: string, userId: string): string | null {
  const re = /\/settings\/notifications\?unsubscribe=([A-Za-z]+)&(?:amp;)?u=([A-Za-z0-9_-]+)&(?:amp;)?t=([A-Za-z0-9_-]{43})/g;
  for (const m of body.matchAll(re)) {
    const [, scope, uid, token] = m;
    if (uid === userId && verifyUnsubscribeToken(uid, scope, token)) return unsubscribeUrl(userId, scope as UnsubscribeScope);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Cron                                                                */
/* ------------------------------------------------------------------ */

/** Key for `/api/cron/emails?key=…` (stable while APP_SECRET is unchanged). */
export function cronKey(): string {
  return sign("cron-emails:v1", "deliver");
}

export function verifyCronKey(candidate: string | null | undefined): boolean {
  return tokensEqual(cronKey(), candidate?.trim());
}

export function cronUrl(): string {
  return `${siteConfig.appUrl}/api/cron/emails?key=${cronKey()}`;
}
