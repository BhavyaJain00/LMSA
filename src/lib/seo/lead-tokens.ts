import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppSecret } from "@/lib/server-env";
import { siteConfig } from "@/lib/config";

/**
 * Signed links for marketing leads (no account, no login):
 *  - double opt-in confirmation links, valid for `CONFIRM_TTL_MS`;
 *  - unsubscribe links, valid until the address unsubscribes.
 * Each purpose has its own key derived from APP_SECRET, so one kind of token
 * can never be replayed as another, and every token is bound to the lead id
 * and email address.
 */

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Purpose = "lead-confirm:v1" | "lead-unsubscribe:v1";

function sign(purpose: Purpose, payload: string): string {
  const key = createHmac("sha256", getAppSecret()).update(`learnloop:${purpose}`).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function equal(expected: string, candidate: string | null | undefined): boolean {
  if (!candidate || !TOKEN_RE.test(candidate)) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function confirmToken(leadId: string, email: string, expiresAt: number): string {
  return sign("lead-confirm:v1", `${leadId}\n${email.toLowerCase()}\n${expiresAt}`);
}

export function unsubscribeLeadToken(leadId: string, email: string): string {
  return sign("lead-unsubscribe:v1", `${leadId}\n${email.toLowerCase()}`);
}

/** Absolute confirmation link for a lead. */
export function leadConfirmUrl(leadId: string, email: string, now: number = Date.now()): string {
  const expiresAt = now + CONFIRM_TTL_MS;
  const q = new URLSearchParams({ l: leadId, e: String(expiresAt), t: confirmToken(leadId, email, expiresAt) });
  return `${siteConfig.appUrl}/free/confirm?${q.toString()}`;
}

/** Absolute unsubscribe link for a lead. */
export function leadUnsubscribeUrl(leadId: string, email: string): string {
  const q = new URLSearchParams({ l: leadId, t: unsubscribeLeadToken(leadId, email) });
  return `${siteConfig.appUrl}/free/unsubscribe?${q.toString()}`;
}

export type ConfirmCheck = "ok" | "invalid" | "expired";

/** Check a confirmation link against the stored lead. */
export function checkConfirmLink(lead: { id: string; email: string } | null, expiresRaw: string | undefined, token: string | undefined, now: number = Date.now()): ConfirmCheck {
  if (!lead || !expiresRaw || !/^\d{10,16}$/.test(expiresRaw)) return "invalid";
  const expiresAt = Number(expiresRaw);
  if (!equal(confirmToken(lead.id, lead.email, expiresAt), token)) return "invalid";
  return expiresAt < now ? "expired" : "ok";
}

export function checkUnsubscribeLink(lead: { id: string; email: string } | null, token: string | undefined): boolean {
  return !!lead && equal(unsubscribeLeadToken(lead.id, lead.email), token);
}

export function isLeadId(value: string | undefined | null): value is string {
  return !!value && ID_RE.test(value);
}
