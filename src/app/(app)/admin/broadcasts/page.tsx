import Link from "next/link";
import { after } from "next/server";
import type { Broadcast } from "@/lib/types";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { type BroadcastListFilters, broadcastPhase, broadcastRates, isEditable, parseBroadcastFilters, sendProgress } from "@/lib/comms/broadcast-core";
import { getBroadcastOverview, listBroadcasts } from "@/lib/comms/broadcasts";
import { runComms } from "@/lib/comms/runner";
import { describeSegment } from "@/lib/comms/segments";
import { LocalDateTime, RelativeTime } from "@/components/assessments/client-time";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { AutoRefresh } from "@/components/comms/auto-refresh";
import { BroadcastMenu } from "@/components/comms/broadcast-controls";
import { BroadcastPhaseBadge } from "@/components/comms/broadcast-phase-badge";
import { BroadcastsNav } from "@/components/comms/broadcasts-nav";
import { ListSearch } from "@/components/comms/list-search";
import { Pager } from "@/components/comms/pager";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Broadcasts" };

function hrefFor(filters: BroadcastListFilters, patch: Partial<BroadcastListFilters> = {}, base = "/admin/broadcasts"): string {
  const next = { ...filters, ...patch };
  const qs = new URLSearchParams();
  if (next.status !== "all") qs.set("status", next.status);
  if (next.q) qs.set("q", next.q);
  if (next.page > 1) qs.set("page", String(next.page));
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}

/** The moment that matters for the row: edited, scheduled for, started or sent. */
function When({ broadcast }: { broadcast: Broadcast }) {
  if (broadcast.status === "scheduled" && broadcast.scheduledAt) {
    return (
      <>
        <span className="block text-xs text-ink-muted">Scheduled for</span>
        <LocalDateTime iso={broadcast.scheduledAt} />
      </>
    );
  }
  if (broadcast.status === "sending" && broadcast.startedAt) {
    return (
      <>
        <span className="block text-xs text-ink-muted">Started</span>
        <RelativeTime iso={broadcast.startedAt} />
      </>
    );
  }
  if (broadcast.status === "sent" && broadcast.sentAt) {
    return (
      <>
        <span className="block text-xs text-ink-muted">{broadcast.canceledAt ? "Stopped" : "Sent"}</span>
        <RelativeTime iso={broadcast.sentAt} />
      </>
    );
  }
  return (
    <>
      <span className="block text-xs text-ink-muted">Edited</span>
      <RelativeTime iso={broadcast.updatedAt} />
    </>
  );
}

