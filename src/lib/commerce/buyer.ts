import "server-only";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/types";
import { CURRENCY_COOKIE, normalizeCurrency } from "./currency";
import { countryCode, countryFromHeaders, type TaxContext } from "./tax";

/**
 * Where the buyer is and which currency they pay in, read from the request:
 * the remembered currency cookie and a country guess (CDN geo-IP header or
 * the `Accept-Language` region) used until they enter a billing address.
 */

/** The currency the viewer chose at checkout (null = each item's default). */
export async function viewerCurrency(): Promise<string | null> {
  try {
    return normalizeCurrency((await cookies()).get(CURRENCY_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** Country guessed from the request headers (null when nothing hints at one). */
export async function requestCountry(): Promise<string | null> {
  try {
    return countryFromHeaders(await headers());
  } catch {
    return null;
  }
}

/**
 * Tax context for a buyer: the billing country they entered (or the one of
 * their last order), else the request's guess.
 */
export async function buyerTaxContext(db: Pick<Database, "taxRules" | "settings">, billingCountry: string | null | undefined): Promise<TaxContext> {
  const entered = countryCode(billingCountry);
  if (entered || db.settings.growth.taxMode !== "by_country") return { rules: db.taxRules, country: entered };
  return { rules: db.taxRules, country: await requestCountry() };
}
