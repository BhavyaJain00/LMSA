import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { serializeWebhookDelivery } from "@/lib/api/serializers";
import { findWebhook, manualDeliveryFailure } from "@/lib/api/webhooks";
import { sendTestWebhook } from "@/lib/webhooks/delivery";

/** POST /api/v1/webhooks/{id}/test — deliver the example payload of an event once and report the receiver's answer. */
export const POST = apiRoute(endpoints.testWebhook, async (ctx) => {
  const endpoint = findWebhook(ctx.db, ctx.params.id!);
  const result = await sendTestWebhook(endpoint.id, ctx.body.event);
  if (!result.ok) throw manualDeliveryFailure(result);
  await ctx.audit("api.webhook.test", { type: "webhook", id: endpoint.id }, { event: result.delivery.event, delivered: result.delivery.status === "success" });
  revalidatePath(`/admin/settings/api/webhooks/${endpoint.id}`);
  return dataResponse(serializeWebhookDelivery(result.delivery));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("POST");
export const GET = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
