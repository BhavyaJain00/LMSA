import "server-only";
import { on } from "@/lib/events";
import { kickComms } from "./runner";
import { enrollInSequences, stopReachedGoals } from "./sequences";

/**
 * Comms reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 * Email sequences start on the event that matches their trigger, and end
 * early the moment their goal happens:
 *  - `user.registered`: "new account" sequences start (not for bulk imports);
 *    a lead nurture whose goal is "creates an account" stops for that address.
 *  - `lead.created`: the runner looks for newly confirmed leads (a lead is
 *    only enrolled once the double opt-in is confirmed, which the runner's
 *    sweep picks up).
 *  - `enrollment.created`: "course enrollment" sequences start for learners;
 *    "enrolls in a course" goals are reached.
 *  - `payment.paid`: "purchase" sequences start; "makes a purchase" goals are
 *    reached.
 *  - `course.completed`: "completes the course" goals are reached.
 */

on(
  "user.registered",
  async (event) => {
    const { userId, source } = event.data;
    await stopReachedGoals(userId);
    if (source !== "import" && (await enrollInSequences({ kind: "member", userId }, { trigger: "signup" }))) kickComms();
  },
  { key: "comms:sequence-signup" },
);

on(
  "lead.created",
  () => {
    kickComms();
  },
  { key: "comms:sequence-lead" },
);

on(
  "enrollment.created",
  async (event) => {
    const { userId, courseId, memberType } = event.data;
    await stopReachedGoals(userId);
    if (memberType !== "staff" && (await enrollInSequences({ kind: "member", userId }, { trigger: "enrollment", courseId }))) kickComms();
  },
  { key: "comms:sequence-enrollment" },
);

on(
  "payment.paid",
  async (event) => {
    const { userId, itemType, itemId } = event.data;
    await stopReachedGoals(userId);
    if (await enrollInSequences({ kind: "member", userId }, { trigger: "purchase", itemType, itemId })) kickComms();
  },
  { key: "comms:sequence-purchase" },
);

on(
  "course.completed",
  async (event) => {
    await stopReachedGoals(event.data.userId);
  },
  { key: "comms:sequence-completion" },
);
