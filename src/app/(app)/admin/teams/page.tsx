import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { paginate, param } from "@/lib/growth/affiliates-shared";
import { TEAM_PAGE_SIZE, getTeamsSummary, listTeamCourseOptions, listTeams } from "@/lib/growth/teams";
import { parseTeamFilter, type TeamFilter } from "@/lib/growth/teams-shared";
import { Badge } from "@/components/ui/badge";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { moneyList } from "@/components/growth/affiliate-badges";
import { ListPagination } from "@/components/growth/list-pagination";
import { CreateTeamButton, TeamProgramSettingsForm } from "@/components/growth/team-admin";
import { formatDate, formatNumber, pluralize } from "@/lib/utils";

export const metadata = { title: "Teams" };

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === "all") continue;
    if (key === "page" && value === 1) continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `/admin/teams?${s}` : "/admin/teams";
}

export default async function AdminTeamsPage(props: PageProps<"/admin/teams">) {
  await requireRole(["admin"], "/admin/teams");
  const sp = await props.searchParams;
  const tab = param(sp, "tab") === "settings" ? "settings" : "teams";
  const [settings, summary, courses] = await Promise.all([getSettings(), getTeamsSummary(), listTeamCourseOptions()]);
  const currency = settings.commerce.defaultCurrency;
  const enabled = settings.growth.teamsEnabled;

  let body: ReactNode;
  let exportLink: string | null = null;

  if (tab === "settings") {
    body = <TeamProgramSettingsForm enabled={enabled} />;
  } else {
    const filter = parseTeamFilter(sp);
    const all = await listTeams(filter);
    const page = paginate(all, filter.page, TEAM_PAGE_SIZE);
    const filtered = filter.status !== "all" || !!filter.q;
    const exportParams = new URLSearchParams();
    if (filter.status !== "all") exportParams.set("status", filter.status);
    if (filter.q) exportParams.set("q", filter.q);
    const exportQuery = exportParams.toString();
    exportLink = all.length ? `/admin/teams/export${exportQuery ? `?${exportQuery}` : ""}` : null;

    body =
      summary.teams + summary.pending === 0 ? (
        <EmptyState
          icon={<Icon.Building />}
          title="No teams yet"
          description={
            enabled
              ? "Companies buy seats from the “For teams” page and appear here. You can also create a team yourself for customers who pay by invoice."
              : "Team purchases are off. Turn them on in the Settings tab, or create a team yourself for customers who pay by invoice."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <CreateTeamButton courses={courses} />
              {enabled && (
                <ButtonLink href="/team/buy" variant="outline" rightIcon={<Icon.ArrowUpRight className="size-4" />}>
                  View the purchase page
                </ButtonLink>
              )}
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          <TeamFilters filter={filter} />
          <Table>
            <THead>
              <tr>
                <TH>Team</TH>
                <TH>Seats</TH>
                <TH className="hidden md:table-cell">Courses</TH>
                <TH className="hidden lg:table-cell">Paid</TH>
                <TH className="hidden sm:table-cell">Status</TH>
                <TH className="hidden lg:table-cell">Created</TH>
              </tr>
            </THead>
            <TBody>
              {page.rows.length === 0 ? (
                <TableEmpty colSpan={6}>
                  No teams match these filters.{" "}
                  {filtered && (
                    <Link href="/admin/teams" className="font-medium text-accent hover:underline">
                      Clear filters
                    </Link>
                  )}
                </TableEmpty>
              ) : (
                page.rows.map((row) => {
                  const { org, usage } = row;
                  const scale = Math.max(usage.total, usage.used, 1);
                  return (
                    <TR key={org.id}>
                      <TD className="max-w-0 w-[45%] md:w-[32%]">
                        <Link href={`/admin/teams/${org.id}`} className="block truncate font-medium text-ink hover:underline">
                          {org.name}
                        </Link>
                        <p className="truncate text-xs text-ink-muted">{row.owner ? `${row.owner.name} · ${row.owner.email}` : "Owner account deleted"}</p>
                        <p className="mt-1 sm:hidden">
                          <TeamStatus draft={row.draft} openOrders={row.openOrders} full={usage.total > 0 && usage.available === 0} />
                        </p>
                      </TD>
                      <TD className="min-w-28">
                        <p className="whitespace-nowrap tabular-nums">
                          {formatNumber(usage.used)} <span className="text-ink-muted">of {formatNumber(usage.total)}</span>
                        </p>
                        <div className="mt-1.5 flex h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                          <div className="h-full bg-success" style={{ width: `${(usage.active / scale) * 100}%` }} />
                          <div className="h-full bg-info" style={{ width: `${(usage.invited / scale) * 100}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-ink-muted">
                          {usage.active} active · {usage.invited} invited
                          {usage.over > 0 && <span className="font-medium text-danger"> · {usage.over} over</span>}
                        </p>
                      </TD>
                      <TD className="hidden tabular-nums md:table-cell">{org.courseIds.length}</TD>
                      <TD className="hidden whitespace-nowrap tabular-nums lg:table-cell">{row.paid.length ? moneyList(row.paid, currency) : <span className="text-ink-faint">—</span>}</TD>
                      <TD className="hidden sm:table-cell">
                        <TeamStatus draft={row.draft} openOrders={row.openOrders} full={usage.total > 0 && usage.available === 0} />
                      </TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(org.createdAt)}</TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
          <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="teams" href={(p) => query({ status: filter.status, q: filter.q, page: p })} />
        </div>
      );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Teams"
        description="Companies that bought seats for their people: how many seats they have, who uses them, and what they paid."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Teams" }]} />}
        actions={
          <>
            {exportLink && (
              <a href={exportLink} className={buttonClasses({ variant: "outline", size: "sm" })} download>
                <Icon.Download className="size-4" aria-hidden="true" />
                Export CSV
              </a>
            )}
            {summary.teams + summary.pending > 0 && <CreateTeamButton courses={courses} />}
          </>
        }
      />

      {!enabled && tab !== "settings" && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            Team purchases are off: the “For teams” page is closed and managers can&apos;t buy more seats. Existing teams keep working.{" "}
            <Link href={query({ tab: "settings" })} className="font-medium underline">
              Turn them on
            </Link>
          </p>
        </div>
      )}

      <section aria-label="Teams summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Teams"
          value={formatNumber(summary.teams)}
          hint={summary.pending ? `${summary.pending} awaiting payment` : "With paid or granted seats"}
          icon={<Icon.Building className="size-5" />}
        />
        <StatCard label="Seats" value={formatNumber(summary.seats)} hint={`${formatNumber(Math.max(0, summary.seats - summary.active - summary.invited))} not assigned yet`} icon={<Icon.Ticket className="size-5" />} />
        <StatCard
          label="Active members"
          value={formatNumber(summary.active)}
          hint={`${pluralize(summary.invited, "invitation")} open`}
          icon={<Icon.Users className="size-5" />}
        />
        <StatCard label="Seat revenue" value={<span className="text-xl sm:text-2xl">{moneyList(summary.revenue, currency)}</span>} hint="Paid orders, after refunds" icon={<Icon.CreditCard className="size-5" />} />
      </section>

      <Tabs
        className="mb-5"
        items={[
          { label: "Teams", value: "teams", count: summary.teams + summary.pending || undefined },
          { label: "Settings", value: "settings" },
        ]}
      />
      {body}
    </div>
  );
}

function TeamStatus({ draft, openOrders, full }: { draft: boolean; openOrders: number; full: boolean }) {
  if (draft) {
    return (
      <Badge tone="warning" dot>
        {openOrders ? "Order unpaid" : "Awaiting payment"}
      </Badge>
    );
  }
  return (
    <Badge tone={full ? "info" : "success"} dot>
      {full ? "All seats used" : "Active"}
    </Badge>
  );
}

function TeamFilters({ filter }: { filter: TeamFilter }) {
  return (
    <form method="get" action="/admin/teams" role="search" aria-label="Filter teams" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center">
      <label htmlFor="team-q" className="sr-only">
        Search teams
      </label>
      <Input id="team-q" name="q" type="search" defaultValue={filter.q} placeholder="Search team or owner" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="team-status" className="sr-only">
        Status
      </label>
      <Select
        id="team-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All teams" },
          { value: "active", label: "Active" },
          { value: "pending", label: "Awaiting payment" },
          { value: "full", label: "All seats used" },
        ]}
      />
      <button type="submit" className={buttonClasses({ variant: "outline" })}>
        Apply
      </button>
    </form>
  );
}
