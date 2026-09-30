import "server-only";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { clampRetentionDays, purgeExpiredRecords, type RetentionResult } from "./retention";

/** Purges run at most this often (they are triggered lazily by the admin log pages and by new audit entries). */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

const g = globalThis as unknown as { __llRetention?: { lastRunAt: number; running: Promise<RetentionResult | null> | null } };
const state = (g.__llRetention ??= { lastRunAt: 0, running: null });

/**
 * Apply `settings.legal.dataRetentionDays` if the last purge is older than
 * six hours, or right away with `force` (used when the retention period
 * changes). Never throws; returns what was removed (null when skipped).
 */
export async function maybePurgeExpiredRecords(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<RetentionResult | null> {
  if (state.running) return state.running;
  if (!opts.force && now.getTime() - state.lastRunAt < RETENTION_INTERVAL_MS) return null;
  state.lastRunAt = now.getTime();
  state.running = (async () => {
    try {
      const { result, retentionDays } = await mutate((db) => ({
        result: purgeExpiredRecords(db, db.settings.legal.dataRetentionDays, now),
        retentionDays: clampRetentionDays(db.settings.legal.dataRetentionDays),
      }));
      if (result.auditEvents || result.errorEvents || result.consents) {
        await audit(null, "retention.purge", undefined, { ...result, retentionDays });
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
