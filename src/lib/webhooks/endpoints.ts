import "server-only";
import type { Database, WebhookEndpoint } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { decryptWebhookSecret, encryptWebhookSecret, webhookSsrfOptions } from "./config";
import { WEBHOOK_EVENT_NAMES, isWebhookEventName, normalizeWebhookEvents, type WebhookEventName } from "./events";
import { MAX_WEBHOOK_DESCRIPTION_LENGTH, MAX_WEBHOOK_ENDPOINTS } from "./policy";
import { generateWebhookSecret } from "./signature";
import { checkWebhookDestination, type Resolver } from "./ssrf";
import type { WebhookDisabledReason } from "./types";

/**
 * Webhook endpoints: validation and the stored rows.
 *
 * One service for the two ways endpoints are managed: the admin settings
 * page (`src/lib/actions/webhooks.ts`) and the REST API (`/api/v1/webhooks`).
 * Callers check permissions and record the audit entry; this module checks
 * the input, keeps the rows consistent and never returns a signing secret
 * except from `createWebhookEndpoint`, `rotateWebhookSecret` and
 * `readWebhookSecret`.
 */

export interface WebhookEndpointInput {
  url?: string;
  description?: string | null;
  events?: readonly unknown[];
  active?: boolean;
}

/** Field → message, in the words shown to the administrator or API client. */
export type WebhookFieldErrors = Partial<Record<"url" | "description" | "events", string>>;

export type WebhookFailure = { ok: false; reason: "invalid" | "not_found" | "limit"; error: string; fieldErrors?: WebhookFieldErrors };

const NOT_FOUND: WebhookFailure = { ok: false, reason: "not_found", error: "This webhook endpoint no longer exists." };

/** Note left on deliveries that were waiting when their endpoint was switched off or removed. */
export const CANCELLED_MESSAGE = "The endpoint was switched off before this event could be delivered. Resend it once the endpoint works again.";

function invalid(fieldErrors: WebhookFieldErrors): WebhookFailure {
  return { ok: false, reason: "invalid", error: Object.values(fieldErrors)[0] ?? "Check the endpoint details.", fieldErrors };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** One line of text without control characters, or an error when it is too long. */
export function cleanDescription(value: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_WEBHOOK_DESCRIPTION_LENGTH) return { ok: false, error: `Keep the description under ${MAX_WEBHOOK_DESCRIPTION_LENGTH} characters.` };
  return { ok: true, value: text };
}

/** The subscribed events in catalog order, or an error naming what is wrong. */
export function checkEvents(input: readonly unknown[] | undefined): { ok: true; value: WebhookEventName[] } | { ok: false; error: string } {
  const list = input ?? [];
  const unknown = list.filter((name) => !isWebhookEventName(name)).map((name) => String(name).slice(0, 60));
  if (unknown.length) return { ok: false, error: `Unknown event ${unknown.map((name) => `"${name}"`).join(", ")}. Available events: ${WEBHOOK_EVENT_NAMES.join(", ")}.` };
  const events = normalizeWebhookEvents(list);
  if (!events.length) return { ok: false, error: "Pick at least one event to send to this endpoint." };
  return { ok: true, value: events };
}

interface CheckOptions {
  /** DNS resolver override (tests). */
  resolver?: Resolver;
}

async function checkUrl(raw: string | undefined, opts: CheckOptions): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const checked = await checkWebhookDestination(raw ?? "", { ...webhookSsrfOptions(), resolver: opts.resolver });
  return checked.ok ? { ok: true, value: checked.url.toString() } : { ok: false, error: checked.error };
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* State changes (on the live database, inside `mutate`)               */
/* ------------------------------------------------------------------ */

/** Mark every waiting delivery of an endpoint as failed. Returns how many were cancelled. */
export function cancelPendingDeliveries(db: Pick<Database, "webhookDeliveries">, endpointId: string): number {
  let cancelled = 0;
  for (const delivery of db.webhookDeliveries) {
    if (delivery.endpointId !== endpointId || delivery.status !== "pending") continue;
    delivery.status = "failed";
    delivery.lastError = CANCELLED_MESSAGE;
    delete delivery.nextAttemptAt;
    cancelled++;
  }
  return cancelled;
}

/** Switch an endpoint off. `reason` is set when the system did it (repeated failures, 410 Gone). */
export function switchEndpointOff(db: Pick<Database, "webhookDeliveries">, endpoint: WebhookEndpoint, now: Date, reason?: WebhookDisabledReason): number {
  endpoint.active = false;
  endpoint.updatedAt = now.toISOString();
  if (reason) {
    endpoint.disabledAt = now.toISOString();
    endpoint.disabledReason = reason;
  } else {
    delete endpoint.disabledAt;
    delete endpoint.disabledReason;
  }
  return cancelPendingDeliveries(db, endpoint.id);
}

/** Switch an endpoint back on with a clean record: past failures no longer count towards switching it off. */
export function switchEndpointOn(endpoint: WebhookEndpoint, now: Date): void {
  endpoint.active = true;
  endpoint.failureCount = 0;
  endpoint.updatedAt = now.toISOString();
  delete endpoint.failingSince;
  delete endpoint.lastError;
  delete endpoint.disabledAt;
  delete endpoint.disabledReason;
}

/* ------------------------------------------------------------------ */
/* Create, update, delete                                              */
/* ------------------------------------------------------------------ */

export type CreateWebhookResult = { ok: true; endpoint: WebhookEndpoint; secret: string } | WebhookFailure;

