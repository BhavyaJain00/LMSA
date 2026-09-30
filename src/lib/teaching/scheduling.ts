import "server-only";
import { after } from "next/server";
import type { Course, Lesson } from "@/lib/types";
import { coursePublishState, isLessonLive, publishTime } from "./schedule-shared";

/**
 * Scheduled publishing on the server: the visibility checks used by the
 * catalog and the lesson outline, and the lazy trigger of the publish sweep.
 *
 * There is no cron. `isPublishedNow` and `isLessonPublishedNow` compare the
 * publish time with the clock on every call, so content appears on time even
 * if nothing else happens. When a check notices work that still has to be
 * written down (a course whose time has come, a released lesson that has not
 * been announced yet) it queues `runPublishSweep` to run after the response;
 * the sweep flips the stored flags and sends the notifications exactly once
 * (see `publish-sweep.ts`, loaded on demand to keep this module light: it is
 * imported by `src/lib/data/courses.ts`).
 */

interface SweepQueue {
  /** A sweep is queued or running; resolves when it has finished. */
  pending: Promise<void> | null;
  /** When the last queued sweep finished (epoch ms). */
  finishedAt: number;
}

const g = globalThis as unknown as { __llPublishSweepQueue?: SweepQueue };
const queue: SweepQueue = (g.__llPublishSweepQueue ??= { pending: null, finishedAt: 0 });

/** A failing sweep is not retried more often than this. */
const MIN_GAP_MS = 2000;

/** Run the publish sweep once the current response has been sent. Never throws, never waits. */
export function queuePublishSweep(): void {
  if (queue.pending || Date.now() - queue.finishedAt < MIN_GAP_MS) return;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  queue.pending = started
    .then(() => import("./publish-sweep"))
    .then((m) => m.runPublishSweep())
    .then(
      () => undefined,
      (error: unknown) => console.error("[schedule] the publish sweep failed:", error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      queue.pending = null;
      queue.finishedAt = Date.now();
    });
  try {
    after(start);
  } catch {
    // Outside a request (scripts, background work): run on the next tick instead.
    setImmediate(start);
  }
}

/** Resolves once a queued sweep (if any) has finished. For tests and graceful shutdown. */
export async function publishSweepSettled(): Promise<void> {
  while (queue.pending) await queue.pending;
}

/**
 * Whether a course is published right now: published by hand, or scheduled
 * and its time has come (the course must still be approved).
 */
export function isPublishedNow(course: Pick<Course, "published" | "publishAt" | "status">, now: number = Date.now()): boolean {
  const state = coursePublishState(course, now);
  // "due": the flag and the announcements are still to be written. A live course that still
  // carries a publish time was published by hand before its schedule: the time is cleared.
  if (state === "due" || (state === "live" && course.publishAt)) queuePublishSweep();
  return state === "live" || state === "due";
}

/** Whether learners can see a lesson right now (it has no publish time, or the time has passed). */
export function isLessonPublishedNow(lesson: Pick<Lesson, "publishAt">, now: number = Date.now()): boolean {
  const live = isLessonLive(lesson, now);
  // A passed publish time that is still stored means the release has not been announced yet.
  if (live && publishTime(lesson) !== null) queuePublishSweep();
  return live;
}
