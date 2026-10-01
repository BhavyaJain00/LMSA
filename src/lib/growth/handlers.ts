import "server-only";
import { on } from "@/lib/events";
import { creditCommission, reverseCommissionForRefund } from "./affiliates";
import { applySeatPurchase, reverseSeatPurchase } from "./teams";
import { recordEnrollment, recordLead, recordPurchase, recordSignUp } from "./analytics";

/**
 * Growth reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 *  - `payment.paid`: credit the referring affiliate (idempotent per order);
 *    add the seats of a team order to its organization.
 *  - `payment.refunded`: void or reduce that commission (claw back when
 *    paid); take back the seats of a fully refunded team order.
 *  - First-party analytics: `purchase` (`payment.paid`), `sign_up`
 *    (`user.registered`), `enroll` (`enrollment.created`) and `lead`
 *    (`lead.created`) events, recorded once per domain record.
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

on(
  "payment.paid",
  async (event) => {
    await recordPurchase(event.data, event.createdAt);
  },
  { key: "growth:analytics-purchase" },
);

on(
  "user.registered",
  async (event) => {
    await recordSignUp(event.data, event.createdAt);
  },
  { key: "growth:analytics-signup" },
);

on(
  "enrollment.created",
  async (event) => {
    await recordEnrollment(event.data, event.createdAt);
  },
  { key: "growth:analytics-enroll" },
);

on(
  "lead.created",
  async (event) => {
    await recordLead(event.data, event.createdAt);
  },
  { key: "growth:analytics-lead" },
);
