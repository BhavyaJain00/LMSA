import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { describeAuditAction } from "@/lib/audit";
import { API_KEY_RATE_LIMIT } from "@/lib/api/rate-limit";
import { isKeyOwnerActive } from "@/lib/api/auth";
import { cronKey } from "@/lib/email";
import { endpointHost, kickWebhooks } from "@/lib/webhooks/delivery";
import { deliveryStatsByEndpoint } from "@/lib/webhooks/log";
import { MAX_DELIVERY_ATTEMPTS, DELIVERY_RETENTION_DAYS } from "@/lib/webhooks/policy";
import { webhookEndpointStatus } from "@/lib/webhooks/types";
import { ButtonLink } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { SettingsPanelHeader, SettingsSection, SettingsSwitchRow } from "@/components/admin/settings/settings-ui";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { ApiAccessSwitch } from "./_components/api-access-switch";
import { ApiKeysManager, type ApiKeyRow } from "./_components/api-keys-manager";
import { WebhooksManager, type WebhookRow } from "./_components/webhooks-manager";

export const metadata = { title: "API & webhooks" };

const DAY_MS = 86_400_000;
const RECENT_ACTIVITY = 8;

/** Plain-language labels for the changes API keys can make (other actions use the audit log's wording). */
const API_ACTION_LABELS: Record<string, string> = {
  "api.course.create": "Course created",
  "api.course.update": "Course updated",
  "api.user.create": "Member created",
  "api.user.update": "Member updated",
  "api.enrollment.create": "Member enrolled in a course",
  "api.enrollment.delete": "Enrollment removed",
  "api.batch_member.add": "Member added to a batch",
  "api.webhook.create": "Webhook endpoint added",
  "api.webhook.update": "Webhook endpoint changed",
  "api.webhook.delete": "Webhook endpoint deleted",
  "api.webhook.test": "Test webhook sent",
};

/** Keys (without hashes), webhook endpoints (without secrets), usage counts and recent API changes for the page. */
async function loadApiOverview() {
  const db = await getDb();
  const now = Date.now();
  const names = new Map(db.users.map((u) => [u.id, u.name]));

  const keys: ApiKeyRow[] = [...db.apiKeys]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: [...k.scopes],
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt ?? null,
      revokedAt: k.revokedAt ?? null,
      createdBy: names.get(k.createdById) ?? null,
      ownerActive: isKeyOwnerActive(db, k),
    }));
  const active = keys.filter((k) => !k.revokedAt);
  const usedRecently = active.filter((k) => k.lastUsedAt && now - Date.parse(k.lastUsedAt) < 30 * DAY_MS).length;
  const monthAgo = new Date(now - 30 * DAY_MS).toISOString();
  const apiEvents = db.auditEvents.filter((e) => e.action.startsWith("api.")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const stats = deliveryStatsByEndpoint(db.webhookDeliveries, now);
  const webhooks: WebhookRow[] = [...db.webhookEndpoints]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => {
      const s = stats.get(e.id);
      return {
        id: e.id,
        url: e.url,
        host: endpointHost(e.url),
        description: e.description ?? "",
        events: [...e.events],
        status: webhookEndpointStatus(e),
        disabledReason: e.disabledReason ?? null,
        failureCount: e.failureCount,
        lastError: e.lastError ?? null,
        lastDeliveryAt: e.lastDeliveryAt ?? null,
        pending: s?.pending ?? 0,
        delivered24h: s?.delivered24h ?? 0,
        failed24h: s?.failed24h ?? 0,
        successRate7d: s?.successRate7d ?? null,
      };
    });
  return {
    keys,
    webhooks,
    active,
    usedRecently,
    writesThisMonth: apiEvents.filter((e) => e.createdAt >= monthAgo).length,
    totalApiEvents: apiEvents.length,
    recent: apiEvents.slice(0, RECENT_ACTIVITY),
    enabled: db.settings.api.enabled,
  };
}

