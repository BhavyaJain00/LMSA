import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { param } from "@/lib/growth/affiliates-shared";
import { getManagedTeams, getMemberships, getTeamOverview, pendingInvitesFor, type InvitePreview, type TeamMembership, type TeamOverview } from "@/lib/growth/teams";
import { orgRole, parseProgressFilter, parseSeatFilter } from "@/lib/growth/teams-shared";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { plural } from "@/components/catalog/format";
import { money } from "@/components/commerce/order-summary";
import { RoleBadge, SeatMeter } from "@/components/growth/team-badges";
import { AcceptSeatButton } from "@/components/growth/team-join";
import { TeamOrdersPanel, TeamProgressPanel, TeamSeatsPanel, type TeamPanelBase } from "@/components/growth/team-panels";
import { TeamManagers, TeamNameForm } from "@/components/growth/team-settings";
import { cn, formatDate, formatNumber, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "My team", robots: { index: false } };

type Tab = "seats" | "progress" | "orders" | "settings";
const TABS: Tab[] = ["seats", "progress", "orders", "settings"];

const BENEFITS = [
  { icon: Icon.Users, title: "One purchase, many learners", text: "Buy seats for the courses your people need and hand them out by email." },
  { icon: Icon.Refresh, title: "Seats you can reassign", text: "Someone left or changed roles? Take the seat back and give it to a colleague." },
  { icon: Icon.BarChart, title: "Progress at a glance", text: "See who started, who finished and who needs a nudge, and export it as a spreadsheet." },
];

