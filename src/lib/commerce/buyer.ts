import "server-only";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/types";
import { CURRENCY_COOKIE, normalizeCurrency } from "./currency";
import { countryCode, countryFromHeaders, type TaxContext } from "./tax";
import { normalizeVatId } from "./vat-id";

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
 * their last order), else the request's guess. `vatId` is the VAT number
 * the checkout form will submit (EU reverse charge needs a billing country).
 */
export async function buyerTaxContext(
  db: Pick<Database, "taxRules" | "settings">,
  billingCountry: string | null | undefined,
  vatId?: string | null,
): Promise<TaxContext> {
  const entered = countryCode(billingCountry);
  const vat = normalizeVatId(vatId);
  if (entered && vat) return { rules: db.taxRules, country: entered, vatId: vat };
  if (entered || db.settings.growth.taxMode !== "by_country") return { rules: db.taxRules, country: entered };
  return { rules: db.taxRules, country: await requestCountry() };
}

/**
 * The VAT number a checkout page prices for: the one typed in the form
 * (`?vat=`, empty when the buyer cleared it), else the one of their last order.
 */
export function checkoutVatId(param: string | string[] | undefined, saved: string | null | undefined): string {
  if (typeof param === "string") return normalizeVatId(param);
  return normalizeVatId(saved);
}
