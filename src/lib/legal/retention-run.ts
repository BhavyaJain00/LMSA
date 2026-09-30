import "server-only";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { purgeExpiredRecords, type RetentionResult } from "./retention";

/** Purges run at most this often (they are triggered lazily by admin pages and new log entries). */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

const g = globalThis as unknown as { __llRetention?: { lastRunAt: number; running: Promise<RetentionResult | null> | null } };
const state = (g.__llRetention ??= { lastRunAt: 0, running: null });

/**
 * Apply `settings.legal.dataRetentionDays` if the last purge is older than
 * six hours. Never throws; returns what was removed (null when skipped).
 */
export async function maybePurgeExpiredRecords(now: Date = new Date()): Promise<RetentionResult | null> {
  if (state.running) return state.running;
  if (now.getTime() - state.lastRunAt < INTERVAL_MS) return null;
  state.lastRunAt = now.getTime();
  state.running = (async () => {
    try {
      const result = await mutate((db) => purgeExpiredRecords(db, db.settings.legal.dataRetentionDays, now));
      if (result.auditEvents || result.errorEvents || result.consents) {
        await audit(null, "retention.purge", undefined, { ...result });
      }
      return result;
    } catch (err) {
      console.error("[retention] purge failed", err instanceof Error ? err.message : err);
      return null;
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}
