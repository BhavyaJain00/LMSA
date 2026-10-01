import type { Settings, TaxRule } from "@/lib/types";
import { currencyExponent } from "@/lib/payments/amounts";

/**
 * Tax by buyer country (pure; shared by checkout, invoices and the admin
 * Taxes & currencies page).
 *
 * `settings.growth.taxMode`:
 *  - "none": the single rate of Settings → Payments applies to every order
 *    (when "Apply tax" is on), exactly as before.
 *  - "by_country": the `TaxRule` of the buyer's country applies, added on top
 *    of the price (exclusive) or carved out of it (inclusive). Countries
 *    without a rule fall back to the single rate when "Apply tax" is on, and
 *    pay no tax otherwise.
 *
 * Amounts are app units (price × 100, see `formatPrice`). Every tax is
 * rounded half up once, on the order's taxable amount, to the smallest unit
 * the currency can charge: a cent for USD/EUR/INR, a whole yen for JPY.
 */

/* ------------------------------------------------------------------ */
/* Countries                                                           */
/* ------------------------------------------------------------------ */

/** Billing-form country names whose CLDR English name differs. */
const COUNTRY_ALIASES: Record<string, string> = {
  "cabo verde": "CV",
  "cape verde": "CV",
  congo: "CG",
  "republic of the congo": "CG",
  "democratic republic of the congo": "CD",
  "hong kong": "HK",
  myanmar: "MM",
  burma: "MM",
  palestine: "PS",
  "saint kitts and nevis": "KN",
  "saint lucia": "LC",
  "saint vincent and the grenadines": "VC",
  turkey: "TR",
  turkiye: "TR",
  "united states of america": "US",
  usa: "US",
  uk: "GB",
  "great britain": "GB",
  "south korea": "KR",
  "north korea": "KP",
};

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/&/g, "and")
    .toLowerCase()
    .replace(/\bst\b\.?/g, "saint")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

let regionNames: Intl.DisplayNames | null | undefined;
function displayNames(): Intl.DisplayNames | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  return regionNames;
}

let byName: Map<string, string> | null = null;
function nameIndex(): Map<string, string> {
  if (byName) return byName;
  const map = new Map<string, string>(Object.entries(COUNTRY_ALIASES));
  const names = displayNames();
  if (names) {
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          continue;
        }
        if (!name || name === code || NOT_COUNTRIES.has(code)) continue;
        const key = normalizeName(name);
        if (!map.has(key)) map.set(key, code);
      }
    }
  }
  byName = map;
  return map;
}

const CODE_RE = /^[A-Z]{2}$/;
/** Region codes that are not countries (unknown, unions, macro-regions). */
const NOT_COUNTRIES = new Set(["ZZ", "EU", "EZ", "UN", "QO", "XA", "XB"]);

/** ISO 3166-1 alpha-2 code for a country name (as stored on billing addresses) or code; null when unknown. */
export function countryCode(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (raw.length === 2) {
    const code = raw.toUpperCase();
    if (!CODE_RE.test(code) || NOT_COUNTRIES.has(code)) return null;
    const name = countryName(code);
    // Unknown codes come back unchanged; "UK" resolves to the canonical "GB" through its name.
    return name === code ? null : (nameIndex().get(normalizeName(name)) ?? code);
  }
  return nameIndex().get(normalizeName(raw)) ?? null;
}

