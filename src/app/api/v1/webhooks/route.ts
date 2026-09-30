import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, listResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { listPage } from "@/lib/api/pagination";
import { serializeWebhookEndpoint, webhookEndpointStamps } from "@/lib/api/serializers";
import { webhookFailure } from "@/lib/api/webhooks";
import { endpointHost } from "@/lib/webhooks/delivery";
import { createWebhookEndpoint } from "@/lib/webhooks/endpoints";

/** GET /api/v1/webhooks — webhook endpoints (never their signing secrets). */
export const GET = apiRoute(endpoints.listWebhooks, async ({ db, query, url }) => {
  const rows = db.webhookEndpoints.filter((e) => (query.active === undefined || e.active === query.active) && (!query.event || e.events.includes(query.event)));
  return listResponse(listPage(rows, webhookEndpointStamps, query), url, serializeWebhookEndpoint);
});

/** POST /api/v1/webhooks — subscribe a URL to events. The signing secret is part of this response only. */
export const POST = apiRoute(endpoints.createWebhook, async (ctx) => {
  const result = await createWebhookEndpoint(ctx.body, { userId: ctx.actorId, source: "api" });
  if (!result.ok) throw webhookFailure(result);
  const { endpoint, secret } = result;
  await ctx.audit("api.webhook.create", { type: "webhook", id: endpoint.id }, { host: endpointHost(endpoint.url), events: endpoint.events.join(" ") });
  revalidatePath("/admin/settings/api");
  return dataResponse({ ...serializeWebhookEndpoint(endpoint), secret }, 201);
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET", "POST");
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
