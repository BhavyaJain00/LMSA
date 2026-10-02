"use client";

import type { PaymentStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import { paymentStatusKey } from "./labels";

const TONES: Record<PaymentStatus, BadgeTone> = {
  paid: "success",
  pending: "warning",
  failed: "neutral",
  refunded: "danger",
};

/**
 * Wording for an order status. Failed orders with a gateway reason read
 * "Payment failed" (otherwise "Cancelled"); partial refunds are called out.
 * Mirrors `paymentStatusLabel` in `src/lib/data/commerce.ts`. English, for exports and logs; the badge shows the translated label.
 */
export function paymentStatusText(p: { status: PaymentStatus; failureReason?: string; refundedAmount?: number; amount?: number }, audience: "admin" | "learner" = "admin"): string {
  if (p.status === "failed") return p.failureReason ? "Payment failed" : "Cancelled";
  if (p.status === "refunded") {
    return p.refundedAmount !== undefined && p.amount !== undefined && p.refundedAmount > 0 && p.refundedAmount < p.amount ? "Partially refunded" : "Refunded";
  }
  if (p.status === "pending") return audience === "learner" ? "Awaiting payment" : "Unpaid";
  return p.refundedAmount ? "Paid · part refunded" : "Paid";
}

/** Status pill for an order, in the viewer's language (a client component, renders anywhere). */
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
  const t = useT("account");
  const tone: BadgeTone = status === "failed" && failureReason ? "danger" : TONES[status];
  return (
    <Badge tone={tone} dot>
      {t(paymentStatusKey({ status, failureReason, refundedAmount, amount }, audience))}
    </Badge>
  );
}
