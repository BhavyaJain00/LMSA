import "server-only";
import { siteConfig } from "@/lib/config";
import { preferenceLabel } from "./preferences";
import { verifyUnsubscribeToken } from "./signing";
import { applySignedSubscription } from "./subscriptions";

/**
 * RFC 8058 one-click unsubscribe (`POST /api/email/unsubscribe?unsubscribe=…&u=…&t=…`
 * with the body `List-Unsubscribe=One-Click`). Mail clients call it without
 * cookies or redirects; the HMAC in the URL authorizes the change. A GET of
 * the same URL (a person or a link scanner opening it) changes nothing and
 * only redirects to the confirmation page.
 */

export interface SignedParams {
  scope: string;
  userId: string;
  token: string;
}

/** Read the signed parameters from the query string, falling back to a form body. */
export function signedParams(query: URLSearchParams, form?: URLSearchParams | null): SignedParams {
  const pick = (name: string) => (query.get(name) ?? form?.get(name) ?? "").trim().slice(0, 200);
  return { scope: pick("unsubscribe") || pick("scope"), userId: pick("u"), token: pick("t") };
}

/** Confirmation page for a GET of the one-click URL (never changes anything). */
export function confirmationUrl(params: SignedParams): string {
  const path = "/settings/notifications";
  if (!verifyUnsubscribeToken(params.userId, params.scope, params.token)) return `${siteConfig.appUrl}${path}`;
  const q = new URLSearchParams({ unsubscribe: params.scope, u: params.userId, t: params.token });
  return `${siteConfig.appUrl}${path}?${q.toString()}`;
}

export interface OneClickResult {
  status: number;
  message: string;
}

/** Apply a one-click unsubscribe. */
export async function oneClickUnsubscribe(params: SignedParams): Promise<OneClickResult> {
  const result = await applySignedSubscription(params.userId, params.scope, params.token, false);
  if (!result) return { status: 400, message: "This unsubscribe link is not valid." };
  return { status: 200, message: `${result.email} is unsubscribed from ${preferenceLabel(result.scope).toLowerCase()} emails.` };
}
