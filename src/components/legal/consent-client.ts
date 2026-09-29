"use client";

import {
  CONSENT_COOKIE,
  CONSENT_EVENT,
  CONSENT_MAX_AGE,
  UNDECIDED_CONSENT,
  parseConsentValue,
  serializeConsent,
  type ConsentState,
} from "@/lib/legal/consent-shared";

export type { ConsentState } from "@/lib/legal/consent-shared";

/**
 * Browser-side access to the cookie-consent decision. Anything that sets
 * optional cookies or loads third-party scripts (analytics, pixels) must
 * check `getConsent()` first and subscribe with `onConsentChange()`.
 */

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Current decision (undecided on the server or when the cookie is missing/malformed). */
export function getConsent(): ConsentState {
  if (typeof document === "undefined") return { ...UNDECIDED_CONSENT };
  return parseConsentValue(readCookie(CONSENT_COOKIE));
}

/** Store a decision for one year and notify listeners in this tab. */
export function setConsent(state: Pick<ConsentState, "analytics" | "marketing">): ConsentState {
  const next: ConsentState = { analytics: Boolean(state.analytics), marketing: Boolean(state.marketing), decided: true };
  if (typeof document === "undefined") return next;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(next)}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: next }));
  return next;
}

/** Subscribe to consent changes; returns an unsubscribe function. */
export function onConsentChange(cb: (state: ConsentState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ConsentState>).detail;
    cb(detail && typeof detail === "object" ? detail : getConsent());
  };
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}
