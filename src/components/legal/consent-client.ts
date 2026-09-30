"use client";

import {
  CONSENT_COOKIE,
  CONSENT_EVENT,
  CONSENT_OPEN_EVENT,
  CONSENT_MAX_AGE,
  UNDECIDED_CONSENT,
  normalizeConsentInput,
  optionalCookieCategory,
  parseConsentValue,
  serializeConsent,
  type ConsentState,
} from "@/lib/legal/consent-shared";

export type { ConsentState } from "@/lib/legal/consent-shared";

/**
 * Browser-side access to the cookie-consent decision. Anything that sets
 * optional cookies or loads third-party scripts (analytics, pixels) must
 * check `getConsent()` first and subscribe with `onConsentChange()`.
 *
 * A decision made in one tab reaches the other open tabs of the site through
 * a BroadcastChannel, so withdrawing consent stops tags everywhere at once.
 */

const CHANNEL_NAME = "ll-consent";
/** undefined = not opened yet, null = BroadcastChannel unavailable. */
let channel: BroadcastChannel | null | undefined;

function notify(state: ConsentState): void {
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_EVENT, { detail: state }));
}

/** The shared channel, opened on first use; decisions from other tabs are replayed as local events. */
function consentChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  channel?.addEventListener("message", (event: MessageEvent) => {
    const decision = normalizeConsentInput(event.data);
    if (decision) notify({ ...decision, decided: true });
  });
  return channel;
}

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

/** Delete a cookie on this host and on each parent domain it may have been scoped to. */
function deleteCookie(name: string): void {
  const labels = window.location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i++) domains.push(`; Domain=.${labels.slice(i).join(".")}`);
  for (const domain of domains) document.cookie = `${name}=; Path=/; Max-Age=0${domain}`;
}

function clearWithdrawnCookies(state: Pick<ConsentState, "analytics" | "marketing">): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name) continue;
    const category = optionalCookieCategory(name);
    if (category && !state[category]) deleteCookie(name);
  }
}

/**
 * Store a decision for one year and notify listeners in this tab. Cookies of
 * a category the visitor turned off are deleted straight away.
 */
export function setConsent(state: Pick<ConsentState, "analytics" | "marketing">): ConsentState {
  const next: ConsentState = { analytics: Boolean(state.analytics), marketing: Boolean(state.marketing), decided: true };
  if (typeof document === "undefined") return next;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(next)}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`;
  clearWithdrawnCookies(next);
  notify(next);
  consentChannel()?.postMessage({ analytics: next.analytics, marketing: next.marketing });
  return next;
}

/** Open the cookie preferences dialog (handled by the consent manager in the root layout). */
export function openConsentSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

/** Subscribe to consent changes (this tab and other tabs of the site); returns an unsubscribe function. */
export function onConsentChange(cb: (state: ConsentState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  consentChannel();
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ConsentState>).detail;
    cb(detail && typeof detail === "object" ? detail : getConsent());
  };
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}
