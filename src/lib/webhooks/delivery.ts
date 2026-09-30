import "server-only";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import type { DomainEvent } from "@/lib/events-shared";
import { siteConfig } from "@/lib/config";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import { webhookSsrfOptions } from "./config";
import { CANCELLED_MESSAGE, readWebhookSecret, switchEndpointOff } from "./endpoints";
import { isWebhookEventName } from "./events";
import { postWebhook, type WebhookHttpResult } from "./http";
import { TEST_EVENT_ID_PREFIX, buildTestPayload, buildWebhookPayload, databaseResolver, parseWebhookPayload, serializeWebhookPayload } from "./payload";
import { DELIVERY_RETENTION_DAYS, MAX_DELIVERY_ROWS, RETRY_DELAYS_MS, nextAttemptAt, shouldAutoDisable } from "./policy";
import { SIGNATURE_HEADER, signatureHeader } from "./signature";
import { isManualDelivery, type WebhookDisabledReason } from "./types";

/**
 * The webhook delivery worker.
 *
 *   domain event ──▶ enqueueWebhookEvent ──▶ one pending delivery per subscribed endpoint
 *                                                      │
 *   timer / cron / page load ──▶ runWebhookDeliveries ─┘──▶ POST (signed, 10 s, no redirects)
 *        2xx  → success
 *        else → retry later (8 attempts, see policy.ts), then failed
 *
 * Deliveries are at-least-once: a delivery stays "pending" while it is
 * attempted, so a server restart in the middle of an attempt sends it again.
 * Receivers deduplicate on the payload `id`.
 *
 * The worker runs from `/api/cron/webhooks` (the reliable clock), right
 * after an event is queued, when an administrator opens the webhook pages,
 * and from an in-process timer armed for the next retry. One run is active
 * per process. Endpoints are served in parallel, the deliveries of one
 * endpoint in order; after a connection failure, a timeout or a 5xx/429
 * answer the endpoint's other due deliveries wait a minute instead of
 * hammering a receiver that is down.
 */

export const WEBHOOK_USER_AGENT = "LearnLoop-Webhooks/1.0";

/** Deliveries attempted per run. */
export const DEFAULT_RUN_LIMIT = 200;
/** Endpoints served at the same time. */
const ENDPOINT_CONCURRENCY = 5;
/** Longest the in-process timer sleeps; cron covers anything further away. */
const MAX_TIMER_MS = 15 * 60_000;
/** The delivery log is pruned at most this often per process. */
const PRUNE_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/** Deliveries re-queued by one "Resend failed" action. */
export const MAX_BULK_RESEND = 100;

/** Sends one request. The default is the SSRF-guarded HTTP client; tests pass their own. */
export type WebhookTransport = (url: string, body: string, headers: Record<string, string>) => Promise<WebhookHttpResult>;

const httpTransport: WebhookTransport = (url, body, headers) => postWebhook(url, body, headers, webhookSsrfOptions());

export interface WebhookRunOptions {
  /** Wait for a run that is already active, then run (cron, actions). */
  wait?: boolean;
  now?: number;
  limit?: number;
  transport?: WebhookTransport;
  /** Prune the delivery log even if it was pruned recently (cron). */
  prune?: boolean;
}

export interface WebhookRunResult {
  ran: boolean;
  reason?: "already_running" | "api_disabled";
  /** Requests sent (or refused before sending) in this run. */
  attempted: number;
  delivered: number;
  /** Failed attempts that will be retried. */
  retrying: number;
  /** Deliveries that used their last attempt. */
  failed: number;
  /** Due deliveries held back because their endpoint just failed. */
  postponed: number;
  /** Waiting deliveries cancelled because their endpoint is off or gone. */
  cancelled: number;
  /** Endpoints switched off by this run. */
  disabled: number;
  /** Deliveries still waiting after the run. */
  pending: number;
  /** Old log rows removed. */
  pruned: number;
  /** When the worker should run next (ISO), or null when nothing is waiting. */
  nextRunAt: string | null;
  durationMs: number;
}

interface WorkerState {
  running: Promise<WebhookRunResult> | null;
  rerun: boolean;
  timer: NodeJS.Timeout | null;
  timerAt: number;
  lastRun: WebhookRunResult | null;
  lastPrunedAt: number;
  /** Tests and resends being sent right now by their action: the worker leaves them alone. */
  inFlight: Set<string>;
  /** Off in tests, where runs are started explicitly. */
  autoRun: boolean;
}

