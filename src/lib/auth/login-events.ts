import "server-only";
import type { LoginEvent } from "@/lib/types";
import { filter, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import type { LoginEventReason } from "./login-reasons";
import { LOGIN_EVENT_REASONS } from "./login-reasons";

/**
 * Login history. Every sign-in attempt (successful or not) is recorded with
 * the outcome, IP and user agent. The log is pruned on write so it stays
 * bounded: events older than 180 days are dropped and at most 20 000 kept.
 */

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 20_000;

export interface LoginEventInput {
  userId?: string;
  email: string;
  reason: LoginEventReason;
  ip?: string;
  userAgent?: string;
}

export async function recordLoginEvent(input: LoginEventInput): Promise<LoginEvent> {
  const now = new Date();
  const event: LoginEvent = {
    id: uid("lev"),
    userId: input.userId,
    email: input.email.trim().toLowerCase().slice(0, 254),
    success: LOGIN_EVENT_REASONS[input.reason].signedIn,
    reason: input.reason,
    ip: input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : undefined,
    userAgent: input.userAgent ? input.userAgent.slice(0, 300) : undefined,
    createdAt: now.toISOString(),
  };
  await mutate((db) => {
    db.loginEvents.push(event);
    const cutoff = now.getTime() - RETENTION_MS;
    const oldestKept = db.loginEvents.length > MAX_EVENTS ? db.loginEvents.length - MAX_EVENTS : 0;
    if (oldestKept > 0 || (db.loginEvents[0] && new Date(db.loginEvents[0].createdAt).getTime() < cutoff)) {
      db.loginEvents = db.loginEvents.slice(oldestKept).filter((e) => new Date(e.createdAt).getTime() >= cutoff);
    }
  });
  return event;
}

/** Most recent events for one account, newest first. */
export async function getLoginEventsForUser(userId: string, limit = 20): Promise<LoginEvent[]> {
  const rows = await filter("loginEvents", (e) => e.userId === userId);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
