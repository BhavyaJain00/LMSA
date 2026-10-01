import "server-only";
import { on } from "@/lib/events";
import { creditEarnings, reverseEarningsForRefund } from "./marketplace";

/**
 * Teaching tools reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 *  - `payment.paid`: credit the approved marketplace instructors of the
 *    order's courses (idempotent per order; off unless the marketplace is on).
 *  - `payment.refunded`: void or reduce those earnings.
 *
 * Rubrics and peer review register nothing here on purpose: reviews are
 * handed out when the assignment re-renders right after a submission
 * (`AssignmentFeedback`), and deadlines, reminders and lesson completion are
 * settled by the throttled `runPeerReviewSweep` that the assignment and peer
 * review pages start in the background.
 */

on(
  "payment.paid",
  async (event) => {
    await creditEarnings(event.data.paymentId);
  },
  { key: "teaching:instructor-earnings" },
);

on(
  "payment.refunded",
  async (event) => {
    await reverseEarningsForRefund(event.data);
  },
  { key: "teaching:instructor-earnings-refund" },
);
