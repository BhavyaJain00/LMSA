import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { listPage } from "@/lib/api/pagination";
import { serializeWebhookDelivery, webhookDeliveryStamps } from "@/lib/api/serializers";
import { findWebhook } from "@/lib/api/webhooks";

/** GET /api/v1/webhooks/{id}/deliveries — the delivery log of one endpoint. */
export const GET = apiRoute(endpoints.listWebhookDeliveries, async ({ db, params, query, url }) => {
  const endpoint = findWebhook(db, params.id!);
  const rows = db.webhookDeliveries.filter((d) => d.endpointId === endpoint.id && (!query.status || d.status === query.status) && (!query.event || d.event === query.event));
  return listResponse(listPage(rows, webhookDeliveryStamps, query), url, serializeWebhookDelivery);
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