export default async function BroadcastsPage(props: PageProps<"/admin/broadcasts">) {
  await requireRole(["moderator"], "/admin/broadcasts");
  const filters = parseBroadcastFilters(await props.searchParams);
  const [list, overview, settings, courses] = await Promise.all([listBroadcasts(filters), getBroadcastOverview(), getSettings(), segmentCourseOptions()]);
  const titles = new Map(courses.map((c) => [c.id, c.title] as const));
  const titleOf = (courseId: string) => titles.get(courseId);
  const anySending = list.counts.sending > 0;
  const nothingYet = list.counts.all === 0 && !filters.q;

  // Lazy runner: once this page is sent, start scheduled broadcasts that are due, queue the next batches
  // and send the sequence emails that are due (a no-op when nothing is waiting).
  after(async () => {
    await runComms().catch(() => undefined);
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Broadcasts"
        description="One-off emails to a segment of your members or leads — newsletters, launches and announcements — with open and click tracking."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Broadcasts" }]} />}
        actions={
          <>
            {!nothingYet && (
              <a href={hrefFor(filters, { page: 1 }, "/admin/broadcasts/export")} download className={buttonClasses({ variant: "outline" })}>
                <Icon.Download className="size-4" />
                Export CSV
              </a>
            )}
            <ButtonLink href="/admin/broadcasts/new" leftIcon={<Icon.Plus className="size-4" />}>
              New broadcast
            </ButtonLink>
          </>
        }
      />
      <BroadcastsNav className="mb-6" />
      {anySending && <AutoRefresh />}

      {!settings.email.enabled && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">
            Email is turned off, so broadcasts can&apos;t be sent and scheduled ones wait. An administrator can switch it on in{" "}
            <Link href="/admin/settings/email" className="font-medium underline">
              Settings → Email
            </Link>
            .
          </p>
        </div>
      )}

      {nothingYet ? (
        <EmptyState
          icon={<Icon.Megaphone />}
          title="No broadcasts yet"
          description="Write an email, choose who should get it — everyone enrolled in a course, people who never purchased, members who have been away — and send it now or later."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/admin/broadcasts/new" leftIcon={<Icon.Plus className="size-4" />}>
                Write your first broadcast
              </ButtonLink>
              <ButtonLink href="/admin/broadcasts/audience" variant="outline" leftIcon={<Icon.Users className="size-4" />}>
                Explore your audience
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <section aria-labelledby="broadcast-summary" className="mb-6">
            <h2 id="broadcast-summary" className="sr-only">
              Summary
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Sent in the last 30 days"
                value={formatNumber(overview.sentLast30Days)}
                hint={`${formatNumber(overview.emailsLast30Days)} ${overview.emailsLast30Days === 1 ? "email" : "emails"}`}
                icon={<Icon.Send className="size-4" />}
              />
              <StatCard label="Open rate" value={`${overview.openRate}%`} hint="Unique opens, last 30 days" icon={<Icon.Eye className="size-4" />} />
              <StatCard label="Click rate" value={`${overview.clickRate}%`} hint="Unique clicks, last 30 days" icon={<Icon.Link className="size-4" />} />
              <StatCard
                label="Scheduled"
                value={formatNumber(overview.scheduled)}
                hint={overview.nextScheduledAt ? <>Next: <LocalDateTime iso={overview.nextScheduledAt} /></> : "Nothing is waiting to go out"}
                icon={<Icon.Calendar className="size-4" />}
              />
            </div>
          </section>

          <div className="mb-4 space-y-3">
            <Tabs
              variant="pills"
              param="status"
              items={[
                { label: "All", value: "all", count: list.counts.all },
                { label: "Drafts", value: "draft", count: list.counts.draft },
                { label: "Scheduled", value: "scheduled", count: list.counts.scheduled },
                { label: "Sending", value: "sending", count: list.counts.sending },
                { label: "Sent", value: "sent", count: list.counts.sent },
              ]}
            />
            <ListSearch label="Search broadcasts" placeholder="Search by subject or message" />
          </div>

          <Table>
            <THead>
              <tr>
                <TH>Broadcast</TH>
                <TH className="hidden sm:table-cell">Status</TH>
                <TH className="hidden text-right md:table-cell">Recipients</TH>
                <TH className="hidden text-right lg:table-cell">Opened</TH>
                <TH className="hidden text-right lg:table-cell">Clicked</TH>
                <TH className="hidden md:table-cell">When</TH>
                <TH className="w-10">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {list.rows.length === 0 ? (
                <TableEmpty colSpan={7}>
                  {filters.q ? `No broadcasts match “${filters.q}”.` : "No broadcasts with this status."}{" "}
                  <Link href="/admin/broadcasts" className="font-medium text-accent hover:underline">
                    Show all
                  </Link>
                </TableEmpty>
              ) : (
                list.rows.map(({ broadcast: b, authorName }) => {
                  const phase = broadcastPhase(b);
                  const rates = broadcastRates(b);
                  const progress = sendProgress(b);
                  const reported = b.status === "sending" || b.status === "sent";
                  return (
                    <TR key={b.id}>
                      <TD className="max-w-0 w-full md:w-[38%]">
                        <Link href={`/admin/broadcasts/${b.id}`} className="block truncate font-medium hover:underline">
                          {b.subject}
                        </Link>
                        <p className="truncate text-xs text-ink-muted">
                          {describeSegment(b.segment, titleOf).join(" · ")} · by {authorName}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted sm:hidden">
                          <BroadcastPhaseBadge phase={phase} size="xs" />
                          {reported && (
                            <span>
                              {formatNumber(b.recipients)} recipients · {rates.openRate}% opened
                            </span>
                          )}
                        </div>
                        {b.status === "sending" && <ProgressBar value={progress.percent} size="xs" className="mt-2 max-w-64" label={`${formatNumber(progress.done)} of ${formatNumber(progress.total)} queued`} />}
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <BroadcastPhaseBadge phase={phase} />
                      </TD>
                      <TD className="hidden text-right tabular-nums md:table-cell">{reported ? formatNumber(b.recipients) : <span className="text-ink-faint">—</span>}</TD>
                      <TD className="hidden text-right tabular-nums lg:table-cell">
                        {reported ? (
                          <>
                            {formatNumber(b.opens)}
                            <span className="block text-xs text-ink-muted">{rates.openRate}%</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TD>
                      <TD className="hidden text-right tabular-nums lg:table-cell">
                        {reported ? (
                          <>
                            {formatNumber(b.clicks)}
                            <span className="block text-xs text-ink-muted">{rates.clickRate}%</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TD>
                      <TD className="hidden whitespace-nowrap text-sm md:table-cell">
                        <When broadcast={b} />
                      </TD>
                      <TD className="text-right">
                        <BroadcastMenu id={b.id} subject={b.subject} editable={isEditable(b)} deletable={phase !== "sending"} showOpen />
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>

          <div className="mt-4">
            <Pager page={list.page} pageCount={list.pageCount} total={list.total} noun="broadcast" hrefFor={(page) => hrefFor(filters, { page })} />
          </div>
        </>
      )}
    </div>
  );
}
