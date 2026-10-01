import type { CurrencyPrice } from "@/lib/types";
import { parseDecimalAmount } from "@/lib/payments/amounts";

/**
 * Multi-currency prices (pure).
 *
 * An item (course, membership plan, bundle) has a default price in its own
 * currency and may define fixed prices in other currencies (`prices`). When
 * `settings.growth.multiCurrency` is on, the viewer's currency (chosen in
 * checkout and remembered in a cookie) picks the matching fixed price; when
 * the item has no price in that currency, the default price is used. There
 * is no conversion: every amount charged is one an administrator entered.
 */

/** Cookie remembering the viewer's chosen currency. */
export const CURRENCY_COOKIE = "ll_currency";
/** One year. */
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Upper-case ISO 4217 code, or null when malformed. */
export function normalizeCurrency(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CURRENCY_RE.test(code) ? code : null;
}

export interface PriceOption {
  currency: string;
  amount: number;
  /** The item's own (default) price. */
  isDefault: boolean;
}

/** Every price an item can be bought at: the default first, then each fixed price in another currency. */
export function priceOptions(base: { amount: number; currency: string }, prices: readonly CurrencyPrice[] | undefined): PriceOption[] {
  const baseCurrency = normalizeCurrency(base.currency) ?? "USD";
  const options: PriceOption[] = [{ currency: baseCurrency, amount: base.amount, isDefault: true }];
  for (const p of prices ?? []) {
    const currency = normalizeCurrency(p.currency);
    if (!currency || options.some((o) => o.currency === currency) || !Number.isFinite(p.amount) || p.amount <= 0) continue;
    options.push({ currency, amount: Math.round(p.amount), isDefault: false });
  }
  return options;
}

/**
 * The price for a viewer who wants `wanted`: the fixed price in that
 * currency when multi-currency is on and the item defines one, else the
 * default price.
 */
export function pickPrice(base: { amount: number; currency: string }, prices: readonly CurrencyPrice[] | undefined, wanted: string | null | undefined, enabled: boolean): PriceOption {
  const options = priceOptions(base, prices);
  const code = normalizeCurrency(wanted);
  if (!enabled || !code) return options[0];
  return options.find((o) => o.currency === code) ?? options[0];
}

/** Currencies the viewer can choose for an item (just the default when multi-currency is off). */
export function selectableCurrencies(base: { amount: number; currency: string }, prices: readonly CurrencyPrice[] | undefined, enabled: boolean): string[] {
  const options = priceOptions(base, prices);
  return (enabled ? options : options.slice(0, 1)).map((o) => o.currency);
}

/** Usual currency of a country, used as the first guess before the viewer picks one. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  IN: "INR",
  GB: "GBP",
  AU: "AUD",
  CA: "CAD",
  SG: "SGD",
  AE: "AED",
  JP: "JPY",
  NZ: "NZD",
  CH: "CHF",
  ...Object.fromEntries(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"].map((c) => [c, "EUR"])),
};

export function currencyForCountry(country: string | null | undefined): string | null {
  return country ? (COUNTRY_CURRENCY[country.toUpperCase()] ?? null) : null;
}

/**
 * The currency to show a viewer: their remembered choice, else the usual
 * currency of their country (when it is one the platform sells in), else
 * null (= each item's default).
 */
export function preferredCurrency(cookie: string | null | undefined, country: string | null | undefined, offered: readonly string[]): string | null {
  const chosen = normalizeCurrency(cookie);
  if (chosen) return chosen;
  const guess = currencyForCountry(country);
  return guess && offered.includes(guess) ? guess : null;
}

/* ------------------------------------------------------------------ */
/* Admin form                                                          */
/* ------------------------------------------------------------------ */

export interface PriceRowInput {
  currency: string;
  /** Decimal amount as typed, e.g. "49.99" (empty = no fixed price in this currency). */
  amount: string;
}

export type PriceRowsValidation = { ok: true; prices: CurrencyPrice[] } | { ok: false; errors: Record<string, string> };

/**
 * Validate the fixed prices typed for an item. Rows with an empty amount are
 * dropped; the item's default currency can't have a second price; amounts
 * use at most two decimals (whole units for zero-decimal currencies are
 * entered the same way, e.g. "1500").
 */
export function validatePriceRows(rows: readonly PriceRowInput[], baseCurrency: string, allowed: readonly string[]): PriceRowsValidation {
  const errors: Record<string, string> = {};
  const prices: CurrencyPrice[] = [];
  const base = normalizeCurrency(baseCurrency);
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    const raw = row.amount.trim();
    if (!raw) continue;
    const key = `price_${row.currency.trim().toUpperCase()}`;
    if (!currency || !allowed.includes(currency)) {
      errors[key] = "Unknown currency.";
      continue;
    }
    if (currency === base) {
      errors[key] = "This is the item's own currency: change its price where the item is edited.";
      continue;
    }
    if (prices.some((p) => p.currency === currency)) continue;
    const amount = parseDecimalAmount(raw);
    if (amount === null || amount <= 0) {
      errors[key] = "Enter a price above 0 with at most two decimals, e.g. 49.99.";
      continue;
    }
    if (amount > 100_000_000) {
      errors[key] = "That price is too high.";
      continue;
    }
    prices.push({ currency, amount });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, prices };
}
