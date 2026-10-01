import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { searchParam } from "@/lib/audit";
import { getStartupCheckResult, type EnvCheckResult } from "@/lib/env-check";
import { maybePurgeExpiredRecords } from "@/lib/legal/retention-run";
import { clampRetentionDays } from "@/lib/legal/retention";
import {
  describeErrorSource,
  errorFilterToQuery,
  errorLogStats,
  filterErrorEvents,
  isBrowserError,
  parseErrorFilter,
  type ErrorFilter,
  type ErrorStatusFilter,
} from "@/lib/errors/shared";
import { parsePaging } from "@/components/assessments/shared";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { cn, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { ErrorList, type ErrorRow } from "./_components/error-list";
import { DeleteResolvedButton } from "./_components/error-actions";

export const metadata = { title: "Error log" };

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function listHref(filter: ErrorFilter): string {
  return `/admin/errors${toQuery(errorFilterToQuery(filter))}`;
}

/** Startup configuration checks (env-check), without values. */
function StartupChecks({ result }: { result: EnvCheckResult }) {
  const issues = [...result.errors, ...result.warnings];
  if (!issues.length) {
    return (
      <p role="status" className="mb-5 flex items-center gap-2 rounded-card border border-success/30 bg-success/10 px-4 py-3 text-sm text-ink">
        <Icon.ShieldCheck className="size-4 shrink-0 text-success" />
        All startup configuration checks passed.
      </p>
    );
  }
  const blocking = result.errors.length > 0;
  return (
    <section
      aria-labelledby="startup-checks-title"
      className={cn("mb-5 rounded-card border px-4 py-3 text-sm", blocking ? "border-danger/30 bg-danger/5" : "border-warning/40 bg-warning/10")}
    >
      <h2 id="startup-checks-title" className="flex items-center gap-2 font-semibold text-ink">
        <Icon.AlertTriangle className={cn("size-4 shrink-0", blocking ? "text-danger" : "text-warning")} />
        {blocking
          ? result.production
            ? "Required settings are missing"
            : `${result.errors.length} ${result.errors.length === 1 ? "setting is" : "settings are"} required before going live`
          : `${issues.length} configuration ${issues.length === 1 ? "warning" : "warnings"}`}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {issues.map((issue, i) => (
          <li key={`${issue.key}-${i}`} className="flex gap-2">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", issue.level === "error" ? "bg-danger" : "bg-warning")} aria-hidden="true" />
            <span className="min-w-0">
              <code className="mr-1 rounded bg-surface-2 px-1 py-px font-mono text-xs text-ink">{issue.key}</code>
              <span className="text-ink-muted">{issue.message}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">Checked when the server started. Change the environment and restart the server to clear these.</p>
    </section>
  );
}

export default async function ErrorLogPage(props: PageProps<"/admin/errors">) {
  await requireRole(["admin"], "/admin/errors");
  await maybePurgeExpiredRecords();
  const [sp, db] = await Promise.all([props.searchParams, getDb()]);
  const filter = parseErrorFilter((key) => searchParam(sp, key));
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);
  const now = new Date();
  const events = db.errorEvents;
  const stats = errorLogStats(events, now);
  const matching = filterErrorEvents(events, filter);
  const visible = matching.slice(0, limit);
  const retentionDays = clampRetentionDays(db.settings.legal.dataRetentionDays);

  const rows: ErrorRow[] = visible.map((e) => ({
    id: e.id,
    message: e.message,
    path: e.path,
    source: describeErrorSource(e),
    browser: isBrowserError(e),
    count: formatNumber(e.count || 1),
    resolved: !!e.resolved,
    lastSeen: { iso: e.lastSeenAt, relative: relativeTime(e.lastSeenAt, now), full: formatDateTime(e.lastSeenAt) },
    firstSeenRelative: relativeTime(e.createdAt, now),
  }));

  const statusTabs: { value: ErrorStatusFilter; label: string; count: number }[] = [
    { value: "open", label: "Open", count: stats.open },
    { value: "resolved", label: "Resolved", count: stats.resolved },
    { value: "all", label: "All", count: events.length },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Error log"
        description="Server and browser errors, grouped by message and page. New errors notify administrators; a resolved error reopens if it happens again."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Error log" }]} />}
        actions={
          <>
            {stats.resolved > 0 && <DeleteResolvedButton count={stats.resolved} />}
            <ButtonLink href="/api/health" variant="outline" target="_blank" rel="noopener" prefetch={false} leftIcon={<Icon.Zap className="size-4" />}>
              Health check
            </ButtonLink>
          </>
        }
      />

      <StartupChecks result={getStartupCheckResult()} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open errors" value={formatNumber(stats.open)} icon={<Icon.AlertTriangle className="size-5" />} hint={stats.openBrowser ? `${formatNumber(stats.openBrowser)} from browsers` : undefined} />
        <StatCard label="Occurrences (open)" value={formatNumber(stats.openOccurrences)} icon={<Icon.BarChart className="size-5" />} />
        <StatCard label="New in 24 hours" value={formatNumber(stats.newToday)} icon={<Icon.Clock className="size-5" />} />
        <StatCard label="Last error" value={stats.lastSeenAt ? relativeTime(stats.lastSeenAt, now) : "Never"} icon={<Icon.Calendar className="size-5" />} />
      </div>

      <nav aria-label="Filter by status" className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {statusTabs.map((t) => {
          const active = filter.status === t.value;
          return (
            <Link
              key={t.value}
              href={listHref({ ...filter, status: t.value })}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "border-transparent bg-ink text-surface-1" : "border-border bg-surface-1 text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 py-px text-[11px] tabular-nums", active ? "bg-surface-1/20 text-surface-1" : "bg-surface-3 text-ink-muted")}>{formatNumber(t.count)}</span>
            </Link>
          );
        })}
      </nav>

      <FilterBar
        filters={[
          { param: "q", kind: "search", label: "Search errors", placeholder: "Search message, page or reference" },
          {
            param: "source",
            kind: "select",
            label: "Source",
            placeholder: "Server and browser",
            options: [
              { value: "server", label: "Server only" },
              { value: "browser", label: "Browser only" },
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        events.length === 0 ? (
          <EmptyState
            icon={<Icon.ShieldCheck />}
            title="No errors recorded"
            description="Failed page renders, API routes, server actions and errors visitors see in their browser will be listed here."
          />
        ) : (
          <EmptyState
            compact
            icon={<Icon.Search />}
            title={filter.status === "open" && !filter.q && filter.source === "all" ? "No open errors" : "No errors match these filters"}
            description={filter.status === "open" && !filter.q && filter.source === "all" ? "Everything recorded so far has been resolved." : undefined}
            action={
              <ButtonLink href={listHref({ status: "all", source: "all", q: "" })} variant="outline" size="sm">
                Show all errors
              </ButtonLink>
            }
          />
        )
      ) : (
        <ErrorList rows={rows} />
      )}

      <ListFooter shown={visible.length} total={matching.length} size={size} pages={pages} noun="errors" />

      <p className="mt-4 text-xs text-ink-faint">
        Errors not seen for {formatNumber(retentionDays)} days are deleted automatically. Request bodies, query strings and cookies are never stored.{" "}
        <Link href="/admin/settings/legal" className="font-medium text-accent hover:underline">
          Change the retention period
        </Link>
        .
      </p>
    </div>
  );
}
