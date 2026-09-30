import "server-only";
import { on } from "@/lib/events";
import { enqueueWebhookEvent } from "./delivery";
import { WEBHOOK_EVENT_NAMES } from "./events";

/**
 * Outgoing webhooks: every domain event is queued for the endpoints
 * subscribed to it (registered from `src/lib/handlers.ts`). Queuing only
 * writes delivery rows; the HTTP requests are made by the delivery worker,
 * so a slow receiver never holds up the bus or the request that emitted
 * the event.
 */
for (const name of WEBHOOK_EVENT_NAMES) {
  on(name, (event) => enqueueWebhookEvent(event).then(() => undefined), { key: `webhooks:${name}` });
}
