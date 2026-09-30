import { apiRoute, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { paginate } from "@/lib/api/pagination";
import { serializeWebhookEvent } from "@/lib/api/serializers";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";

/** GET /api/v1/webhook-events — the events an endpoint can subscribe to, with field docs and example payloads. */
export const GET = apiRoute(endpoints.listWebhookEvents, async ({ query, url, baseUrl }) =>
  listResponse(paginate(WEBHOOK_EVENTS, query.page, query.perPage), url, (event) => serializeWebhookEvent(event, { baseUrl })),
);

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET");
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
