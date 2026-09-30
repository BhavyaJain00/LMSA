import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { WebhookDelivery } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { paginate } from "@/lib/api/pagination";
import { endpointHost, kickWebhooks, undeliveredEvents } from "@/lib/webhooks/delivery";
import { readWebhookSecret } from "@/lib/webhooks/endpoints";
import { webhookEventLabel } from "@/lib/webhooks/events";
import {
  DELIVERY_PAGE_SIZE,
  deliveryFilterQuery,
  deliveryStats,
  describeAttempts,
  filterDeliveries,
  isDeliveryFilterActive,
  parseDeliveryFilter,
  type DeliveryFilter,
} from "@/lib/webhooks/log";
import { AUTO_DISABLE_AFTER_MS, DELIVERY_RETENTION_DAYS, MAX_DELIVERY_ATTEMPTS, describeDelay } from "@/lib/webhooks/policy";
import { parseWebhookPayload } from "@/lib/webhooks/payload";
import { webhookEndpointStatus } from "@/lib/webhooks/types";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs, DetailItem, SettingsSection } from "@/components/admin/settings/settings-ui";
import { CopyButton } from "@/components/developers/copy-button";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { DeliveryFilters } from "../../_components/delivery-filters";
import { DeliveryBulkActions, DeliveryLog, type DeliveryRow } from "../../_components/delivery-log";
import { disabledReasonText } from "../../_components/webhook-copy";
import { WebhookEndpointActions } from "../../_components/webhook-endpoint-actions";
import { WebhookSecretPanel } from "../../_components/webhook-secret-panel";
import { EndpointStatusBadge } from "../../_components/webhook-status";
import { WebhookTestPanel } from "../../_components/webhook-test-panel";

export const metadata = { title: "Webhook endpoint" };

const SETTINGS = "/admin/settings/api";

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") qs.set(key, String(value));
  const text = qs.toString();
  return text ? `?${text}` : "";
}

/** The stored body, indented for reading (left as it is when it is not JSON). */
function prettyPayload(delivery: WebhookDelivery): string {
  const payload = parseWebhookPayload(delivery.payload);
  return payload ? JSON.stringify(payload, null, 2) : delivery.payload;
}

function toRow(delivery: WebhookDelivery): DeliveryRow {
  return {
    id: delivery.id,
    event: delivery.event,
    eventLabel: webhookEventLabel(delivery.event),
    eventId: delivery.eventId ?? parseWebhookPayload(delivery.payload)?.id ?? delivery.id,
    status: delivery.status,
    attempts: delivery.attempts,
    attemptsLabel: delivery.attempts === 0 ? "Not attempted yet" : describeAttempts(delivery),
    responseStatus: delivery.responseStatus ?? null,
    responseBody: delivery.responseBody ?? null,
    error: delivery.lastError ?? null,
    test: !!delivery.test,
    resentFromId: delivery.resentFromId ?? null,
    durationMs: delivery.durationMs ?? null,
    createdAt: delivery.createdAt,
    lastAttemptAt: delivery.lastAttemptAt ?? null,
    deliveredAt: delivery.deliveredAt ?? null,
    nextAttemptAt: delivery.nextAttemptAt ?? null,
    payload: prettyPayload(delivery),
  };
}

