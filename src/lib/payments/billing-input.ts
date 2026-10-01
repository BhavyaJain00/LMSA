import type { Payment } from "@/lib/types";
import { BILLING_SOURCES, GSTIN_RE, PAN_RE, canonicalIndianState, isKnownCountry } from "@/components/commerce/countries";
import { fd, fdBool } from "@/lib/utils";

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
    source: fd(formData, "source"),
    consent: fdBool(formData, "consent"),
  };
}

/** Validation order mirrors Frappe's checkout: source, consent, mandatory fields, tax ids, state. */
export function validateBilling(input: BillingInput, applyTax: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.source || !(BILLING_SOURCES as readonly string[]).includes(input.source)) {
    errors.source = "Please let us know where you heard about us from.";
  }
  if (!input.consent) errors.consent = "Please provide your consent to proceed with the payment.";
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
  if (applyTax) {
    if (input.gstin && !GSTIN_RE.test(input.gstin)) errors.gstin = "Please enter a valid GST number.";
    if (input.gstin && !input.pan) errors.pan = "Please enter a valid pan number.";
    else if (input.pan && !PAN_RE.test(input.pan)) errors.pan = "Please enter a valid pan number.";
  }
  return errors;
}

/** The billing fields of an order row from validated input. */
export function billingFields(input: BillingInput, applyTax: boolean): Pick<Payment, "billingName" | "address" | "gstin" | "pan" | "source"> {
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
    source: input.source,
  };
}
