import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import {
  getEarningFilterOptions,
  getMarketplaceOverview,
  listEarnings,
  listInstructorPayouts,
  listInstructorProfiles,
  listPayableInstructors,
} from "@/lib/teaching/marketplace";
import {
  earningFilterQuery,
  isEarningFilterActive,
  MARKETPLACE_PAGE_SIZE,
  parseApplicationFilter,
  parseEarningFilter,
  type ApplicationFilter,
  type EarningFilter,
} from "@/lib/teaching/marketplace-shared";
import { methodLabel, pageParam, paginate } from "@/lib/growth/affiliates-shared";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { moneyList } from "@/components/growth/affiliate-badges";
import { ListPagination } from "@/components/growth/list-pagination";
import { ApplicationStatusBadge, EarningStatusBadge } from "@/components/teaching/marketplace-badges";
import { InstructorReviewButtons, MarketplaceSettingsForm, PayableInstructorsTable } from "@/components/teaching/marketplace-admin";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata = { title: "Instructor marketplace" };

type Tab = "instructors" | "earnings" | "payouts" | "settings";
const TABS: Tab[] = ["instructors", "earnings", "payouts", "settings"];

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === "all") continue;
    if (key === "page" && value === 1) continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `/admin/marketplace?${s}` : "/admin/marketplace";
}