export default async function ApiSettingsPage() {
  await requireRole(["admin"], "/admin/settings/api");
  const { keys, webhooks, active, usedRecently, writesThisMonth, totalApiEvents, recent, enabled } = await loadApiOverview();
  // Opening the page also nudges the delivery worker (retries that came due while the server was idle).
  if (enabled && webhooks.some((w) => w.pending > 0)) kickWebhooks();
  const webhooksOn = webhooks.filter((w) => w.status !== "disabled").length;

  return (
    <>
      <SettingsPanelHeader
        title="API & webhooks"
        description="Connect other tools to your academy: read and update courses, members, enrollments and payments over a REST API with keys you control, and get signed webhooks the moment something happens."
        actions={
          <ButtonLink href="/developers" variant="outline" size="sm" leftIcon={<Icon.Code className="size-4" />}>
            API reference
          </ButtonLink>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Status" value={enabled ? "On" : "Off"} hint={enabled ? "Requests with a valid key are answered" : "All requests are refused"} icon={<Icon.Zap className="size-5" />} />
        <StatCard label="Active keys" value={formatNumber(active.length)} hint={`${formatNumber(usedRecently)} used in 30 days · ${formatNumber(keys.length - active.length)} revoked`} icon={<Icon.Lock className="size-5" />} />
        <StatCard
          label="Webhook endpoints"
          value={formatNumber(webhooksOn)}
          hint={webhooks.length ? `${formatNumber(webhooks.reduce((n, w) => n + w.delivered24h, 0))} delivered in 24 hours` : "None added yet"}
          icon={<Icon.Send className="size-5" />}
        />
        <StatCard label="Changes via API (30 days)" value={formatNumber(writesThisMonth)} hint="Recorded in the audit log" icon={<Icon.ClipboardList className="size-5" />} />
      </div>

      <div className="space-y-6">
        <SettingsSection title="Access">
          <SettingsSwitchRow>
            <ApiAccessSwitch initial={enabled} activeKeys={active.length} />
          </SettingsSwitchRow>
          <div className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-3 sm:px-5">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Base URL</p>
              <code className="mt-1 block break-all font-mono text-xs text-ink">{siteConfig.appUrl}/api/v1</code>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Authentication</p>
              <code className="mt-1 block break-all font-mono text-xs text-ink">Authorization: Bearer ll_live_…</code>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Rate limit</p>
              <p className="mt-1 text-ink">
                {API_KEY_RATE_LIMIT.limit} requests per minute per key
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="API keys" description="Each key has its own permissions. The full key is shown only once, when it is created; only a fingerprint is stored.">
          <ApiKeysManager keys={keys} appUrl={siteConfig.appUrl} />
        </SettingsSection>

        <SettingsSection
          title="Webhooks"
          description={`Signed POST requests to your URLs when events happen. Failed deliveries are retried up to ${MAX_DELIVERY_ATTEMPTS} times over about a day; the log keeps ${DELIVERY_RETENTION_DAYS} days.`}
        >
          <WebhooksManager endpoints={webhooks} apiEnabled={enabled} />
          {webhooks.length > 0 && (
            <details className="px-4 py-3 text-sm sm:px-5">
              <summary className="cursor-pointer font-medium text-ink">Keep retries on time with a scheduler</summary>
              <p className="mt-2 text-ink-muted">
                New events are sent right away. Retries are sent by a timer inside the server, which stops while the server is restarting or asleep. For reliable retries, call this URL every minute from cron or
                your host&apos;s scheduler (it uses the same key as the email cron URL):
              </p>
              <code className="mt-2 block select-all break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink">
                {siteConfig.appUrl}/api/cron/webhooks?key={cronKey()}
              </code>
            </details>
          )}
        </SettingsSection>

        <SettingsSection
          title="Recent API activity"
          description="Changes made with API keys. Reads are not logged."
          actions={
            totalApiEvents > 0 ? (
              <Link href="/admin/audit?action=api.*" className="shrink-0 text-sm font-medium text-accent hover:underline">
                View all
              </Link>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">No changes have been made through the API yet. Creating or updating courses, members and enrollments with a key will show up here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((event) => {
                const keyName = typeof event.meta?.apiKey === "string" ? event.meta.apiKey : null;
                return (
                  <li key={event.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{API_ACTION_LABELS[event.action] ?? describeAuditAction(event.action)}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {event.targetType && event.targetId ? `${event.targetType} ${event.targetId}` : "—"}
                        {keyName ? ` · ${keyName}` : ""}
                      </p>
                    </div>
                    <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)} className="shrink-0 text-xs text-ink-muted">
                      {relativeTime(event.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsSection>
      </div>
    </>
  );
}
