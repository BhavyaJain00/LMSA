import "server-only";

/**
 * Teaching tools reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 * Rubrics and peer review register nothing here on purpose: reviews are
 * handed out when the assignment re-renders right after a submission
 * (`AssignmentFeedback`), and deadlines, reminders and lesson completion are
 * settled by the throttled `runPeerReviewSweep` that the assignment and peer
 * review pages start in the background. Event handlers of the other teaching
 * tools (e.g. instructor earnings on `payment.paid`) belong in this file.
 */

export {};
