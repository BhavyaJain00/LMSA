import "server-only";
import { cookies } from "next/headers";
import type { ConsentRecord } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
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

/** Identical decisions from one visitor within this window are stored once (double clicks, several tabs). */
const DUPLICATE_WINDOW_MS = 60_000;

/**
 * Keep evidence of a consent decision (`consents` collection). Returns the
 * stored record, or null when it repeats the visitor's latest decision from
 * the last minute.
 */
export async function recordConsent(
  decision: Pick<ConsentState, "analytics" | "marketing">,
  ids: { anonId: string; userId?: string },
  now: Date = new Date(),
): Promise<ConsentRecord | null> {
  return mutate((db) => {
    let latest: ConsentRecord | undefined;
    for (let i = db.consents.length - 1; i >= 0; i--) {
      const row = db.consents[i]!;
      if (row.anonId === ids.anonId) {
        latest = row;
        break;
      }
    }
    if (
      latest &&
      latest.analytics === decision.analytics &&
      latest.marketing === decision.marketing &&
      latest.userId === ids.userId &&
      now.getTime() - new Date(latest.createdAt).getTime() < DUPLICATE_WINDOW_MS
    ) {
      return null;
    }
    const record: ConsentRecord = {
      id: uid("cns"),
      anonId: ids.anonId,
      analytics: decision.analytics,
      marketing: decision.marketing,
      createdAt: now.toISOString(),
    };
    if (ids.userId) record.userId = ids.userId;
    db.consents.push(record);
    return record;
  });
}
