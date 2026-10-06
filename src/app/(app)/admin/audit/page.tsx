import Link from "next/link";
import type { AuditEvent, Database } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  AUDIT_PAGE_SIZE,
  auditFacets,
  auditFilterToQuery,
  auditTargetHref,
  countAuditEventsSince,
  describeAuditAction,
  describeAuditTarget,
  filterAuditEvents,
  isAuditFilterActive,
  parseAuditFilter,
  searchParam,
  type AuditFilter,
} from "@/lib/audit";
import { paginate } from "@/lib/api/pagination";
import { maybePurgeExpiredRecords } from "@/lib/legal/retention-run";
import { clampRetentionDays } from "@/lib/legal/retention";
import { isDeletedAccount } from "@/lib/legal/erase";
import {
  countDataRequests,
  dataRequestRows,
  DATA_REQUEST_STATUS_LABELS,
  DATA_REQUEST_TYPE_LABELS,
  parseDataRequestFilter,
  type DataRequestFilter,
} from "@/lib/legal/data-requests";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import type { PickerMember } from "@/components/admin/settings/member-picker";
import { AuditFilters, type AuditFilterOptions } from "@/components/legal/audit-filters";
import { AuditDetailDrawer, type AuditDetail } from "@/components/legal/audit-detail-drawer";
import { DataRequestTools } from "@/components/legal/data-request-tools";
import { cn, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Audit log" };

const DAY_MS = 24 * 60 * 60 * 1000;

type Actors = Map<string, { name: string; email: string }>;

const NO_FILTER: AuditFilter = { q: "", actor: "", action: "", targetType: "", from: "", to: "" };

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function activityHref(filter: AuditFilter, extra: { page?: number; event?: string } = {}): string {
  return `/admin/audit${toQuery({ ...auditFilterToQuery(filter), page: extra.page && extra.page > 1 ? extra.page : undefined, event: extra.event })}`;
}

function requestsHref(filter: DataRequestFilter, page?: number): string {
  return `/admin/audit${toQuery({ tab: "requests", type: filter.type === "all" ? undefined : filter.type, q: filter.q || undefined, page: page && page > 1 ? page : undefined })}`;
}

/** Actor names for display: erased accounts read "Deleted user", missing ones keep their id. */
function actorMap(db: Database): Actors {
  return new Map(db.users.map((u) => [u.id, { name: u.name, email: isDeletedAccount(u) ? "" : u.email }]));
}

function formatMetaValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function buildDetail(event: AuditEvent, db: Database, actors: Actors, filter: AuditFilter): AuditDetail {
  const actor = event.actorId ? actors.get(event.actorId) : undefined;
  const related: AuditDetail["related"] = [];
  if (event.actorId) related.push({ label: `Everything done by ${actor?.name ?? "this member"}`, href: activityHref({ ...NO_FILTER, actor: event.actorId }) });
  if (event.targetType && event.targetId) related.push({ label: `Every event for this ${describeAuditTarget(event.targetType).toLowerCase()}`, href: activityHref({ ...NO_FILTER, q: event.targetId }) });
  related.push({ label: `Every “${describeAuditAction(event.action)}” event`, href: activityHref({ ...NO_FILTER, action: event.action }) });
  if (event.ip) related.push({ label: `Everything from ${event.ip}`, href: activityHref({ ...NO_FILTER, q: event.ip }) });
  // Links that would show the list already on screen are left out.
  const current = activityHref(filter);
  return {
    id: event.id,
    action: event.action,
    actionLabel: describeAuditAction(event.action),
    when: formatDateTime(event.createdAt),
    whenIso: event.createdAt,
    relative: relativeTime(event.createdAt),
    actor: event.actorId ? { name: actor?.name ?? "Unknown member", email: actor?.email || undefined, href: actor ? `/admin/members/${event.actorId}` : undefined } : null,
    target:
      event.targetType && event.targetId
        ? {
            typeLabel: describeAuditTarget(event.targetType),
            id: event.targetId,
            href: auditTargetHref(event, (paymentId) => db.payments.find((p) => p.id === paymentId)?.orderId),
          }
        : null,
    ip: event.ip,
    meta: Object.entries(event.meta ?? {}).map(([key, value]) => ({ key, value: formatMetaValue(value) })),
    related: related.filter((r) => r.href !== current),
  };
}

function Pagination({ page, pageCount, total, noun, href }: { page: number; pageCount: number; total: number; noun: [string, string]; href: (page: number) => string }) {
  const start = total === 0 ? 0 : (page - 1) * AUDIT_PAGE_SIZE + 1;
  const end = Math.min(total, page * AUDIT_PAGE_SIZE);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
      <span>{total === 0 ? "No results" : `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)} ${total === 1 ? noun[0] : noun[1]}`}</span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 && (
            <ButtonLink href={href(page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />}>
              Newer
            </ButtonLink>
          )}
          <span className="tabular-nums">
            Page {page} of {pageCount}
          </span>
          {page < pageCount && (
            <ButtonLink href={href(page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />}>
              Older
            </ButtonLink>
          )}
        </div>
      )}
    </nav>
  );
}

