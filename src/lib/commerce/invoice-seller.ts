import type { Settings, TaxRule } from "@/lib/types";
import { countryCode, countryName, sellerTaxCountry } from "./tax";
import { isEuCountry, isPlausibleTaxId, normalizeVatId, parseEuVatId } from "./vat-id";

/**
 * Who sells, as printed on invoices (pure). Tax-compliant invoices name the
 * seller's legal entity, its registered address and its VAT/GST number; when
 * the seller is also registered in the buyer's country (e.g. a UK VAT number
 * for UK buyers), that registration is printed too.
 *
 * Settings → Taxes & currencies → Seller details stores the fields in
 * `settings.growth.seller*`; empty fields fall back to Settings → Legal
 * (company name and address) and then to the brand name.
 */

export interface InvoiceTaxRegistration {
  /** "VAT No.", "GSTIN", "UK VAT No." */
  label: string;
  value: string;
}

export interface InvoiceSellerDetails {
  legalName: string;
  addressLines: string[];
  /** Country the seller is established in (English name). */
  countryName?: string;
  /** Registration numbers to print, the main one first. */
  taxIds: InvoiceTaxRegistration[];
}

/** Address text → lines (blank lines and duplicate spaces dropped, at most 6 lines). */
export function addressLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 6);
}

/** Label for a tax number when the admin did not set one, guessed from its shape and the country. */
export function defaultTaxIdLabel(taxId: string, country: string | null): string {
  const value = normalizeVatId(taxId);
  if (parseEuVatId(value).ok) return "VAT No.";
  if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value)) return "GSTIN";
  switch (country) {
    case "GB":
      return "VAT No.";
    case "IN":
      return "GSTIN";
    case "AU":
      return "ABN";
    case "NZ":
      return "GST No.";
    case "CA":
      return "GST/HST No.";
    case "CH":
    case "NO":
      return "VAT No.";
    default:
      return country && isEuCountry(country) ? "VAT No." : "Tax ID";
  }
}

type SellerSettings = Pick<Settings, "brand" | "legal" | "growth">;

/**
 * The seller block of an invoice. `taxCountry` is the country the order was
 * taxed for: the seller's registration there (from its tax rule) is added.
 */
export function invoiceSeller(settings: SellerSettings, rules: readonly TaxRule[] | undefined, taxCountry: string | null | undefined): InvoiceSellerDetails {
  const g = settings.growth;
  const legalName = (g.sellerLegalName || settings.legal.companyName || settings.brand.name || "").trim();
  const lines = addressLines(g.sellerAddress || settings.legal.companyAddress);
  const country = sellerTaxCountry(g);
  const taxIds: InvoiceTaxRegistration[] = [];
  const main = normalizeVatId(g.sellerTaxId);
  if (main) taxIds.push({ label: (g.sellerTaxIdLabel || "").trim() || defaultTaxIdLabel(main, country), value: main });
  const code = countryCode(taxCountry);
  const rule = code ? rules?.find((r) => r.country.toUpperCase() === code) : undefined;
  const local = normalizeVatId(rule?.registrationNumber);
  if (rule && local && local !== main) {
    taxIds.push({ label: (rule.registrationLabel || "").trim() || `${countryName(rule.country)} ${rule.name || "tax"} No.`, value: local });
  }
  const countryLabel = country ? countryName(country) : undefined;
  // Print the country when the address does not already end with it.
  const showCountry = countryLabel && !lines.some((l) => l.toLowerCase().includes(countryLabel.toLowerCase()));
  return { legalName, addressLines: lines, countryName: showCountry ? countryLabel : undefined, taxIds };
}

/* ------------------------------------------------------------------ */
/* Admin form                                                          */
/* ------------------------------------------------------------------ */

export interface SellerDetailsInput {
  legalName: string;
  address: string;
  country: string;
  taxId: string;
  taxIdLabel: string;
}

export interface SellerDetailsValue {
  sellerLegalName?: string;
  sellerAddress?: string;
  sellerCountry?: string;
  sellerTaxId?: string;
  sellerTaxIdLabel?: string;
}

export type SellerDetailsValidation = { ok: true; value: SellerDetailsValue } | { ok: false; errors: Record<string, string> };

/** Validate the seller details form (every field optional; empty = the fallback). */
export function validateSellerDetails(input: SellerDetailsInput): SellerDetailsValidation {
  const errors: Record<string, string> = {};
  const legalName = input.legalName.trim().replace(/\s+/g, " ");
  if (legalName.length > 140) errors.legalName = "Keep the legal name under 140 characters.";
  const address = input.address
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (address.length > 6) errors.address = "Use at most 6 lines.";
  else if (address.some((l) => l.length > 120)) errors.address = "Keep each line under 120 characters.";
  const rawCountry = input.country.trim();
  const country = rawCountry ? countryCode(rawCountry) : null;
  if (rawCountry && !country) errors.country = "Choose a country from the list.";
  const taxId = normalizeVatId(input.taxId);
  if (taxId) {
    const vat = parseEuVatId(taxId);
    if (country && isEuCountry(country)) {
      if (!vat.ok) errors.taxId = vat.reason === "format" ? `This doesn't look like a valid ${countryName(vat.country ?? country)} VAT number.` : "Enter the VAT number with its country prefix, e.g. DE123456789.";
      else if (vat.country !== country) errors.taxId = `This VAT number belongs to ${countryName(vat.country)}, not ${countryName(country)}.`;
    } else if (!country && !vat.ok && vat.reason === "format") {
      errors.taxId = `This doesn't look like a valid ${countryName(vat.country ?? "")} VAT number.`;
    } else if (!vat.ok && !isPlausibleTaxId(taxId)) {
      errors.taxId = "Use 4 to 20 letters and digits.";
    }
  }
  const taxIdLabel = input.taxIdLabel.trim().replace(/\s+/g, " ");
  if (taxIdLabel.length > 30) errors.taxIdLabel = "Keep the label under 30 characters.";
  else if (taxIdLabel && !taxId) errors.taxId = "Enter the number the label is for, or clear the label.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      sellerLegalName: legalName || undefined,
      sellerAddress: address.length ? address.join("\n") : undefined,
      sellerCountry: country ?? undefined,
      sellerTaxId: taxId || undefined,
      sellerTaxIdLabel: taxId && taxIdLabel ? taxIdLabel : undefined,
    },
  };
}
