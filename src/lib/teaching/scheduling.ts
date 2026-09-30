import "server-only";
import { after } from "next/server";
import type { Course, Lesson } from "@/lib/types";
import { coursePublishState, isLessonLive, publishTime } from "./schedule-shared";

/**
 * Scheduled publishing on the server: the visibility checks used by the
 * catalog and the lesson outline, and the lazy trigger of the publish sweep.
 *
 * No cron is needed. `isPublishedNow` and `isLessonPublishedNow` compare the
 * publish time with the clock on every call, so content appears on time even
 * if nothing else happens. When a check notices work that still has to be
 * written down (a course whose time has come, a released lesson that has not
 * been announced yet) it queues `runPublishSweep` to run after the response;
 * the sweep flips the stored flags and sends the notifications exactly once
 * (see `publish-sweep.ts`, loaded on demand to keep this module light: it is
 * imported by `src/lib/data/courses.ts`).
 *
 * While the server keeps running, a timer also wakes the sweep at the next
 * publish time, so announcements go out on time on a quiet site. The timer is
 * only a convenience: after a restart the first visibility check arms it again.
 */

interface SweepQueue {
  /** A sweep is queued or running; resolves when it has finished. */
  pending: Promise<void> | null;
  /** When the last queued sweep finished (epoch ms). */
  finishedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** The publish time the timer is waiting for (epoch ms). */
  timerAt: number;
}

const g = globalThis as unknown as { __llPublishSweepQueue?: SweepQueue };
const queue: SweepQueue = (g.__llPublishSweepQueue ??= { pending: null, finishedAt: 0, timer: null, timerAt: 0 });
// A queue created by an older version of this module (hot reload) has no timer fields yet.
queue.timer ??= null;
queue.timerAt ??= 0;

/** A failing sweep is not retried more often than this. */
const MIN_GAP_MS = 2000;
/** Longest single wait of the timer (`setTimeout` cannot wait longer than about 24 days). */
const MAX_TIMER_MS = 6 * 3_600_000;
/** The timer fires slightly late so the publish time has certainly passed. */
const TIMER_SLACK_MS = 250;

/** `next build` renders pages too; nothing is published or announced from there. */
const building = () => process.env.NEXT_PHASE === "phase-production-build";

function startSweep(): Promise<void> {
  return import("./publish-sweep")
    .then((m) => m.runPublishSweep())
    .then(
      () => undefined,
      (error: unknown) => console.error("[schedule] the publish sweep failed:", error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      queue.pending = null;
      queue.finishedAt = Date.now();
    });
}

/** Run the publish sweep once the current response has been sent. Never throws, never waits. */
export function queuePublishSweep(): void {
  if (queue.pending || building() || Date.now() - queue.finishedAt < MIN_GAP_MS) return;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const pending = gate.then(startSweep);
  queue.pending = pending;
  const begin = () => {
    open();
    return pending;
  };
  try {
    after(begin);
  } catch {
    // Outside a request (the timer, scripts, background work): run on the next tick instead.
    setImmediate(begin);
  }
}

/** Resolves once a queued sweep (if any) has finished. For tests and graceful shutdown. */
export async function publishSweepSettled(): Promise<void> {
  while (queue.pending) await queue.pending;
}

/**
 * Wake the sweep when the publish time `at` arrives (no-op when an earlier
 * wake-up is already set, or `at` has passed). The timer never keeps the
 * process alive.
 */
export function armPublishTimer(at: number | null): void {
  if (at === null || !Number.isFinite(at) || building()) return;
  const now = Date.now();
  if (at <= now || (queue.timer && queue.timerAt <= at)) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timerAt = at;
  queue.timer = setTimeout(
    () => {
      queue.timer = null;
      queue.timerAt = 0;
      // The sweep arms the timer again for whatever is still ahead (including this time, after a capped wait).
      queue.finishedAt = 0;
      queuePublishSweep();
    },
    Math.min(at - now + TIMER_SLACK_MS, MAX_TIMER_MS),
  );
  queue.timer.unref?.();
}

/**
 * Whether a course is published right now: published by hand, or scheduled
 * and its time has come (the course must still be approved).
 */
export function isPublishedNow(course: Pick<Course, "published" | "publishAt" | "status">, now: number = Date.now()): boolean {
  if (!course.publishAt) return course.published;
  const state = coursePublishState(course, now);
  // "due": the flag and the announcements are still to be written. A live course that still
  // carries a publish time was published by hand before its schedule: the time is cleared.
  if (state === "due" || state === "live") queuePublishSweep();
  else if (state === "scheduled") armPublishTimer(publishTime(course));
  return state === "live" || state === "due";
}

/** Whether learners can see a lesson right now (it has no publish time, or the time has passed). */
export function isLessonPublishedNow(lesson: Pick<Lesson, "publishAt">, now: number = Date.now()): boolean {
  const at = publishTime(lesson);
  if (at === null) return true;
  const live = isLessonLive(lesson, now);
  // A passed publish time that is still stored means the release has not been announced yet.
  if (live) queuePublishSweep();
  else armPublishTimer(at);
  return live;
}
