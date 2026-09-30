/**
 * Daily message quota for the AI tutor (Settings → AI tutor → daily limit).
 * The day runs from 00:00 to 24:00 UTC so the limit resets at the same moment
 * for everyone.
 *
 * Pure: unit tested in tests/ai-tutor-quota.test.ts.
 */

export interface QuotaStatus {
  /** 0 means unlimited. */
  limit: number;
  used: number;
  /** Messages left today; null when unlimited. */
  remaining: number | null;
  exceeded: boolean;
  /** ISO time the counter resets (next midnight UTC). */
  resetsAt: string;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
}

/** Normalise a configured limit: whole number ≥ 0 (anything invalid means "unlimited"). */
export function normalizeDailyLimit(limit: unknown): number {
  const n = typeof limit === "number" ? limit : Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function quotaStatus(used: number, limit: unknown, now: Date = new Date()): QuotaStatus {
  const cap = normalizeDailyLimit(limit);
  const count = Math.max(0, Math.floor(used));
  return {
    limit: cap,
    used: count,
    remaining: cap ? Math.max(0, cap - count) : null,
    exceeded: cap > 0 && count >= cap,
    resetsAt: nextUtcMidnight(now).toISOString(),
  };
}

/**
 * Count the questions a learner sent today, given their messages and the ids
 * of their conversations (messages from other people's conversations never count).
 */
export function countQuestionsToday(
  messages: readonly { conversationId: string; role: string; createdAt: string }[],
  conversationIds: ReadonlySet<string>,
  now: Date = new Date(),
): number {
  const since = startOfUtcDay(now).toISOString();
  let n = 0;
  for (const m of messages) {
    if (m.role === "user" && m.createdAt >= since && conversationIds.has(m.conversationId)) n++;
  }
  return n;
}
