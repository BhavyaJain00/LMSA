/**
 * Per-sender quotas for outbound mail to arbitrary addresses.
 *
 * Batch and course emails can be copied (CC) to any address an instructor
 * types in, using the platform's sender address and reputation. These
 * sliding-window quotas cap how many external recipients one member can reach
 * and how often an email may go out to CC addresses only (no member among
 * the recipients).
 *
 * Weighted sliding-window log kept in memory (per process, survives dev hot
 * reloads through `globalThis`). Pure module: no Node or Next APIs.
 */

export interface QuotaRule {
  /** Units allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface QuotaResult {
  ok: boolean;
  /** When refused: how long until enough units free up. */
  retryAfterMs: number;
  /** The rule that refused the request. */
  limit?: number;
  windowMs?: number;
}

interface Entry {
  at: number;
  amount: number;
}

const MAX_KEYS = 20_000;

export class WeightedQuota {
  private readonly log = new Map<string, Entry[]>();

  private recent(key: string, horizonMs: number, now: number): Entry[] {
    const entries = (this.log.get(key) ?? []).filter((e) => e.at > now - horizonMs && e.at <= now + 1000);
    if (entries.length) this.log.set(key, entries);
    else this.log.delete(key);
    return entries;
  }

  /** Check every rule; record `amount` units only when all of them allow it. */
  consume(key: string, amount: number, rules: QuotaRule[], now: number = Date.now()): QuotaResult {
    const units = Math.max(0, Math.floor(amount));
    if (!units) return { ok: true, retryAfterMs: 0 };
    const horizon = Math.max(...rules.map((r) => r.windowMs));
    const entries = this.recent(key, horizon, now);
    for (const rule of rules) {
      const inWindow = entries.filter((e) => e.at > now - rule.windowMs);
      const used = inWindow.reduce((sum, e) => sum + e.amount, 0);
      if (used + units > rule.limit) {
        // Find when enough of the oldest units leave this window.
        let freed = 0;
        let retryAt = now + rule.windowMs;
        for (const e of inWindow) {
          freed += e.amount;
          if (used - freed + units <= rule.limit) {
            retryAt = e.at + rule.windowMs;
            break;
          }
        }
        return { ok: false, retryAfterMs: units > rule.limit ? rule.windowMs : Math.max(0, retryAt - now), limit: rule.limit, windowMs: rule.windowMs };
      }
    }
    entries.push({ at: now, amount: units });
    this.log.delete(key);
    this.log.set(key, entries);
    while (this.log.size > MAX_KEYS) {
      const oldest = this.log.keys().next();
      if (oldest.done) break;
      this.log.delete(oldest.value);
    }
    return { ok: true, retryAfterMs: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.log.clear();
    else this.log.delete(key);
  }
}

/** External (CC) recipients one member may add to batch and course emails. */
export const EXTERNAL_RECIPIENT_RULES: QuotaRule[] = [
  { limit: 100, windowMs: 3_600_000 },
  { limit: 300, windowMs: 24 * 3_600_000 },
];

/** Emails that reach CC addresses only (moderators only). */
export const CC_ONLY_SEND_RULES: QuotaRule[] = [
  { limit: 5, windowMs: 3_600_000 },
  { limit: 20, windowMs: 24 * 3_600_000 },
];

const g = globalThis as unknown as { __llEmailQuota?: WeightedQuota };
function quota(): WeightedQuota {
  return (g.__llEmailQuota ??= new WeightedQuota());
}

/** Reserve `count` external recipients for `senderId`. */
export function reserveExternalRecipients(senderId: string, count: number, now?: number): QuotaResult {
  return quota().consume(`cc:${senderId}`, count, EXTERNAL_RECIPIENT_RULES, now);
}

/** Reserve one CC-only send for `senderId`. */
export function reserveCcOnlySend(senderId: string, now?: number): QuotaResult {
  return quota().consume(`cc-only:${senderId}`, 1, CC_ONLY_SEND_RULES, now);
}

/** Forget every counter (tests). */
export function resetEmailQuotas(): void {
  quota().reset();
}

/** "in 12 minutes" / "in 3 hours" for quota messages. */
export function retryAfterLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hours`;
}

/** Friendly refusal for the CC field. */
export function externalRecipientLimitMessage(result: QuotaResult): string {
  const per = result.windowMs && result.windowMs > 3_600_000 ? "per day" : "per hour";
  return `You can add at most ${result.limit ?? EXTERNAL_RECIPIENT_RULES[0]!.limit} CC recipients ${per}. Remove some addresses or try again ${retryAfterLabel(result.retryAfterMs)}.`;
}
