import type { WebhookEndpointStatus } from "@/lib/webhooks/types";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@/lib/webhooks/log";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const ENDPOINT_TONES: Record<WebhookEndpointStatus, { tone: BadgeTone; label: string; title: string }> = {
  active: { tone: "success", label: "Active", title: "Events are being delivered." },
  failing: { tone: "warning", label: "Failing", title: "Recent deliveries failed. They are retried automatically." },
  disabled: { tone: "neutral", label: "Off", title: "Events are not sent to this endpoint." },
};

/** Health of a webhook endpoint. */
export function EndpointStatusBadge({ status, size = "xs" }: { status: WebhookEndpointStatus; size?: "xs" | "sm" }) {
  const { tone, label, title } = ENDPOINT_TONES[status];
  return (
    <Badge tone={tone} size={size} dot={status !== "disabled"} title={title}>
      {label}
    </Badge>
  );
}

const DELIVERY_TONES: Record<DeliveryStatus, BadgeTone> = { success: "success", pending: "warning", failed: "danger" };

/** Outcome of one delivery. */
export function DeliveryStatusBadge({ status, size = "xs" }: { status: DeliveryStatus; size?: "xs" | "sm" }) {
  return (
    <Badge tone={DELIVERY_TONES[status]} size={size}>
      {DELIVERY_STATUS_LABELS[status]}
    </Badge>
  );
}