const g = globalThis as unknown as { __llWebhookWorker?: WorkerState };
function state(): WorkerState {
  return (g.__llWebhookWorker ??= { running: null, rerun: false, timer: null, timerAt: 0, lastRun: null, lastPrunedAt: 0, inFlight: new Set(), autoRun: true });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Host of an endpoint URL for messages and the audit log (never the path, which may hold a token). */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the endpoint";
  }
}

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

/** Headers of a webhook request. `timestamp` is in unix seconds and is part of the signature. */
export function deliveryHeaders(input: { secret: string; body: string; event: string; eventId: string; deliveryId: string; attempt: number; timestamp: number }): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": `${WEBHOOK_USER_AGENT} (+${siteConfig.appUrl}/developers)`,
    [SIGNATURE_HEADER]: signatureHeader(input.secret, input.body, input.timestamp),
    "LL-Event": input.event,
    "LL-Event-Id": input.eventId,
    "LL-Delivery": input.deliveryId,
    "LL-Attempt": String(input.attempt),
  };
}

interface AttemptOutcome {
  /** The delivery after the attempt, or null when it was removed or cancelled meanwhile. */
  delivery: WebhookDelivery | null;
  ok: boolean;
  /** The receiver looks down (no answer, 5xx, 429): hold its other deliveries back. */
  backOff: boolean;
  disabled: { endpoint: WebhookEndpoint; reason: WebhookDisabledReason; cancelled: number } | null;
}

/** Send one delivery and record the outcome on the delivery and its endpoint. */
async function attemptDelivery(delivery: WebhookDelivery, endpoint: WebhookEndpoint, transport: WebhookTransport, clock: () => number = Date.now): Promise<AttemptOutcome> {
  const secret = readWebhookSecret(endpoint);
  let result: WebhookHttpResult;
  if (!secret) {
    result = { ok: false, durationMs: 0, error: "The signing secret could not be read (APP_SECRET changed since it was created). Roll the secret of this endpoint." };
  } else {
    const headers = deliveryHeaders({
      secret,
      body: delivery.payload,
      event: delivery.event,
      eventId: delivery.eventId ?? delivery.id,
      deliveryId: delivery.id,
      attempt: delivery.attempts + 1,
      timestamp: Math.floor(clock() / 1000),
    });
    try {
      result = await transport(endpoint.url, delivery.payload, headers);
    } catch (error) {
      result = { ok: false, durationMs: 0, error: `The request could not be sent: ${describe(error).slice(0, 300)}` };
    }
  }

  const finishedAt = clock();
  const iso = new Date(finishedAt).toISOString();
  const recorded = await mutate((db) => {
    const row = db.webhookDeliveries.find((d) => d.id === delivery.id);
    if (!row || row.status !== "pending") return null;
    const manual = isManualDelivery(row);
    row.attempts += 1;
    row.lastAttemptAt = iso;
    row.durationMs = result.durationMs;
    if (result.status !== undefined) row.responseStatus = result.status;
    else delete row.responseStatus;
    if (result.body) row.responseBody = result.body;
    else delete row.responseBody;

    if (result.ok) {
      row.status = "success";
      row.deliveredAt = iso;
      delete row.lastError;
      delete row.nextAttemptAt;
    } else {
      row.lastError = result.error ?? "The delivery failed.";
      const next = manual ? null : nextAttemptAt(row.attempts, finishedAt);
      if (next === null) {
        row.status = "failed";
        delete row.nextAttemptAt;
      } else {
        row.nextAttemptAt = new Date(next).toISOString();
      }
    }

    let disabled: AttemptOutcome["disabled"] = null;
    const live = db.webhookEndpoints.find((e) => e.id === endpoint.id);
    if (live) {
      live.lastDeliveryAt = iso;
      // Tests and resends are made by hand: they never count for or against the endpoint.
      if (!manual && result.ok) {
        live.failureCount = 0;
        live.lastSuccessAt = iso;
        delete live.failingSince;
        delete live.lastError;
      } else if (!manual) {
        live.failureCount += 1;
        live.lastFailureAt = iso;
        live.failingSince ??= iso;
        live.lastError = row.lastError;
        // 410 Gone is how a receiver unsubscribes (the REST hooks convention).
        const reason: WebhookDisabledReason | null = result.status === 410 ? "gone" : shouldAutoDisable(live, finishedAt) ? "failures" : null;
        if (reason && live.active) {
          // This delivery keeps its own error; the others waiting are cancelled.
          row.status = "failed";
          delete row.nextAttemptAt;
          const cancelled = switchEndpointOff(db, live, new Date(finishedAt), reason);
          disabled = { endpoint: { ...live }, reason, cancelled };
        }
      }
    }
    return { delivery: { ...row }, disabled };
  });

  if (recorded?.disabled) await announceDisabled(recorded.disabled.endpoint, recorded.disabled.reason);
  const status = result.status;
  return {
    delivery: recorded?.delivery ?? null,
    ok: result.ok,
    backOff: !result.ok && (status === undefined || status >= 500 || status === 429),
    disabled: recorded?.disabled ?? null,
  };
}

