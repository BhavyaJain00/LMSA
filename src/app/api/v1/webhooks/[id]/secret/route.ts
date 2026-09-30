import { revalidatePath } from "next/cache";
import { apiRoute, dataResponse, methodNotAllowed } from "@/lib/api/handler";
import { endpoints } from "@/lib/api/endpoints";
import { serializeWebhookEndpoint } from "@/lib/api/serializers";
import { webhookFailure } from "@/lib/api/webhooks";
import { endpointHost } from "@/lib/webhooks/delivery";
import { rotateWebhookSecret } from "@/lib/webhooks/endpoints";

/** POST /api/v1/webhooks/{id}/secret — replace the signing secret and return the new one, once. */
export const POST = apiRoute(endpoints.rollWebhookSecret, async (ctx) => {
  const id = ctx.params.id!;
  const result = await rotateWebhookSecret(id);
  if (!result.ok) throw webhookFailure(result, id);
  await ctx.audit("api.webhook.secret_rotate", { type: "webhook", id }, { host: endpointHost(result.endpoint.url) });
  revalidatePath(`/admin/settings/api/webhooks/${id}`);
  return dataResponse({ ...serializeWebhookEndpoint(result.endpoint), secret: result.secret });
});

/** Other methods answer 405 with the JSON error envelope. */
const unsupported = methodNotAllowed("POST");
export const GET = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
