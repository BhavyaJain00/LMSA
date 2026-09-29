import Link from "next/link";
import { after } from "next/server";
import type { EmailStatus } from "@/lib/types";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { deliverDueEmails, getDeliveryState, getTransportStatus } from "@/lib/email";
import { listOutbox, parseOutboxFilters, type OutboxFilters as Filters } from "@/lib/email/admin";
import { EMAIL_CATEGORY_LABELS } from "@/lib/email/preferences";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { OutboxToolbar } from "@/components/admin/emails/outbox-toolbar";
import { OutboxFilters } from "@/components/admin/emails/outbox-filters";
import { EmailCategoryBadge, EmailStatusBadge } from "@/components/admin/emails/email-status";
import { cn, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Outbox" };

const STATUS_TABS: { value: EmailStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

/** "in 4 minutes", or "soon" once the retry is due. */
function retryLabel(iso: string): string {
  return new Date(iso).getTime() > Date.now() ? relativeTime(iso) : "soon";
}

function hrefFor(filters: Filters, patch: Partial<Filters>): string {
  const next = { ...filters, ...patch };
  const qs = new URLSearchParams();
  if (next.status !== "all") qs.set("status", next.status);
  if (next.category !== "all") qs.set("category", next.category);
  if (next.q) qs.set("q", next.q);
  if (next.page > 1) qs.set("page", String(next.page));
  const query = qs.toString();
  return query ? `/admin/emails?${query}` : "/admin/emails";
}

export default async function OutboxPage(props: PageProps<"/admin/emails">) {
  const viewer = await requireRole(["moderator"], "/admin/emails");
  const filters = parseOutboxFilters(await props.searchParams);
  const [list, settings] = await Promise.all([listOutbox(filters), getSettings()]);
  const transport = getTransportStatus(settings);
  const delivery = getDeliveryState();

  // Opportunistic delivery: anything due goes out after this response is sent.
  if (list.counts.queued > 0) {
    after(async () => {
      await deliverDueEmails().catch(() => undefined);
    });
  }

  const categories = Object.entries(list.categoryCounts)
    .map(([value, count]) => ({ value, label: EMAIL_CATEGORY_LABELS[value as keyof typeof EMAIL_CATEGORY_LABELS] ?? value, count: count ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (filters.category !== "all" && !categories.some((c) => c.value === filters.category)) {
    categories.push({ value: filters.category, label: EMAIL_CATEGORY_LABELS[filters.category], count: 0 });
  }
  const filtered = filters.status !== "all" || filters.category !== "all" || !!filters.q;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Outbox"
        description="Every email the platform sends — notifications, announcements, receipts and account emails — with its delivery status."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Outbox" }]} />}
        actions={<OutboxToolbar defaultTestTo={viewer.email} failedCount={list.counts.failed} canConfigure={isAdmin(viewer)} />}
      />

      {transport.problems.length > 0 ? (
        <div role="alert" className="mb-5 flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Emails can&apos;t be delivered until the mail configuration is fixed.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {transport.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {isAdmin(viewer) && (
              <Link href="/admin/settings/email" className="mt-2 inline-block font-medium underline">
                Open email settings
              </Link>
            )}
          </div>
        </div>
      ) : transport.transport === "log" ? (
        <div className="mb-5 flex gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-info">
          <Icon.Info className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">
            <span className="font-medium">Log mode.</span> MAIL_TRANSPORT is &quot;log&quot;: emails are recorded here and summarised in the server log, but nothing is delivered. Set
            MAIL_TRANSPORT=smtp and the SMTP_* variables in .env to send real email.
          </p>
        </div>
      ) : !settings.email.enabled ? (
        <div className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">Notification emails are turned off. Only account emails (password resets, verification, receipts sent by staff) are delivered.</p>
        </div>
      ) : null}

      <nav aria-label="Filter by status" className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {STATUS_TABS.map((tab) => {
          const active = filters.status === tab.value;
          const count = tab.value === "all" ? list.counts.total : list.counts[tab.value];
          return (
            <Link
              key={tab.value}
              href={hrefFor(filters, { status: tab.value, page: 1 })}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "border-transparent bg-ink text-surface-1" : "border-border bg-surface-1 text-ink-muted hover:text-ink",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] tabular-nums",
                  active ? "bg-surface-1/20 text-surface-1" : tab.value === "failed" && count > 0 ? "bg-danger/15 text-danger" : "bg-surface-3 text-ink-muted",
                )}
              >
                {formatNumber(count)}
              </span>
            </Link>
          );
        })}
      </nav>

      {list.counts.total === 0 ? (
        <EmptyState
          icon={<Icon.Send />}
          title="No emails yet"
          description="Emails appear here as soon as the platform sends one: notification copies, announcements, receipts, password resets and test messages."
          action={
            isAdmin(viewer) ? (
              <ButtonLink href="/admin/settings/email" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                Email settings
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <OutboxFilters values={{ status: filters.status, category: filters.category, q: filters.q }} categories={categories} />
          <Table>
            <THead>
              <tr>
                <TH>Recipient</TH>
                <TH className="hidden md:table-cell">Subject</TH>
                <TH className="hidden lg:table-cell">Category</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Created</TH>
              </tr>
            </THead>
            <TBody>
              {list.rows.length === 0 ? (
                <TableEmpty colSpan={5}>
                  {filters.q ? `No emails match “${filters.q}”.` : "No emails match these filters."}{" "}
                  {filtered && (
                    <Link href="/admin/emails" className="font-medium text-accent hover:underline">
                      Clear filters
                    </Link>
                  )}
                </TableEmpty>
              ) : (
                list.rows.map((row) => (
                  <TR key={row.id} className="relative transition-colors hover:bg-surface-2">
                    <TD className="max-w-0 w-[40%] md:w-[26%]">
                      <Link href={`/admin/emails/${row.id}`} className="block truncate font-medium after:absolute after:inset-0 hover:underline">
                        {row.toName || row.to}
                      </Link>
                      <p className="truncate text-xs text-ink-muted">
                        {row.toName ? row.to : ""}
                        {row.ccCount > 0 && ` +${row.ccCount} cc`}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink md:hidden">{row.subject}</p>
                    </TD>
                    <TD className="hidden max-w-0 md:table-cell">
                      <p className="truncate">{row.subject}</p>
                      {row.lastError && row.status !== "sent" && <p className="truncate text-xs text-danger">{row.lastError}</p>}
                    </TD>
                    <TD className="hidden lg:table-cell">
                      <EmailCategoryBadge category={row.category} />
                    </TD>
                    <TD>
                      <EmailStatusBadge status={row.status} attempts={row.attempts} />
                      {row.status === "queued" && row.attempts > 0 && row.nextAttemptAt && (
                        <p className="mt-0.5 text-[11px] text-ink-muted" title={formatDateTime(row.nextAttemptAt)}>
                          Attempt {row.attempts + 1} {retryLabel(row.nextAttemptAt)}
                        </p>
                      )}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell" title={formatDateTime(row.createdAt)}>
                      {relativeTime(row.createdAt)}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>

          {list.pageCount > 1 && (
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-ink-muted">
                Page {list.page} of {list.pageCount} · {formatNumber(list.total)} {list.total === 1 ? "email" : "emails"}
              </p>
              <div className="flex gap-2">
                {list.page > 1 ? (
                  <ButtonLink href={hrefFor(filters, { page: list.page - 1 })} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
                    Newer
                  </ButtonLink>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-ink-faint">Newer</span>
                )}
                {list.page < list.pageCount ? (
                  <ButtonLink href={hrefFor(filters, { page: list.page + 1 })} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
                    Older
                  </ButtonLink>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-ink-faint">Older</span>
                )}
              </div>
            </nav>
          )}

          <p className="text-xs text-ink-faint">
            {transport.label}.{" "}
            {delivery.running
              ? "A delivery run is in progress."
              : delivery.lastRun?.ran
                ? `Last delivery run ${relativeTime(delivery.lastRun.startedAt)}: ${delivery.lastRun.sent} sent, ${delivery.lastRun.retried} to retry, ${delivery.lastRun.failed} failed.`
                : "Queued emails are delivered in the background and retried after 1 min, 5 min, 30 min and 2 h."}
            {delivery.pausedUntil && ` Automatic delivery is paused until ${formatDateTime(delivery.pausedUntil)} after a connection error.`}
          </p>
        </div>
      )}
    </div>
  );
}
