/**
 * Money conversions between the app and payment gateways.
 *
 * The app stores every amount as "minor units with two decimals" (the price
 * multiplied by 100, see `formatPrice`), whatever the currency. Gateways want
 * the currency's real smallest unit: cents for USD, but whole yen for JPY
 * (zero-decimal) and fils for KWD (three decimals). These helpers translate in
 * both directions so the amount sent to a gateway always matches what the
 * learner saw at checkout.
 */

/** Currencies without a minor unit (Stripe/Razorpay "zero-decimal" currencies). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

/** Currencies with three decimals. */
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Number of decimals of the currency's smallest unit. */
export function currencyExponent(currency: string): 0 | 2 | 3 {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/** App amount (price × 100) → the gateway's smallest unit. */
export function toGatewayAmount(appAmount: number, currency: string): number {
  const exp = currencyExponent(currency);
  if (exp === 0) return Math.round(appAmount / 100);
  if (exp === 3) return Math.round(appAmount * 10);
  return Math.round(appAmount);
}

/** Gateway smallest unit → app amount (price × 100). */
export function fromGatewayAmount(gatewayAmount: number, currency: string): number {
  const exp = currencyExponent(currency);
  if (exp === 0) return Math.round(gatewayAmount * 100);
  if (exp === 3) return Math.round(gatewayAmount / 10);
  return Math.round(gatewayAmount);
}

/** Whether a gateway-reported amount and currency match what the order expects. */
export function amountMatches(expectedAppAmount: number, expectedCurrency: string, gatewayAmount: unknown, gatewayCurrency: unknown): boolean {
  if (typeof gatewayAmount !== "number" || !Number.isFinite(gatewayAmount)) return false;
  if (typeof gatewayCurrency !== "string") return false;
  if (gatewayCurrency.toUpperCase() !== expectedCurrency.toUpperCase()) return false;
  return toGatewayAmount(expectedAppAmount, expectedCurrency) === gatewayAmount;
}

/** Parse a decimal amount typed by an admin ("12.50") into app units (1250). */
export function parseDecimalAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return Number.isFinite(n) ? n : null;
}
