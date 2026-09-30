import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { ADMIN_PAGE_SIZE, getAffiliateOverview, listAffiliatePayouts, listAffiliates, listCommissions } from "@/lib/growth/affiliates";
import { methodLabel, paginate, parseAffiliateFilter, parseCommissionFilter, type AffiliateFilter, type CommissionFilter } from "@/lib/growth/affiliates-shared";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { AffiliateRowActions, AffiliateSettingsForm } from "@/components/growth/affiliate-admin";
import { AffiliateStatusBadge, moneyList } from "@/components/growth/affiliate-badges";
import { CommissionsTable } from "@/components/growth/commissions-table";
import { ListPagination } from "@/components/growth/list-pagination";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Affiliates" };

type Tab = "affiliates" | "commissions" | "payouts" | "settings";
const TABS: Tab[] = ["affiliates", "commissions", "payouts", "settings"];

function query(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false || value === "all") continue;
    if (key === "page" && value === 1) continue;
    qs.set(key, value === true ? "1" : String(value));
  }
  const s = qs.toString();
  return s ? `/admin/affiliates?${s}` : "/admin/affiliates";
}

export default async function AdminAffiliatesPage(props: PageProps<"/admin/affiliates">) {
  await requireRole(["admin"], "/admin/affiliates");
  const sp = await props.searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "affiliates";
  const [settings, overview] = await Promise.all([getSettings(), getAffiliateOverview()]);
  const currency = settings.commerce.defaultCurrency;
  const exportHref = (type: string, extra: string) => `/admin/affiliates/export?type=${type}${extra ? `&${extra}` : ""}`;

  let body: ReactNode;
  let exportLink: string | null = null;

  if (tab === "affiliates") {
    const filter = parseAffiliateFilter(sp);
    const all = await listAffiliates(filter);
    const page = paginate(all, filter.page, ADMIN_PAGE_SIZE);
    const href = (p: number) => query({ status: filter.status, q: filter.q, flagged: filter.flagged, page: p });
    const filtered = filter.status !== "all" || !!filter.q || filter.flagged;
    exportLink = exportHref("affiliates", new URLSearchParams({ status: filter.status, q: filter.q, ...(filter.flagged ? { flagged: "1" } : {}) }).toString());
    body =
      overview.active + overview.pending + overview.paused === 0 ? (
        <EmptyState
          icon={<Icon.Handshake />}
          title="No affiliates yet"
          description={
            settings.growth.affiliatesEnabled
              ? "Members join from the Affiliate page in their sidebar. Their applications, clicks and sales appear here."
              : "The affiliate program is off. Turn it on in the Settings tab so members can join."
          }
          action={
            <ButtonLink href={query({ tab: "settings" })} variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
              Program settings
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <AffiliateFilters filter={filter} />
          <Table>
            <THead>
              <tr>
                <TH>Affiliate</TH>
                <TH className="hidden md:table-cell">Code</TH>
                <TH className="hidden lg:table-cell">Clicks</TH>
                <TH className="hidden sm:table-cell">Sales</TH>
                <TH className="hidden lg:table-cell">Payable</TH>
                <TH>Status</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {page.rows.length === 0 ? (
                <TableEmpty colSpan={7}>
                  No affiliates match these filters.{" "}
                  {filtered && (
                    <Link href="/admin/affiliates" className="font-medium text-accent hover:underline">
                      Clear filters
                    </Link>
                  )}
                </TableEmpty>
              ) : (
                page.rows.map((row) => (
                  <TR key={row.affiliate.id}>
                    <TD className="max-w-0 w-[45%] md:w-[30%]">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={row.user?.name ?? "?"} src={row.user?.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/admin/affiliates/${row.affiliate.id}`} className="block truncate font-medium text-ink hover:underline">
                            {row.user?.name ?? "Deleted member"}
                          </Link>
                          <p className="truncate text-xs text-ink-muted">
                            <span className="font-mono md:hidden">{row.affiliate.code} · </span>
                            {row.user?.email}
                          </p>
                          {row.flagged > 0 && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-danger">
                              <Icon.AlertTriangle className="size-3" aria-hidden="true" />
                              {row.flagged} flagged {row.flagged === 1 ? "sale" : "sales"}
                            </p>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <span className="font-mono text-xs">{row.affiliate.code}</span>
                      <p className="text-xs text-ink-muted">{row.affiliate.commissionPercent}%</p>
                    </TD>
                    <TD className="hidden tabular-nums lg:table-cell">{formatNumber(row.stats.clicks)}</TD>
                    <TD className="hidden tabular-nums sm:table-cell">
                      {formatNumber(row.stats.conversions)}
                      <p className="text-xs text-ink-muted">{row.stats.conversionRate}% of clicks</p>
                    </TD>
                    <TD className="hidden whitespace-nowrap tabular-nums lg:table-cell">{moneyList(row.stats.payable, currency)}</TD>
                    <TD>
                      <AffiliateStatusBadge status={row.affiliate.status} />
                    </TD>
                    <TD>
                      <AffiliateRowActions
                        affiliate={{ id: row.affiliate.id, code: row.affiliate.code, status: row.affiliate.status }}
                        payout={{
                          affiliateId: row.affiliate.id,
                          name: row.user?.name ?? row.affiliate.code,
                          code: row.affiliate.code,
                          payTo: row.affiliate.payoutEmail ?? row.user?.email ?? "no email on file",
                          balances: row.stats.payable,
                        }}
                      />
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
          <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="affiliates" href={href} />
        </div>
      );
  } else if (tab === "commissions") {
    const filter = parseCommissionFilter(sp);
    const all = await listCommissions(filter);
    const page = paginate(all, filter.page, ADMIN_PAGE_SIZE);
    const href = (p: number) =>
      query({ tab: "commissions", status: filter.status, q: filter.q, flagged: filter.flagged, from: filter.from, to: filter.to, affiliate: filter.affiliateId, page: p });
    const params = new URLSearchParams();
    if (filter.status !== "all") params.set("status", filter.status);
    if (filter.q) params.set("q", filter.q);
    if (filter.flagged) params.set("flagged", "1");
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    if (filter.affiliateId) params.set("affiliate", filter.affiliateId);
    exportLink = exportHref("commissions", params.toString());
    body = (
      <div className="space-y-4">
        <CommissionFilters filter={filter} />
        <CommissionsTable
          key={`${filter.status}-${filter.q}-${filter.flagged}-${filter.from}-${filter.to}-${filter.affiliateId}-${page.page}`}
          rows={page.rows}
          emptyText={all.length === 0 && filter.status === "all" && !filter.q && !filter.flagged ? "No commissions yet. Sales through affiliate links appear here." : "No commissions match these filters."}
        />
        <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="commissions" href={href} />
      </div>
    );
  } else if (tab === "payouts") {
    const payouts = await listAffiliatePayouts();
    const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
    const page = paginate(payouts, Number.isInteger(pageRaw) ? pageRaw : 1, ADMIN_PAGE_SIZE);
    exportLink = payouts.length ? exportHref("payouts", "") : null;
    body = (
      <div className="space-y-4">
        <Table>
          <THead>
            <tr>
              <TH>Affiliate</TH>
              <TH className="hidden sm:table-cell">Date</TH>
              <TH className="hidden md:table-cell">Method</TH>
              <TH className="hidden lg:table-cell">Reference</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {page.rows.length === 0 ? (
              <TableEmpty colSpan={5}>No payouts yet. Use “Record payout” on an affiliate with an approved balance.</TableEmpty>
            ) : (
              page.rows.map((r) => (
                <TR key={r.payout.id}>
                  <TD className="max-w-0">
                    <Link href={`/admin/affiliates/${r.payout.affiliateId}`} className="block truncate font-medium text-ink hover:underline">
                      {r.affiliateName}
                    </Link>
                    <p className="truncate text-xs text-ink-muted">
                      <span className="font-mono">{r.affiliateCode}</span>
                      <span className="sm:hidden"> · {formatDate(r.payout.createdAt)}</span>
                    </p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(r.payout.createdAt)}</TD>
                  <TD className="hidden md:table-cell">{methodLabel(r.payout.method)}</TD>
                  <TD className="hidden font-mono text-xs text-ink-muted lg:table-cell">{r.payout.reference ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.payout.amount, r.payout.currency)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
        <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="payouts" href={(p) => query({ tab: "payouts", page: p })} />
      </div>
    );
  } else {
    const g = settings.growth;
    body = (
      <AffiliateSettingsForm
        initial={{ affiliatesEnabled: g.affiliatesEnabled, affiliateAutoApprove: g.affiliateAutoApprove, defaultCommissionPercent: g.defaultCommissionPercent, cookieDays: g.cookieDays }}
      />
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Affiliates"
        description="Members who promote your courses: their clicks and sales, the commissions they earned, and the payouts you sent."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Affiliates" }]} />}
        actions={
          exportLink ? (
            <a href={exportLink} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" aria-hidden="true" />
              Export CSV
            </a>
          ) : undefined
        }
      />

      {!settings.growth.affiliatesEnabled && tab !== "settings" && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            The affiliate program is off: members can&apos;t join and new sales earn no commissions.{" "}
            <Link href={query({ tab: "settings" })} className="font-medium underline">
              Turn it on
            </Link>
          </p>
        </div>
      )}
      {overview.flaggedUnpaid > 0 && tab !== "settings" && (
        <div role="alert" className="mb-5 flex gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            {overview.flaggedUnpaid} unpaid {overview.flaggedUnpaid === 1 ? "commission looks" : "commissions look"} like a possible self-referral.{" "}
            <Link href={query({ tab: "commissions", flagged: true })} className="font-medium underline">
              Review flagged commissions
            </Link>
          </p>
        </div>
      )}

      <section aria-label="Program summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active affiliates"
          value={formatNumber(overview.active)}
          hint={overview.pending ? `${overview.pending} awaiting review` : overview.paused ? `${overview.paused} paused` : "Earning on new sales"}
          icon={<Icon.Handshake className="size-5" />}
        />
        <StatCard label="Clicks (30 days)" value={formatNumber(overview.clicks30)} hint={`${formatNumber(overview.conversions30)} sales credited`} icon={<Icon.Link className="size-5" />} />
        <StatCard
          label="Awaiting approval"
          value={<span className="text-xl sm:text-2xl">{moneyList(overview.pendingTotals, currency)}</span>}
          hint="Pending commissions"
          icon={<Icon.Clock className="size-5" />}
        />
        <StatCard
          label="Payable"
          value={<span className="text-xl sm:text-2xl">{moneyList(overview.payableTotals, currency)}</span>}
          hint={overview.paidTotals.length ? `${moneyList(overview.paidTotals, currency)} paid so far` : "Nothing paid yet"}
          icon={<Icon.CreditCard className="size-5" />}
        />
      </section>

      <Tabs
        className="mb-5"
        items={[
          { label: "Affiliates", value: "affiliates", count: overview.pending || undefined },
          { label: "Commissions", value: "commissions" },
          { label: "Payouts", value: "payouts" },
          { label: "Settings", value: "settings" },
        ]}
      />
      {body}
    </div>
  );
}

function AffiliateFilters({ filter }: { filter: AffiliateFilter }) {
  return (
    <form method="get" action="/admin/affiliates" role="search" aria-label="Filter affiliates" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto_auto] sm:items-center">
      <label htmlFor="aff-q" className="sr-only">
        Search affiliates
      </label>
      <Input id="aff-q" name="q" type="search" defaultValue={filter.q} placeholder="Search name, email or code" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="aff-status" className="sr-only">
        Status
      </label>
      <Select
        id="aff-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All statuses" },
          { value: "pending", label: "Awaiting review" },
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
        ]}
      />
      <Checkbox name="flagged" value="1" defaultChecked={filter.flagged} label="Flagged only" id="aff-flagged" />
      <button type="submit" className={buttonClasses({ variant: "outline" })}>
        Apply
      </button>
    </form>
  );
}

function CommissionFilters({ filter }: { filter: CommissionFilter }) {
  return (
    <form method="get" action="/admin/affiliates" role="search" aria-label="Filter commissions" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_9.5rem_9.5rem_auto_auto] lg:items-center">
      <input type="hidden" name="tab" value="commissions" />
      {filter.affiliateId && <input type="hidden" name="affiliate" value={filter.affiliateId} />}
      <label htmlFor="com-q" className="sr-only">
        Search commissions
      </label>
      <Input id="com-q" name="q" type="search" defaultValue={filter.q} placeholder="Order, item, buyer or affiliate" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="com-status" className="sr-only">
        Status
      </label>
      <Select
        id="com-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All statuses" },
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "paid", label: "Paid" },
          { value: "void", label: "Void" },
        ]}
      />
      <label htmlFor="com-from" className="sr-only">
        From date
      </label>
      <Input id="com-from" name="from" type="date" defaultValue={filter.from} />
      <label htmlFor="com-to" className="sr-only">
        To date
      </label>
      <Input id="com-to" name="to" type="date" defaultValue={filter.to} />
      <Checkbox name="flagged" value="1" defaultChecked={filter.flagged} label="Flagged only" id="com-flagged" />
      <button type="submit" className={buttonClasses({ variant: "outline" })}>
        Apply
      </button>
    </form>
  );
}
