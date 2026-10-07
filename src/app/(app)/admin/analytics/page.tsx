import Link from "next/link";
import type { ReactNode } from "react";
import { after } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getAnalyticsReport, maybeCompactAnalytics, type AnalyticsReport, type ExportSection, type ItemRevenueView } from "@/lib/growth/analytics";
import { DIRECT } from "@/lib/growth/analytics-metrics";
import { ATTRIBUTION_DAYS, RETENTION_DAYS, TRAFFIC_RAW_DAYS, parseRange, rangeQuery } from "@/lib/growth/analytics-shared";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { BarList } from "@/components/dashboard/charts/bar-list";
import { DonutChart } from "@/components/dashboard/charts/donut-chart";
import { categoricalColor } from "@/components/dashboard/charts/scale";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { moneyList } from "@/components/growth/affiliate-badges";
import { AnalyticsCohorts } from "@/components/growth/analytics-cohorts";
import { AnalyticsFunnel } from "@/components/growth/analytics-funnel";
import { AnalyticsRangePicker } from "@/components/growth/analytics-range";
import { AnalyticsTrend } from "@/components/growth/analytics-trend";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Analytics" };

const BASE = "/admin/analytics";
const TOP = 10;

const ITEM_TYPE_LABELS: Record<string, string> = {
  course: "Course",
  bundle: "Bundle",
  plan: "Membership",
  batch: "Batch",
  certificate: "Certificate",
  gift: "Gift",
  seats: "Team seats",
};

