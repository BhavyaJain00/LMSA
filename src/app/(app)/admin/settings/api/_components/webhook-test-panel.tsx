"use client";

import { useState, useTransition } from "react";
import { sendTestWebhookAction, type DeliveryOutcome } from "@/lib/actions/webhooks";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** "Send test event": deliver the example payload of an event and show what the receiver answered. */
export function WebhookTestPanel({ endpointId, subscribed, apiEnabled }: { endpointId: string; subscribed: string[]; apiEnabled: boolean }) {
  const toast = useToast();
  const [event, setEvent] = useState(subscribed[0] ?? WEBHOOK_EVENTS[0]!.name);
  const [outcome, setOutcome] = useState<(DeliveryOutcome & { event: string }) | null>(null);
  const [sending, startSend] = useTransition();

  const send = () =>
    startSend(async () => {
      const result = await sendTestWebhookAction(endpointId, event);
      if (result.ok) setOutcome({ ...result.data, event });
      else {
        setOutcome(null);
        toast.error(result.error);
      }
    });

  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:w-72">
          <label htmlFor="webhook-test-event" className="mb-1.5 block text-sm font-medium text-ink">
            Event
          </label>
          <Select id="webhook-test-event" value={event} onChange={(e) => setEvent(e.currentTarget.value)} disabled={sending}>
            {WEBHOOK_EVENTS.map((doc) => (
              <option key={doc.name} value={doc.name}>
                {doc.name}
                {subscribed.includes(doc.name) ? "" : " (not subscribed)"}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={send} loading={sending} disabled={!apiEnabled} leftIcon={<Icon.Send className="size-4" />}>
          Send test event
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        {apiEnabled
          ? "Sends the example payload from the API reference once, signed with this endpoint's secret. The event id starts with evt_test_ and the delivery is marked as a test in the log."
          : "The API is switched off, so webhooks (tests included) are not sent. Turn it on under Access first."}
      </p>
      <div aria-live="polite">
        {outcome && (
          <div className={cn("rounded-lg border px-3 py-2.5 text-sm", outcome.delivered ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10")}>
            <p className="flex items-center gap-2 font-medium text-ink">
              {outcome.delivered ? <Icon.CheckCircle className="size-4 shrink-0 text-success" /> : <Icon.XCircle className="size-4 shrink-0 text-danger" />}
              {outcome.delivered ? "Delivered" : "Not delivered"}
              {outcome.responseStatus !== null && <span className="font-mono text-xs text-ink-muted">HTTP {outcome.responseStatus}</span>}
              {outcome.durationMs !== null && <span className="text-xs text-ink-muted">{outcome.durationMs} ms</span>}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              <code>{outcome.event}</code>
              {outcome.error ? ` · ${outcome.error}` : " · The receiver answered with a 2xx status."} See the delivery log below for the payload and the response.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