export default async function TeamPage(props: PageProps<"/team">) {
  const sp = await props.searchParams;
  const orgRef = param(sp, "org");
  const user = await requireUser(orgRef ? `/team?org=${encodeURIComponent(orgRef)}` : "/team");
  const admin = isAdmin(user);
  const [settings, managed, memberships, invites] = await Promise.all([getSettings(), getManagedTeams(user.id), getMemberships(user.id), pendingInvitesFor(user)]);

  const wanted = orgRef ? managed.find((t) => t.org.slug === orgRef || t.org.id === orgRef) : undefined;
  const fallback = managed.find((t) => !t.draft) ?? managed[0];
  // Administrators can open any team's dashboard from Admin → Teams.
  const selectedRef = wanted?.org.id ?? (orgRef && admin ? orgRef : fallback?.org.id);
  const overview = selectedRef ? await getTeamOverview(selectedRef) : null;
  const canManage = overview ? admin || !!orgRole(overview.org, user.id) : false;

  if (!overview || !canManage) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader className="mb-0" title="My team" description="Seats your company or team bought for you, and the courses they unlock." />
        {orgRef && (
          <p role="status" className="flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            This team doesn&apos;t exist, or you don&apos;t manage it.
          </p>
        )}
        <PendingInvites invites={invites} />
        <Memberships memberships={memberships} />
        {memberships.length === 0 && invites.length === 0 && (
          <EmptyState
            icon={<Icon.Building />}
            title="You're not part of a team yet"
            description={
              settings.growth.teamsEnabled
                ? "When a team manager invites you, the invitation shows up here. Buying for your own company? Get seats for your people in a few minutes."
                : "When a team manager invites you, the invitation shows up here."
            }
            action={
              settings.growth.teamsEnabled ? (
                <ButtonLink href="/team/buy" leftIcon={<Icon.Plus className="size-4" />}>
                  Buy seats for your team
                </ButtonLink>
              ) : (
                <ButtonLink href="/courses" variant="outline">
                  Browse courses
                </ButtonLink>
              )
            }
          />
        )}
        {settings.growth.teamsEnabled && (
          <Card>
            <CardHeader
              title="Training a team?"
              description="Buy seats once and manage who learns what."
              actions={
                memberships.length + invites.length > 0 ? (
                  <ButtonLink href="/team/buy" size="sm" variant="outline">
                    Buy seats
                  </ButtonLink>
                ) : undefined
              }
            />
            <CardBody>
              <ul className="grid gap-5 sm:grid-cols-3">
                {BENEFITS.map((b) => (
                  <li key={b.title} className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <b.icon className="size-4.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">{b.title}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">{b.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    );
  }

  const { org, usage } = overview;
  const role = orgRole(org, user.id);
  const owns = admin || role === "owner";
  const tabRaw = param(sp, "tab");
  const tab: Tab = TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "seats";
  const teamParams = { org: org.slug };
  const base: TeamPanelBase = { path: "/team", params: tab === "seats" ? teamParams : { ...teamParams, tab } };
  const teamHref = `/team?org=${encodeURIComponent(org.slug)}`;
  const buyHref = `/team/buy?org=${encodeURIComponent(org.slug)}`;
  const canBuy = settings.growth.teamsEnabled && !!overview.seatPrice;
  const hasSeatHere = memberships.some((m) => m.team.id === org.id);
  const openOrder = overview.orders.find((o) => o.status === "pending");

  let body: ReactNode;
  if (tab === "progress") {
    body = <TeamProgressPanel overview={overview} base={base} filter={parseProgressFilter(sp)} seatsHref={teamHref} />;
  } else if (tab === "orders") {
    body = <TeamOrdersPanel overview={overview} buyHref={canBuy ? buyHref : undefined} viewer={{ id: user.id, admin }} />;
  } else if (tab === "settings") {
    body = <TeamSettings overview={overview} viewerId={user.id} owns={owns} admin={admin} />;
  } else {
    body = <TeamSeatsPanel overview={overview} base={base} filter={parseSeatFilter(sp)} buyHref={buyHref} canClaim={!!role && !hasSeatHere} />;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="min-w-0 break-words">{org.name}</span>
            <RoleBadge role={role} />
          </span>
        }
        description={`${pluralize(overview.courses.length, "course")} for every seat · team since ${formatDate(org.createdAt)}`}
        actions={
          canBuy ? (
            <ButtonLink href={buyHref} leftIcon={<Icon.Plus className="size-4" />}>
              {overview.draft ? "Finish purchase" : "Buy more seats"}
            </ButtonLink>
          ) : undefined
        }
      />

      {managed.length > 1 && (
        <nav aria-label="Your teams" className="no-scrollbar -mt-2 flex gap-2 overflow-x-auto">
          {managed.map((t) => {
            const active = t.org.id === org.id;
            return (
              <Link
                key={t.org.id}
                href={`/team?org=${encodeURIComponent(t.org.slug)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "border-accent bg-accent/10 text-accent" : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                <Icon.Building className="size-3.5" aria-hidden="true" />
                {t.org.name}
                <span className="text-xs font-normal tabular-nums opacity-80">{t.draft ? "not paid" : `${t.usage.used}/${t.usage.total}`}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {overview.draft && (
        <div role="status" className="flex flex-col gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-3 text-ink">
            <Icon.Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            {openOrder
              ? `Order ${openOrder.orderId} is waiting for payment. Your ${pluralize(openOrder.seats, "seat")} ${openOrder.seats === 1 ? "is" : "are"} added as soon as it is confirmed.`
              : "This team has no seats yet. They are added as soon as your order or invoice is paid; then you can invite your people."}
          </p>
          {canBuy && !openOrder && (
            <ButtonLink href={buyHref} size="sm" variant="outline" className="shrink-0">
              Finish purchase
            </ButtonLink>
          )}
        </div>
      )}
      {usage.over > 0 && (
        <p role="alert" className="flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {usage.over} more {plural(usage.over, "seat")} {usage.over === 1 ? "is" : "are"} in use than the team has. Revoke {usage.over === 1 ? "a seat" : "seats"} or buy more; new invitations are
          paused until then.
        </p>
      )}

      <section aria-label="Seats" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-5">
          <p className="text-sm font-medium text-ink-muted">Seats in use</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">
            {formatNumber(usage.used)}
            <span className="text-lg font-normal text-ink-muted"> of {formatNumber(usage.total)}</span>
          </p>
          <SeatMeter usage={usage} className="mt-4" />
        </Card>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Active" value={formatNumber(usage.active)} hint="Members learning" className="p-4 sm:p-5" />
          <StatCard label="Invited" value={formatNumber(usage.invited)} hint={overview.expiredInvites ? `${overview.expiredInvites} expired` : "Waiting to accept"} className="p-4 sm:p-5" />
          <StatCard label="Free" value={formatNumber(usage.available)} hint={usage.available ? "Ready to assign" : "All assigned"} className="p-4 sm:p-5" />
        </div>
      </section>

      <Tabs
        items={[
          { label: "Members", value: "seats", count: usage.used || undefined },
          { label: "Progress", value: "progress" },
          { label: "Orders", value: "orders", count: overview.orders.length || undefined },
          { label: "Settings", value: "settings" },
        ]}
      />
      {body}

      {(invites.length > 0 || memberships.some((m) => m.team.id !== org.id)) && (
        <div className="space-y-6 border-t border-border pt-6">
          <PendingInvites invites={invites} />
          <Memberships memberships={memberships.filter((m) => m.team.id !== org.id)} />
        </div>
      )}
    </div>
  );
}

function TeamSettings({ overview, viewerId, owns, admin }: { overview: TeamOverview; viewerId: string; owns: boolean; admin: boolean }) {
  const { org, courses } = overview;
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Team name" />
          <CardBody>
            {owns ? <TeamNameForm orgId={org.id} name={org.name} /> : <p className="text-sm text-ink">{org.name} <span className="text-ink-muted">· only the owner can rename the team</span></p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Courses" description="Every seat unlocks these courses. New members are enrolled when they accept their invitation." />
          <CardBody className="p-0">
            {courses.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">This team&apos;s courses are no longer available. Contact us to choose new ones.</p>
            ) : (
              <ul className="divide-y divide-border">
                {courses.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/courses/${c.slug}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                      {c.title}
                    </Link>
                    <span className="shrink-0 tabular-nums text-ink-muted">{c.price > 0 ? `${money(c.price, c.currency)} per seat` : "Included"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border px-5 py-3 text-xs text-ink-muted">
              {admin ? (
                <>
                  Change the courses or the seat count in{" "}
                  <Link href={`/admin/teams/${org.id}`} className="font-medium text-accent hover:underline">
                    Admin → Teams
                  </Link>
                  .
                </>
              ) : (
                "Need other courses for this team? Contact us and we'll update it for you."
              )}
            </p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Owner and managers" description="Managers invite members, assign seats and follow progress. The owner also adds managers and can hand the team over." />
        <CardBody>
          <TeamManagers orgId={org.id} owner={overview.owner} managers={overview.managers} viewerId={viewerId} canEdit={owns} canTransfer={owns} />
        </CardBody>
      </Card>
    </div>
  );
}

function PendingInvites({ invites }: { invites: InvitePreview[] }) {
  if (!invites.length) return null;
  return (
    <section aria-labelledby="invites-heading" className="space-y-3">
      <h2 id="invites-heading" className="text-base font-semibold text-ink">
        {invites.length === 1 ? "You have an invitation" : `You have ${invites.length} invitations`}
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {invites.map((invite) => (
          <li key={invite.seatId}>
            <Card className="flex h-full flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Icon.Mail className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span className="truncate">{invite.team.name}</span>
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  A paid seat with {invite.courses.length === 1 ? invite.courses[0].title : `${invite.courses.length} courses`}. Accept by {formatDate(invite.expiresAt)}.
                </p>
                {invite.courses.length > 1 && (
                  <ul className="mt-2 list-inside list-disc text-sm text-ink-muted">
                    {invite.courses.slice(0, 5).map((c) => (
                      <li key={c.id} className="truncate">
                        {c.title}
                      </li>
                    ))}
                    {invite.courses.length > 5 && <li>and {invite.courses.length - 5} more</li>}
                  </ul>
                )}
              </div>
              <div className="shrink-0">
                <AcceptSeatButton seatId={invite.seatId} teamName={invite.team.name} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Memberships({ memberships }: { memberships: TeamMembership[] }) {
  if (!memberships.length) return null;
  return (
    <section aria-labelledby="memberships-heading" className="space-y-3">
      <h2 id="memberships-heading" className="text-base font-semibold text-ink">
        Your team seats
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {memberships.map((m) => (
          <Card key={m.seatId}>
            <CardHeader title={m.team.name} description={m.joinedAt ? `You joined on ${formatDate(m.joinedAt)}` : undefined} />
            <CardBody className="p-0">
              {m.courses.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">This team has no courses at the moment.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {m.courses.map((c) => (
                    <li key={c.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <Link href={`/courses/${c.slug}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                          {c.title}
                        </Link>
                        <span className={cn("shrink-0 text-xs tabular-nums", c.completed ? "font-medium text-success" : "text-ink-muted")}>{c.completed ? "Completed" : `${c.progress}%`}</span>
                      </div>
                      <ProgressBar value={c.completed ? 100 : c.progress} size="xs" tone={c.completed ? "success" : "accent"} className="mt-2" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}
