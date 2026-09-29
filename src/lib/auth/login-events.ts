import "server-only";
import type { LoginEvent } from "@/lib/types";
import { filter, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import type { LoginEventReason } from "./login-reasons";
import { LOGIN_EVENT_REASONS } from "./login-reasons";
import { SlidingWindowRateLimiter } from "./rate-limit";

/**
 * Login history. Every sign-in attempt (successful or not) is recorded with
 * the outcome, IP and user agent. The log is pruned on write so it stays
 * bounded, and pruned per bucket so a flood of cheap requests can't wipe the
 * history that matters:
 *
 *  - events older than 180 days are dropped;
 *  - each account keeps its newest 100 successful sign-ins and, separately,
 *    its newest 200 other events (failures can't push out successes);
 *  - events without an account keep at most 20 per email address and 2,000
 *    in total, so anonymous floods never touch account history;
 *  - past 20,000 events overall, anonymous events go first, then failures,
 *    then successful sign-ins (oldest first within each group).
 *
 * Blocked attempts (`rate_limited`, `locked`) are coalesced: at most one per
 * reason and address (or account) per 15 minutes is written.
 */

export const LOGIN_EVENT_LIMITS = {
  retentionMs: 180 * 24 * 60 * 60 * 1000,
  perUserSuccess: 100,
  perUserOther: 200,
  perEmailAnonymous: 20,
  anonymousTotal: 2_000,
  total: 20_000,
};

export type LoginEventLimits = typeof LOGIN_EVENT_LIMITS;

/** Pure: which events to keep (input in chronological order, output too). */
export function pruneLoginEvents(events: readonly LoginEvent[], now: number, limits: LoginEventLimits = LOGIN_EVENT_LIMITS): LoginEvent[] {
  const cutoff = new Date(now - limits.retentionMs).toISOString();
  const counts = new Map<string, number>();
  let anonymous = 0;
  const keep: boolean[] = new Array<boolean>(events.length).fill(false);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (!(typeof e.createdAt === "string" && e.createdAt >= cutoff)) continue;
    let bucket: string;
    let cap: number;
    if (e.userId) {
      bucket = `u:${e.userId}:${e.success ? "ok" : "other"}`;
      cap = e.success ? limits.perUserSuccess : limits.perUserOther;
    } else {
      if (anonymous >= limits.anonymousTotal) continue;
      bucket = `e:${e.email}`;
      cap = limits.perEmailAnonymous;
    }
    const n = counts.get(bucket) ?? 0;
    if (n >= cap) continue;
    counts.set(bucket, n + 1);
    if (!e.userId) anonymous++;
    keep[i] = true;
  }
  let kept = events.filter((_, i) => keep[i]);
  let excess = kept.length - limits.total;
  if (excess > 0) {
    const rank = (e: LoginEvent) => (!e.userId ? 0 : e.success ? 2 : 1);
    const drop = new Set<LoginEvent>();
    for (const group of [0, 1, 2]) {
      for (const e of kept) {
        if (excess <= 0) break;
        if (rank(e) === group) {
          drop.add(e);
          excess--;
        }
      }
    }
    kept = kept.filter((e) => !drop.has(e));
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Coalescing of blocked attempts                                       */
/* ------------------------------------------------------------------ */

const BLOCKED_REASONS: ReadonlySet<LoginEventReason> = new Set(["rate_limited", "locked"]);
const BLOCKED_EVENT_RULE = { limit: 1, windowMs: 15 * 60 * 1000 };

const g = globalThis as unknown as { __llBlockedLoginEvents?: SlidingWindowRateLimiter };
const blockedEvents: SlidingWindowRateLimiter = (g.__llBlockedLoginEvents ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

/** Whether an event should be written: always, except repeats of a blocked outcome within 15 minutes. */
export function shouldRecordLoginEvent(reason: LoginEventReason, subject: string, now: number = Date.now()): boolean {
  if (!BLOCKED_REASONS.has(reason)) return true;
  return blockedEvents.hit(`${reason}:${subject.trim().toLowerCase()}`, BLOCKED_EVENT_RULE, now).ok;
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

export interface LoginEventInput {
  userId?: string;
  email: string;
  reason: LoginEventReason;
  ip?: string;
  userAgent?: string;
}

/** Write an event (blocked repeats are coalesced; returns null when skipped). */
export async function recordLoginEvent(input: LoginEventInput): Promise<LoginEvent | null> {
  const now = new Date();
  const email = input.email.trim().toLowerCase().slice(0, 254);
  if (!shouldRecordLoginEvent(input.reason, input.userId ?? email, now.getTime())) return null;
  const event: LoginEvent = {
    id: uid("lev"),
    userId: input.userId,
    email,
    success: LOGIN_EVENT_REASONS[input.reason].signedIn,
    reason: input.reason,
    ip: input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : undefined,
    userAgent: input.userAgent ? input.userAgent.slice(0, 300) : undefined,
    createdAt: now.toISOString(),
  };
  await mutate((db) => {
    db.loginEvents.push(event);
    db.loginEvents = pruneLoginEvents(db.loginEvents, now.getTime());
  });
  return event;
}

/** Most recent events for one account, newest first. */
export async function getLoginEventsForUser(userId: string, limit = 20): Promise<LoginEvent[]> {
  const rows = await filter("loginEvents", (e) => e.userId === userId);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
