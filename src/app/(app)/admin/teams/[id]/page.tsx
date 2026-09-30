import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { sumByCurrency } from "@/lib/growth/affiliates";
import { param } from "@/lib/growth/affiliates-shared";
import { getTeamHistory, getTeamOverview, listTeamCourseOptions } from "@/lib/growth/teams";
import { parseProgressFilter, parseSeatFilter } from "@/lib/growth/teams-shared";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { plural } from "@/components/catalog/format";
import { money } from "@/components/commerce/order-summary";
import { moneyList } from "@/components/growth/affiliate-badges";
import { AdjustSeatsForm, DeleteTeamButton, TeamCoursesForm } from "@/components/growth/team-admin";
import { SeatMeter } from "@/components/growth/team-badges";
import { TeamOrdersPanel, TeamProgressPanel, TeamSeatsPanel, type TeamPanelBase } from "@/components/growth/team-panels";
import { TeamManagers, TeamNameForm } from "@/components/growth/team-settings";
import { formatDate, formatDateTime, formatNumber, pluralize, relativeTime } from "@/lib/utils";

type Tab = "overview" | "seats" | "progress" | "orders";
const TABS: Tab[] = ["overview", "seats", "progress", "orders"];

export async function generateMetadata(props: PageProps<"/admin/teams/[id]">) {
  const { id } = await props.params;
  const overview = await getTeamOverview(id);
  return { title: overview ? `Team ${overview.org.name}` : "Team not found" };
}

