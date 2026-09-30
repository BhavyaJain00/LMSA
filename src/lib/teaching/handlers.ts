import "server-only";
import { on } from "@/lib/events";
import { getDb } from "@/lib/db/store";
import { activePeerConfig } from "./peer-shared";
import { runPeerReviewSweep, syncPeerAssignments } from "./peer-review";

/**
 * Teaching tools reactions to domain events (registered from `src/lib/handlers.ts`).
 *
 * Submitting an assignment from a lesson completes that lesson, so
 * `lesson.completed` is the moment a new submission can join peer review in
 * rolling mode: hand out reviews for the peer-reviewed assignments the lesson
 * embeds straight away. The throttled sweep also runs, which catches
 * deadline-mode assignments whose due point has passed and sends reminders.
 */
on(
  "lesson.completed",
  async (event) => {
    const db = await getDb();
    const lesson = db.lessons.find((l) => l.id === event.data.lessonId);
    if (!lesson) return;
    const assignmentIds = new Set<string>();
    for (const block of lesson.blocks) if (block.type === "assignment") assignmentIds.add(block.assignmentId);
    const peerIds = db.assignments.filter((a) => assignmentIds.has(a.id) && activePeerConfig(a)).map((a) => a.id);
    if (peerIds.length) await syncPeerAssignments({ assignmentIds: peerIds });
    await runPeerReviewSweep();
  },
  { key: "teaching:peer-allocation" },
);