function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  return (
    <p
      role="status"
      className={
        tone === "danger"
          ? "flex items-start gap-2 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-ink"
          : "flex items-start gap-2 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink"
      }
    >
      <Icon.AlertTriangle className={tone === "danger" ? "mt-0.5 size-4 shrink-0 text-danger" : "mt-0.5 size-4 shrink-0 text-warning"} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Pagination({ page, pageCount, total, href }: { page: number; pageCount: number; total: number; href: (page: number) => string }) {
  const start = total === 0 ? 0 : (page - 1) * DELIVERY_PAGE_SIZE + 1;
  const end = Math.min(total, page * DELIVERY_PAGE_SIZE);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-ink-muted sm:px-5">
      <span>
        Showing {formatNumber(start)}–{formatNumber(end)} of {formatNumber(total)} {total === 1 ? "delivery" : "deliveries"}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 && (
            <ButtonLink href={href(page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
              Newer
            </ButtonLink>
          )}
          <span className="tabular-nums">
            Page {page} of {pageCount}
          </span>
          {page < pageCount && (
            <ButtonLink href={href(page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
              Older
            </ButtonLink>
          )}
        </div>
      )}
    </nav>
  );
}

export default async function WebhookEndpointPage(props: PageProps<"/admin/settings/api/webhooks/[id]">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const path = `${SETTINGS}/webhooks/${id}`;
  await requireRole(["admin"], path);

  const db = await getDb();
  const endpoint = db.webhookEndpoints.find((e) => e.id === id);
  if (!endpoint) notFound();

  const apiEnabled = db.settings.api.enabled;
  const status = webhookEndpointStatus(endpoint);
  const host = endpointHost(endpoint.url);
  const stats = deliveryStats(db.webhookDeliveries, endpoint.id);
  const undelivered = undeliveredEvents(db.webhookDeliveries, endpoint.id).length;
  const secretReadable = readWebhookSecret(endpoint) !== null;
  const createdBy = endpoint.createdById ? db.users.find((u) => u.id === endpoint.createdById) : undefined;
  // Opening the page also nudges the delivery worker (retries that came due while the server was idle).
  if (apiEnabled && endpoint.active && stats.pending > 0) kickWebhooks();

  const filter: DeliveryFilter = parseDeliveryFilter(sp);
  const filtered = isDeliveryFilterActive(filter);
  const matching = filterDeliveries(db.webhookDeliveries, endpoint.id, filter);
  const requestedPage = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const { items, meta } = paginate(matching, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, DELIVERY_PAGE_SIZE);
  const rows = items.map(toRow);
  const query = deliveryFilterQuery(filter);
  const pageHref = (page: number) => `${path}${toQuery({ ...query, page: page > 1 ? page : undefined })}`;

  return (
    <>
      <Breadcrumbs items={[{ label: "API & webhooks", href: SETTINGS }, { label: host }]} />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{endpoint.description || host}</h2>
            <EndpointStatusBadge status={status} size="sm" />
            {endpoint.source === "api" && (
              <Badge tone="outline" size="sm" title="Created with an API key">
                Created via API
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 break-all rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink">{endpoint.url}</code>
            <CopyButton value={endpoint.url} label="Copy URL" size="sm" />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <WebhookEndpointActions
            endpoint={{ id: endpoint.id, url: endpoint.url, host, description: endpoint.description ?? "", events: [...endpoint.events], active: endpoint.active, pending: stats.pending }}
          />
        </div>
      </div>

      <div className="space-y-6">
        {(!apiEnabled || !secretReadable || status !== "active") && (
          <div className="space-y-3">
            {!apiEnabled && (
              <Notice tone="warning">
                The API is switched off, so no webhooks are sent and events that happen now are not queued.{" "}
                <Link href={SETTINGS} className="font-medium text-accent hover:underline">
                  Turn it on under Access
                </Link>
                .
              </Notice>
            )}
            {!secretReadable && (
              <Notice tone="danger">
                The signing secret of this endpoint can&apos;t be read because APP_SECRET changed since it was created, so nothing can be sent to it. Roll the secret below and update your receiver.
              </Notice>
            )}
            {status === "disabled" && endpoint.disabledReason && (
              <Notice tone="warning">
                {disabledReasonText(endpoint.disabledReason)}
                {endpoint.disabledAt ? ` (${formatDateTime(endpoint.disabledAt)})` : ""} {endpoint.lastError ? `Last error: ${endpoint.lastError} ` : ""}
                Fix the receiver, turn the endpoint back on, then resend the events it missed.
              </Notice>
            )}
            {status === "disabled" && !endpoint.disabledReason && <Notice tone="warning">This endpoint is switched off. Events that happen while it is off are not queued for it.</Notice>}
            {status === "failing" && (
              <Notice tone="warning">
                {endpoint.failureCount} failed {endpoint.failureCount === 1 ? "attempt" : "attempts"} in a row
                {endpoint.failingSince ? ` since ${formatDateTime(endpoint.failingSince)}` : ""}. {endpoint.lastError ?? ""} Deliveries are retried automatically; the endpoint is switched off when
                nothing gets through for {describeDelay(AUTO_DISABLE_AFTER_MS)}.
              </Notice>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Delivered (24 hours)" value={formatNumber(stats.delivered24h)} hint={`${formatNumber(stats.delivered7d)} in 7 days`} icon={<Icon.CheckCircle className="size-5" />} />
          <StatCard label="Failed (24 hours)" value={formatNumber(stats.failed24h)} hint={`${formatNumber(stats.failed7d)} in 7 days`} icon={<Icon.XCircle className="size-5" />} />
          <StatCard
            label="Success rate (7 days)"
            value={stats.successRate7d === null ? "—" : `${stats.successRate7d}%`}
            hint={stats.medianMs7d === null ? "No deliveries yet" : `Median response ${formatNumber(stats.medianMs7d)} ms`}
            icon={<Icon.TrendingUp className="size-5" />}
          />
          <StatCard label="Waiting for a retry" value={formatNumber(stats.pending)} hint={`Up to ${MAX_DELIVERY_ATTEMPTS} attempts per event`} icon={<Icon.Clock className="size-5" />} />
        </div>

        <SettingsSection title="Details">
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
            <DetailItem label="Events" className="sm:col-span-2 xl:col-span-3">
              <span className="mt-1 flex flex-wrap gap-1">
                {endpoint.events.map((event) => (
                  <Badge key={event} tone="outline" size="sm" title={webhookEventLabel(event)}>
                    {event}
                  </Badge>
                ))}
              </span>
            </DetailItem>
            <DetailItem label="Endpoint id">
              <code className="break-all font-mono text-xs">{endpoint.id}</code>
            </DetailItem>
            <DetailItem label="Added">
              {formatDateTime(endpoint.createdAt)}
              {createdBy ? ` by ${createdBy.name}` : ""}
            </DetailItem>
            <DetailItem label="Last changed">{endpoint.updatedAt ? formatDateTime(endpoint.updatedAt) : "Never"}</DetailItem>
            <DetailItem label="Last delivery attempt">{endpoint.lastDeliveryAt ? relativeTime(endpoint.lastDeliveryAt) : "Nothing sent yet"}</DetailItem>
            <DetailItem label="Last success">{endpoint.lastSuccessAt ? formatDateTime(endpoint.lastSuccessAt) : "None yet"}</DetailItem>
            <DetailItem label="Last failure">{endpoint.lastFailureAt ? formatDateTime(endpoint.lastFailureAt) : "None"}</DetailItem>
          </dl>
        </SettingsSection>

        <SettingsSection title="Signing secret" description="Your receiver uses it to check that a request really comes from this site and was not changed on the way.">
          <WebhookSecretPanel endpointId={endpoint.id} rotatedAt={endpoint.secretRotatedAt ?? null} pending={stats.pending} />
        </SettingsSection>

        <SettingsSection title="Send a test event" description="Check your receiver without waiting for a real enrollment or payment.">
          <WebhookTestPanel endpointId={endpoint.id} subscribed={[...endpoint.events]} apiEnabled={apiEnabled} />
        </SettingsSection>

        <SettingsSection
          title="Deliveries"
          description={`Every request sent to this endpoint in the last ${DELIVERY_RETENTION_DAYS} days. Open one to see the payload and the response, or to send it again.`}
          actions={
            stats.total > 0 ? (
              <a href={`${path}/export${toQuery(query)}`} download className={buttonClasses({ variant: "outline", size: "sm" })}>
                <Icon.Download className="size-4" />
                Export CSV
              </a>
            ) : undefined
          }
        >
          {stats.total > 0 && <DeliveryFilters action={path} filter={filter} />}
          {(stats.pending > 0 || undelivered > 0) && (
            <div className="px-4 py-3 sm:px-5">
              <DeliveryBulkActions endpointId={endpoint.id} pending={stats.pending} undelivered={undelivered} active={endpoint.active} apiEnabled={apiEnabled} />
            </div>
          )}
          {rows.length > 0 ? (
            <>
              <DeliveryLog rows={rows} apiEnabled={apiEnabled} />
              <Pagination page={meta.page} pageCount={meta.totalPages} total={meta.total} href={pageHref} />
            </>
          ) : (
            <div className="p-4 sm:p-5">
              {meta.total > 0 ? (
                <EmptyState
                  compact
                  icon={<Icon.Inbox />}
                  title="There is no such page"
                  description="The log is shorter than that."
                  action={
                    <ButtonLink href={pageHref(1)} variant="outline" size="sm">
                      Back to the newest deliveries
                    </ButtonLink>
                  }
                />
              ) : filtered ? (
                <EmptyState
                  compact
                  icon={<Icon.Search />}
                  title="No deliveries match these filters"
                  description="Try another status or event, or clear the filters to see everything."
                  action={
                    <ButtonLink href={path} variant="outline" size="sm">
                      Clear filters
                    </ButtonLink>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={<Icon.Send />}
                  title="Nothing has been sent yet"
                  description="Deliveries show up here as soon as one of the selected events happens. Send a test event above to try your receiver now."
                />
              )}
            </div>
          )}
        </SettingsSection>
      </div>
    </>
  );
}