/** English name of a country code ("IN" → "India"); the code itself when unknown. */
export function countryName(code: string): string {
  const upper = code.toUpperCase();
  if (!CODE_RE.test(upper)) return code;
  try {
    return displayNames()?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Country of the first `Accept-Language` entry that names a region ("en-IN,en;q=0.9" → "IN"). */
export function countryFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((e) => e.tag && e.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of entries) {
    // Language-Script-Region or Language-Region: the region is the 2-letter subtag after the language.
    const region = tag
      .split("-")
      .slice(1)
      .find((s) => /^[A-Za-z]{2}$/.test(s));
    const code = region ? countryCode(region) : null;
    if (code) return code;
  }
  return null;
}

/** Headers set by CDNs/hosts with the visitor's country (from their IP address). */
const GEO_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-country-code", "x-geo-country"] as const;

/**
 * Best guess of the visitor's country before they enter a billing address:
 * a geo-IP header from the CDN when present, else the region of their
 * preferred language.
 */
export function countryFromHeaders(headers: { get(name: string): string | null }): string | null {
  for (const name of GEO_HEADERS) {
    const value = headers.get(name)?.trim().toUpperCase();
    // "XX" / "T1" are Cloudflare's unknown / Tor markers.
    if (value && value !== "XX" && value !== "T1") {
      const code = countryCode(value);
      if (code) return code;
    }
  }
  return countryFromAcceptLanguage(headers.get("accept-language"));
}

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

/** The tax an order pays, resolved for one buyer. */
export interface AppliedTax {
  /** Invoice label, e.g. "GST" or "VAT". */
  name: string;
  /** Percent, e.g. 18 (0 = no tax). */
  rate: number;
  /** The price already includes the tax. */
  inclusive: boolean;
  /** Country the tax was resolved for (null when not by country). */
  country: string | null;
  /** The country's `TaxRule` (null = the default single rate or no tax). */
  ruleId: string | null;
}

/** Tax rules and the buyer's country (billing address, else a guess from the request). */
export interface TaxContext {
  rules: readonly TaxRule[];
  country: string | null;
}

export const NO_TAX: AppliedTax = { name: "Tax", rate: 0, inclusive: false, country: null, ruleId: null };

export function findTaxRule(rules: readonly TaxRule[], country: string | null | undefined): TaxRule | null {
  const code = countryCode(country);
  return code ? (rules.find((r) => r.country.toUpperCase() === code) ?? null) : null;
}

/** Which tax applies to a buyer from `country` under the platform's settings. */
export function resolveTax(settings: Pick<Settings, "commerce" | "growth">, tax: TaxContext | null | undefined): AppliedTax {
  const c = settings.commerce;
  const flat: AppliedTax = c.applyTax && c.taxPercentage > 0 ? { name: c.taxLabel || "Tax", rate: c.taxPercentage, inclusive: false, country: null, ruleId: null } : { ...NO_TAX, name: c.taxLabel || "Tax" };
  if (settings.growth.taxMode !== "by_country") return flat;
  const country = countryCode(tax?.country);
  const rule = tax ? findTaxRule(tax.rules, country) : null;
  if (rule) return { name: rule.name || "Tax", rate: Math.max(0, rule.rate), inclusive: rule.inclusive, country, ruleId: rule.id };
  return { ...flat, country };
}

/** Round half away from zero to a whole smallest unit, ignoring float noise (2.4999999 from 2.5). */
export function roundAmount(value: number): number {
  const cleaned = Math.round(value * 1e6) / 1e6;
  return cleaned < 0 ? -Math.round(-cleaned) : Math.round(cleaned);
}

export interface TaxedAmount {
  /** Amount before tax (for inclusive prices: the price with the tax carved out). */
  net: number;
  taxAmount: number;
  /** What the buyer pays. */
  total: number;
}

/** Round an app amount to the smallest unit `currency` can charge (whole yen for zero-decimal currencies). */
export function roundForCurrency(value: number, currency: string | undefined): number {
  const unit = currency && currencyExponent(currency) === 0 ? 100 : 1;
  return roundAmount(value / unit) * unit;
}

/**
 * Apply a tax to a taxable amount (price after discounts):
 *  - exclusive: tax = round(amount × rate), total = amount + tax;
 *  - inclusive: total = amount, tax = amount − round(amount ÷ (1 + rate)).
 */
export function applyTax(amount: number, tax: Pick<AppliedTax, "rate" | "inclusive">, currency?: string): TaxedAmount {
  const base = Math.max(0, Math.round(amount));
  const rate = Math.max(0, tax.rate);
  if (rate <= 0 || base === 0) return { net: base, taxAmount: 0, total: base };
  if (tax.inclusive) {
    const net = roundForCurrency((base * 100) / (100 + rate), currency);
    return { net, taxAmount: base - net, total: base };
  }
  const taxAmount = roundForCurrency((base * rate) / 100, currency);
  return { net: base, taxAmount, total: base + taxAmount };
}

/**
 * Whether a stored order's tax was included in its price: an inclusive order
 * charges the discounted price, an exclusive one adds the tax on top. Works
 * on split installment parts too (closest match wins).
 */
export function isTaxInclusive(p: { originalAmount: number; discountAmount: number; taxAmount: number; amount: number }): boolean {
  if (p.taxAmount <= 0) return false;
  const base = p.originalAmount - p.discountAmount;
  return Math.abs(p.amount - base) < Math.abs(p.amount - (base + p.taxAmount));
}

/** Label of a tax line: "VAT (20%, included)", "GST (18%)". */
export function taxLineLabel(tax: { name: string; rate: number | null; inclusive: boolean }): string {
  const parts = [tax.rate !== null && tax.rate > 0 ? `${tax.rate}%` : null, tax.inclusive ? "included" : null].filter(Boolean);
  return parts.length ? `${tax.name} (${parts.join(", ")})` : tax.name;
}

/* ------------------------------------------------------------------ */
/* Admin form                                                          */
/* ------------------------------------------------------------------ */

export interface TaxRuleInput {
  country: string;
  name: string;
  rate: string;
  inclusive: boolean;
}

export type TaxRuleValidation = { ok: true; value: Omit<TaxRule, "id"> } | { ok: false; errors: Record<string, string> };

/** Validate the rule form; `takenBy` returns the id of another rule for the same country. */
export function validateTaxRuleInput(input: TaxRuleInput, takenBy: (country: string) => string | null): TaxRuleValidation {
  const errors: Record<string, string> = {};
  const country = countryCode(input.country);
  if (!country) errors.country = "Choose a country.";
  else if (takenBy(country)) errors.country = `${countryName(country)} already has a tax rule. Edit that one instead.`;
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Enter the name printed on invoices, e.g. VAT or GST.";
  else if (name.length > 40) errors.name = "Keep the name under 40 characters.";
  const rawRate = input.rate.trim().replace(",", ".");
  const rate = Number(rawRate);
  if (!rawRate || !Number.isFinite(rate) || !/^\d{1,3}(\.\d{1,3})?$/.test(rawRate)) errors.rate = "Enter a rate in percent, e.g. 18 or 7.5.";
  else if (rate <= 0 || rate > 100) errors.rate = "The rate must be more than 0% and at most 100%.";
  if (Object.keys(errors).length || !country) return { ok: false, errors };
  return { ok: true, value: { country, name, rate, inclusive: input.inclusive } };
}
