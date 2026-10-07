import "server-only";
import { createHash } from "node:crypto";
import type { ErrorEvent } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { notifyMany } from "@/lib/services/notifications";
import { maybePurgeExpiredRecords } from "@/lib/legal/retention-run";
import { uid } from "@/lib/utils";
import { addErrorOccurrence, BROWSER_METHOD, capErrorGroups, normalizeRoutePath, type ErrorInput } from "./shared";

/**
 * Server side of the admin error log. `recordError` never throws: failing to
 * log an error must not cause another one.
 */

/**
 * New error groups notify administrators in-app, at most this many per hour.
 * Browser reports (which anyone can send) have their own, smaller budget, so
 * they can never use up the alerts meant for server errors.
 */
const ALERTS_PER_HOUR = { server: 10, browser: 3 } as const;
type AlertSource = keyof typeof ALERTS_PER_HOUR;
const g = globalThis as unknown as { __llErrorAlertSlots?: Partial<Record<AlertSource, number[]>> };

function takeAlertSlot(source: AlertSource, now: number): boolean {
  const slots = (g.__llErrorAlertSlots ??= {});
  const recent = (slots[source] ?? []).filter((t) => now - t < 60 * 60 * 1000);
  slots[source] = recent;
  if (recent.length >= ALERTS_PER_HOUR[source]) return false;
  recent.push(now);
  return true;
}

async function alertAdmins(event: ErrorEvent, reopened: boolean): Promise<void> {
  if (!takeAlertSlot(event.method === BROWSER_METHOD ? "browser" : "server", Date.now())) return;
  const db = await getDb();
  const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
  const where = event.path ? ` on ${event.path}` : "";
  // Browser reports are written by visitors, so the alert says where the text came from.
  const kind = event.method === BROWSER_METHOD ? "browser error report" : "error";
  await notifyMany(admins, {
    type: "system",
    subject: reopened ? `A resolved ${kind} happened again${where}` : `New ${kind}${where}`,
    message: event.message.slice(0, 200),
    link: `/admin/errors/${event.id}`,
    email: false,
    dedupeKey: `error:${event.id}:${event.count}`,
  });
}

/** Store one occurrence (grouped). Returns the group, or null if logging failed. */
export async function recordError(input: ErrorInput): Promise<ErrorEvent | null> {
  try {
    const result = await mutate((db) => {
      const outcome = addErrorOccurrence(db.errorEvents, input, new Date(), () => uid("err"));
      if (!outcome) return null;
      const capped = capErrorGroups(db.errorEvents);
      if (capped !== db.errorEvents) db.errorEvents = capped;
      return { ...outcome, event: { ...outcome.event } };
    });
    if (!result) return null;
    if (result.isNew || result.reopened) {
      void alertAdmins(result.event, result.reopened).catch(() => undefined);
      void maybePurgeExpiredRecords();
    }
    return result.event;
  } catch (err) {
    console.error("[errors] failed to record error", err instanceof Error ? err.message : err);
    return null;
  }
}

/** A group recorded from the server with this digest in the last few minutes (browser reports then add nothing). */
export async function hasRecentServerDigest(digest: string, withinMs = 10 * 60 * 1000): Promise<boolean> {
  const db = await getDb();
  const since = Date.now() - withinMs;
  return db.errorEvents.some((e) => e.digest === digest && e.method !== BROWSER_METHOD && new Date(e.lastSeenAt).getTime() >= since);
}

/** Session cookie value from a raw Cookie header. */
function sessionTokenFromCookieHeader(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === siteConfig.sessionCookie) {
      const value = part.slice(eq + 1).trim();
      return value && value.length <= 200 ? value : null;
    }
  }
  return null;
}

async function userIdFromCookieHeader(header: string | string[] | undefined): Promise<string | undefined> {
  const token = sessionTokenFromCookieHeader(header);
  if (!token) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = await getDb();
  const session = db.sessions.find((s) => s.tokenHash === tokenHash);
  return session && new Date(session.expiresAt).getTime() > Date.now() ? session.userId : undefined;
}

export interface RequestErrorInfo {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface RequestErrorContext {
  routePath?: string;
  routeType?: string;
}

/** Errors Next uses for control flow (redirect(), notFound(), dynamic bail-outs) are not failures. */
function isControlFlowError(err: unknown): boolean {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("BAILOUT_TO_CLIENT_SIDE_RENDERING");
}

/** Entry point for `onRequestError` in `src/instrumentation.ts`. Only reads the path, method and session cookie. */
export async function recordRequestError(err: unknown, request: RequestErrorInfo, context: RequestErrorContext): Promise<void> {
  if (isControlFlowError(err)) return;
  const error = err instanceof Error ? err : null;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  let userId: string | undefined;
  try {
    userId = await userIdFromCookieHeader(request.headers?.cookie);
  } catch {
    userId = undefined;
  }
  await recordError({
    message: error ? `${error.name && error.name !== "Error" ? `${error.name}: ` : ""}${error.message}` : String(err),
    stack: error?.stack,
    digest,
    path: normalizeRoutePath(context.routePath) ?? request.path,
    method: context.routeType === "action" ? "ACTION" : request.method,
    userId,
  });
}
