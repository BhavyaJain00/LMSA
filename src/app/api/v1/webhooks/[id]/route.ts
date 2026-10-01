import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { serializeDeleted, serializeWebhookEndpoint } from "@/lib/api/serializers";
import { findWebhook, webhookFailure } from "@/lib/api/webhooks";
import { endpointHost } from "@/lib/webhooks/delivery";
import { deleteWebhookEndpoint, updateWebhookEndpoint } from "@/lib/webhooks/endpoints";

function refresh(id: string) {
  revalidatePath("/admin/settings/api");
  revalidatePath(`/admin/settings/api/webhooks/${id}`);
}

/** GET /api/v1/webhooks/{id} — one endpoint (without its signing secret). */
export const GET = apiRoute(endpoints.getWebhook, async ({ db, params }) => dataResponse(serializeWebhookEndpoint(findWebhook(db, params.id!))));

/** PATCH /api/v1/webhooks/{id} — change the URL, events or description, or switch the endpoint on or off. */
export const PATCH = apiRoute(endpoints.updateWebhook, async (ctx) => {
  const id = ctx.params.id!;
  const result = await updateWebhookEndpoint(id, ctx.body);
  if (!result.ok) throw webhookFailure(result, id);
  if (result.changed.length) {
    await ctx.audit(
      "api.webhook.update",
      { type: "webhook", id },
      { host: endpointHost(result.endpoint.url), changed: result.changed.join(" "), active: result.endpoint.active, cancelled: result.cancelled },
    );
    refresh(id);
  }
  return dataResponse(serializeWebhookEndpoint(result.endpoint));
});

/** DELETE /api/v1/webhooks/{id} — unsubscribe: removes the endpoint and its delivery log. */
export const DELETE = apiRoute(endpoints.deleteWebhook, async (ctx) => {
  const id = ctx.params.id!;
  const result = await deleteWebhookEndpoint(id);
  if (!result.ok) throw webhookFailure(result, id);
  await ctx.audit("api.webhook.delete", { type: "webhook", id }, { host: endpointHost(result.endpoint.url), deliveries: result.deliveriesRemoved });
  refresh(id);
  return dataResponse(serializeDeleted("webhook_endpoint", id));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("GET", "PATCH", "DELETE");
export const POST = unsupported;
export const PUT = unsupported;
