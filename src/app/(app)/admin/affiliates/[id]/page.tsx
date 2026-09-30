import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { ADMIN_PAGE_SIZE, getAdminAffiliate, listAffiliatePayouts, listCommissions, listReferralClicks } from "@/lib/growth/affiliates";
import { methodLabel, paginate } from "@/lib/growth/affiliates-shared";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { AffiliateEditForm, AffiliateRowActions, PayoutButton } from "@/components/growth/affiliate-admin";
import { AffiliateStatusBadge, moneyList } from "@/components/growth/affiliate-badges";
import { CommissionsTable } from "@/components/growth/commissions-table";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/affiliates/[id]">) {
  const { id } = await props.params;
  const row = await getAdminAffiliate(id);
  return { title: row ? `Affiliate ${row.affiliate.code}` : "Affiliate not found" };
}

export default async function AdminAffiliatePage(props: PageProps<"/admin/affiliates/[id]">) {
  const { id } = await props.params;
  await requireRole(["admin"], `/admin/affiliates/${id}`);
  const sp = await props.searchParams;
  const row = await getAdminAffiliate(id);
  if (!row) notFound();

  const [settings, commissions, payouts, clicks] = await Promise.all([
    getSettings(),
    listCommissions({ status: "all", affiliateId: id, q: "", flagged: false, from: "", to: "" }),
    listAffiliatePayouts(id),
    listReferralClicks(id),
  ]);
  const currency = settings.commerce.defaultCurrency;
  const { affiliate, user, stats } = row;
  const name = user?.name ?? "Deleted member";
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  const page = paginate(commissions, Number.isInteger(pageRaw) ? pageRaw : 1, ADMIN_PAGE_SIZE);
  const pageHref = (p: number) => (p > 1 ? `/admin/affiliates/${id}?page=${p}` : `/admin/affiliates/${id}`);
  const payout = { affiliateId: id, name, code: affiliate.code, payTo: affiliate.payoutEmail ?? user?.email ?? "no email on file", balances: stats.payable };

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name}
            <AffiliateStatusBadge status={affiliate.status} />
          </span>
        }
        description={
          <>
            Code <span className="font-mono font-medium text-ink">{affiliate.code}</span> · {affiliate.commissionPercent}% commission · joined {formatDate(affiliate.createdAt)}
          </>
        }
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Affiliates", href: "/admin/affiliates" }, { label: affiliate.code }]} />}
        actions={
          <>
            <PayoutButton payout={payout} />
            <AffiliateRowActions affiliate={{ id, code: affiliate.code, status: affiliate.status }} payout={payout} detail />
          </>
        }
      />

      {row.flagged > 0 && (
        <div role="alert" className="flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            {row.flagged} unpaid {row.flagged === 1 ? "commission is" : "commissions are"} flagged as a possible self-referral (highlighted below). Void them unless you know the buyer is
            someone else.
          </p>
        </div>
      )}

      <section aria-label="Performance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clicks" value={formatNumber(stats.clicks)} hint={`${formatNumber(stats.clicks30)} in the last 30 days`} icon={<Icon.Link className="size-5" />} />
        <StatCard label="Sign-ups" value={formatNumber(stats.signups)} hint="New accounts after a click" icon={<Icon.UserPlus className="size-5" />} />
        <StatCard label="Sales" value={formatNumber(stats.conversions)} hint={`${stats.conversionRate}% of clicks`} icon={<Icon.CreditCard className="size-5" />} />
        <StatCard
          label="Payable"
          value={<span className="text-xl sm:text-2xl">{moneyList(stats.payable, currency)}</span>}
          hint={`${moneyList(stats.totals.map((t) => ({ currency: t.currency, amount: t.pending })), currency)} pending`}
          icon={<Icon.Clock className="size-5" />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="commissions-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="commissions-heading" className="text-base font-semibold text-ink">
                Commissions
              </h2>
              {commissions.length > 0 && (
                <a href={`/admin/affiliates/export?type=commissions&affiliate=${encodeURIComponent(id)}`} className={buttonClasses({ variant: "ghost", size: "sm" })} download>
                  <Icon.Download className="size-4" aria-hidden="true" />
                  CSV
                </a>
              )}
            </div>
            <CommissionsTable key={page.page} rows={page.rows} showAffiliate={false} emptyText="No commissions yet. Sales through this affiliate's links appear here." />
            {page.pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
                <p className="text-ink-muted">
                  Page {page.page} of {page.pageCount}
                </p>
                <div className="flex gap-2">
                  {page.page > 1 && (
                    <ButtonLink href={pageHref(page.page - 1)} variant="outline" size="sm">
                      Newer
                    </ButtonLink>
                  )}
                  {page.page < page.pageCount && (
                    <ButtonLink href={pageHref(page.page + 1)} variant="outline" size="sm">
                      Older
                    </ButtonLink>
                  )}
                </div>
              </nav>
            )}
          </section>

          <section aria-labelledby="clicks-heading" className="space-y-3">
            <h2 id="clicks-heading" className="text-base font-semibold text-ink">
              Recent clicks <span className="font-normal text-ink-muted">({formatNumber(clicks.total)} total)</span>
            </h2>
            <Table>
              <THead>
                <tr>
                  <TH>Landing page</TH>
                  <TH className="hidden sm:table-cell">When</TH>
                  <TH>Result</TH>
                </tr>
              </THead>
              <TBody>
                {clicks.rows.length === 0 ? (
                  <TableEmpty colSpan={3}>No clicks yet.</TableEmpty>
                ) : (
                  clicks.rows.map((c) => (
                    <TR key={c.id}>
                      <TD className="max-w-0">
                        <Link href={c.landingPath} className="block truncate font-mono text-xs text-ink hover:text-accent">
                          {c.landingPath}
                        </Link>
                        <p className="text-xs text-ink-muted sm:hidden">{relativeTime(c.createdAt)}</p>
                      </TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell" title={formatDateTime(c.createdAt)}>
                        {relativeTime(c.createdAt)}
                      </TD>
                      <TD className="whitespace-nowrap text-sm">{c.convertedPaymentId ? <span className="font-medium text-success">Purchase</span> : <span className="text-ink-muted">Visit</span>}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Member" />
            <CardBody>
              <div className="flex items-center gap-3">
                <Avatar name={name} src={user?.avatarUrl} />
                <div className="min-w-0">
                  {user ? (
                    <Link href={`/user/${user.username}`} className="block truncate font-medium text-ink hover:underline">
                      {user.name}
                    </Link>
                  ) : (
                    <p className="font-medium text-ink">{name}</p>
                  )}
                  <p className="truncate text-sm text-ink-muted">{user?.email}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <DetailItem label="Payout email">{affiliate.payoutEmail ?? "Account email"}</DetailItem>
                <DetailItem label="Paid so far">{moneyList(stats.totals.map((t) => ({ currency: t.currency, amount: t.paid })), currency)}</DetailItem>
              </dl>
            </CardBody>
          </Card>

          <AffiliateEditForm affiliate={affiliate} />

          <Card>
            <CardHeader title="Payouts" />
            <CardBody className="p-0">
              {payouts.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">No payouts yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {payouts.map((p) => (
                    <li key={p.payout.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-ink">{formatDate(p.payout.createdAt)}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {methodLabel(p.payout.method)}
                          {p.payout.reference ? ` · ${p.payout.reference}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">{money(p.payout.amount, p.payout.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
