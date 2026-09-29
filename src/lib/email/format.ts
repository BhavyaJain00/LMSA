/** Small display helpers shared by the email senders (pure). */
import type { LiveClass, Payment } from "@/lib/types";

const GATEWAY_LABELS: Record<string, string> = {
  manual: "Manual payment",
  stripe: "Card (Stripe)",
  razorpay: "Razorpay",
  test: "Test payment",
  free: "Free",
};

export function gatewayLabel(gateway: string): string {
  return GATEWAY_LABELS[gateway] ?? gateway.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function paymentItemLabel(itemType: Payment["itemType"]): string {
  return itemType === "batch" ? "Batch" : itemType === "certificate" ? "Certificate" : "Course";
}

const PROVIDERS: Record<LiveClass["provider"], string> = { zoom: "Zoom", google_meet: "Google Meet", custom: "Online meeting" };

export function liveClassProviderLabel(provider: LiveClass["provider"]): string {
  return PROVIDERS[provider] ?? "Online meeting";
}

/** A timestamp in UTC for security emails, e.g. "Tue, 29 Sep 2026 10:04 UTC". */
export function utcStamp(date: Date = new Date()): string {
  return date.toUTCString().replace(/:\d\d GMT$/, " UTC");
}