/** Tell administrators that an endpoint was switched off, and record it in the audit log. Never throws. */
async function announceDisabled(endpoint: WebhookEndpoint, reason: WebhookDisabledReason): Promise<void> {
  const host = endpointHost(endpoint.url);
  try {
    await audit(null, "webhook.auto_disable", { type: "webhook", id: endpoint.id }, { host, reason, failures: endpoint.failureCount });
    const db = await getDb();
    const admins = db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
    await notifyMany(admins, {
      type: "system",
      subject: `Webhook endpoint switched off: ${host}`,
      message:
        reason === "gone"
          ? `${host} answered 410 Gone, which means it no longer wants these events. The endpoint was switched off; turn it back on in Settings → API & webhooks if that was a mistake.`
          : `Every delivery to ${host} has failed for more than a day (${endpoint.failureCount} attempts in a row). The endpoint was switched off so events stop queuing. Fix the receiver, then turn the endpoint back on and resend what it missed.`,
      link: `/admin/settings/api/webhooks/${endpoint.id}`,
      dedupeKey: `webhook-disabled:${endpoint.id}:${endpoint.disabledAt ?? ""}`,
    });
  } catch (error) {
    console.error("[webhooks] could not notify administrators about a disabled endpoint:", describe(error));
  }
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

/**
 * Queue a domain event for every active endpoint subscribed to it. Returns
 * the number of deliveries created (0 when the API is off, nothing is
 * subscribed, or the event was already queued).
 */
export async function enqueueWebhookEvent(event: DomainEvent): Promise<number> {
  if (!isWebhookEventName(event.name)) return 0;
  const db = await getDb();
  if (!db.settings.api.enabled) return 0;
  if (!db.webhookEndpoints.some((e) => e.active && e.events.includes(event.name))) return 0;

  const body = serializeWebhookPayload(buildWebhookPayload(event, databaseResolver(db, siteConfig.appUrl)));
  const created = await mutate((live) => {
    const now = new Date().toISOString();
    let count = 0;
    for (const endpoint of live.webhookEndpoints) {
      if (!endpoint.active || !endpoint.events.includes(event.name)) continue;
      // The bus may hand the same event over twice (a handler registered by two bundles).
      if (live.webhookDeliveries.some((d) => d.endpointId === endpoint.id && d.eventId === event.id && !isManualDelivery(d))) continue;
      live.webhookDeliveries.push({
        id: uid("whd"),
        endpointId: endpoint.id,
        event: event.name,
        eventId: event.id,
        payload: body,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
      count++;
    }
    return count;
  });
  if (created) kickWebhooks();
  return created;
}

function dueAt(delivery: WebhookDelivery): number {
  const at = Date.parse(delivery.nextAttemptAt ?? delivery.createdAt);
  return Number.isFinite(at) ? at : 0;
}

/** Cancel waiting deliveries whose endpoint was switched off or deleted. */
async function cancelOrphans(): Promise<number> {
  const db = await getDb();
  const { inFlight } = state();
  const active = new Set(db.webhookEndpoints.filter((e) => e.active).map((e) => e.id));
  if (!db.webhookDeliveries.some((d) => d.status === "pending" && !active.has(d.endpointId) && !inFlight.has(d.id))) return 0;
  return mutate((live) => {
    const on = new Set(live.webhookEndpoints.filter((e) => e.active).map((e) => e.id));
    let cancelled = 0;
    for (const delivery of live.webhookDeliveries) {
      if (delivery.status !== "pending" || on.has(delivery.endpointId) || inFlight.has(delivery.id)) continue;
      delivery.status = "failed";
      delivery.lastError = CANCELLED_MESSAGE;
      delete delivery.nextAttemptAt;
      cancelled++;
    }
    return cancelled;
  });
}

/**
 * Remove finished deliveries older than the retention period, then the
 * oldest finished ones beyond the row limit. Waiting deliveries are kept.
 */
export async function pruneWebhookDeliveries(now: number = Date.now()): Promise<number> {
  const cutoff = now - DELIVERY_RETENTION_DAYS * DAY_MS;
  const db = await getDb();
  const expired = (d: WebhookDelivery) => d.status !== "pending" && Date.parse(d.createdAt) < cutoff;
  if (db.webhookDeliveries.length <= MAX_DELIVERY_ROWS && !db.webhookDeliveries.some(expired)) return 0;
  return mutate((live) => {
    const before = live.webhookDeliveries.length;
    let kept = live.webhookDeliveries.filter((d) => !expired(d));
    const excess = kept.length - MAX_DELIVERY_ROWS;
    if (excess > 0) {
      const oldestFinished = kept
        .filter((d) => d.status !== "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, excess);
      const drop = new Set(oldestFinished.map((d) => d.id));
      kept = kept.filter((d) => !drop.has(d.id));
    }
    if (kept.length !== before) live.webhookDeliveries = kept;
    return before - kept.length;
  });
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function emptyResult(reason?: WebhookRunResult["reason"]): WebhookRunResult {
  return { ran: !reason, reason, attempted: 0, delivered: 0, retrying: 0, failed: 0, postponed: 0, cancelled: 0, disabled: 0, pending: 0, pruned: 0, nextRunAt: null, durationMs: 0 };
}

async function runOnce(opts: WebhookRunOptions): Promise<WebhookRunResult> {
  const started = Date.now();
  const now = opts.now ?? started;
  // A fixed `now` (tests, replays) also stamps what the run records.
  const clock = opts.now === undefined ? Date.now : () => now;
  const transport = opts.transport ?? httpTransport;
  const { inFlight } = state();
  const db = await getDb();
  if (!db.settings.api.enabled) return emptyResult("api_disabled");

  const result = emptyResult();
  result.cancelled = await cancelOrphans();

  const due = db.webhookDeliveries
    .filter((d) => d.status === "pending" && dueAt(d) <= now && !inFlight.has(d.id))
    .sort((a, b) => dueAt(a) - dueAt(b) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(1, opts.limit ?? DEFAULT_RUN_LIMIT));
  const queues = new Map<string, WebhookDelivery[]>();
  for (const delivery of due) {
    const queue = queues.get(delivery.endpointId);
    if (queue) queue.push(delivery);
    else queues.set(delivery.endpointId, [delivery]);
  }

  const serveEndpoint = async (endpointId: string, queue: WebhookDelivery[]) => {
    for (let index = 0; index < queue.length; index++) {
      const endpoint = (await getDb()).webhookEndpoints.find((e) => e.id === endpointId);
      if (!endpoint?.active) return;
      const outcome = await attemptDelivery(queue[index]!, endpoint, transport, clock);
      if (!outcome.delivery) continue;
      result.attempted++;
      if (outcome.ok) result.delivered++;
      else if (outcome.delivery.status === "pending") result.retrying++;
      else result.failed++;
      if (outcome.disabled) {
        result.disabled++;
        result.cancelled += outcome.disabled.cancelled;
        return;
      }
      if (outcome.backOff && index < queue.length - 1) {
        const rest = new Set(queue.slice(index + 1).map((d) => d.id));
        const retryAt = new Date(clock() + RETRY_DELAYS_MS[0]!).toISOString();
        result.postponed += await mutate((live) => {
          let postponed = 0;
          for (const row of live.webhookDeliveries) {
            if (!rest.has(row.id) || row.status !== "pending") continue;
            row.nextAttemptAt = retryAt;
            postponed++;
          }
          return postponed;
        });
        return;
      }
    }
  };

  const pendingEndpoints = [...queues.entries()];
  const workers = Array.from({ length: Math.min(ENDPOINT_CONCURRENCY, pendingEndpoints.length) }, async () => {
    for (let next = pendingEndpoints.shift(); next; next = pendingEndpoints.shift()) {
      try {
        await serveEndpoint(next[0], next[1]);
      } catch (error) {
        console.error("[webhooks] delivering to an endpoint failed:", describe(error));
      }
    }
  });
  await Promise.all(workers);

  const s = state();
  if (opts.prune || started - s.lastPrunedAt >= PRUNE_INTERVAL_MS) {
    s.lastPrunedAt = started;
    result.pruned = await pruneWebhookDeliveries(now);
  }

  const waiting = (await getDb()).webhookDeliveries.filter((d) => d.status === "pending");
  result.pending = waiting.length;
  if (waiting.length) result.nextRunAt = new Date(Math.min(...waiting.map(dueAt))).toISOString();
  result.durationMs = Date.now() - started;
  if (result.attempted || result.cancelled || result.pruned) {
    console.info(
      `[webhooks] run: ${result.delivered} delivered, ${result.retrying} to retry, ${result.failed} failed, ${result.postponed} postponed, ${result.cancelled} cancelled, ${result.disabled} endpoints switched off (${result.durationMs} ms)`,
    );
  }
  return result;
}

/**
 * Send the deliveries that are due. With `wait`, a call made during another
 * run waits for it and then runs itself; without it the active run is asked
 * to go again. Never sends while the API is switched off.
 */
export async function runWebhookDeliveries(opts: WebhookRunOptions = {}): Promise<WebhookRunResult> {
  const s = state();
  if (s.running) {
    if (!opts.wait) {
      s.rerun = true;
      return emptyResult("already_running");
    }
    while (s.running) await s.running.catch(() => undefined);
  }
  const run = runOnce(opts);
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
    runWebhookDeliveries().catch((error) => console.error("[webhooks] run failed:", describe(error)));
  }, delay);
  s.timer.unref?.();
}

/** Fire-and-forget: run soon (bursts of events share one run). Never throws. */
export function kickWebhooks(delayMs = 100): void {
  armTimer(delayMs);
}

/** The outcome of the most recent run in this process, for the admin page. */
export function getLastWebhookRun(): WebhookRunResult | null {
  return state().lastRun;
}

/** Switch the in-process timer off or on (tests start runs themselves). */
export function setWebhookAutoRun(enabled: boolean): void {
  const s = state();
  s.autoRun = enabled;
  if (!enabled && s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
    s.timerAt = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Manual deliveries: test events and resends                          */
/* ------------------------------------------------------------------ */

export type ManualDeliveryResult = { ok: true; delivery: WebhookDelivery } | { ok: false; reason: "not_found" | "api_disabled" | "invalid"; error: string };

const API_OFF = "The API is switched off, so webhooks are not sent. Turn it on under Access first.";

/** Insert a one-attempt delivery and send it right away. */
async function sendNow(row: WebhookDelivery, transport: WebhookTransport): Promise<ManualDeliveryResult> {
  const { inFlight } = state();
  inFlight.add(row.id);
  try {
    const endpoint = await mutate((db) => {
      const live = db.webhookEndpoints.find((e) => e.id === row.endpointId);
      if (live) db.webhookDeliveries.push(row);
      return live ? { ...live } : null;
    });
    if (!endpoint) return { ok: false, reason: "not_found", error: "This webhook endpoint no longer exists." };
    const outcome = await attemptDelivery(row, endpoint, transport);
    if (!outcome.delivery) return { ok: false, reason: "not_found", error: "The delivery was removed before it could be sent." };
    return { ok: true, delivery: outcome.delivery };
  } finally {
    inFlight.delete(row.id);
  }
}

/**
 * "Send test event": deliver the documented example of an event to an
 * endpoint, once, whether or not the endpoint is subscribed to it or
 * switched on. The result is logged like any delivery and marked as a test.
 */
export async function sendTestWebhook(endpointId: string, eventName: string, opts: { transport?: WebhookTransport } = {}): Promise<ManualDeliveryResult> {
  if (!isWebhookEventName(eventName)) return { ok: false, reason: "invalid", error: "Pick the event to send." };
  const db = await getDb();
  if (!db.settings.api.enabled) return { ok: false, reason: "api_disabled", error: API_OFF };
  const now = new Date();
  const payload = buildTestPayload(eventName, siteConfig.appUrl, uid(TEST_EVENT_ID_PREFIX.slice(0, -1)), now);
  return sendNow(
    {
      id: uid("whd"),
      endpointId,
      event: eventName,
      eventId: payload.id,
      payload: serializeWebhookPayload(payload),
      status: "pending",
      attempts: 0,
      test: true,
      createdAt: now.toISOString(),
    },
    opts.transport ?? httpTransport,
  );
}

function resendRow(source: WebhookDelivery, now: string): WebhookDelivery {
  const row: WebhookDelivery = {
    id: uid("whd"),
    endpointId: source.endpointId,
    event: source.event,
    eventId: source.eventId ?? parseWebhookPayload(source.payload)?.id ?? source.id,
    payload: source.payload,
    status: "pending",
    attempts: 0,
    resentFromId: source.resentFromId ?? source.id,
    createdAt: now,
  };
  if (source.test) row.test = true;
  return row;
}

/** "Resend": send the same payload (same event id) again, once, as a new log entry. */
export async function resendWebhookDelivery(deliveryId: string, opts: { transport?: WebhookTransport } = {}): Promise<ManualDeliveryResult> {
  const db = await getDb();
  if (!db.settings.api.enabled) return { ok: false, reason: "api_disabled", error: API_OFF };
  const source = db.webhookDeliveries.find((d) => d.id === deliveryId);
  if (!source) return { ok: false, reason: "not_found", error: "This delivery is no longer in the log." };
  if (source.status === "pending") return { ok: false, reason: "invalid", error: "This delivery is still being retried. Wait for it to finish, or for its next attempt." };
  return sendNow(resendRow(source, new Date().toISOString()), opts.transport ?? httpTransport);
}

/**
 * Events an endpoint never received: the latest delivery of every event
 * whose deliveries (the original and its resends) all failed. Tests are
 * left out. Newest first.
 */
export function undeliveredEvents(deliveries: readonly WebhookDelivery[], endpointId: string): WebhookDelivery[] {
  const byEvent = new Map<string, WebhookDelivery[]>();
  for (const delivery of deliveries) {
    if (delivery.endpointId !== endpointId || delivery.test) continue;
    const key = delivery.resentFromId ?? delivery.id;
    const group = byEvent.get(key);
    if (group) group.push(delivery);
    else byEvent.set(key, [delivery]);
  }
  const out: WebhookDelivery[] = [];
  for (const group of byEvent.values()) {
    if (group.some((d) => d.status !== "failed")) continue;
    out.push(group.reduce((latest, d) => (d.createdAt > latest.createdAt ? d : latest)));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type BulkResendResult = { ok: true; queued: number; remaining: number } | { ok: false; reason: "not_found" | "api_disabled" | "invalid"; error: string };

/**
 * "Resend failed": queue every failed delivery of an endpoint again (oldest
 * first, up to `MAX_BULK_RESEND` per call) for the worker to send. The
 * endpoint must be switched on.
 */
export async function resendFailedDeliveries(endpointId: string): Promise<BulkResendResult> {
  const db = await getDb();
  if (!db.settings.api.enabled) return { ok: false, reason: "api_disabled", error: API_OFF };
  const outcome = await mutate((live): BulkResendResult => {
    const endpoint = live.webhookEndpoints.find((e) => e.id === endpointId);
    if (!endpoint) return { ok: false, reason: "not_found", error: "This webhook endpoint no longer exists." };
    if (!endpoint.active) return { ok: false, reason: "invalid", error: "Turn the endpoint on before resending what it missed." };
    const failed = undeliveredEvents(live.webhookDeliveries, endpointId);
    const batch = failed.slice(-MAX_BULK_RESEND).reverse();
    const base = Date.now();
    batch.forEach((source, index) => {
      // One millisecond apart so the log and the worker keep the original order.
      const at = new Date(base + index).toISOString();
      live.webhookDeliveries.push({ ...resendRow(source, at), nextAttemptAt: at });
    });
    return { ok: true, queued: batch.length, remaining: failed.length - batch.length };
  });
  if (outcome.ok && outcome.queued) kickWebhooks(50);
  return outcome;
}
