import type { ManualPaymentDetails, Settings } from "@/lib/types";

/** A way to pay that a buyer can pick at checkout. */
export type CheckoutMethodId = "stripe" | "razorpay" | "manual";

export const CHECKOUT_METHOD_NAMES: Record<CheckoutMethodId, string> = {
  stripe: "Card (Stripe)",
  razorpay: "UPI, cards & more (Razorpay)",
  manual: "Bank transfer / UPI",
};

const ORDER: CheckoutMethodId[] = ["razorpay", "stripe", "manual"];

/** One method as the checkout shows it. */
export interface CheckoutMethodView {
  id: CheckoutMethodId;
  /** Can take a payment now: manual always; Stripe and Razorpay once their keys are configured. */
  ready: boolean;
  /** Test or live keys (online methods only). */
  mode: "test" | "live" | null;
}

/** How the server sees an online gateway: keys present, and whether they are test keys. */
export type GatewayStatus = (gateway: "stripe" | "razorpay") => { configured: boolean; mode: "test" | "live" | null };

function isMethod(value: string): value is CheckoutMethodId {
  return value === "stripe" || value === "razorpay" || value === "manual";
}

/**
 * The methods checkout offers, the site's main gateway first. Methods switched off in Settings → Payments are
 * left out, except the main gateway, which is always offered. Nothing is offered when the gateway is "none"
 * (every order is free then).
 */
export function checkoutMethods(commerce: Pick<Settings["commerce"], "paymentGateway" | "paymentMethods">, status: GatewayStatus): CheckoutMethodView[] {
  if (commerce.paymentGateway === "none") return [];
  const primary = commerce.paymentGateway;
  const enabled = ORDER.filter((id) => commerce.paymentMethods?.[id] || id === primary);
  const sorted = [...enabled].sort((a, b) => (a === primary ? -1 : b === primary ? 1 : 0));
  return sorted.map((id) => {
    if (id === "manual") return { id, ready: true, mode: null };
    const s = status(id);
    return { id, ready: s.configured, mode: s.configured ? s.mode : null };
  });
}

/** The method preselected at checkout: the first one that can take a payment now, else the first one. */
export function preferredMethod(methods: readonly CheckoutMethodView[]): CheckoutMethodId | null {
  return (methods.find((m) => m.ready) ?? methods[0])?.id ?? null;
}

/**
 * Check the method a checkout submitted. Without one (an older page, or the API), the site's main gateway
 * is used, exactly as before buyers could choose.
 */
export function resolveCheckoutMethod(
  requested: string,
  commerce: Pick<Settings["commerce"], "paymentGateway" | "paymentMethods">,
  status: GatewayStatus,
): { ok: true; method: CheckoutMethodId } | { ok: false; error: string } {
  const methods = checkoutMethods(commerce, status);
  const value = requested.trim();
  if (!value) {
    const primary = commerce.paymentGateway;
    if (!isMethod(primary)) return { ok: false, error: "Payments are switched off." };
    const view = methods.find((m) => m.id === primary);
    if (!view?.ready) return { ok: false, error: "Online payments are not available right now. Please try again later or contact us." };
    return { ok: true, method: primary };
  }
  const view = isMethod(value) ? methods.find((m) => m.id === value) : undefined;
  if (!view) return { ok: false, error: "This payment method is not available. Please choose another one." };
  if (!view.ready) return { ok: false, error: `${CHECKOUT_METHOD_NAMES[view.id]} is not available right now. Please choose another payment method.` };
  return { ok: true, method: view.id };
}

/** Longest payment reference a buyer can enter. */
export const MAX_REFERENCE_LENGTH = 80;

/**
 * Clean the transaction reference (UTR, bank reference) a buyer typed: trimmed, inner spaces collapsed.
 * Letters, digits, spaces and - _ / . # are allowed.
 */
export function normalizeBuyerReference(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length > MAX_REFERENCE_LENGTH) return { ok: false, error: `Keep the reference under ${MAX_REFERENCE_LENGTH} characters.` };
  if (value && !/^[\p{L}\p{N} _\-/.#]+$/u.test(value)) return { ok: false, error: "Use only letters, numbers, spaces and - _ / . # in the reference." };
  return { ok: true, value };
}

/** Whether the admin filled in any bank or UPI detail. */
export function hasManualDetails(details: ManualPaymentDetails | undefined): boolean {
  if (!details) return false;
  return [details.accountName, details.bankName, details.accountNumber, details.ifsc, details.swift, details.upiId].some((v) => !!v?.trim());
}

/** UPI payment link (opens the buyer's UPI app on phones) for an amount in the smallest unit of INR. */
export function upiPayUrl(details: ManualPaymentDetails, amountMinor: number, note: string): string | null {
  const vpa = details.upiId?.trim();
  if (!vpa) return null;
  const params = new URLSearchParams({ pa: vpa, pn: details.accountName?.trim() || "Payee", am: (amountMinor / 100).toFixed(2), cu: "INR", tn: note.slice(0, 50) });
  return `upi://pay?${params}`;
}
