import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { notFound } from "@/lib/api/errors";
import { serializeWebhookDelivery } from "@/lib/api/serializers";
import { findWebhook, manualDeliveryFailure } from "@/lib/api/webhooks";
import { resendWebhookDelivery } from "@/lib/webhooks/delivery";

/** POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/resend — send a logged delivery again, once. */
export const POST = apiRoute(endpoints.resendWebhookDelivery, async (ctx) => {
  const endpoint = findWebhook(ctx.db, ctx.params.id!);
  const deliveryId = ctx.params.deliveryId!;
  // The delivery must belong to the endpoint in the URL.
  if (!ctx.db.webhookDeliveries.some((d) => d.id === deliveryId && d.endpointId === endpoint.id)) throw notFound("delivery", deliveryId);
  const result = await resendWebhookDelivery(deliveryId);
  if (!result.ok) throw manualDeliveryFailure(result);
  await ctx.audit(
    "api.webhook.resend",
    { type: "webhook", id: endpoint.id },
    { event: result.delivery.event, delivery: deliveryId, delivered: result.delivery.status === "success" },
  );
  revalidatePath(`/admin/settings/api/webhooks/${endpoint.id}`);
  return dataResponse(serializeWebhookDelivery(result.delivery));
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("POST");
export const GET = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
