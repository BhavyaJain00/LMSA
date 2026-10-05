import type { Payment } from "@/lib/types";
import { BILLING_SOURCES, GSTIN_RE, PAN_RE, canonicalIndianState, isKnownCountry } from "@/components/commerce/countries";
import { fd, fdBool } from "@/lib/utils";
import { countryCode, countryName } from "@/lib/commerce/tax";
import { exampleVatId, isEuCountry, isPlausibleTaxId, normalizeVatId, parseEuVatId } from "@/lib/commerce/vat-id";

/**
 * The billing details every checkout form posts (course/batch/plan/bundle
 * checkout and the gift checkout), read and validated the same way.
 */

export interface BillingInput {
  billingName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gstin: string;
  pan: string;
  /** Optional VAT / tax number of a business buyer, normalized ("DE123456789"). */
  vatId: string;
  source: string;
  consent: boolean;
}

export function readBilling(formData: FormData): BillingInput {
  return {
    billingName: fd(formData, "billingName"),
    line1: fd(formData, "line1"),
    line2: fd(formData, "line2"),
    city: fd(formData, "city"),
    state: fd(formData, "state"),
    country: fd(formData, "country"),
    pincode: fd(formData, "pincode"),
    gstin: fd(formData, "gstin").toUpperCase(),
    pan: fd(formData, "pan").toUpperCase(),
    vatId: normalizeVatId(fd(formData, "vatId")),
    source: fd(formData, "source"),
    consent: fdBool(formData, "consent"),
  };
}

/** Validation order mirrors Frappe's checkout: source, consent, mandatory fields, tax ids, state. */
export function validateBilling(input: BillingInput, applyTax: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.source || !(BILLING_SOURCES as readonly string[]).includes(input.source)) {
    errors.source = "Tell us how you found out about us.";
  }
  if (!input.consent) errors.consent = "Tick the consent box to continue to payment.";
  if (input.billingName.length < 2 || input.billingName.length > 140) errors.billingName = "Please enter a valid Billing Name";
  if (input.line1.length < 3 || input.line1.length > 200) errors.line1 = "Please enter a valid Address Line 1";
  if (input.line2.length > 200) errors.line2 = "Please enter a valid Address Line 2";
  if (input.city.length < 2 || input.city.length > 100) errors.city = "Please enter a valid City";
  if (!isKnownCountry(input.country)) errors.country = "Please select your country.";
  if (input.pincode && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(input.pincode)) errors.pincode = "Please enter a valid Postal Code";
  if (input.country === "India") {
    if (!input.state) errors.state = "Please select your state.";
    else if (!canonicalIndianState(input.state)) errors.state = "Please select your state from the list.";
  } else if (input.state.length > 100) {
    errors.state = "Please enter a valid State/Province";
  }
  const vatError = validateVatId(input.vatId, input.country);
  if (vatError) errors.vatId = vatError;
  if (applyTax) {
    if (input.gstin && !GSTIN_RE.test(input.gstin)) errors.gstin = "Please enter a valid GST number.";
    if (input.gstin && !input.pan) errors.pan = "Please enter a valid pan number.";
    else if (input.pan && !PAN_RE.test(input.pan)) errors.pan = "Please enter a valid pan number.";
  }
  return errors;
}

/**
 * Check the buyer's optional VAT number against their billing country. A
 * buyer from an EU country must give a well-formed VAT number of that
 * country (with its prefix, "EL" for Greece); elsewhere any plausible tax
 * number is accepted. Returns the error message, or null when it is fine.
 */
export function validateVatId(vatId: string, billingCountry: string): string | null {
  const value = normalizeVatId(vatId);
  if (!value) return null;
  const country = countryCode(billingCountry);
  const vat = parseEuVatId(value);
  if (country && isEuCountry(country)) {
    if (vat.ok) return vat.country === country ? null : `This VAT number is registered in ${countryName(vat.country)}. Use a VAT number of ${countryName(country)}, your billing country.`;
    if (vat.reason === "format") return `This doesn't look like a valid ${countryName(vat.country ?? country)} VAT number, e.g. ${exampleVatId(vat.country ?? country)}.`;
    return `Enter your VAT number with its country prefix, e.g. ${exampleVatId(country)}.`;
  }
  if (!vat.ok && vat.reason === "format") return `This doesn't look like a valid ${countryName(vat.country ?? "")} VAT number, e.g. ${exampleVatId(vat.country)}.`;
  if (!vat.ok && !isPlausibleTaxId(value)) return "Please enter a valid VAT or tax number (4 to 20 letters and digits).";
  return null;
}

/** The billing fields of an order row from validated input. */
export function billingFields(input: BillingInput, applyTax: boolean): Pick<Payment, "billingName" | "address" | "gstin" | "pan" | "source" | "buyerVatId"> {
  return {
    billingName: input.billingName,
    address: {
      line1: input.line1,
      line2: input.line2 || undefined,
      city: input.city,
      state: input.country === "India" ? (canonicalIndianState(input.state) ?? undefined) : input.state || undefined,
      country: input.country,
      pincode: input.pincode || undefined,
    },
    gstin: applyTax ? input.gstin || undefined : undefined,
    pan: applyTax ? input.pan || undefined : undefined,
    buyerVatId: input.vatId || undefined,
    source: input.source,
  };
}
