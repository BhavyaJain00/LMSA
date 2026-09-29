import type { PaymentStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const TONES: Record<PaymentStatus, BadgeTone> = {
  paid: "success",
  pending: "warning",
  failed: "neutral",
  refunded: "danger",
};

/**
 * Wording for an order status. Failed orders with a gateway reason read
 * "Payment failed" (otherwise "Cancelled"); partial refunds are called out.
 * Mirrors `paymentStatusLabel` in `src/lib/data/commerce.ts`.
 */
export function paymentStatusText(p: { status: PaymentStatus; failureReason?: string; refundedAmount?: number; amount?: number }, audience: "admin" | "learner" = "admin"): string {
  if (p.status === "failed") return p.failureReason ? "Payment failed" : "Cancelled";
  if (p.status === "refunded") {
    return p.refundedAmount !== undefined && p.amount !== undefined && p.refundedAmount > 0 && p.refundedAmount < p.amount ? "Partially refunded" : "Refunded";
  }
  if (p.status === "pending") return audience === "learner" ? "Awaiting payment" : "Unpaid";
  return p.refundedAmount ? "Paid · part refunded" : "Paid";
}

/** Status pill for an order (server- and client-safe). */
export function PaymentStatusBadge({
  status,
  failureReason,
  refundedAmount,
  amount,
  audience = "admin",
}: {
  status: PaymentStatus;
  failureReason?: string;
  refundedAmount?: number;
  amount?: number;
  audience?: "admin" | "learner";
}) {
  const tone: BadgeTone = status === "failed" && failureReason ? "danger" : TONES[status];
  return (
    <Badge tone={tone} dot>
      {paymentStatusText({ status, failureReason, refundedAmount, amount }, audience)}
    </Badge>
  );
}
