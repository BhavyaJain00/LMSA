import "server-only";
import { getDb, mutate } from "@/lib/db/store";
import { type BroadcastRunResult, processBroadcasts } from "./broadcasts";
import { countUnsubscribes } from "./campaign-core";
import { type SequenceRunResult, processSequences } from "./sequences";
import { maybePruneEmailEvents } from "./tracking";

/**
 * The comms runner: starts scheduled broadcasts, queues the next batches of
 * broadcasts that are sending (within their per-minute throttle), enrolls
 * people in sequences and sends sequence steps that are due.
 *
 * It runs
 *  - from `/api/cron/comms?key=…` (the reliable clock; every minute or five),
 *  - lazily when staff open the broadcast and sequence pages,
 *  - right after an action or a domain event that created work, and
 *  - from an in-process timer armed for the next known due time, so a send
 *    keeps going and a scheduled broadcast starts on time while the server is
 *    up even without cron.
 *
 * Only one run is active per process; a call during a run asks for another
 * one right after it.
 */

export interface CommsRunResult {
  ran: boolean;
  reason?: "already_running";
  startedAt: string;
  durationMs: number;
  broadcasts: BroadcastRunResult;
  sequences: SequenceRunResult;
  /** Campaign rows whose delivery or unsubscribe numbers were refreshed. */
  statsUpdated: number;
  /** Tracking events removed because their email and campaign are gone. */
  eventsPruned: number;
  /** When the runner should run next (ISO), or null when nothing is waiting. */
  nextRunAt: string | null;
  error?: string;
}

interface RunnerState {
  running: Promise<CommsRunResult> | null;
  rerun: boolean;
  timer: NodeJS.Timeout | null;
  timerAt: number;
  lastRun: CommsRunResult | null;
  /** Off in tests, where runs are started explicitly. */
  autoRun: boolean;
}

const g = globalThis as unknown as { __llCommsRunner?: RunnerState };
function state(): RunnerState {
  return (g.__llCommsRunner ??= { running: null, rerun: false, timer: null, timerAt: 0, lastRun: null, autoRun: true });
}

/** Longest the in-process timer sleeps; cron covers anything further away. */
const MAX_TIMER_MS = 15 * 60_000;
/** Broadcast statistics are refreshed from the outbox for this long after the send. */
const STATS_WINDOW_MS = 35 * 86_400_000;

const EMPTY_BROADCASTS: BroadcastRunResult = { started: 0, queued: 0, skipped: 0, finished: 0, sending: 0, nextAt: null };
const EMPTY_SEQUENCES: SequenceRunResult = { enrolled: 0, sent: 0, completed: 0, stopped: 0, nextAt: null };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

/**
 * Copy delivery results from the outbox onto the campaign rows, so the
 * numbers outlive the outbox clean-up: delivered and failed emails per
 * broadcast, and unsubscribes per broadcast and sequence. Counts only grow
 * (except "failed", which shrinks when failed emails are retried).
 * Returns how many rows changed.
 */