function itemTypeLabel(type: string): string {
  return ITEM_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function trend(value: number | null) {
  return value === null ? undefined : { value, label: "vs previous period" };
}

function ExportLink({ section, report, label = "CSV" }: { section: ExportSection; report: AnalyticsReport; label?: string }) {
  return (
    <a href={`${BASE}/export?section=${section}&${rangeQuery(report.range)}`} download className={buttonClasses({ variant: "ghost", size: "sm" })}>
      <Icon.Download className="size-4" aria-hidden="true" />
      {label}
      <span className="sr-only"> export of {section}</span>
    </a>
  );
}

function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader title={title} description={description} actions={actions ? <div className="flex shrink-0 gap-1">{actions}</div> : undefined} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function ManageLink({ href }: { href: string }) {
  return (
    <Link href={href} className={buttonClasses({ variant: "ghost", size: "sm" })}>
      Manage
    </Link>
  );
}

export default async function AdminAnalyticsPage(props: PageProps<"/admin/analytics">) {
  await requireRole(["admin"], BASE);
  const sp = await props.searchParams;
  const range = parseRange(sp);
  const report = await getAnalyticsReport(range);
  // Fold raw events older than the retention period into daily totals (at most every few hours per server).
  after(() => maybeCompactAnalytics());

  const k = report.kpis;
  const c = report.currency;
  const mainMrr = report.subscriptions.mrr.find((m) => m.currency === c);
  const funnelEmpty = report.funnel.every((s) => s.count === 0);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Analytics"
        description="Traffic, sales and learner retention from your own data. No third-party trackers: visitors who decline analytics cookies are counted anonymously."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Analytics" }]} />}
        actions={<ExportLink section="daily" report={report} label="Daily CSV" />}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <AnalyticsRangePicker range={range} basePath={BASE} />
        <p className="text-xs text-ink-muted">
          {formatDate(range.from)} – {formatDate(range.to)} (UTC), compared with the {range.days} days before
        </p>
      </div>

      {k.pageViews === 0 && (
        <div role="status" className="flex gap-3 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-ink">
          <Icon.Info className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
          <p>
            No page views were recorded in this period. Visits are counted as people browse the site (bots and Do-Not-Track browsers are skipped), so traffic starts on
            the day tracking went live. Sales, sign-ups and learner activity come from your records and are complete.
          </p>
        </div>
      )}

      <section aria-label="Key numbers" className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Visitors" value={formatNumber(k.visitors)} trend={trend(k.visitorsTrend)} hint={`${formatNumber(k.pageViews)} page views`} icon={<Icon.Eye className="size-4" />} />
        <StatCard label="Sign-ups" value={formatNumber(k.signups)} trend={trend(k.signupsTrend)} hint="New accounts" icon={<Icon.UserPlus className="size-4" />} />
        <StatCard
          label="Conversion rate"
          value={`${k.conversionRate}%`}
          trend={trend(k.conversionTrend)}
          hint={`${formatNumber(k.orders)} ${k.orders === 1 ? "order" : "orders"} from ${formatNumber(k.visitors)} visitors`}
          icon={<Icon.Target className="size-4" />}
        />
        <StatCard
          label="Net revenue"
          value={<span className="text-2xl sm:text-3xl">{money(k.revenue.net, c)}</span>}
          trend={trend(k.revenueTrend)}
          hint={
            k.otherCurrencies.length
              ? `+ ${moneyList(
                  k.otherCurrencies.map((r) => ({ currency: r.currency, amount: r.net })),
                  c,
                )}`
              : `${money(k.revenue.gross, c)} sales excl. tax`
          }
          icon={<Icon.CreditCard className="size-4" />}
        />
        <StatCard
          label="Average order"
          value={<span className="text-2xl sm:text-3xl">{money(k.revenue.aov, c)}</span>}
          trend={trend(k.aovTrend)}
          hint={`${formatNumber(k.revenue.orders)} orders in ${c}`}
          icon={<Icon.Receipt className="size-4" />}
        />
        <StatCard
          label="Refund rate"
          value={`${k.revenue.refundRate}%`}
          hint={k.revenue.refunds ? `${money(k.revenue.refunds, c)} refunded` : "No refunds in this period"}
          icon={<Icon.Refresh className="size-4" />}
        />
        <StatCard
          label="MRR"
          value={<span className="text-2xl sm:text-3xl">{money(mainMrr?.mrr ?? 0, c)}</span>}
          hint={mainMrr ? `${formatNumber(mainMrr.active)} paying ${mainMrr.active === 1 ? "subscription" : "subscriptions"}` : "No subscriptions yet"}
          icon={<Icon.TrendingUp className="size-4" />}
        />
        <StatCard
          label="Active learners"
          value={formatNumber(k.activeLearners)}
          trend={trend(k.activeLearnersTrend)}
          hint="Learned or signed in"
          icon={<Icon.GraduationCap className="size-4" />}
        />
      </section>

      <Section title="Trends" description="Day by day over the selected period." actions={<ExportLink section="daily" report={report} />}>
        <AnalyticsTrend days={report.series} currency={c} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Funnel"
          description="Visit → course or offer page → checkout → purchase. Visitors without analytics consent count once per page view."
          actions={<ExportLink section="funnel" report={report} />}
        >
          {funnelEmpty ? (
            <EmptyState compact icon={<Icon.Target />} title="No funnel data yet" description="The funnel fills in as visitors browse courses and check out." />
          ) : (
            <AnalyticsFunnel stages={report.funnel} />
          )}
        </Section>
        <Section title="Revenue by type" description={`Net revenue in ${c} by what was sold.`}>
          {report.revenueByType.every((t) => t.net <= 0) ? (
            <EmptyState compact icon={<Icon.CreditCard />} title="No sales in this period" description="Paid orders appear here as they come in." />
          ) : (
            <DonutChart
              centerLabel={`Net ${c}`}
              segments={report.revenueByType
                .filter((t) => t.net > 0)
                .map((t, i) => ({ label: itemTypeLabel(t.itemType), value: Math.round(t.net / 100), color: categoricalColor(i) }))}
            />
          )}
        </Section>
      </div>

      <Section title="Revenue by course, bundle and plan" description="Orders paid in the period: sales without tax, minus refunds." actions={<ExportLink section="revenue" report={report} />}>
        <ItemRevenueTable rows={report.revenueByItem.slice(0, TOP)} total={report.revenueByItem.length} />
      </Section>

      <Section title="Subscriptions" description="Monthly recurring revenue right now. Yearly plans count one twelfth per month; trials bring none yet.">
        {report.subscriptions.mrr.length === 0 ? (
          <EmptyState compact icon={<Icon.TrendingUp />} title="No subscriptions yet" description="Memberships sold on the pricing page appear here." />
        ) : (
          <div className="space-y-4">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {report.subscriptions.mrr.map((m) => (
                <li key={m.currency} className="rounded-lg border border-border p-4">
                  <p className="text-xs font-medium text-ink-muted">MRR ({m.currency})</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{money(m.mrr, m.currency)}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {m.active} paying · {m.trialing} trialing · {m.pastDue} past due
                  </p>
                  {(m.atRisk > 0 || m.cancelling > 0) && (
                    <p className="mt-1 text-xs text-warning">
                      {[m.atRisk > 0 ? `${money(m.atRisk, m.currency)} at risk` : "", m.cancelling > 0 ? `${m.cancelling} cancelling at period end` : ""].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-muted">
              In this period: <span className="font-medium text-ink">{formatNumber(report.subscriptions.started)}</span> started,{" "}
              <span className="font-medium text-ink">{formatNumber(report.subscriptions.ended)}</span> cancelled or expired.
            </p>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Top landing pages" description="Where visits started." actions={<ExportLink section="landing" report={report} />}>
          {report.landingPages.length === 0 ? (
            <EmptyState compact icon={<Icon.Layout />} title="No visits recorded" description="Landing pages appear once visitors arrive." />
          ) : (
            <BarList
              valueLabel="Visits per landing page"
              data={report.landingPages.slice(0, TOP).map((r) => ({ id: r.key, label: r.label, value: r.value, href: r.label.includes("[") ? undefined : r.label }))}
            />
          )}
        </Section>
        <Section title="Top referrers" description="Sites that sent visits, and the sign-ups and sales credited to them." actions={<ExportLink section="referrers" report={report} />}>
          <Table>
            <THead>
              <tr>
                <TH>Source</TH>
                <TH className="text-right">Visits</TH>
                <TH className="hidden text-right sm:table-cell">Sign-ups</TH>
                <TH className="text-right">Sales</TH>
              </tr>
            </THead>
            <TBody>
              {report.referrers.length === 0 ? (
                <TableEmpty colSpan={4}>No visits recorded in this period.</TableEmpty>
              ) : (
                report.referrers.slice(0, TOP).map((r) => (
                  <TR key={r.host}>
                    <TD className="max-w-0 truncate">{r.host === DIRECT ? <span className="text-ink-muted">Direct or unknown</span> : r.host}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(r.visits)}</TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(r.signups)}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(r.purchases)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Section>
      </div>

      <Section
        title="UTM campaigns"
        description={`Visits tagged with utm_source, utm_medium or utm_campaign, and the sign-ups and sales made within ${ATTRIBUTION_DAYS} days of such a visit.`}
        actions={<ExportLink section="campaigns" report={report} />}
      >
        <Table>
          <THead>
            <tr>
              <TH>Campaign</TH>
              <TH className="hidden md:table-cell">Source / medium</TH>
              <TH className="text-right">Visits</TH>
              <TH className="hidden text-right sm:table-cell">Sign-ups</TH>
              <TH className="text-right">Sales</TH>
            </tr>
          </THead>
          <TBody>
            {report.campaigns.length === 0 ? (
              <TableEmpty colSpan={5}>No tagged visits in this period. Add UTM tags to the links in your emails and ads to compare them here.</TableEmpty>
            ) : (
              report.campaigns.slice(0, TOP).map((r) => (
                <TR key={r.key}>
                  <TD className="max-w-0">
                    <p className="truncate font-medium text-ink">{r.campaign || "(no campaign)"}</p>
                    <p className="truncate text-xs text-ink-muted md:hidden">
                      {r.source || "(none)"} / {r.medium || "(none)"}
                    </p>
                  </TD>
                  <TD className="hidden text-ink-muted md:table-cell">
                    {r.source || "(none)"} / {r.medium || "(none)"}
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(r.visits)}</TD>
                  <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(r.signups)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(r.purchases)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Coupons"
          description="Orders paid with a coupon in the period."
          actions={
            <>
              <ExportLink section="coupons" report={report} />
              <ManageLink href="/admin/settings/coupons" />
            </>
          }
        >
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH className="text-right">Orders</TH>
                <TH className="hidden text-right sm:table-cell">Discount</TH>
                <TH className="text-right">Net revenue</TH>
              </tr>
            </THead>
            <TBody>
              {report.coupons.length === 0 ? (
                <TableEmpty colSpan={4}>No coupon orders in this period.</TableEmpty>
              ) : (
                report.coupons.slice(0, TOP).map((r) => (
                  <TR key={`${r.code}-${r.currency}`}>
                    <TD className="font-mono text-xs">{r.code}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(r.orders)}</TD>
                    <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">{money(r.discount, r.currency)}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{money(r.revenue, r.currency)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Section>
        <Section
          title="Affiliates"
          description="Referral clicks, credited sales and commissions earned in the period."
          actions={
            <>
              <ExportLink section="affiliates" report={report} />
              <ManageLink href="/admin/affiliates" />
            </>
          }
        >
          <Table>
            <THead>
              <tr>
                <TH>Affiliate</TH>
                <TH className="hidden text-right sm:table-cell">Clicks</TH>
                <TH className="text-right">Sales</TH>
                <TH className="text-right">Commission</TH>
              </tr>
            </THead>
            <TBody>
              {report.affiliates.length === 0 ? (
                <TableEmpty colSpan={4}>No affiliate clicks or sales in this period.</TableEmpty>
              ) : (
                report.affiliates.slice(0, TOP).map((a) => (
                  <TR key={a.affiliateId}>
                    <TD className="max-w-0">
                      <Link href={`/admin/affiliates/${a.affiliateId}`} className="block truncate font-medium text-ink hover:underline">
                        {a.name}
                      </Link>
                      <p className="truncate font-mono text-xs text-ink-muted">{a.code}</p>
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(a.clicks)}</TD>
                    <TD className="text-right tabular-nums">
                      {formatNumber(a.sales)}
                      {a.revenue.length > 0 && <p className="whitespace-nowrap text-xs text-ink-muted">{moneyList(a.revenue, c)}</p>}
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{moneyList(a.commission, c)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Section>
      </div>

      <Section
        title="Learner retention"
        description="Members grouped by the week they signed up, and the share active (a lesson, an activity or a sign-in) in each later week. Administrators are left out."
        actions={<ExportLink section="cohorts" report={report} />}
      >
        {report.cohorts.every((r) => r.size === 0) ? (
          <EmptyState compact icon={<Icon.Users />} title="No sign-ups in these weeks" description="Cohorts cover the eight weeks up to the end of the selected period." />
        ) : (
          <AnalyticsCohorts rows={report.cohorts} />
        )}
      </Section>

      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge tone="neutral" size="xs">
          Privacy
        </Badge>
        <span>
          {report.tracking.consentedShare}% of page views in this period came from visitors who accepted analytics cookies. Page views are kept one by one for up to{" "}
          {TRAFFIC_RAW_DAYS + 1} days and then as daily totals; visits from a campaign or another site, sign-ups and purchases are kept for {RETENTION_DAYS} days, then
          only as daily totals ({formatNumber(report.tracking.rawEvents)} raw events and {formatNumber(report.tracking.rollupRows)} daily totals stored
          {report.tracking.oldestRaw ? `; oldest raw event from ${formatDate(report.tracking.oldestRaw)}` : ""}).
        </span>
      </p>
    </div>
  );
}

function ItemRevenueTable({ rows, total }: { rows: ItemRevenueView[]; total: number }) {
  return (
    <div className="space-y-2">
      <Table>
        <THead>
          <tr>
            <TH>Item</TH>
            <TH className="hidden sm:table-cell">Type</TH>
            <TH className="text-right">Orders</TH>
            <TH className="hidden text-right md:table-cell">Refunds</TH>
            <TH className="text-right">Net</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>No paid orders in this period.</TableEmpty>
          ) : (
            rows.map((r) => (
              <TR key={r.key}>
                <TD className="max-w-0">
                  {r.href ? (
                    <Link href={r.href} className="block truncate font-medium text-ink hover:underline">
                      {r.title}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink">{r.title}</span>
                  )}
                  <p className="truncate text-xs text-ink-muted sm:hidden">{itemTypeLabel(r.itemType)}</p>
                </TD>
                <TD className="hidden text-ink-muted sm:table-cell">{itemTypeLabel(r.itemType)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(r.orders)}</TD>
                <TD className="hidden whitespace-nowrap text-right tabular-nums text-ink-muted md:table-cell">{r.refunds ? money(r.refunds, r.currency) : "—"}</TD>
                <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.net, r.currency)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
      {total > rows.length && (
        <p className="text-xs text-ink-muted">
          Showing the top {rows.length} of {total} items. Download the CSV for all of them.
        </p>
      )}
    </div>
  );
}
