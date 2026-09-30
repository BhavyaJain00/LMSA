import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { getAffiliateDashboard, getShareTargets } from "@/lib/growth/affiliates";
import { methodLabel, paginate } from "@/lib/growth/affiliates-shared";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { LineChart } from "@/components/dashboard/charts/line-chart";
import { money } from "@/components/commerce/order-summary";
import { AffiliateApplyForm, PayoutEmailForm } from "@/components/growth/affiliate-forms";
import { AffiliateStatusBadge, CommissionStatusBadge, moneyList } from "@/components/growth/affiliate-badges";
import { ShareLinkBuilder } from "@/components/growth/share-link-builder";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Affiliate program", robots: { index: false } };

const PAGE_SIZE = 20;

const STEPS = [
  { icon: Icon.Link, title: "Share your link", text: "Add your code to any course, bundle or page link and share it with your audience." },
  { icon: Icon.CreditCard, title: "They buy", text: "When someone who clicked your link buys within the referral window, the sale is credited to you." },
  { icon: Icon.Gift, title: "You get paid", text: "Approved commissions are paid out to your payout email." },
];

export default async function AffiliatePage(props: PageProps<"/affiliate">) {
  const user = await requireUser("/affiliate");
  const sp = await props.searchParams;
  const [settings, dashboard] = await Promise.all([getSettings(), getAffiliateDashboard(user.id)]);
  const g = settings.growth;
  const currency = settings.commerce.defaultCurrency;

  if (!dashboard) {
    if (!g.affiliatesEnabled) {
      return (
        <div className="animate-fade-in">
          <PageHeader title="Affiliate program" />
          <EmptyState
            icon={<Icon.Handshake />}
            title="The affiliate program is closed"
            description="We aren't accepting new affiliates right now. Check back later."
            action={<ButtonLink href="/courses" variant="outline">Browse courses</ButtonLink>}
          />
        </div>
      );
    }
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Affiliate program"
          description={`Recommend our courses and earn ${g.defaultCommissionPercent}% of every purchase made through your link.`}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <CardHeader title="How it works" />
            <CardBody>
              <ol className="space-y-5">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <step.icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-medium text-ink">
                        <span className="sr-only">Step {i + 1}: </span>
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <dl className="mt-6 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-4 text-sm">
                <div>
                  <dt className="text-ink-muted">Commission</dt>
                  <dd className="text-lg font-semibold text-ink">{g.defaultCommissionPercent}%</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Referral window</dt>
                  <dd className="text-lg font-semibold text-ink">{g.cookieDays} days</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card className="lg:self-start">
            <CardHeader title={g.affiliateAutoApprove ? "Join now" : "Apply to join"} description={g.affiliateAutoApprove ? "Your link is ready right away." : "An administrator reviews every application."} />
            <CardBody>
              <AffiliateApplyForm accountEmail={user.email} percent={g.defaultCommissionPercent} cookieDays={g.cookieDays} autoApprove={g.affiliateAutoApprove} />
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  const { affiliate, stats } = dashboard;
  const tab = sp.tab === "payouts" ? "payouts" : "commissions";
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const commissionsPage = paginate(dashboard.commissions, Number.isInteger(pageRaw) ? pageRaw : 1, PAGE_SIZE);
  const pageHref = (page: number) => (page > 1 ? `/affiliate?page=${page}` : "/affiliate");

  if (affiliate.status === "pending") {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Affiliate program" description="Your application is waiting for review." actions={<AffiliateStatusBadge status="pending" />} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardBody className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <Icon.Clock className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-ink">Thanks for applying</p>
                <p className="mt-1 text-sm text-ink-muted">
                  You applied on {formatDate(affiliate.createdAt)}. We&apos;ll notify you as soon as an administrator approves your account; your referral links start working then.
                </p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payout email" />
            <CardBody>
              <PayoutEmailForm current={affiliate.payoutEmail} accountEmail={user.email} />
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  const shareGroups = await getShareTargets();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Affiliate dashboard"
        description={`You earn ${affiliate.commissionPercent}% of the price (excluding tax) of purchases made within ${g.cookieDays} days of a click on your link.`}
        actions={<AffiliateStatusBadge status={affiliate.status} />}
        className="mb-0"
      />

      {affiliate.status === "paused" && (
        <div role="status" className="flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>Your affiliate account is paused: new clicks and purchases don&apos;t earn commissions. Commissions you already earned are still paid out.</p>
        </div>
      )}
      {!g.affiliatesEnabled && affiliate.status !== "paused" && (
        <div role="status" className="flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>The affiliate program is on hold, so new purchases don&apos;t earn commissions for now. Commissions you already earned are still paid out.</p>
        </div>
      )}

      <Card>
        <CardHeader
          title="Share your link"
          description={
            <>
              Your code is <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-semibold text-ink">{affiliate.code}</span>. Add{" "}
              <span className="font-mono">?ref={affiliate.code}</span> to any page address on this site.
            </>
          }
        />
        <CardBody>
          <ShareLinkBuilder origin={siteConfig.appUrl} code={affiliate.code} groups={shareGroups} />
        </CardBody>
      </Card>

      <section aria-label="Referral performance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clicks" value={formatNumber(stats.clicks)} hint={`${formatNumber(stats.clicks30)} in the last 30 days`} icon={<Icon.Link className="size-5" />} />
        <StatCard label="Sign-ups" value={formatNumber(stats.signups)} hint="New accounts from your link" icon={<Icon.UserPlus className="size-5" />} />
        <StatCard label="Sales" value={formatNumber(stats.conversions)} hint="Purchases credited to you" icon={<Icon.CreditCard className="size-5" />} />
        <StatCard label="Conversion rate" value={`${stats.conversionRate}%`} hint="Sales per click" icon={<Icon.TrendingUp className="size-5" />} />
      </section>

      <section aria-label="Earnings" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Pending"
          value={<span className="text-xl sm:text-2xl">{moneyList(stats.totals.map((t) => ({ currency: t.currency, amount: t.pending })), currency)}</span>}
          hint="Waiting for approval"
        />
        <StatCard
          label="Approved"
          value={<span className="text-xl sm:text-2xl">{moneyList(stats.payable, currency)}</span>}
          hint="Included in your next payout"
        />
        <StatCard
          label="Paid"
          value={<span className="text-xl sm:text-2xl">{moneyList(stats.totals.map((t) => ({ currency: t.currency, amount: t.paid })), currency)}</span>}
          hint={dashboard.payouts[0] ? `Last payout ${formatDate(dashboard.payouts[0].createdAt)}` : "No payouts yet"}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title="Clicks" description="Last 30 days" />
          <CardBody>
            {stats.clicks30 > 0 ? (
              <LineChart data={dashboard.daily} label="Clicks" unit="click" height={200} />
            ) : (
              <EmptyState compact icon={<Icon.BarChart />} title="No clicks yet" description="Share your link: every visit through it shows up here." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top landing pages" />
          <CardBody>
            {dashboard.topPages.length ? (
              <ul className="space-y-3 text-sm">
                {dashboard.topPages.map((p) => (
                  <li key={p.path} className="flex items-center justify-between gap-3">
                    <Link href={p.path} className="min-w-0 truncate font-mono text-xs text-ink hover:text-accent">
                      {p.path}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                      {formatNumber(p.clicks)} {p.clicks === 1 ? "click" : "clicks"}
                      {p.conversions > 0 && ` · ${formatNumber(p.conversions)} sold`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">The pages people land on through your link appear here.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <section aria-labelledby="history-heading" className="space-y-4">
        <h2 id="history-heading" className="sr-only">
          History
        </h2>
        <Tabs
          items={[
            { label: "Commissions", value: "commissions", count: dashboard.commissions.length },
            { label: "Payouts", value: "payouts", count: dashboard.payouts.length },
          ]}
        />
        {tab === "commissions" ? (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Purchase</TH>
                  <TH className="hidden sm:table-cell">Date</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Commission</TH>
                </tr>
              </THead>
              <TBody>
                {commissionsPage.rows.length === 0 ? (
                  <TableEmpty colSpan={4}>No commissions yet. Purchases made through your link appear here.</TableEmpty>
                ) : (
                  commissionsPage.rows.map((c) => (
                    <TR key={c.id}>
                      <TD className="max-w-0">
                        <p className="truncate font-medium text-ink">{c.itemTitle}</p>
                        <p className="text-xs text-ink-muted">
                          {c.adjustment ? "Refund adjustment" : "Sale"}
                          <span className="sm:hidden"> · {formatDate(c.createdAt)}</span>
                        </p>
                      </TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(c.createdAt)}</TD>
                      <TD>
                        <CommissionStatusBadge status={c.status} />
                      </TD>
                      <TD className={cn("whitespace-nowrap text-right font-medium tabular-nums", c.amount < 0 ? "text-danger" : "text-ink", c.status === "void" && "text-ink-faint line-through")}>
                        {money(c.amount, c.currency)}
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
            {commissionsPage.pageCount > 1 && (
              <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-ink-muted">
                  Page {commissionsPage.page} of {commissionsPage.pageCount}
                </p>
                <div className="flex gap-2">
                  {commissionsPage.page > 1 && (
                    <ButtonLink href={pageHref(commissionsPage.page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
                      Newer
                    </ButtonLink>
                  )}
                  {commissionsPage.page < commissionsPage.pageCount && (
                    <ButtonLink href={pageHref(commissionsPage.page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
                      Older
                    </ButtonLink>
                  )}
                </div>
              </nav>
            )}
          </>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH className="hidden sm:table-cell">Method</TH>
                <TH className="hidden md:table-cell">Reference</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {dashboard.payouts.length === 0 ? (
                <TableEmpty colSpan={4}>No payouts yet. Approved commissions are paid out to your payout email.</TableEmpty>
              ) : (
                dashboard.payouts.map((p) => (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap">
                      {formatDate(p.createdAt)}
                      <p className="text-xs text-ink-muted sm:hidden">{methodLabel(p.method)}</p>
                    </TD>
                    <TD className="hidden sm:table-cell">{methodLabel(p.method)}</TD>
                    <TD className="hidden font-mono text-xs text-ink-muted md:table-cell">{p.reference ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(p.amount, p.currency)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        )}
      </section>

      <Card>
        <CardHeader title="Payout email" description="We send payouts and payout questions to this address." />
        <CardBody>
          <PayoutEmailForm current={affiliate.payoutEmail} accountEmail={user.email} />
        </CardBody>
      </Card>
    </div>
  );
}