export async function refreshCampaignStats(now: number = Date.now()): Promise<number> {
  const db = await getDb();
  const tracked = db.broadcasts.filter((b) => b.status === "sending" || (b.status === "sent" && now - (Date.parse(b.sentAt ?? "") || 0) < STATS_WINDOW_MS));
  if (!tracked.length && !db.emailSequences.length) return 0;

  const delivery = new Map<string, { sent: number; failed: number }>();
  for (const email of db.emails) {
    if (!email.trackingId?.startsWith("broadcast:")) continue;
    const row = delivery.get(email.trackingId) ?? { sent: 0, failed: 0 };
    if (email.status === "sent") row.sent++;
    else if (email.status === "failed") row.failed++;
    delivery.set(email.trackingId, row);
  }
  const unsubscribes = countUnsubscribes(db);

  const broadcastPatches = new Map<string, { delivered: number; failed: number; unsubscribes: number }>();
  for (const b of tracked) {
    const key = `broadcast:${b.id}`;
    const counts = delivery.get(key);
    const patch = {
      delivered: Math.max(b.delivered ?? 0, counts?.sent ?? 0),
      failed: counts ? counts.failed : (b.failed ?? 0),
      unsubscribes: Math.max(b.unsubscribes ?? 0, unsubscribes.get(key) ?? 0),
    };
    if (patch.delivered !== (b.delivered ?? 0) || patch.failed !== (b.failed ?? 0) || patch.unsubscribes !== (b.unsubscribes ?? 0)) broadcastPatches.set(b.id, patch);
  }
  const sequencePatches = new Map<string, number>();
  for (const s of db.emailSequences) {
    const count = unsubscribes.get(`sequence:${s.id}`) ?? 0;
    if (count > (s.unsubscribes ?? 0)) sequencePatches.set(s.id, count);
  }
  if (!broadcastPatches.size && !sequencePatches.size) return 0;

  return mutate((live) => {
    let changed = 0;
    for (const row of live.broadcasts.filter((b) => broadcastPatches.has(b.id))) {
      const patch = broadcastPatches.get(row.id)!;
      row.delivered = Math.max(row.delivered ?? 0, patch.delivered);
      row.failed = patch.failed;
      row.unsubscribes = Math.max(row.unsubscribes ?? 0, patch.unsubscribes);
      changed++;
    }
    for (const row of live.emailSequences.filter((s) => sequencePatches.has(s.id))) {
      row.unsubscribes = Math.max(row.unsubscribes ?? 0, sequencePatches.get(row.id)!);
      changed++;
    }
    return changed;
  });
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

async function runOnce(now: number): Promise<CommsRunResult> {
  const started = Date.now();
  const result: CommsRunResult = {
    ran: true,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    broadcasts: EMPTY_BROADCASTS,
    sequences: EMPTY_SEQUENCES,
    statsUpdated: 0,
    eventsPruned: 0,
    nextRunAt: null,
  };
  const errors: string[] = [];
  // Each part is independent: a failing broadcast must not hold back sequence emails.
  try {
    result.broadcasts = await processBroadcasts(now);
  } catch (error) {
    errors.push(`broadcasts: ${describe(error)}`);
  }
  try {
    result.sequences = await processSequences(now);
  } catch (error) {
    errors.push(`sequences: ${describe(error)}`);
  }
  try {
    result.statsUpdated = await refreshCampaignStats(now);
  } catch (error) {
    errors.push(`statistics: ${describe(error)}`);
  }
  result.eventsPruned = await maybePruneEmailEvents(now);

  const next = [result.broadcasts.nextAt, result.sequences.nextAt].filter((at): at is number => at !== null);
  if (next.length) result.nextRunAt = new Date(Math.min(...next)).toISOString();
  if (errors.length) {
    result.error = errors.join("; ");
    console.error("[comms] run failed:", result.error);
  }
  result.durationMs = Date.now() - started;
  const { broadcasts: b, sequences: s } = result;
  if (b.started || b.queued || b.finished || s.enrolled || s.sent || s.stopped) {
    console.info(
      `[comms] run: ${b.queued} broadcast emails queued (${b.started} started, ${b.finished} finished), ${s.enrolled} enrolled in sequences, ${s.sent} sequence emails queued, ${s.stopped} stopped (${result.durationMs} ms)`,
    );
  }
  return result;
}

function skipped(reason: CommsRunResult["reason"]): CommsRunResult {
  return {
    ran: false,
    reason,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    broadcasts: EMPTY_BROADCASTS,
    sequences: EMPTY_SEQUENCES,
    statsUpdated: 0,
    eventsPruned: 0,
    nextRunAt: null,
  };
}

/**
 * Run the comms work that is due now. With `wait`, a call made during
 * another run waits for it and then runs itself (cron, actions that report
 * the outcome); without it the active run is asked to go again.
 */
export async function runComms(opts: { wait?: boolean; now?: number } = {}): Promise<CommsRunResult> {
  const s = state();
  if (s.running) {
    if (!opts.wait) {
      s.rerun = true;
      return skipped("already_running");
    }
    while (s.running) await s.running.catch(() => undefined);
  }
  const run = runOnce(opts.now ?? Date.now());
  s.running = run;
  try {
    const result = await run;
    s.lastRun = result;
    if (result.nextRunAt) armTimer(Date.parse(result.nextRunAt) - Date.now());
    return result;
  } finally {
    s.running = null;
    if (s.rerun) {
      s.rerun = false;
      armTimer(50);
    }
  }
}

function armTimer(delayMs: number): void {
  const s = state();
  if (!s.autoRun) return;
  const delay = Math.min(MAX_TIMER_MS, Math.max(50, delayMs));
  const at = Date.now() + delay;
  if (s.timer && s.timerAt <= at) return;
  if (s.timer) clearTimeout(s.timer);
  s.timerAt = at;
  s.timer = setTimeout(() => {
    s.timer = null;
    s.timerAt = 0;
    runComms().catch((error) => console.error("[comms] run failed:", describe(error)));
  }, delay);
  s.timer.unref?.();
}

/** Fire-and-forget: run soon (bursts of calls share one run). Never throws. */
export function kickComms(delayMs = 100): void {
  armTimer(delayMs);
}

/** The outcome of the most recent run in this process, for the admin pages. */
export function getLastCommsRun(): CommsRunResult | null {
  return state().lastRun;
}

/** Switch the in-process timer off or on (tests start runs themselves). */
export function setCommsAutoRun(enabled: boolean): void {
  const s = state();
  s.autoRun = enabled;
  if (!enabled && s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
    s.timerAt = 0;
  }
}