export default async function AdminMarketplacePage(props: PageProps<"/admin/marketplace">) {
  await requireRole(["admin"], "/admin/marketplace");
  const sp = await props.searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "instructors";
  const [settings, overview] = await Promise.all([getSettings(), getMarketplaceOverview()]);
  const m = settings.marketplace;
  const currency = settings.commerce.defaultCurrency;

  let body: ReactNode;
  let exportLink: string | null = null;

  if (tab === "instructors") {
    const filter = parseApplicationFilter(sp);
    const all = await listInstructorProfiles(filter);
    const page = paginate(all, filter.page, MARKETPLACE_PAGE_SIZE);
    const filtered = filter.status !== "all" || !!filter.q;
    body =
      overview.applied + overview.approved + overview.rejected === 0 ? (
        <EmptyState
          icon={<Icon.Presentation />}
          title="No instructor applications yet"
          description={
            m.enabled && m.allowApplications
              ? "Members apply from the Teach page in their sidebar. Applications appear here for review."
              : "Turn on the marketplace and applications in the Settings tab so members can apply to teach."
          }
          action={
            <ButtonLink href={query({ tab: "settings" })} variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
              Marketplace settings
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <InstructorFilters filter={filter} />
          <Table>
            <THead>
              <tr>
                <TH>Member</TH>
                <TH className="hidden lg:table-cell">Subjects</TH>
                <TH className="hidden md:table-cell">Share</TH>
                <TH className="hidden sm:table-cell">Unpaid</TH>
                <TH>Status</TH>
                <TH className="w-40">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {page.rows.length === 0 ? (
                <TableEmpty colSpan={6}>
                  No instructors match these filters.{" "}
                  {filtered && (
                    <Link href="/admin/marketplace" className="font-medium text-accent hover:underline">
                      Clear filters
                    </Link>
                  )}
                </TableEmpty>
              ) : (
                page.rows.map((row) => (
                  <TR key={row.profile.id}>
                    <TD className="max-w-0 w-[45%] md:w-[30%]">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={row.user?.name ?? "?"} src={row.user?.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/admin/marketplace/${row.profile.id}`} className="block truncate font-medium text-ink hover:underline">
                            {row.user?.name ?? "Deleted member"}
                          </Link>
                          <p className="truncate text-xs text-ink-muted">
                            {row.user?.email} · {row.profile.status === "applied" ? `applied ${formatDate(row.profile.createdAt)}` : `${row.courseCount} courses`}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden max-w-0 lg:table-cell">
                      <p className="truncate text-sm text-ink-muted">{row.application.expertise.join(", ") || "—"}</p>
                    </TD>
                    <TD className="hidden tabular-nums md:table-cell">{row.profile.revenueSharePercent}%</TD>
                    <TD className="hidden whitespace-nowrap tabular-nums sm:table-cell">{moneyList(row.balances, currency)}</TD>
                    <TD>
                      <ApplicationStatusBadge status={row.profile.status} />
                    </TD>
                    <TD>
                      {row.profile.status === "applied" ? (
                        <InstructorReviewButtons
                          compact
                          target={{ id: row.profile.id, name: row.user?.name ?? "this member", status: row.profile.status, sharePercent: row.profile.revenueSharePercent }}
                        />
                      ) : (
                        <div className="flex justify-end">
                          <ButtonLink href={`/admin/marketplace/${row.profile.id}`} variant="ghost" size="xs">
                            Open
                          </ButtonLink>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
          <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="members" href={(p) => query({ status: filter.status, q: filter.q, page: p })} />
        </div>
      );
  } else if (tab === "earnings") {
    const filter = parseEarningFilter(sp);
    const [all, options] = await Promise.all([listEarnings(filter), getEarningFilterOptions()]);
    const page = paginate(all, filter.page, MARKETPLACE_PAGE_SIZE);
    exportLink = `/admin/marketplace/export?${earningFilterQuery(filter, { type: "earnings" })}`;
    body = (
      <div className="space-y-4">
        <EarningFilters filter={filter} options={options} />
        <Table>
          <THead>
            <tr>
              <TH>Instructor</TH>
              <TH className="hidden md:table-cell">Course</TH>
              <TH className="hidden lg:table-cell">Date</TH>
              <TH className="hidden text-right lg:table-cell">Net sale</TH>
              <TH className="text-right">Share</TH>
              <TH className="hidden sm:table-cell">Status</TH>
            </tr>
          </THead>
          <TBody>
            {page.rows.length === 0 ? (
              <TableEmpty colSpan={6}>
                {isEarningFilterActive(filter) ? "No earnings match these filters." : "No earnings yet. Sales of courses taught by approved instructors appear here."}
              </TableEmpty>
            ) : (
              page.rows.map((r) => (
                <TR key={r.id}>
                  <TD className="max-w-0">
                    <p className="truncate font-medium text-ink">{r.instructorName}</p>
                    <p className="truncate text-xs text-ink-muted">
                      <span className="md:hidden">{r.courseTitle} · </span>
                      {r.adjustment ? "Refund correction" : `Order ${r.orderId}`}
                    </p>
                  </TD>
                  <TD className="hidden max-w-0 truncate md:table-cell">{r.courseTitle}</TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(r.createdAt)}</TD>
                  <TD className="hidden whitespace-nowrap text-right tabular-nums text-ink-muted lg:table-cell">{r.adjustment ? "—" : money(r.gross, r.currency)}</TD>
                  <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.share, r.currency)}</TD>
                  <TD className="hidden sm:table-cell">
                    <EarningStatusBadge status={r.status} />
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
        <ListPagination
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          noun="earnings"
          href={(p) => `/admin/marketplace?${earningFilterQuery(filter, { tab: "earnings", ...(p > 1 ? { page: String(p) } : {}) })}`}
        />
      </div>
    );
  } else if (tab === "payouts") {
    const [payable, payouts] = await Promise.all([listPayableInstructors(), listInstructorPayouts()]);
    const page = paginate(payouts, pageParam(sp), MARKETPLACE_PAGE_SIZE);
    exportLink = payouts.length ? "/admin/marketplace/export?type=payouts" : null;
    body = (
      <div className="space-y-8">
        <section aria-labelledby="payable-title" className="space-y-3">
          <h2 id="payable-title" className="text-base font-semibold text-ink">
            Unpaid balances
          </h2>
          <PayableInstructorsTable
            fallbackCurrency={currency}
            rows={payable.map((r) => ({
              instructorId: r.profile.userId,
              profileId: r.profile.id,
              name: r.user?.name ?? "Deleted member",
              avatarUrl: r.user?.avatarUrl,
              payTo: r.profile.payoutEmail ?? r.user?.email ?? "no email on file",
              balances: r.balances,
            }))}
          />
        </section>
        <section aria-labelledby="history-title" className="space-y-3">
          <h2 id="history-title" className="text-base font-semibold text-ink">
            Payout history
          </h2>
          <Table>
            <THead>
              <tr>
                <TH>Instructor</TH>
                <TH className="hidden sm:table-cell">Date</TH>
                <TH className="hidden md:table-cell">Method</TH>
                <TH className="hidden lg:table-cell">Reference</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {page.rows.length === 0 ? (
                <TableEmpty colSpan={5}>No payouts yet.</TableEmpty>
              ) : (
                page.rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="max-w-0">
                      <p className="truncate font-medium text-ink">{p.instructorName}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {p.payTo}
                        <span className="sm:hidden"> · {formatDate(p.createdAt)}</span>
                      </p>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(p.createdAt)}</TD>
                    <TD className="hidden md:table-cell">{methodLabel(p.method)}</TD>
                    <TD className="hidden font-mono text-xs text-ink-muted lg:table-cell">{p.reference ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(p.amount, p.currency)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
          <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="payouts" href={(p) => query({ tab: "payouts", page: p })} />
        </section>
      </div>
    );
  } else {
    body = <MarketplaceSettingsForm initial={m} />;
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Instructor marketplace"
        description="Review applications to teach, set revenue shares, and pay instructors their share of course sales."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Settings", href: "/admin/settings" }, { label: "Instructors & payouts" }]} />}
        actions={
          exportLink ? (
            <a href={exportLink} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" aria-hidden="true" />
              Export CSV
            </a>
          ) : undefined
        }
      />
      {!m.enabled && tab !== "settings" && (
        <div role="status" className="mb-5 flex gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            The marketplace is off: members can&apos;t apply and new sales earn instructors nothing.{" "}
            <Link href={query({ tab: "settings" })} className="font-medium underline">
              Turn it on
            </Link>
          </p>
        </div>
      )}
      <section aria-label="Marketplace summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Instructors" value={formatNumber(overview.approved)} hint={overview.rejected ? `${overview.rejected} declined or suspended` : "Approved to teach"} icon={<Icon.Presentation className="size-5" />} />
        <StatCard
          label="Awaiting review"
          value={formatNumber(overview.applied)}
          hint={overview.applied ? <Link href={query({ status: "applied" })} className="hover:underline">Review applications</Link> : "All caught up"}
          icon={<Icon.ClipboardList className="size-5" />}
        />
        <StatCard label="Unpaid earnings" value={<span className="text-xl sm:text-2xl">{moneyList(overview.pendingTotals, currency)}</span>} hint={`${formatNumber(overview.sales30)} sales in 30 days`} icon={<Icon.Clock className="size-5" />} />
        <StatCard label="Paid out" value={<span className="text-xl sm:text-2xl">{moneyList(overview.paidTotals, currency)}</span>} hint="All time" icon={<Icon.CreditCard className="size-5" />} />
      </section>
      <Tabs
        className="mb-5"
        items={[
          { label: "Instructors", value: "instructors", count: overview.applied || undefined },
          { label: "Earnings", value: "earnings" },
          { label: "Payouts", value: "payouts" },
          { label: "Settings", value: "settings" },
        ]}
      />
      {body}
    </div>
  );
}

function InstructorFilters({ filter }: { filter: ApplicationFilter }) {
  return (
    <form method="get" action="/admin/marketplace" role="search" aria-label="Filter instructors" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center">
      <label htmlFor="mkt-q" className="sr-only">
        Search instructors
      </label>
      <Input id="mkt-q" name="q" type="search" defaultValue={filter.q} placeholder="Name, email or subject" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="mkt-status" className="sr-only">
        Status
      </label>
      <Select
        id="mkt-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All statuses" },
          { value: "applied", label: "Awaiting review" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Declined or suspended" },
        ]}
      />
      <button type="submit" className={buttonClasses({ variant: "outline" })}>
        Apply
      </button>
    </form>
  );
}

function EarningFilters({ filter, options }: { filter: EarningFilter; options: { courses: { id: string; title: string }[]; instructors: { id: string; name: string }[] } }) {
  return (
    <form
      method="get"
      action="/admin/marketplace"
      role="search"
      aria-label="Filter earnings"
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_8.5rem_9.5rem_9.5rem_auto] lg:items-center"
    >
      <input type="hidden" name="tab" value="earnings" />
      <label htmlFor="me-q" className="sr-only">
        Search earnings
      </label>
      <Input id="me-q" name="q" type="search" defaultValue={filter.q} placeholder="Course, instructor or order" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="me-instructor" className="sr-only">
        Instructor
      </label>
      <Select id="me-instructor" name="instructor" defaultValue={filter.instructorId} options={[{ value: "", label: "All instructors" }, ...options.instructors.map((i) => ({ value: i.id, label: i.name }))]} />
      <label htmlFor="me-course" className="sr-only">
        Course
      </label>
      <Select id="me-course" name="course" defaultValue={filter.courseId} options={[{ value: "", label: "All courses" }, ...options.courses.map((c) => ({ value: c.id, label: c.title }))]} />
      <label htmlFor="me-status" className="sr-only">
        Status
      </label>
      <Select
        id="me-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All statuses" },
          { value: "pending", label: "Unpaid" },
          { value: "paid", label: "Paid" },
          { value: "void", label: "Void" },
        ]}
      />
      <label htmlFor="me-from" className="sr-only">
        From date
      </label>
      <Input id="me-from" name="from" type="date" defaultValue={filter.from} />
      <label htmlFor="me-to" className="sr-only">
        To date
      </label>
      <Input id="me-to" name="to" type="date" defaultValue={filter.to} />
      <button type="submit" className={buttonClasses({ variant: "outline" })}>
        Apply
      </button>
    </form>
  );
}
