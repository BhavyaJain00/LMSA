"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createWebhookEndpointAction, deleteWebhookEndpointAction, sendTestWebhookAction, setWebhookActiveAction, type CreatedWebhook } from "@/lib/actions/webhooks";
import type { WebhookEndpointStatus } from "@/lib/webhooks/types";
import { MAX_WEBHOOK_ENDPOINTS } from "@/lib/webhooks/policy";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, formatNumber, relativeTime } from "@/lib/utils";
import { DELETE_ENDPOINT_WARNING, disabledReasonText, turnOffWarning } from "./webhook-copy";
import { WebhookFields } from "./webhook-fields";
import { SecretValue } from "./webhook-secret";
import { EndpointStatusBadge } from "./webhook-status";

/** A webhook endpoint as listed for administrators (never its secret). */
export interface WebhookRow {
  id: string;
  url: string;
  host: string;
  description: string;
  events: string[];
  status: WebhookEndpointStatus;
  /** Switched off by the system ("failures" or "gone") rather than by an administrator. */
  disabledReason: string | null;
  failureCount: number;
  lastError: string | null;
  lastDeliveryAt: string | null;
  pending: number;
  delivered24h: number;
  failed24h: number;
  successRate7d: number | null;
}

const BASE = "/admin/settings/api/webhooks";
const SHOWN_EVENTS = 3;

function CreateEndpointDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (created: CreatedWebhook) => void }) {
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, errors, formError } = useFormAction(createWebhookEndpointAction, {
    toastSuccess: false,
    toastError: false,
    onSuccess: (result) => {
      setFormKey((k) => k + 1);
      onCreated(result.data);
    },
  });
  const hasFieldError = Object.keys(errors).length > 0;

  return (
    <Dialog open={open} onClose={onClose} title="Add a webhook endpoint" description="We send a signed POST request to this URL whenever one of the selected events happens." size="lg">
      <form key={formKey} onSubmit={onSubmit} noValidate className="space-y-5">
        <WebhookFields idPrefix="new-webhook" errors={errors} />
        {formError && !hasFieldError && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Add endpoint
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Shown after an endpoint is created: its signing secret and the next steps. */
function CreatedEndpointDialog({ created, onClose }: { created: CreatedWebhook | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!created}
      onClose={onClose}
      title="Endpoint added"
      description="Use the signing secret to check that requests really come from this site."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          {created && (
            <ButtonLink href={`${BASE}/${created.id}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
              Send a test event
            </ButtonLink>
          )}
        </>
      }
    >
      {created && (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Signing secret</p>
            <SecretValue secret={created.secret} />
            <p className="mt-2 text-xs text-ink-muted">You can show it again, or replace it, on the endpoint&apos;s page.</p>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-muted">
            <li>Store the secret in your receiver&apos;s configuration.</li>
            <li>
              Verify the <code className="text-xs text-ink">LL-Signature</code> header of each request (see{" "}
              <Link href="/developers#webhook-signatures" className="font-medium text-accent hover:underline">
                verifying signatures
              </Link>
              ).
            </li>
            <li>Answer with a 2xx status within 10 seconds, then do slow work in the background.</li>
          </ol>
        </div>
      )}
    </Dialog>
  );
}

type PendingAction = { kind: "delete" | "pause"; row: WebhookRow } | null;

export function WebhooksManager({ endpoints, apiEnabled }: { endpoints: WebhookRow[]; apiEnabled: boolean }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [action, setAction] = useState<PendingAction>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [working, startWork] = useTransition();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return endpoints;
    return endpoints.filter((e) => `${e.url} ${e.description} ${e.events.join(" ")} ${e.status}`.toLowerCase().includes(needle));
  }, [endpoints, query]);
  const atLimit = endpoints.length >= MAX_WEBHOOK_ENDPOINTS;

  const run = (id: string, task: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) => {
    setBusyId(id);
    startWork(async () => {
      const result = await task();
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
      setBusyId(null);
      after?.();
    });
  };

  const sendTest = (row: WebhookRow) => {
    setBusyId(row.id);
    startWork(async () => {
      const result = await sendTestWebhookAction(row.id, row.events[0] ?? "");
      if (!result.ok) toast.error(result.error);
      else if (result.data.delivered) toast.success(result.message ?? "Test delivered");
      else toast.error("The test was not delivered", result.data.error ?? undefined);
      setBusyId(null);
    });
  };

  const addButton = (
    <Button
      size="sm"
      leftIcon={<Icon.Plus className="size-4" />}
      onClick={() => setCreating(true)}
      disabled={atLimit}
      title={atLimit ? `A site can have at most ${MAX_WEBHOOK_ENDPOINTS} endpoints.` : undefined}
    >
      Add endpoint
    </Button>
  );

  return (
    <div>
      {endpoints.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <label htmlFor="webhook-search" className="sr-only">
              Search endpoints
            </label>
            <Input
              id="webhook-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search endpoints"
              leftAddon={<Icon.Search className="size-4" />}
              className="sm:w-64"
            />
          </div>
          {addButton}
        </div>
      )}

      {!apiEnabled && endpoints.length > 0 && (
        <p className="flex items-start gap-2 border-b border-border bg-warning/10 px-4 py-3 text-sm text-ink sm:px-5" role="status">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          The API is switched off, so no webhooks are sent and events that happen now are not queued. Turn it on under Access.
        </p>
      )}

      {endpoints.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            compact
            icon={<Icon.Send />}
            title="No webhook endpoints yet"
            description="Add a URL to be told the moment someone enrolls, pays, completes a course or earns a certificate. Works with Zapier, Make, n8n and your own code."
            action={addButton}
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-muted sm:px-5">No endpoints match. Try another search.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((row) => {
            const off = row.status === "disabled";
            return (
              <li key={row.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${BASE}/${row.id}`} className={cn("min-w-0 break-all font-mono text-sm font-medium text-ink hover:text-accent hover:underline", off && "text-ink-muted")}>
                      {row.url}
                    </Link>
                    <EndpointStatusBadge status={row.status} />
                  </div>
                  {row.description && <p className="text-sm text-ink-muted">{row.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {row.events.slice(0, SHOWN_EVENTS).map((event) => (
                      <Badge key={event} tone="outline" size="xs">
                        {event}
                      </Badge>
                    ))}
                    {row.events.length > SHOWN_EVENTS && (
                      <Badge tone="neutral" size="xs" title={row.events.slice(SHOWN_EVENTS).join(", ")}>
                        +{row.events.length - SHOWN_EVENTS} more
                      </Badge>
                    )}
                  </div>
                  {off && row.disabledReason && <p className="text-xs text-warning">{disabledReasonText(row.disabledReason)}</p>}
                  {row.status === "failing" && row.lastError && (
                    <p className="text-xs text-warning">
                      {row.failureCount} failed {row.failureCount === 1 ? "attempt" : "attempts"} in a row. {row.lastError}
                    </p>
                  )}
                  <p className="text-xs text-ink-muted">
                    {row.lastDeliveryAt ? `Last delivery ${relativeTime(row.lastDeliveryAt)}` : "Nothing sent yet"} · {formatNumber(row.delivered24h)} delivered and {formatNumber(row.failed24h)} failed in 24 hours
                    {row.pending > 0 ? ` · ${formatNumber(row.pending)} waiting for a retry` : ""}
                    {row.successRate7d !== null ? ` · ${row.successRate7d}% success in 7 days` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ButtonLink href={`${BASE}/${row.id}`} size="sm" variant="outline">
                    Deliveries
                  </ButtonLink>
                  <Dropdown
                    align="end"
                    trigger={
                      <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                        {working && busyId === row.id ? <Spinner className="size-4" /> : <Icon.MoreHorizontal className="size-4" />}
                        <span className="sr-only">More actions for {row.host}</span>
                      </span>
                    }
                    items={[
                      { label: "Send test event", icon: <Icon.Send className="size-4" />, onClick: () => sendTest(row), disabled: !apiEnabled, description: row.events[0] },
                      off
                        ? { label: "Turn on", icon: <Icon.Play className="size-4" />, onClick: () => run(row.id, () => setWebhookActiveAction(row.id, true)) }
                        : { label: "Turn off", icon: <Icon.Pause className="size-4" />, onClick: () => setAction({ kind: "pause", row }) },
                      { label: "Delete", icon: <Icon.Trash className="size-4" />, destructive: true, separator: true, onClick: () => setAction({ kind: "delete", row }) },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateEndpointDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          setCreating(false);
          setCreated(result);
        }}
      />
      <CreatedEndpointDialog created={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (!action) return;
          const { kind, row } = action;
          run(row.id, () => (kind === "delete" ? deleteWebhookEndpointAction(row.id) : setWebhookActiveAction(row.id, false)), () => setAction(null));
        }}
        loading={working}
        destructive
        title={action?.kind === "delete" ? `Delete the endpoint at ${action.row.host}?` : `Turn off the endpoint at ${action?.row.host ?? ""}?`}
        description={action?.kind === "delete" ? DELETE_ENDPOINT_WARNING : turnOffWarning(action?.row.pending ?? 0)}
        confirmLabel={action?.kind === "delete" ? "Delete endpoint" : "Turn off"}
      />
    </div>
  );
}
