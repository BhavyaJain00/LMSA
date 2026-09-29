/**
 * Payment types shared between the server and client components.
 * Keep this file free of runtime imports (it is bundled for the browser).
 */

export type RealGateway = "stripe" | "razorpay";

/** Options the browser needs to open Razorpay Checkout (no secrets). */
export interface RazorpayLaunchOptions {
  /** Public key id (rzp_test_… / rzp_live_…). */
  keyId: string;
  /** Razorpay order id (order_…). */
  razorpayOrderId: string;
  /** Our order id (ORD-…), used for the return pages. */
  orderId: string;
  /** Amount in the currency's smallest unit, as sent to Razorpay. */
  amount: number;
  currency: string;
  /** Merchant name shown in the checkout modal. */
  name: string;
  description: string;
  image?: string;
  prefill: { name: string; email: string };
  themeColor?: string;
}

/** What the browser should do after an order was placed or a payment resumed. */
export type CheckoutNext =
  /** Go to a hosted checkout page (Stripe) or an internal page. */
  | { kind: "redirect"; url: string }
  /** Open Razorpay Checkout in a modal. */
  | { kind: "razorpay"; options: RazorpayLaunchOptions };

/** Status of one gateway as shown to administrators (never contains secrets). */
export interface GatewayStatusView {
  gateway: RealGateway;
  label: string;
  configured: boolean;
  mode: "test" | "live" | null;
  /** Masked key (e.g. "sk_test_…a1b2"). */
  maskedKey: string;
  keyLabel: string;
  /** Human readable problems, e.g. "Missing STRIPE_SECRET_KEY". */
  missing: string[];
  webhookConfigured: boolean;
  /** Name of the environment variable holding the webhook secret. */
  webhookSecretVar: string;
  webhookUrl: string;
  webhookEvents: string[];
  dashboardUrl: string;
  docsUrl: string;
  /** Currencies the gateway accepts without extra activation (informational). */
  note: string;
}
