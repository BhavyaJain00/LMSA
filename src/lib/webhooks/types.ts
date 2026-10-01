import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import type { WebhookDisabledReason } from "@/lib/types";
export type { WebhookDisabledReason };

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
