"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, WebhookDelivery } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fd } from "@/lib/utils";
import { endpointHost, resendFailedDeliveries, resendWebhookDelivery, runWebhookDeliveries, sendTestWebhook, type ManualDeliveryResult } from "@/lib/webhooks/delivery";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  readWebhookSecret,
  rotateWebhookSecret,
  updateWebhookEndpoint,
  type WebhookFailure,
} from "@/lib/webhooks/endpoints";
import { webhookEventLabel } from "@/lib/webhooks/events";

/**
 * Admin → Settings → API & webhooks: manage webhook endpoints, their
 * signing secrets and deliveries. Every action re-checks the admin role;
 * every change (and every time a secret is shown) is recorded in the audit
 * log. Audit entries carry the endpoint's host, never its path or secret.
 */

const PAGE = "/admin/settings/api";
const DENIED = "Only administrators can manage webhooks.";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function refresh(id?: string) {
  revalidatePath(PAGE);
  if (id) revalidatePath(`${PAGE}/webhooks/${id}`);
}

function failure<T>(result: WebhookFailure): ActionResult<T> {
  return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
}

export interface CreatedWebhook {
  id: string;
  url: string;
  /** The signing secret (also available later from the endpoint page). */
  secret: string;
}

export async function createWebhookEndpointAction(_prev: ActionResult<CreatedWebhook> | null, formData: FormData): Promise<ActionResult<CreatedWebhook>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await createWebhookEndpoint(
    { url: fd(formData, "url"), description: fd(formData, "description"), events: formData.getAll("events") },
    { userId: user.id, source: "admin" },
  );
  if (!result.ok) return failure(result);
  const { endpoint, secret } = result;
  await audit(user, "webhook.create", { type: "webhook", id: endpoint.id }, { host: endpointHost(endpoint.url), events: endpoint.events.join(" ") });
  refresh();
  return { ok: true, data: { id: endpoint.id, url: endpoint.url, secret }, message: "Endpoint added. Copy its signing secret to verify requests." };
}

export async function updateWebhookEndpointAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const id = fd(formData, "id");
  const result = await updateWebhookEndpoint(id, { url: fd(formData, "url"), description: fd(formData, "description"), events: formData.getAll("events") });
  if (!result.ok) return failure(result);
  if (result.changed.length) {
    await audit(user, "webhook.update", { type: "webhook", id }, { host: endpointHost(result.endpoint.url), changed: result.changed.join(" "), events: result.endpoint.events.join(" ") });
  }
  refresh(id);
  return { ok: true, data: undefined, message: result.changed.length ? "Endpoint saved." : "Nothing changed." };
}

/** Pause or resume an endpoint. Pausing cancels the deliveries that were waiting for a retry. */
export async function setWebhookActiveAction(id: string, active: boolean): Promise<ActionResult<{ active: boolean }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  if (typeof active !== "boolean") return { ok: false, error: "Choose on or off." };
  const result = await updateWebhookEndpoint(String(id), { active });
  if (!result.ok) return failure(result);
  if (result.changed.length) {
    await audit(user, active ? "webhook.enable" : "webhook.disable", { type: "webhook", id: result.endpoint.id }, { host: endpointHost(result.endpoint.url), cancelled: result.cancelled });
  }
  refresh(result.endpoint.id);
  const cancelled = result.cancelled ? ` ${result.cancelled} waiting ${result.cancelled === 1 ? "delivery was" : "deliveries were"} cancelled.` : "";
  return {
    ok: true,
    data: { active },
    message: active ? "The endpoint is on. New events will be sent to it." : `The endpoint is off. Events are not sent to it until you turn it back on.${cancelled}`,
  };
}

export async function deleteWebhookEndpointAction(id: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await deleteWebhookEndpoint(String(id));
  if (!result.ok) return failure(result);
  await audit(user, "webhook.delete", { type: "webhook", id: result.endpoint.id }, { host: endpointHost(result.endpoint.url), deliveries: result.deliveriesRemoved });
  refresh(result.endpoint.id);
  return { ok: true, data: undefined, message: "The endpoint and its delivery log were deleted." };
}

/** Show the signing secret again (it is stored encrypted, not hashed, because the server signs with it). */
export async function revealWebhookSecretAction(id: string): Promise<ActionResult<{ secret: string }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const endpoint = (await getDb()).webhookEndpoints.find((e) => e.id === id);
  if (!endpoint) return { ok: false, error: "This webhook endpoint no longer exists." };
  const secret = readWebhookSecret(endpoint);
  if (!secret) return { ok: false, error: "The secret can't be read because APP_SECRET changed since it was created. Roll the secret to get a new one." };
  await audit(user, "webhook.secret_reveal", { type: "webhook", id: endpoint.id }, { host: endpointHost(endpoint.url) });
  return { ok: true, data: { secret } };
}

