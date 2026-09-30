import type { Database } from "@/lib/types";

/**
 * Data retention (`settings.legal.dataRetentionDays`): audit events, error
 * groups and cookie-consent evidence older than the retention period are
 * purged. Consent evidence is kept for at least a year, as long as the
 * consent cookie it backs up can live.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Lower and upper bounds accepted for the setting. */
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 3650;
/** The consent cookie lasts a year, so its evidence must too. */
const CONSENT_MIN_DAYS = 365;

export function clampRetentionDays(days: number): number {
  if (!Number.isFinite(days)) return 365;
  return Math.min(RETENTION_MAX_DAYS, Math.max(RETENTION_MIN_DAYS, Math.round(days)));
}

export interface RetentionResult {
  auditEvents: number;
  errorEvents: number;
  consents: number;
}

function olderThan(iso: string | undefined, cutoff: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < cutoff;
}

/** Remove expired rows in place; returns how many were removed per collection. */
export function purgeExpiredRecords(db: Pick<Database, "auditEvents" | "errorEvents" | "consents">, retentionDays: number, now: Date = new Date()): RetentionResult {
  const days = clampRetentionDays(retentionDays);
  const cutoff = now.getTime() - days * DAY_MS;
  const consentCutoff = now.getTime() - Math.max(days, CONSENT_MIN_DAYS) * DAY_MS;

  const audit = db.auditEvents.filter((e) => !olderThan(e.createdAt, cutoff));
  const errors = db.errorEvents.filter((e) => !olderThan(e.lastSeenAt || e.createdAt, cutoff));
  const consents = db.consents.filter((c) => !olderThan(c.createdAt, consentCutoff));
  const result: RetentionResult = {
    auditEvents: db.auditEvents.length - audit.length,
    errorEvents: db.errorEvents.length - errors.length,
    consents: db.consents.length - consents.length,
  };
  if (result.auditEvents) db.auditEvents = audit;
  if (result.errorEvents) db.errorEvents = errors;
  if (result.consents) db.consents = consents;
  return result;
}

export function retentionCutoff(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - clampRetentionDays(retentionDays) * DAY_MS);
}
