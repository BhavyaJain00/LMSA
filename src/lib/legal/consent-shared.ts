/**
 * Cookie-consent format shared by the server (`consent.ts`) and the browser
 * (`src/components/legal/consent-client.ts`). No runtime imports: safe on
 * both sides.
 *
 * Cookie `ll_consent` holds compact JSON `{"a":0|1,"m":0|1}` (analytics,
 * marketing), URI-encoded, kept for one year. Necessary cookies need no
 * consent and are not represented. A missing or malformed cookie means the
 * visitor has not decided yet, which is treated as "no" for everything
 * optional (fail closed).
 */

export const CONSENT_COOKIE = "ll_consent";
/** One year, in seconds. */
export const CONSENT_MAX_AGE = 365 * 24 * 60 * 60;
/** Window event fired (with the new `ConsentState` as `detail`) whenever consent changes in this tab. */
export const CONSENT_EVENT = "ll:consent";

export type ConsentState = { analytics: boolean; marketing: boolean; decided: boolean };

export const UNDECIDED_CONSENT: ConsentState = Object.freeze({ analytics: false, marketing: false, decided: false }) as ConsentState;

/** Parse the raw cookie value (URI-encoded or not). Anything unexpected → undecided. */
export function parseConsentValue(raw: string | null | undefined): ConsentState {
  if (!raw || raw.length > 200) return { ...UNDECIDED_CONSENT };
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.unshift(decoded);
  } catch {
    /* not URI-encoded */
  }
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) break;
    const { a, m } = parsed as { a?: unknown; m?: unknown };
    if ((a !== 0 && a !== 1) || (m !== 0 && m !== 1)) break;
    return { analytics: a === 1, marketing: m === 1, decided: true };
  }
  return { ...UNDECIDED_CONSENT };
}

/** Serialize a decision to the (URI-encoded) cookie value. */
export function serializeConsent(state: Pick<ConsentState, "analytics" | "marketing">): string {
  return encodeURIComponent(JSON.stringify({ a: state.analytics ? 1 : 0, m: state.marketing ? 1 : 0 }));
}

/**
 * Window event that opens the cookie preferences dialog (dispatched by
 * `<CookieSettingsLink />`, handled by the consent manager).
 */
export const CONSENT_OPEN_EVENT = "ll:consent-open";

/**
 * Random, httpOnly visitor id stored with each `ConsentRecord`, so a decision
 * made before signing in can still be evidenced. Kept as long as the consent
 * cookie.
 */
export const ANON_COOKIE = "ll_anon";

const ANON_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** True for a well-formed visitor id (anything else is replaced). */
export function isValidAnonId(value: unknown): value is string {
  return typeof value === "string" && ANON_ID_PATTERN.test(value);
}

/** Coerce untrusted input (a Server Action argument) into a decision. */
export function normalizeConsentInput(input: unknown): Pick<ConsentState, "analytics" | "marketing"> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { analytics, marketing } = input as { analytics?: unknown; marketing?: unknown };
  if (typeof analytics !== "boolean" || typeof marketing !== "boolean") return null;
  return { analytics, marketing };
}

/**
 * Consent category of a cookie set by the optional tags (Google Analytics /
 * Ads, Meta Pixel), or null for anything else. Used to delete those cookies
 * as soon as the visitor withdraws consent.
 */
export function optionalCookieCategory(name: string): "analytics" | "marketing" | null {
  if (/^(_ga($|_)|_gid$|_gat($|_))/.test(name)) return "analytics";
  if (/^(_fbp|_fbc|_gcl_[a-z]+)$/.test(name)) return "marketing";
  return null;
}
