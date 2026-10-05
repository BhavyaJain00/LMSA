/**
 * EU VAT identification numbers (pure, client-safe).
 *
 * A VAT number is a two-letter prefix followed by a national number whose
 * shape depends on the member state ("DE123456789", "FRXX999999999",
 * "NL123456789B01"). Greece uses the prefix "EL" instead of its ISO code.
 * Only the format is checked here: whether the number is actually registered
 * is a VIES lookup, which the seller can do from the invoice.
 *
 * Used by the billing form (the buyer's optional VAT number), the invoice
 * seller settings, and the reverse-charge rule in `tax.ts`.
 */

/** ISO 3166-1 alpha-2 codes of the 27 EU member states. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** National part of the VAT number, by VAT prefix (the prefix is the ISO code except Greece's "EL"). */
const EU_VAT_FORMATS: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^(?:[A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])$/,
  FI: /^\d{8}$/,
  FR: /^[0-9A-HJ-NP-Z]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(?:\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(?:\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^[1-9]\d{1,9}$/,
  SE: /^\d{10}01$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
};

/** A VAT prefix → the ISO country code ("EL" → "GR"). */
export function vatPrefixCountry(prefix: string): string | null {
  const p = prefix.toUpperCase();
  if (p === "EL") return "GR";
  if (p === "GR") return null; // Greek VAT numbers are written with "EL".
  return EU_VAT_FORMATS[p] ? p : null;
}

/** The VAT prefix of an EU country ("GR" → "EL"). */
export function countryVatPrefix(country: string): string | null {
  const c = country.toUpperCase();
  if (!EU_COUNTRIES.has(c)) return null;
  return c === "GR" ? "EL" : c;
}

export function isEuCountry(country: string | null | undefined): boolean {
  return !!country && EU_COUNTRIES.has(country.toUpperCase());
}

/**
 * Canonical spelling of a tax number as typed: upper case, without the
 * spaces, dots, dashes and slashes people use to group digits.
 */
export function normalizeVatId(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.\-/_,]+/g, "")
    .slice(0, 40);
}

export type EuVatIdCheck =
  | { ok: true; /** Normalized, with prefix, e.g. "DE123456789". */ value: string; /** ISO country, e.g. "GR" for "EL…". */ country: string; prefix: string }
  | { ok: false; reason: "empty" | "prefix" | "format"; /** ISO country of a known EU prefix with a malformed number. */ country?: string };

/** Check the format of an EU VAT number (with its country prefix). */
export function parseEuVatId(raw: string | null | undefined): EuVatIdCheck {
  const value = normalizeVatId(raw);
  if (!value) return { ok: false, reason: "empty" };
  const prefix = value.slice(0, 2);
  const country = vatPrefixCountry(prefix);
  if (!country) return { ok: false, reason: "prefix" };
  const format = EU_VAT_FORMATS[prefix]!;
  if (!format.test(value.slice(2))) return { ok: false, reason: "format", country };
  return { ok: true, value, country, prefix };
}

/** Whether `raw` is a well-formed EU VAT number. */
export function isValidEuVatId(raw: string | null | undefined): boolean {
  return parseEuVatId(raw).ok;
}

/** Tax numbers of other countries: letters and digits only once normalized (GB123456789, CHE123456789MWST, 12345678901 ABN…). */
const GENERIC_TAX_ID_RE = /^[A-Z0-9]{4,20}$/;

/** Whether a normalized tax number of a non-EU country looks plausible. */
export function isPlausibleTaxId(value: string): boolean {
  return GENERIC_TAX_ID_RE.test(value);
}

/** A well-formed example VAT number of each member state, for form hints. */
const VAT_EXAMPLES: Readonly<Record<string, string>> = {
  AT: "ATU12345678",
  BE: "BE0123456789",
  BG: "BG123456789",
  CY: "CY12345678X",
  CZ: "CZ12345678",
  DE: "DE123456789",
  DK: "DK12345678",
  EE: "EE123456789",
  ES: "ESA1234567B",
  FI: "FI12345678",
  FR: "FRXX123456789",
  GR: "EL123456789",
  HR: "HR12345678901",
  HU: "HU12345678",
  IE: "IE1234567T",
  IT: "IT12345678901",
  LT: "LT123456789",
  LU: "LU12345678",
  LV: "LV12345678901",
  MT: "MT12345678",
  NL: "NL123456789B01",
  PL: "PL1234567890",
  PT: "PT123456789",
  RO: "RO1234567",
  SE: "SE123456789001",
  SI: "SI12345678",
  SK: "SK1234567890",
};

/** Example VAT number of a member state ("DE123456789" for other countries). */
export function exampleVatId(country: string | null | undefined): string {
  return VAT_EXAMPLES[(country ?? "").toUpperCase()] ?? "DE123456789";
}