/** Replace the signing secret: the old one stops working at once. */
export async function rotateWebhookSecretAction(id: string): Promise<ActionResult<{ secret: string }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await rotateWebhookSecret(String(id));
  if (!result.ok) return failure(result);
  await audit(user, "webhook.secret_rotate", { type: "webhook", id: result.endpoint.id }, { host: endpointHost(result.endpoint.url) });
  refresh(result.endpoint.id);
  return { ok: true, data: { secret: result.secret }, message: "New signing secret created. Update your receiver: requests are now signed with it." };
}

/** What happened to a delivery sent by hand, for the toast and the result panel. */
export interface DeliveryOutcome {
  deliveryId: string;
  delivered: boolean;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
}

function outcomeOf(delivery: WebhookDelivery): DeliveryOutcome {
  return {
    deliveryId: delivery.id,
    delivered: delivery.status === "success",
    responseStatus: delivery.responseStatus ?? null,
    error: delivery.lastError ?? null,
    durationMs: delivery.durationMs ?? null,
  };
}

function manualResult(result: ManualDeliveryResult, what: string): ActionResult<DeliveryOutcome> {
  if (!result.ok) return { ok: false, error: result.error };
  const outcome = outcomeOf(result.delivery);
  return {
    ok: true,
    data: outcome,
    message: outcome.delivered ? `${what} delivered (HTTP ${outcome.responseStatus ?? 200}).` : `${what} was not delivered: ${outcome.error ?? "the endpoint did not answer with a 2xx status."}`,
  };
}

/** "Send test event": deliver the example payload of an event once. */
export async function sendTestWebhookAction(id: string, event: string): Promise<ActionResult<DeliveryOutcome>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await sendTestWebhook(String(id), String(event));
  if (result.ok) {
    await audit(user, "webhook.test", { type: "webhook", id: result.delivery.endpointId }, { event: result.delivery.event, delivered: result.delivery.status === "success" });
    refresh(result.delivery.endpointId);
  }
  return manualResult(result, `Test “${webhookEventLabel(String(event))}”`);
}

/** "Resend": send a logged delivery again, once, with the same event id. */
export async function resendWebhookDeliveryAction(deliveryId: string): Promise<ActionResult<DeliveryOutcome>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await resendWebhookDelivery(String(deliveryId));
  if (result.ok) {
    await audit(user, "webhook.resend", { type: "webhook", id: result.delivery.endpointId }, { event: result.delivery.event, delivery: String(deliveryId), delivered: result.delivery.status === "success" });
    refresh(result.delivery.endpointId);
  }
  return manualResult(result, "The event");
}

/** "Resend failed": queue every event the endpoint never received again. */
export async function resendFailedWebhooksAction(endpointId: string): Promise<ActionResult<{ queued: number; remaining: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const result = await resendFailedDeliveries(String(endpointId));
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.queued) return { ok: true, data: { queued: 0, remaining: 0 }, message: "There are no failed events left to resend." };
  await audit(user, "webhook.resend_failed", { type: "webhook", id: String(endpointId) }, { queued: result.queued, remaining: result.remaining });
  await runWebhookDeliveries({ wait: true });
  refresh(String(endpointId));
  const more = result.remaining ? ` ${result.remaining} more are left: resend again for the next batch.` : "";
  return { ok: true, data: { queued: result.queued, remaining: result.remaining }, message: `${result.queued} failed ${result.queued === 1 ? "event was" : "events were"} sent again.${more}` };
}

/** "Retry now": make the deliveries waiting for their next attempt due at once. */
export async function retryPendingWebhooksAction(endpointId: string): Promise<ActionResult<{ retried: number; delivered: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: DENIED };
  const id = String(endpointId);
  const due = await mutate((db) => {
    const endpoint = db.webhookEndpoints.find((e) => e.id === id);
    if (!endpoint) return null;
    if (!endpoint.active) return -1;
    const now = new Date().toISOString();
    let count = 0;
    for (const delivery of db.webhookDeliveries) {
      if (delivery.endpointId !== id || delivery.status !== "pending") continue;
      delivery.nextAttemptAt = now;
      count++;
    }
    return count;
  });
  if (due === null) return { ok: false, error: "This webhook endpoint no longer exists." };
  if (due === -1) return { ok: false, error: "Turn the endpoint on first." };
  if (due === 0) return { ok: true, data: { retried: 0, delivered: 0 }, message: "Nothing is waiting for a retry." };
  const run = await runWebhookDeliveries({ wait: true });
  if (!run.ran) return { ok: false, error: "The API is switched off, so webhooks are not sent. Turn it on under Access first." };
  refresh(id);
  return {
    ok: true,
    data: { retried: run.attempted, delivered: run.delivered },
    message: `${run.delivered} of ${run.attempted} waiting ${run.attempted === 1 ? "delivery" : "deliveries"} went through.${run.postponed ? ` ${run.postponed} were held back because the endpoint is still failing.` : ""}`,
  };
}
