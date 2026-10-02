import type { PaymentItemType, PaymentStatus } from "@/lib/types";
import type { InstallmentPlanStatus } from "@/lib/commerce/installments";
import type { MessageKey } from "@/i18n/catalog";
import type { Translator } from "@/i18n/translate";

/**
 * Message keys for commerce values whose English labels live in `src/lib`
 * (kept English there for emails, logs and exports). Client- and server-safe.
 */
type Key = MessageKey<"account">;
export type AccountTranslator = Translator<Key>;

export const ITEM_TYPE_KEYS: Record<PaymentItemType, Key> = {
  course: "global.itemType.course",
  batch: "global.itemType.batch",
  certificate: "global.itemType.certificate",
  plan: "global.itemType.plan",
  bundle: "global.itemType.bundle",
  gift: "global.itemType.gift",
  seats: "global.itemType.seats",
};

/** Mirrors `paymentStatusText`: failed orders with a gateway reason read "Payment failed", partial refunds are called out. */
export function paymentStatusKey(
  p: { status: PaymentStatus; failureReason?: string; refundedAmount?: number; amount?: number },
  audience: "admin" | "learner" = "admin",
): Key {
  if (p.status === "failed") return p.failureReason ? "global.paymentStatus.paymentFailed" : "global.paymentStatus.cancelled";
  if (p.status === "refunded") {
    return p.refundedAmount !== undefined && p.amount !== undefined && p.refundedAmount > 0 && p.refundedAmount < p.amount
      ? "global.paymentStatus.partiallyRefunded"
      : "global.paymentStatus.refunded";
  }
  if (p.status === "pending") return audience === "learner" ? "global.paymentStatus.awaitingPayment" : "global.paymentStatus.unpaid";
  return p.refundedAmount ? "global.paymentStatus.paidPartRefunded" : "global.paymentStatus.paid";
}

const GATEWAY_KEYS: Record<string, Key> = { manual: "commerce.gateway.manual", none: "commerce.gateway.none", free: "commerce.gateway.free" };
const GATEWAY_BRANDS: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

/** "Stripe", "Razorpay" (brand names), "Manual payment", "Free order" in the active language. */
export function gatewayText(gateway: string, t: AccountTranslator): string {
  const key = GATEWAY_KEYS[gateway];
  return key ? t(key) : (GATEWAY_BRANDS[gateway] ?? gateway);
}

/** "every week", "every 30 days" (the installment interval) in the active language. */
export function intervalText(days: number, t: AccountTranslator): string {
  if (days === 1) return t("commerce.interval.day");
  if (days % 7 === 0) return days === 7 ? t("commerce.interval.week") : t("commerce.interval.weeks", { count: days / 7 });
  return t("commerce.interval.days", { count: days });
}

/** "$19.00/month" for monthly and yearly plans, the plain price otherwise. */
export function pricePerInterval(price: string, interval: string, t: AccountTranslator): string {
  if (interval === "month") return t("commerce.interval.perMonth", { price });
  if (interval === "year") return t("commerce.interval.perYear", { price });
  return price;
}

export const INSTALLMENT_STATUS_KEYS: Record<InstallmentPlanStatus, Key> = {
  awaiting_first: "commerce.plan.status.awaiting_first",
  on_track: "commerce.plan.status.on_track",
  overdue: "commerce.plan.status.overdue",
  paused: "commerce.plan.status.paused",
  completed: "commerce.plan.status.completed",
  cancelled: "commerce.plan.status.cancelled",
};
