import "server-only";
import { cookies } from "next/headers";
import { CONSENT_COOKIE, parseConsentValue, type ConsentState } from "./consent-shared";

export type { ConsentState } from "./consent-shared";
export { CONSENT_COOKIE, CONSENT_MAX_AGE, CONSENT_EVENT, parseConsentValue, serializeConsent } from "./consent-shared";

/**
 * The visitor's cookie-consent decision from the `ll_consent` cookie.
 * Undecided (or unreadable) means no optional cookies.
 *
 * Reading cookies makes the caller dynamic; do not wrap this in try/catch
 * (Next signals dynamic rendering by throwing from `cookies()`).
 */
export async function readConsentCookie(): Promise<ConsentState> {
  const jar = await cookies();
  return parseConsentValue(jar.get(CONSENT_COOKIE)?.value);
}
