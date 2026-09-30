import Link from "next/link";
import { after } from "next/server";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getTrackingOverview, listTrackingEvents, maybePruneEmailEvents, parseTrackingEventFilters, type TrackingEventFilters } from "@/lib/comms/tracking";
import { ratePercent } from "@/lib/comms/tracking-core";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BroadcastsNav } from "@/components/comms/broadcasts-nav";
import { TrackingFilters } from "@/components/comms/tracking-filters";
import { TrackingSettingsForm } from "@/components/comms/tracking-settings-form";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const metadata = { title: "Email tracking" };

const RANGE_LABEL: Record<number, string> = { 7: "last 7 days", 30: "last 30 days", 90: "last 90 days" };

function query(filters: TrackingEventFilters, patch: Partial<TrackingEventFilters> = {}): string {
  const next = { ...filters, ...patch };
  const qs = new URLSearchParams();
  if (next.range !== 30) qs.set("range", String(next.range));
  if (next.type !== "all") qs.set("type", next.type);
  if (next.q) qs.set("q", next.q);
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** "example.com/pricing" for display; the full URL stays in the title and link. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return `${u.host}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

export default async function EmailTrackingPage(props: PageProps<"/admin/broadcasts/tracking">) {
  const viewer = await requireRole(["moderator"], "/admin/broadcasts/tracking");
  const filters = parseTrackingEventFilters(await props.searchParams);
  const [overview, events, settings] = await Promise.all([getTrackingOverview(filters.range), listTrackingEvents(filters), getSettings()]);
  const { summary } = overview;
  const rangeLabel = RANGE_LABEL[filters.range] ?? `last ${filters.range} days`;
  const trackingOff = !settings.email.trackOpens && !settings.email.trackClicks;
  const filtered = filters.type !== "all" || !!filters.q;
  // Drop events left behind by deleted emails and campaigns (at most every few hours, after the page is sent).
  after(() => maybePruneEmailEvents());

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Email tracking"
        description="Opens and link clicks of broadcasts and automated sequences, per campaign and per link."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Tracking" },
            ]}
          />
        }
        actions={
          <ButtonLink href={`/admin/broadcasts/tracking/export${query(filters, { page: 1 })}`} variant="outline" leftIcon={<Icon.Download className="size-4" />}>
            Export CSV
          </ButtonLink>
        }
      />
      <BroadcastsNav className="mb-6" />

      {trackingOff && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0">Open and click tracking are both off, so nothing new is recorded. Earlier results stay available below.</p>
        </div>
      )}

      <section aria-labelledby="tracking-summary" className="mb-6">
        <h2 id="tracking-summary" className="sr-only">
          Summary for the {rangeLabel}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Tracked emails"
            value={formatNumber(overview.tracked)}
            hint={`${formatNumber(overview.delivered)} delivered · ${rangeLabel}`}
            icon={<Icon.Mail className="size-4" />}
          />
          <StatCard
            label="Unique opens"
            value={formatNumber(summary.uniqueOpens)}
            hint={`${ratePercent(summary.uniqueOpens, overview.delivered)}% open rate · ${formatNumber(summary.totalOpens)} total`}
            icon={<Icon.Eye className="size-4" />}
          />
          <StatCard
            label="Unique clicks"
            value={formatNumber(summary.uniqueClicks)}
            hint={`${ratePercent(summary.uniqueClicks, overview.delivered)}% click rate · ${formatNumber(summary.totalClicks)} total`}
            icon={<Icon.Link className="size-4" />}
          />
          <StatCard
            label="Click-to-open rate"
            value={`${ratePercent(summary.uniqueClicks, summary.uniqueOpens)}%`}
            hint="Share of openers who clicked a link"
            icon={<Icon.TrendingUp className="size-4" />}
          />
        </div>
      </section>

      <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card className="min-w-0">
          <CardHeader title="Campaigns" description={`Broadcasts and sequences that sent tracked emails in the ${rangeLabel}.`} />
          {overview.campaigns.length === 0 ? (
            <CardBody>
              <EmptyState
                compact
                icon={<Icon.Megaphone />}
                title="No tracked emails in this period"
                description="Broadcasts and sequence emails appear here with their delivery, open and click counts once they're sent."
              />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead>
                  <tr>
                    <TH>Campaign</TH>
                    <TH className="text-right">Delivered</TH>
                    <TH className="text-right">Opened</TH>
                    <TH className="hidden text-right sm:table-cell">Clicked</TH>
                  </tr>
                </THead>
                <TBody>
                  {overview.campaigns.map((c) => (
                    <TR key={c.key}>
                      <TD className="max-w-0 w-1/2">
                        {c.href ? (
                          <Link href={c.href} className="block truncate font-medium hover:underline">
                            {c.label}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium">{c.label}</span>
                        )}
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                          <Badge tone={c.kind === "broadcast" ? "accent" : c.kind === "sequence" ? "info" : "neutral"} size="xs">
                            {c.kind === "broadcast" ? "Broadcast" : c.kind === "sequence" ? "Sequence" : "Other"}
                          </Badge>
                          {formatNumber(c.sent)} sent
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-muted sm:hidden">
                          {formatNumber(c.uniqueClicks)} clicked ({ratePercent(c.uniqueClicks, c.delivered)}%)
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums">{formatNumber(c.delivered)}</TD>
                      <TD className="text-right tabular-nums">
                        {formatNumber(c.uniqueOpens)}
                        <span className="block text-xs text-ink-muted">{ratePercent(c.uniqueOpens, c.delivered)}%</span>
                      </TD>
                      <TD className="hidden text-right tabular-nums sm:table-cell">
                        {formatNumber(c.uniqueClicks)}
                        <span className="block text-xs text-ink-muted">{ratePercent(c.uniqueClicks, c.delivered)}%</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </table>
            </div>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Tracking settings" description="Applies to broadcasts and sequence emails." />
          <CardBody>
            <TrackingSettingsForm trackOpens={settings.email.trackOpens} trackClicks={settings.email.trackClicks} canEdit={isAdmin(viewer)} />
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6 min-w-0">
        <CardHeader title="Top links" description={`Most clicked links in tracked emails, ${rangeLabel}.`} />
        {overview.topLinks.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">No link clicks yet in this period.</p>
          </CardBody>
        ) : (
          <ol className="divide-y divide-border">
            {overview.topLinks.map((link, i) => (
              <li key={link.url} className="flex items-center gap-3 px-5 py-3">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-faint">{i + 1}</span>
                <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" title={link.url} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
                  {shortUrl(link.url)}
                </a>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="font-medium text-ink">{formatNumber(link.uniqueClicks)}</span>
                  <span className="block text-xs text-ink-muted">{formatNumber(link.clicks)} clicks</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <section aria-labelledby="tracking-events" className="space-y-4">
        <h2 id="tracking-events" className="text-lg font-semibold tracking-tight text-ink">
          Activity
        </h2>
        <TrackingFilters values={{ range: filters.range, type: filters.type, q: filters.q }} />
        <Table>
          <THead>
            <tr>
              <TH>Recipient</TH>
              <TH>Event</TH>
              <TH className="hidden md:table-cell">Email</TH>
              <TH className="hidden sm:table-cell">When</TH>
            </tr>
          </THead>
          <TBody>
            {events.rows.length === 0 ? (
              <TableEmpty colSpan={4}>
                {filtered ? "No opens or clicks match these filters." : `No opens or clicks in the ${rangeLabel}.`}{" "}
                {filtered && (
                  <Link href={`/admin/broadcasts/tracking${query({ ...filters, type: "all", q: "", page: 1 })}`} className="font-medium text-accent hover:underline">
                    Clear filters
                  </Link>
                )}
              </TableEmpty>
            ) : (
              events.rows.map((row) => (
                <TR key={row.id}>
                  <TD className="max-w-0 w-[40%] md:w-[28%]">
                    <p className="truncate font-medium">{row.toName || row.to}</p>
                    {row.toName && <p className="truncate text-xs text-ink-muted">{row.to}</p>}
                    <p className="truncate text-xs text-ink-muted sm:hidden">{relativeTime(row.createdAt)}</p>
                  </TD>
                  <TD className="max-w-0">
                    {row.type === "open" ? (
                      <Badge tone="success" dot>
                        Opened
                      </Badge>
                    ) : (
                      <>
                        <Badge tone="accent" dot>
                          Clicked
                        </Badge>
                        {row.url && (
                          <p className="mt-0.5 truncate text-xs text-ink-muted" title={row.url}>
                            {shortUrl(row.url)}
                          </p>
                        )}
                      </>
                    )}
                  </TD>
                  <TD className="hidden max-w-0 md:table-cell">
                    <Link href={`/admin/emails/${row.emailId}`} className="block truncate hover:underline">
                      {row.subject}
                    </Link>
                    <p className="truncate text-xs text-ink-muted">{row.campaign.label}</p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell" title={formatDateTime(row.createdAt)}>
                    {relativeTime(row.createdAt)}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {events.pageCount > 1 && (
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-ink-muted">
              Page {events.page} of {events.pageCount} · {formatNumber(events.total)} {events.total === 1 ? "event" : "events"}
            </p>
            <div className="flex gap-2">
              {events.page > 1 ? (
                <ButtonLink href={`/admin/broadcasts/tracking${query(filters, { page: events.page - 1 })}`} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
                  Newer
                </ButtonLink>
              ) : (
                <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-ink-faint">Newer</span>
              )}
              {events.page < events.pageCount ? (
                <ButtonLink href={`/admin/broadcasts/tracking${query(filters, { page: events.page + 1 })}`} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
                  Older
                </ButtonLink>
              ) : (
                <span className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-ink-faint">Older</span>
              )}
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
