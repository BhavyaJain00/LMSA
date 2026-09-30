import "server-only";
import { on } from "@/lib/events";
import { creditCommission, reverseCommissionForRefund } from "./affiliates";
import { applySeatPurchase, reverseSeatPurchase } from "./teams";

/**
 * Growth reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 *  - `payment.paid`: credit the referring affiliate (idempotent per order);
 *    add the seats of a team order to its organization.
 *  - `payment.refunded`: void or reduce that commission (claw back when
 *    paid); take back the seats of a fully refunded team order.
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

on(
  "payment.paid",
  async (event) => {
    if (event.data.itemType === "seats") await applySeatPurchase(event.data.paymentId);
  },
  { key: "growth:team-seats" },
);

on(
  "payment.refunded",
  async (event) => {
    await reverseSeatPurchase(event.data);
  },
  { key: "growth:team-seats-refund" },
);