function ActivityTab({ db, sp, actors, retentionDays }: { db: Database; sp: Awaited<PageProps<"/admin/audit">["searchParams"]>; actors: Actors; retentionDays: number }) {
  const filter = parseAuditFilter(sp);
  const events = db.auditEvents;
  const matching = filterAuditEvents(events, filter, actors);
  const { items: visible, meta } = paginate(matching, Number(searchParam(sp, "page")) || 1, AUDIT_PAGE_SIZE);
  const selectedId = searchParam(sp, "event");
  const selected = selectedId ? events.find((e) => e.id === selectedId) : undefined;
  const filtered = isAuditFilterActive(filter);

  const now = new Date();
  const facets = auditFacets(events);
  const options: AuditFilterOptions = {
    actors: [
      ...[...facets.actors.entries()]
        .map(([id, count]) => ({ value: id, label: `${actors.get(id)?.name ?? id} (${formatNumber(count)})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      ...(facets.system ? [{ value: "system", label: `System (${formatNumber(facets.system)})` }] : []),
    ],
    actionGroups: facets.groups.map((g) => ({ value: g.value, label: g.label, actions: g.actions.map((a) => ({ value: a.value, label: `${a.label} (${formatNumber(a.count)})` })) })),
    targets: facets.targetTypes.map((t) => ({ value: t.value, label: `${t.label} (${formatNumber(t.count)})` })),
  };
  // Keep a filter value selectable even when no event carries it any more (e.g. after a purge).
  if (filter.actor && !options.actors.some((a) => a.value === filter.actor)) options.actors.push({ value: filter.actor, label: actors.get(filter.actor)?.name ?? filter.actor });
  if (filter.targetType && !options.targets.some((t) => t.value === filter.targetType)) options.targets.push({ value: filter.targetType, label: describeAuditTarget(filter.targetType) });
  const knownAction = options.actionGroups.some((g) => g.value === filter.action || g.actions.some((a) => a.value === filter.action));
  if (filter.action && !knownAction) options.actionGroups.push({ value: filter.action, label: describeAuditAction(filter.action), actions: [] });

  const exportHref = `/admin/audit/export${toQuery(auditFilterToQuery(filter))}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Events (24 hours)" value={formatNumber(countAuditEventsSince(events, new Date(now.getTime() - DAY_MS)))} icon={<Icon.Clock className="size-5" />} />
        <StatCard label="Events (7 days)" value={formatNumber(countAuditEventsSince(events, new Date(now.getTime() - 7 * DAY_MS)))} icon={<Icon.Calendar className="size-5" />} />
        <StatCard label="People who acted" value={formatNumber(facets.actors.size)} icon={<Icon.Users className="size-5" />} />
        <StatCard label="Kept for" value={`${formatNumber(retentionDays)} days`} icon={<Icon.Archive className="size-5" />} />
      </div>

      <AuditFilters
        values={{ q: filter.q, actor: filter.actor, action: filter.action, target: filter.targetType, from: filter.from, to: filter.to }}
        options={options}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {filtered ? `${formatNumber(matching.length)} matching ${matching.length === 1 ? "event" : "events"}` : `${formatNumber(events.length)} ${events.length === 1 ? "event" : "events"} recorded`}
        </p>
        {matching.length > 0 && (
          <a href={exportHref} download className={buttonClasses({ variant: "outline", size: "sm" })}>
            <Icon.Download className="mr-1.5 size-4" />
            Export CSV
          </a>
        )}
      </div>

      <Table>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Action</TH>
            <TH className="hidden sm:table-cell">Done by</TH>
            <TH className="hidden md:table-cell">Target</TH>
            <TH className="hidden lg:table-cell">IP address</TH>
          </tr>
        </THead>
        <TBody>
          {visible.length === 0 ? (
            <TableEmpty colSpan={5}>
              {events.length === 0 ? (
                <EmptyState
                  compact
                  className="border-0"
                  icon={<Icon.ListChecks />}
                  title="Nothing recorded yet"
                  description="Settings changes, role changes, refunds, certificates, data downloads and other sensitive actions will be listed here."
                />
              ) : (
                <>
                  No events match these filters.{" "}
                  <Link href="/admin/audit" className="font-medium text-accent hover:underline">
                    Clear filters
                  </Link>
                </>
              )}
            </TableEmpty>
          ) : (
            visible.map((e) => {
              const actor = e.actorId ? actors.get(e.actorId) : undefined;
              const active = e.id === selectedId;
              return (
                <TR key={e.id} className={cn("relative transition-colors hover:bg-surface-2", active && "bg-accent/5")}>
                  <TD className="whitespace-nowrap align-top text-ink-muted">
                    <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                      {relativeTime(e.createdAt)}
                    </time>
                  </TD>
                  <TD className="max-w-0 w-[55%] align-top sm:w-[35%]">
                    <Link
                      href={activityHref(filter, { page: meta.page, event: e.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className="block truncate font-medium text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/40"
                    >
                      {describeAuditAction(e.action)}
                    </Link>
                    <span className="block truncate font-mono text-[11px] text-ink-faint">{e.action}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted sm:hidden">{e.actorId ? (actor?.name ?? "Unknown member") : "System"}</span>
                  </TD>
                  <TD className="hidden max-w-0 align-top sm:table-cell">
                    {e.actorId ? (
                      <>
                        <span className="block truncate">{actor?.name ?? "Unknown member"}</span>
                        {actor?.email && <span className="block truncate text-xs text-ink-muted">{actor.email}</span>}
                      </>
                    ) : (
                      <Badge tone="neutral">System</Badge>
                    )}
                  </TD>
                  <TD className="hidden max-w-0 align-top md:table-cell">
                    {e.targetType ? (
                      <>
                        <span className="block truncate">{describeAuditTarget(e.targetType)}</span>
                        <span className="block truncate font-mono text-xs text-ink-muted">{e.targetId}</span>
                      </>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TD>
                  <TD className="hidden whitespace-nowrap align-top font-mono text-xs text-ink-muted lg:table-cell">{e.ip ?? "—"}</TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      <Pagination page={meta.page} pageCount={meta.totalPages} total={meta.total} noun={["event", "events"]} href={(p) => activityHref(filter, { page: p })} />

      <p className="text-xs text-ink-faint">
        Events older than {formatNumber(retentionDays)} days are deleted automatically.{" "}
        <Link href="/admin/settings/legal" className="font-medium text-accent hover:underline">
          Change the retention period
        </Link>
        .
      </p>

      {selected && <AuditDetailDrawer key={selected.id} detail={buildDetail(selected, db, actors, filter)} closeHref={activityHref(filter, { page: meta.page })} />}
      {selectedId && !selected && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          That event no longer exists. It may have been removed by the retention period.
        </p>
      )}
    </div>
  );
}

const EXPORT_NOTICES: Record<string, string> = {
  limited: "Too many data downloads in the last hour. Please wait a while and try again.",
  missing: "That member no longer exists or their account was already erased.",
};

function RequestsTab({ db, sp, viewerId }: { db: Database; sp: Awaited<PageProps<"/admin/audit">["searchParams"]>; viewerId: string }) {
  const filter = parseDataRequestFilter((key) => searchParam(sp, key));
  const counts = countDataRequests(db.dataRequests);
  const rows = dataRequestRows(db.dataRequests, db.users, filter);
  const { items: visible, meta } = paginate(rows, Number(searchParam(sp, "page")) || 1, AUDIT_PAGE_SIZE);
  const notice = EXPORT_NOTICES[searchParam(sp, "export")];

  const members: PickerMember[] = db.users
    .filter((u) => !isDeletedAccount(u))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const exportHref = `/admin/audit/export${toQuery({ tab: "requests", type: filter.type === "all" ? undefined : filter.type, q: filter.q || undefined })}`;

  const typeTabs: { value: DataRequestFilter["type"]; label: string }[] = [
    { value: "all", label: "All" },
    { value: "export", label: "Data downloads" },
    { value: "delete", label: "Account deletions" },
  ];

  return (
    <div className="space-y-4">
      {notice && (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>{notice}</p>
        </div>
      )}

      <Card>
        <CardHeader title="Requests received by email or letter" description="Handle a member's request on their behalf. Each one is recorded below and in the activity log." />
        <CardBody>
          <DataRequestTools members={members} viewerId={viewerId} />
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter by request type" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {typeTabs.map((t) => {
            const active = filter.type === t.value;
            return (
              <Link
                key={t.value}
                href={requestsHref({ ...filter, type: t.value })}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "border-transparent bg-ink text-surface-1" : "border-border bg-surface-1 text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 py-px text-[11px] tabular-nums", active ? "bg-surface-1/20 text-surface-1" : "bg-surface-3 text-ink-muted")}>
                  {formatNumber(counts[t.value])}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form method="get" action="/admin/audit" role="search" className="flex gap-2">
            <input type="hidden" name="tab" value="requests" />
            {filter.type !== "all" && <input type="hidden" name="type" value={filter.type} />}
            <Input type="search" name="q" defaultValue={filter.q} aria-label="Search requests by member" placeholder="Search member or request id" leftAddon={<Icon.Search className="size-4" />} />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {rows.length > 0 && (
            <a href={exportHref} download className={buttonClasses({ variant: "outline", className: "self-start sm:self-auto" })}>
              <Icon.Download className="mr-1.5 size-4" />
              Export CSV
            </a>
          )}
        </div>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Requested</TH>
            <TH>Member</TH>
            <TH>Type</TH>
            <TH className="hidden sm:table-cell">Status</TH>
            <TH className="hidden md:table-cell">Completed</TH>
            <TH className="hidden lg:table-cell">
              <span className="sr-only">Activity</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {visible.length === 0 ? (
            <TableEmpty colSpan={6}>
              {counts.all === 0 ? (
                <EmptyState
                  compact
                  className="border-0"
                  icon={<Icon.ClipboardList />}
                  title="No data requests yet"
                  description="When members download their data or delete their account from their privacy settings, the request is listed here."
                />
              ) : (
                <>
                  No requests match these filters.{" "}
                  <Link href="/admin/audit?tab=requests" className="font-medium text-accent hover:underline">
                    Clear filters
                  </Link>
                </>
              )}
            </TableEmpty>
          ) : (
            visible.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap align-top text-ink-muted">
                  <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>
                    {relativeTime(r.createdAt)}
                  </time>
                </TD>
                <TD className="max-w-0 w-[45%] align-top">
                  {r.erased ? (
                    <span className="block truncate text-ink-muted">{r.name}</span>
                  ) : (
                    <Link href={`/admin/members/${r.userId}`} className="block truncate font-medium hover:underline">
                      {r.name}
                    </Link>
                  )}
                  <span className="block truncate text-xs text-ink-muted">{r.email || r.userId}</span>
                </TD>
                <TD className="align-top">
                  <Badge tone={r.type === "delete" ? "danger" : "info"}>{DATA_REQUEST_TYPE_LABELS[r.type]}</Badge>
                  <span className="mt-1 block text-xs text-ink-muted sm:hidden">{DATA_REQUEST_STATUS_LABELS[r.status]}</span>
                </TD>
                <TD className="hidden align-top sm:table-cell">
                  <Badge tone={r.status === "completed" ? "success" : r.status === "pending" ? "warning" : "neutral"} dot>
                    {DATA_REQUEST_STATUS_LABELS[r.status]}
                  </Badge>
                </TD>
                <TD className="hidden whitespace-nowrap align-top text-ink-muted md:table-cell">{r.completedAt ? formatDateTime(r.completedAt) : "—"}</TD>
                <TD className="hidden whitespace-nowrap align-top lg:table-cell">
                  <Link href={activityHref({ ...NO_FILTER, q: r.id })} className="text-sm font-medium text-accent hover:underline" aria-label={`Show the audit event for request ${r.id}`}>
                    View event
                  </Link>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <Pagination page={meta.page} pageCount={meta.totalPages} total={meta.total} noun={["request", "requests"]} href={(p) => requestsHref(filter, p)} />
    </div>
  );
}

export default async function AuditLogPage(props: PageProps<"/admin/audit">) {
  const viewer = await requireRole(["admin"], "/admin/audit");
  // Lazily apply the retention period (at most every few hours) before reading.
  await maybePurgeExpiredRecords();
  const [sp, db] = await Promise.all([props.searchParams, getDb()]);
  const tab = searchParam(sp, "tab") === "requests" ? "requests" : "activity";
  const retentionDays = clampRetentionDays(db.settings.legal.dataRetentionDays);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Audit log"
        description="Who changed what, and when: sensitive administrative actions and personal-data requests."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Audit log" }]} />}
        actions={
          <ButtonLink href="/admin/settings/legal" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
            Legal settings
          </ButtonLink>
        }
      />

      <nav aria-label="Audit log sections" className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {[
          { value: "activity", label: "Activity", href: "/admin/audit", count: db.auditEvents.length, icon: <Icon.ListChecks className="size-4" /> },
          { value: "requests", label: "Data requests", href: "/admin/audit?tab=requests", count: db.dataRequests.length, icon: <Icon.Shield className="size-4" /> },
        ].map((t) => {
          const active = tab === t.value;
          return (
            <Link
              key={t.value}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
              )}
            >
              {t.icon}
              {t.label}
              <span className={cn("rounded-full px-1.5 py-px text-[11px] tabular-nums", active ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-muted")}>{formatNumber(t.count)}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "requests" ? <RequestsTab db={db} sp={sp} viewerId={viewer.id} /> : <ActivityTab db={db} sp={sp} actors={actorMap(db)} retentionDays={retentionDays} />}
    </div>
  );
}
