import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";

/**
 * Optional fields the webhook feature keeps on its two stored rows, added
 * by module augmentation (the pattern used by the email outbox) so the
 * shared `types.ts` stays untouched. Every field is optional: rows written
 * before this module existed remain valid.
 */
declare module "@/lib/types" {
  interface WebhookEndpoint {
    /** What the endpoint is for ("Zapier: new sales"), shown in the admin list. */
    description?: string;
    /** Administrator who created the endpoint (the key's creator for endpoints made through the API). */
    createdById?: string;
    /** "admin" (settings page) or "api" (POST /api/v1/webhooks). */
    source?: "admin" | "api";
    updatedAt?: string;
    /** When the signing secret was last replaced. */
    secretRotatedAt?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    /** Why the latest attempt failed (cleared by a success). */
    lastError?: string;
    /** Start of the current run of failed attempts (cleared by a success). */
    failingSince?: string;
    /** Set when the endpoint was switched off automatically. */
    disabledAt?: string;
    disabledReason?: WebhookDisabledReason;
  }

  interface WebhookDelivery {
    /** `id` of the payload, shared by every endpoint (and every resend) of one event. */
    eventId?: string;
    /** Sent with "Send test event": example data, a single attempt. */
    test?: boolean;
    /** The delivery this one repeats ("Resend"): a single attempt. */
    resentFromId?: string;
    /** Why the latest attempt failed (network error, timeout, blocked address, non-2xx status). */
    lastError?: string;
    lastAttemptAt?: string;
    /** Duration of the latest attempt. */
    durationMs?: number;
  }
}

/** Why an endpoint was switched off automatically. */
export type WebhookDisabledReason = "failures" | "gone";

/** Health of an endpoint as shown to administrators and returned by the API. */
export type WebhookEndpointStatus = "active" | "failing" | "disabled";

export function webhookEndpointStatus(endpoint: Pick<WebhookEndpoint, "active" | "failureCount">): WebhookEndpointStatus {
  if (!endpoint.active) return "disabled";
  return endpoint.failureCount > 0 ? "failing" : "active";
}

/** A delivery made by hand (test or resend): tried once, never retried, never counted against the endpoint. */
export function isManualDelivery(delivery: Pick<WebhookDelivery, "test" | "resentFromId">): boolean {
  return !!delivery.test || !!delivery.resentFromId;
}
