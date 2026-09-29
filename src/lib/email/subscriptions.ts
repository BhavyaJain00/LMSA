import "server-only";
import { cookies } from "next/headers";
import type { EmailPreferences } from "@/lib/types";
import { findById, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { EMAIL_PREFERENCE_KEYS, resolveEmailPreferences } from "./preferences";
import { type UnsubscribeScope, verifyUnsubscribeToken } from "./signing";
import { UNSUBSCRIBE_RECEIPT_COOKIE } from "./unsubscribe-cookie";

/**
 * Signed (no-login) subscription changes: the one-click unsubscribe link, its
 * confirmation page and "Undo". Reading a link never changes anything; only
 * `applySignedSubscription` (called from POST handlers) writes.
 */

export interface SignedSubscription {
  scope: UnsubscribeScope;
  /** Current state: the category is on (for "all": at least one category is on). */
  subscribed: boolean;
  preferences: EmailPreferences;
  name: string;
  email: string;
}

function isSubscribed(preferences: EmailPreferences, scope: UnsubscribeScope): boolean {
  return scope === "all" ? EMAIL_PREFERENCE_KEYS.some((key) => preferences[key]) : preferences[scope];
}

/** Verify a signed link and report the member's current state. Never writes. */
export async function readSignedSubscription(
  userId: string | null | undefined,
  scope: string | null | undefined,
  token: string | null | undefined,
): Promise<SignedSubscription | null> {
  if (!verifyUnsubscribeToken(userId, scope, token)) return null;
  const user = await findById("users", userId!);
  if (!user) return null;
  const preferences = resolveEmailPreferences(user);
  return { scope, subscribed: isSubscribed(preferences, scope), preferences, name: user.name, email: user.email };
}

/**
 * Change a member's email preferences for one category (or all). Returns the
 * updated state, or null when the link is invalid or the account no longer
 * exists. Only call this from a POST (Server Action or route handler).
 */
export async function applySignedSubscription(
  userId: string | null | undefined,
  scope: string | null | undefined,
  token: string | null | undefined,
  subscribed: boolean,
): Promise<SignedSubscription | null> {
  if (!verifyUnsubscribeToken(userId, scope, token)) return null;
  const validScope: UnsubscribeScope = scope;
  return mutate((db) => {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;
    const next = resolveEmailPreferences(user);
    if (validScope === "all") for (const key of EMAIL_PREFERENCE_KEYS) next[key] = subscribed;
    else next[validScope] = subscribed;
    user.emailPreferences = next;
    return { scope: validScope, subscribed: isSubscribed(next, validScope), preferences: { ...next }, name: user.name, email: user.email };
  });
}

/* ------------------------------------------------------------------ */
/* Receipt cookie                                                      */
/* ------------------------------------------------------------------ */

export interface UnsubscribeReceipt {
  userId: string;
  scope: string;
  token: string;
}

const RECEIPT_MAX_AGE_S = 60 * 60;

export function encodeReceipt(receipt: UnsubscribeReceipt): string {
  return Buffer.from(JSON.stringify([receipt.userId, receipt.scope, receipt.token]), "utf8").toString("base64url");
}

export function decodeReceipt(value: string | undefined | null): UnsubscribeReceipt | null {
  if (!value || value.length > 400) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((p) => typeof p === "string")) return null;
    const [userId, scope, token] = parsed as string[];
    return verifyUnsubscribeToken(userId, scope, token) ? { userId: userId!, scope: scope!, token: token! } : null;
  } catch {
    return null;
  }
}

/**
 * Remember a signed link for an hour after it was used, so the result page
 * (without the token in its URL) can show the outcome and offer Undo.
 * Server Actions and route handlers only.
 */
export async function setUnsubscribeReceipt(receipt: UnsubscribeReceipt): Promise<void> {
  const store = await cookies();
  store.set({
    name: UNSUBSCRIBE_RECEIPT_COOKIE,
    value: encodeReceipt(receipt),
    path: "/settings/notifications",
    maxAge: RECEIPT_MAX_AGE_S,
    httpOnly: true,
    sameSite: "lax",
    secure: siteConfig.cookieSecure,
  });
}

/** The verified receipt from the cookie, if any. */
export async function readUnsubscribeReceipt(): Promise<UnsubscribeReceipt | null> {
  const store = await cookies();
  return decodeReceipt(store.get(UNSUBSCRIBE_RECEIPT_COOKIE)?.value);
}
