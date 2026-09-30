"use client";

import { useState, useTransition } from "react";
import { resendFailedWebhooksAction, resendWebhookDeliveryAction, retryPendingWebhooksAction } from "@/lib/actions/webhooks";
import type { DeliveryStatus } from "@/lib/webhooks/log";
import { CopyButton } from "@/components/developers/copy-button";
import { DetailItem } from "@/components/admin/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { DeliveryStatusBadge } from "./webhook-status";

/** One delivery as shown in the log (prepared on the server). */
export interface DeliveryRow {
  id: string;
  event: string;
  eventLabel: string;
  eventId: string;
  status: DeliveryStatus;
  attempts: number;
  attemptsLabel: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  test: boolean;
  resentFromId: string | null;
  durationMs: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  /** The JSON body that was sent, pretty-printed. */
  payload: string;
}

function DeliveryDialog({ row, apiEnabled, onClose }: { row: DeliveryRow | null; apiEnabled: boolean; onClose: () => void }) {
  const toast = useToast();
  const [sending, startSend] = useTransition();
  const resend = () => {
    if (!row) return;
    startSend(async () => {
      const result = await resendWebhookDeliveryAction(row.id);
      if (!result.ok) toast.error(result.error);
      else if (result.data.delivered) toast.success(result.message ?? "Delivered");
      else toast.error("The event was not delivered", result.data.error ?? undefined);
      if (result.ok) onClose();
    });
  };

  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      title={row ? row.eventLabel : "Delivery"}
      description={row ? `${row.event} · ${formatDateTime(row.createdAt)}` : undefined}
      size="xl"
      footer={
        row && (
          <>
            <Button variant="outline" onClick={onClose} disabled={sending}>
              Close
            </Button>
            <Button
              onClick={resend}
              loading={sending}
              disabled={row.status === "pending" || !apiEnabled}
              title={row.status === "pending" ? "This delivery is still being retried." : !apiEnabled ? "The API is switched off." : undefined}
              leftIcon={<Icon.Send className="size-4" />}
            >
              Resend
            </Button>
          </>
        )
      }
    >
      {row && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <DeliveryStatusBadge status={row.status} size="sm" />
            {row.test && (
              <Badge tone="info" size="sm">
                Test
              </Badge>
            )}
            {row.resentFromId && (
              <Badge tone="outline" size="sm">
                Resend
              </Badge>
            )}
            {row.responseStatus !== null && <span className="font-mono text-sm text-ink">HTTP {row.responseStatus}</span>}
            {row.durationMs !== null && <span className="text-sm text-ink-muted">{row.durationMs} ms</span>}
          </div>

          {row.error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink" role="status">
              {row.error}
            </p>
          )}

          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Event id">
              <code className="break-all font-mono text-xs">{row.eventId}</code>
            </DetailItem>
            <DetailItem label="Delivery id">
              <code className="break-all font-mono text-xs">{row.id}</code>
            </DetailItem>
            <DetailItem label="Attempts">{row.attemptsLabel}</DetailItem>
            <DetailItem label="Last attempt">{row.lastAttemptAt ? formatDateTime(row.lastAttemptAt) : "Not attempted yet"}</DetailItem>
            {row.deliveredAt && <DetailItem label="Delivered">{formatDateTime(row.deliveredAt)}</DetailItem>}
            {row.nextAttemptAt && row.status === "pending" && <DetailItem label="Next attempt">{formatDateTime(row.nextAttemptAt)}</DetailItem>}
            {row.resentFromId && (
              <DetailItem label="Resend of">
                <code className="break-all font-mono text-xs">{row.resentFromId}</code>
              </DetailItem>
            )}
          </dl>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-ink">Request body</h3>
              <CopyButton value={row.payload} label="Copy" size="xs" />
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-ink" tabIndex={0}>
              {row.payload}
            </pre>
          </div>

          <div>
            <h3 className="mb-1.5 text-sm font-medium text-ink">Response body</h3>
            {row.responseBody ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-ink" tabIndex={0}>
                {row.responseBody}
              </pre>
            ) : (
              <p className="text-sm text-ink-muted">{row.responseStatus !== null ? "The response had no body." : "No response was received."}</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Bulk buttons above the log: retry what is waiting now, resend what failed for good. */
export function DeliveryBulkActions({ endpointId, pending, undelivered, active, apiEnabled }: { endpointId: string; pending: number; undelivered: number; active: boolean; apiEnabled: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"retry" | "resend" | null>(null);
  const [working, startWork] = useTransition();
  const run = (kind: "retry" | "resend") => {
    setBusy(kind);
    startWork(async () => {
      const result = kind === "retry" ? await retryPendingWebhooksAction(endpointId) : await resendFailedWebhooksAction(endpointId);
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
      setBusy(null);
    });
  };
  if (!pending && !undelivered) return null;
  const blocked = !active ? "Turn the endpoint on first." : !apiEnabled ? "The API is switched off." : undefined;
  return (
    <div className="flex flex-wrap gap-2">
      {pending > 0 && (
        <Button size="sm" variant="outline" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => run("retry")} loading={working && busy === "retry"} disabled={working || !!blocked} title={blocked}>
          Retry {pending} waiting now
        </Button>
      )}
      {undelivered > 0 && (
        <Button size="sm" variant="outline" leftIcon={<Icon.Send className="size-4" />} onClick={() => run("resend")} loading={working && busy === "resend"} disabled={working || !!blocked} title={blocked}>
          Resend {undelivered} failed
        </Button>
      )}
    </div>
  );
}

/** The delivery log: one row per delivery, opening a dialog with the request, the response and "Resend". */
export function DeliveryLog({ rows, apiEnabled }: { rows: DeliveryRow[]; apiEnabled: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((row) => row.id === openId) ?? null;

  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpenId(row.id)}
              className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:flex-row sm:items-center sm:gap-4 sm:px-5"
              aria-haspopup="dialog"
            >
              <span className="flex shrink-0 items-center gap-2 sm:w-28">
                <DeliveryStatusBadge status={row.status} />
                {row.responseStatus !== null && <span className="font-mono text-xs text-ink-muted">{row.responseStatus}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono text-sm text-ink">{row.event}</code>
                  {row.test && (
                    <Badge tone="info" size="xs">
                      Test
                    </Badge>
                  )}
                  {row.resentFromId && (
                    <Badge tone="outline" size="xs">
                      Resend
                    </Badge>
                  )}
                </span>
                {row.error ? (
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">{row.error}</span>
                ) : (
                  <span className="mt-0.5 block truncate font-mono text-xs text-ink-faint">{row.eventId}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-ink-muted sm:w-56 sm:justify-end">
                <span>{row.attemptsLabel}</span>
                <time dateTime={row.createdAt} title={formatDateTime(row.createdAt)}>
                  {relativeTime(row.createdAt)}
                </time>
                <Icon.ChevronRight className="hidden size-4 text-ink-faint sm:block" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <DeliveryDialog row={open} apiEnabled={apiEnabled} onClose={() => setOpenId(null)} />
    </>
  );
}
