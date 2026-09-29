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