export default async function AdminTeamPage(props: PageProps<"/admin/teams/[id]">) {
  const { id } = await props.params;
  const admin = await requireRole(["admin"], `/admin/teams/${id}`);
  const sp = await props.searchParams;
  const overview = await getTeamOverview(id);
  if (!overview) notFound();

  const { org, usage } = overview;
  const path = `/admin/teams/${org.id}`;
  const tabRaw = param(sp, "tab");
  const tab: Tab = TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "overview";
  const base: TeamPanelBase = { path, params: { tab } };
  const settings = await getSettings();
  const currency = settings.commerce.defaultCurrency;
  const managerView = `/team?org=${encodeURIComponent(org.slug)}`;
  const buyHref = `/team/buy?org=${encodeURIComponent(org.slug)}`;
  const paidTotals = sumByCurrency(overview.orders.filter((o) => o.status === "paid").map((o) => ({ currency: o.currency, amount: o.amount - (o.refundedAmount ?? 0) })));

  let body: ReactNode;
  if (tab === "seats") {
    body = <TeamSeatsPanel overview={overview} base={base} filter={parseSeatFilter(sp)} buyHref={buyHref} canClaim={false} />;
  } else if (tab === "progress") {
    body = <TeamProgressPanel overview={overview} base={base} filter={parseProgressFilter(sp)} seatsHref={`${path}?tab=seats`} />;
  } else if (tab === "orders") {
    body = <TeamOrdersPanel overview={overview} viewer={{ id: admin.id, admin: true }} transactionsLink />;
  } else {
    const [courses, history] = await Promise.all([listTeamCourseOptions(), getTeamHistory(org.id)]);
    body = (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Seats" description="Add seats when an invoice is paid, or correct the count. Online orders add their seats automatically." />
            <CardBody className="space-y-5">
              <SeatMeter usage={usage} />
              <AdjustSeatsForm key={org.seatCount} orgId={org.id} seatCount={org.seatCount} used={usage.used} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Courses"
              description={
                overview.seatPrice
                  ? `Every seat unlocks these courses. One more seat costs ${money(overview.seatPrice.amount, overview.seatPrice.currency)} today.`
                  : "Every seat unlocks these courses. They can't be priced together (free, unpublished or mixed currencies), so managers can't buy more seats online."
              }
            />
            <CardBody>
              <TeamCoursesForm key={org.courseIds.join(",")} orgId={org.id} courseIds={org.courseIds} courses={courses} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="History"
              description="The latest changes to this team."
              actions={
                history.length > 0 ? (
                  <ButtonLink href={`/admin/audit?target=team&q=${encodeURIComponent(org.id)}`} size="sm" variant="ghost">
                    Audit log
                  </ButtonLink>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              {history.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">Nothing recorded yet. Seat changes, invitations and manager changes appear here.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{h.label}</p>
                        <p className="break-words text-xs text-ink-muted">{[h.detail, `by ${h.actorName}`].filter(Boolean).join(" · ")}</p>
                      </div>
                      <time dateTime={h.createdAt} title={formatDateTime(h.createdAt)} className="shrink-0 whitespace-nowrap text-xs text-ink-muted">
                        {relativeTime(h.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Team name" />
            <CardBody>
              <TeamNameForm key={org.name} orgId={org.id} name={org.name} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Owner and managers" description="Managers invite members and see progress. The owner can also add managers." />
            <CardBody>
              <TeamManagers orgId={org.id} owner={overview.owner} managers={overview.managers} viewerId={admin.id} canEdit canTransfer />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Delete team" description="Revokes every seat and removes the team. Orders stay in Transactions." />
            <CardBody>
              <DeleteTeamButton orgId={org.id} name={org.name} inUse={usage.used} />
            </CardBody>
          </Card>
        </aside>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 break-words">{org.name}</span>
            <Badge tone={overview.draft ? "warning" : "success"} dot>
              {overview.draft ? "Awaiting payment" : "Active"}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {overview.owner ? (
              <>
                <Avatar name={overview.owner.name} src={overview.owner.avatarUrl} size="xs" />
                <Link href={`/user/${overview.owner.username}`} className="font-medium text-ink hover:underline">
                  {overview.owner.name}
                </Link>
                <span className="break-all">{overview.owner.email}</span>
              </>
            ) : (
              <span className="text-danger">Owner account deleted — transfer the team to a new owner</span>
            )}
            <span>· created {formatDate(org.createdAt)}</span>
          </span>
        }
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Teams", href: "/admin/teams" }, { label: org.name }]} />}
        actions={
          <ButtonLink href={managerView} variant="outline" size="sm" rightIcon={<Icon.ArrowUpRight className="size-4" />}>
            Manager view
          </ButtonLink>
        }
      />

      {overview.draft && (
        <p role="status" className="flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-ink">
          <Icon.Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          This team was started on the purchase page and has no seats yet. They are added when its order is paid. If the customer paid by invoice, set the seat count below.
        </p>
      )}
      {usage.over > 0 && (
        <p role="alert" className="flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {usage.over} more {plural(usage.over, "seat")} {usage.over === 1 ? "is" : "are"} in use than the team has. Raise the seat count or revoke seats.
        </p>
      )}

      <section aria-label="Team summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Seats" value={formatNumber(usage.total)} hint={`${formatNumber(usage.available)} free`} icon={<Icon.Ticket className="size-5" />} />
        <StatCard label="Active members" value={formatNumber(usage.active)} hint="Accepted their invitation" icon={<Icon.Users className="size-5" />} />
        <StatCard
          label="Open invitations"
          value={formatNumber(usage.invited)}
          hint={overview.expiredInvites ? `${overview.expiredInvites} expired` : "Waiting to be accepted"}
          icon={<Icon.Mail className="size-5" />}
        />
        <StatCard
          label="Paid"
          value={<span className="text-xl sm:text-2xl">{moneyList(paidTotals, currency)}</span>}
          hint={pluralize(overview.orders.length, "order")}
          icon={<Icon.CreditCard className="size-5" />}
        />
      </section>

      <Tabs
        items={[
          { label: "Overview", value: "overview" },
          { label: "Seats", value: "seats", count: usage.used || undefined },
          { label: "Progress", value: "progress" },
          { label: "Orders", value: "orders", count: overview.orders.length || undefined },
        ]}
      />
      {body}
    </div>
  );
}