/** Create an endpoint. The signing secret is returned once here and stored encrypted. */
export async function createWebhookEndpoint(
  input: WebhookEndpointInput,
  by: { userId: string; source: "admin" | "api" },
  opts: CheckOptions = {},
): Promise<CreateWebhookResult> {
  const fieldErrors: WebhookFieldErrors = {};
  const url = await checkUrl(input.url, opts);
  if (!url.ok) fieldErrors.url = url.error;
  const description = cleanDescription(input.description);
  if (!description.ok) fieldErrors.description = description.error;
  const events = checkEvents(input.events);
  if (!events.ok) fieldErrors.events = events.error;
  if (!url.ok || !description.ok || !events.ok) return invalid(fieldErrors);

  const now = new Date().toISOString();
  const secret = generateWebhookSecret();
  const row: WebhookEndpoint = {
    id: uid("whk"),
    url: url.value,
    secretEnc: encryptWebhookSecret(secret),
    events: events.value,
    active: input.active ?? true,
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
    createdById: by.userId,
    source: by.source,
  };
  if (description.value) row.description = description.value;

  const outcome = await mutate((db): "ok" | "limit" | "duplicate" => {
    if (db.webhookEndpoints.length >= MAX_WEBHOOK_ENDPOINTS) return "limit";
    if (db.webhookEndpoints.some((e) => sameUrl(e.url, row.url))) return "duplicate";
    db.webhookEndpoints.push(row);
    return "ok";
  });
  if (outcome === "limit") return { ok: false, reason: "limit", error: `A site can have at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints. Delete one you no longer use first.` };
  if (outcome === "duplicate") return invalid({ url: "An endpoint with this URL already exists. Edit it to change its events." });
  return { ok: true, endpoint: { ...row }, secret };
}

export type UpdateWebhookResult = { ok: true; endpoint: WebhookEndpoint; changed: string[]; cancelled: number } | WebhookFailure;

/** Change the given fields of an endpoint. `changed` lists what is different afterwards (for the audit log). */
export async function updateWebhookEndpoint(id: string, patch: WebhookEndpointInput, opts: CheckOptions = {}): Promise<UpdateWebhookResult> {
  const fieldErrors: WebhookFieldErrors = {};
  let url: string | undefined;
  let description: string | undefined;
  let events: WebhookEventName[] | undefined;
  if (patch.url !== undefined) {
    const checked = await checkUrl(patch.url, opts);
    if (checked.ok) url = checked.value;
    else fieldErrors.url = checked.error;
  }
  if (patch.description !== undefined) {
    const checked = cleanDescription(patch.description);
    if (checked.ok) description = checked.value;
    else fieldErrors.description = checked.error;
  }
  if (patch.events !== undefined) {
    const checked = checkEvents(patch.events);
    if (checked.ok) events = checked.value;
    else fieldErrors.events = checked.error;
  }
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);

  return mutate((db): UpdateWebhookResult => {
    const row = db.webhookEndpoints.find((e) => e.id === id);
    if (!row) return NOT_FOUND;
    if (url !== undefined && db.webhookEndpoints.some((e) => e.id !== id && sameUrl(e.url, url))) {
      return invalid({ url: "Another endpoint already uses this URL." });
    }
    const now = new Date();
    const changed: string[] = [];
    let cancelled = 0;
    if (url !== undefined && url !== row.url) {
      row.url = url;
      changed.push("url");
    }
    if (description !== undefined && description !== (row.description ?? "")) {
      if (description) row.description = description;
      else delete row.description;
      changed.push("description");
    }
    if (events !== undefined && events.join(" ") !== row.events.join(" ")) {
      row.events = events;
      changed.push("events");
    }
    if (patch.active !== undefined && patch.active !== row.active) {
      if (patch.active) switchEndpointOn(row, now);
      else cancelled = switchEndpointOff(db, row, now);
      changed.push("active");
    }
    if (changed.length) row.updatedAt = now.toISOString();
    return { ok: true, endpoint: { ...row }, changed, cancelled };
  });
}

/** Delete an endpoint together with its delivery log. */
export async function deleteWebhookEndpoint(id: string): Promise<{ ok: true; endpoint: WebhookEndpoint; deliveriesRemoved: number } | WebhookFailure> {
  return mutate((db) => {
    const index = db.webhookEndpoints.findIndex((e) => e.id === id);
    const row = db.webhookEndpoints[index];
    if (!row) return NOT_FOUND;
    db.webhookEndpoints.splice(index, 1);
    const before = db.webhookDeliveries.length;
    db.webhookDeliveries = db.webhookDeliveries.filter((d) => d.endpointId !== id);
    return { ok: true as const, endpoint: row, deliveriesRemoved: before - db.webhookDeliveries.length };
  });
}

/* ------------------------------------------------------------------ */
/* Signing secret                                                      */
/* ------------------------------------------------------------------ */

/** Replace the signing secret. Requests sent from now on (retries included) are signed with the new one. */
export async function rotateWebhookSecret(id: string): Promise<{ ok: true; endpoint: WebhookEndpoint; secret: string } | WebhookFailure> {
  const secret = generateWebhookSecret();
  const secretEnc = encryptWebhookSecret(secret);
  return mutate((db) => {
    const row = db.webhookEndpoints.find((e) => e.id === id);
    if (!row) return NOT_FOUND;
    const now = new Date().toISOString();
    row.secretEnc = secretEnc;
    row.secretRotatedAt = now;
    row.updatedAt = now;
    return { ok: true as const, endpoint: { ...row }, secret };
  });
}

/** The signing secret of an endpoint, or null when it cannot be decrypted (APP_SECRET changed). */
export function readWebhookSecret(endpoint: Pick<WebhookEndpoint, "secretEnc">): string | null {
  return decryptWebhookSecret(endpoint.secretEnc);
}
