import "server-only";
import { parseEuVatId } from "./vat-id";

/**
 * VIES lookup of EU VAT numbers (the European Commission's registry of
 * VAT-registered businesses), used before an order is reverse-charged: the
 * format check in `vat-id.ts` only proves a number could exist, not that it
 * belongs to a registered business.
 *
 * Results:
 *  - "valid"        VIES confirmed the number: reverse charge applies.
 *  - "invalid"      VIES says no such registration: the buyer must fix the
 *                   number or remove it (and pay VAT).
 *  - "unavailable"  VIES (or the member state's service, which is often
 *                   down for maintenance) could not answer. The sale goes
 *                   ahead reverse-charged and the order is flagged for the
 *                   administrators to check (`Payment.vatCheck`).
 *
 * Answers are cached in memory (a confirmed number for a day, a rejected one
 * for an hour), so a buyer retrying a checkout does not query VIES again.
 */

export type ViesResult = "valid" | "invalid" | "unavailable";

const ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
const TIMEOUT_MS = 6_000;
const VALID_TTL_MS = 24 * 60 * 60 * 1000;
const INVALID_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 5_000;

type Lookup = (prefix: string, number: string) => Promise<ViesResult>;

const state = globalThis as unknown as {
  __llViesCache?: Map<string, { result: ViesResult; until: number }>;
  __llViesLookup?: Lookup | null;
};
const cache = (state.__llViesCache ??= new Map());

/** Read a VIES `/ms/{country}/vat/{number}` answer. */
export function parseViesAnswer(json: unknown): ViesResult {
  if (!json || typeof json !== "object") return "unavailable";
  const body = json as { isValid?: unknown; userError?: unknown };
  const userError = typeof body.userError === "string" ? body.userError.toUpperCase() : "";
  if (userError && userError !== "VALID" && userError !== "INVALID") return "unavailable";
  if (body.isValid === true) return "valid";
  if (body.isValid === false) return "invalid";
  return "unavailable";
}

async function queryVies(prefix: string, number: string): Promise<ViesResult> {
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(prefix)}/vat/${encodeURIComponent(number)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return "unavailable";
    return parseViesAnswer(await res.json());
  } catch {
    return "unavailable";
  }
}

/**
 * Replace the VIES request (tests). Without one, the test environment never
 * reaches the network and every lookup is "unavailable".
 */
export function setViesLookupForTests(lookup: Lookup | null): void {
  state.__llViesLookup = lookup;
  cache.clear();
}

/** Ask VIES whether an EU VAT number is registered (cached). Malformed numbers are "invalid". */
export async function checkVatRegistration(vatId: string): Promise<ViesResult> {
  const parsed = parseEuVatId(vatId);
  if (!parsed.ok) return "invalid";
  const now = Date.now();
  const hit = cache.get(parsed.value);
  if (hit && hit.until > now) return hit.result;
  const number = parsed.value.slice(2);
  const lookup = state.__llViesLookup ?? (process.env.NODE_ENV === "test" ? async () => "unavailable" as const : queryVies);
  const result = await lookup(parsed.prefix, number);
  if (result !== "unavailable") {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(parsed.value, { result, until: now + (result === "valid" ? VALID_TTL_MS : INVALID_TTL_MS) });
  }
  return result;
}

/** The buyer-facing message for a VAT number VIES does not know. */
export const VAT_NOT_REGISTERED =
  "This VAT number isn't registered in the EU VIES database. Check it, or remove it to buy as a consumer (VAT is then charged).";

export type ReverseChargeCheck = { ok: true; vatCheck?: "valid" | "unverified" } | { ok: false; error: string };

/**
 * Before an order is reverse-charged: refuse a VAT number VIES does not
 * know, and record whether the registration was confirmed (`vatCheck`).
 * Orders that are not reverse-charged need no lookup.
 */
export async function reverseChargeCheck(summary: { reverseCharge?: boolean }, vatId: string | null | undefined): Promise<ReverseChargeCheck> {
  if (!summary.reverseCharge || !vatId) return { ok: true };
  const result = await checkVatRegistration(vatId);
  if (result === "invalid") return { ok: false, error: VAT_NOT_REGISTERED };
  return { ok: true, vatCheck: result === "valid" ? "valid" : "unverified" };
}
