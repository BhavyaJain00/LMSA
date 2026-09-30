import "server-only";
import type { Database, WebhookEndpoint } from "@/lib/types";
import type { ManualDeliveryResult } from "@/lib/webhooks/delivery";
import type { WebhookFailure } from "@/lib/webhooks/endpoints";
import { ApiError, conflict, notFound, validationError } from "./errors";

/**
 * Glue between the webhook services (`src/lib/webhooks/*`) and the
 * `/api/v1/webhooks` route handlers: row lookup and the translation of
 * service failures into the API's error envelope.
 */

export function findWebhook(db: Pick<Database, "webhookEndpoints">, id: string): WebhookEndpoint {
  const endpoint = db.webhookEndpoints.find((e) => e.id === id);
  if (!endpoint) throw notFound("webhook endpoint", id);
  return endpoint;
}

/** The `ApiError` for a failed create, update, delete or secret roll. */
export function webhookFailure(failure: WebhookFailure, id?: string): ApiError {
  if (failure.reason === "not_found") return notFound("webhook endpoint", id);
  if (failure.reason === "limit") return conflict(failure.error);
  return validationError(failure.fieldErrors ?? { body: failure.error }, failure.error);
}

/** The `ApiError` for a test event or resend that could not be sent at all. */
export function manualDeliveryFailure(failure: Extract<ManualDeliveryResult, { ok: false }>): ApiError {
  if (failure.reason === "not_found") return new ApiError(404, "not_found", failure.error);
  if (failure.reason === "invalid") return conflict(failure.error);
  // "api_disabled" cannot happen here (the route wrapper already refused the request), but fail closed.
  return new ApiError(403, "api_disabled", failure.error);
}
