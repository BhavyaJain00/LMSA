import "server-only";
import { on } from "@/lib/events";
import { creditCommission, reverseCommissionForRefund } from "./affiliates";

/**
 * Growth reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 *  - `payment.paid`: credit the referring affiliate (idempotent per order).
 *  - `payment.refunded`: void or reduce that commission (claw back when paid).
 */

on(
  "payment.paid",
  async (event) => {
    await creditCommission(event.data.paymentId, event.data.affiliateId);
  },
  { key: "growth:affiliate-commission" },
);

on(
  "payment.refunded",
  async (event) => {
    await reverseCommissionForRefund(event.data);
  },
  { key: "growth:affiliate-refund" },
);
