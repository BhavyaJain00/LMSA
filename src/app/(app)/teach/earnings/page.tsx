import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getInstructorEarnings } from "@/lib/teaching/marketplace";
import { earningFilterQuery, isEarningFilterActive, MARKETPLACE_PAGE_SIZE, monthLabel, parseEarningFilter, type EarningFilter } from "@/lib/teaching/marketplace-shared";
import { methodLabel, paginate } from "@/lib/growth/affiliates-shared";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { BarList } from "@/components/dashboard/charts/bar-list";
import { money } from "@/components/commerce/order-summary";
import { moneyList } from "@/components/growth/affiliate-badges";
import { ListPagination } from "@/components/growth/list-pagination";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { EarningStatusBadge } from "@/components/teaching/marketplace-badges";
import { TeachPayoutEmailForm } from "@/components/teaching/teach-forms";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Earnings", robots: { index: false } };

type Tab = "overview" | "sales" | "payouts";
const TABS: Tab[] = ["overview", "sales", "payouts"];

export default async function TeachEarningsPage(props: PageProps<"/teach/earnings">) {
  const user = await requireUser("/teach/earnings");
  const sp = await props.searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.includes(tabRaw as Tab) ? (tabRaw as Tab) : "overview";
  const filter = parseEarningFilter(sp);
  const [settings, data] = await Promise.all([getSettings(), getInstructorEarnings(user.id, filter)]);
  if (!data) redirect("/teach");
  const currency = settings.commerce.defaultCurrency;
  const pending = data.totals.map((t) => ({ currency: t.currency, amount: t.pending }));
  const paid = data.totals.map((t) => ({ currency: t.currency, amount: t.paid }));
  const sales = data.byCourse.reduce((s, c) => s + c.sales, 0);

  let body: ReactNode;
  let exportHref: string | null = null;
  if (data.totalRows === 0 && tab !== "payouts") {
    body = (
      <EmptyState
        icon={<Icon.BarChart />}
        title="No earnings yet"
        description={
          data.profile.status === "approved"
            ? "When learners buy a course you teach, your share of the sale appears here."
            : "Earnings appear here once your instructor application is approved and your courses sell."
        }
        action={
          <ButtonLink href="/teach" variant="outline">
            Back to Teach
          </ButtonLink>
        }
      />
    );
  } else if (tab === "overview") {
    body = (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By course" description="Sales, unpaid and paid amounts per course." />
          <CardBody className="p-0">
            <Table className="rounded-none border-0">
              <THead>
                <tr>
                  <TH>Course</TH>
                  <TH className="hidden text-right sm:table-cell">Sales</TH>
                  <TH className="text-right">Unpaid</TH>
                  <TH className="hidden text-right sm:table-cell">Paid</TH>
                </tr>
              </THead>
              <TBody>
                {data.byCourse.map((c) => (
                  <TR key={`${c.courseId}-${c.currency}`}>
                    <TD className="max-w-0">
                      <Link href={`/teach/earnings?tab=sales&course=${c.courseId}`} className="block truncate font-medium text-ink hover:underline">
                        {c.courseTitle}
                      </Link>
                      <p className="text-xs text-ink-muted sm:hidden">
                        {formatNumber(c.sales)} sales · {money(c.paid, c.currency)} paid
                      </p>
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(c.sales)}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{money(c.pending, c.currency)}</TD>
                    <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">{money(c.paid, c.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By month" description="What you earned each month, after refund corrections." />
          <CardBody>
            <BarList
              valueLabel="Earnings by month"
              data={data.byMonth.slice(0, 12).map((m) => ({
                id: `${m.month}-${m.currency}`,
                label: `${monthLabel(m.month)} · ${money(m.earned, m.currency)}`,
                value: Math.max(0, m.earned),
                note: `${formatNumber(m.sales)} ${m.sales === 1 ? "sale" : "sales"}`,
                href: `/teach/earnings?tab=sales&from=${m.month}-01&to=${m.month}-31`,
              }))}
            />
          </CardBody>
        </Card>
      </div>
    );
  } else if (tab === "sales") {
    const page = paginate(data.rows, filter.page, MARKETPLACE_PAGE_SIZE);
    exportHref = `/teach/earnings/export?${earningFilterQuery(filter, { type: "earnings" })}`;
    body = (
      <div className="space-y-4">
        <SalesFilters filter={filter} courses={data.courses} />
        <Table>
          <THead>
            <tr>
              <TH>Course</TH>
              <TH className="hidden sm:table-cell">Date</TH>
              <TH className="hidden text-right md:table-cell">Net sale</TH>
              <TH className="text-right">Your share</TH>
              <TH className="hidden sm:table-cell">Status</TH>
            </tr>
          </THead>
          <TBody>
            {page.rows.length === 0 ? (
              <TableEmpty colSpan={5}>
                No earnings match these filters.{" "}
                <Link href="/teach/earnings?tab=sales" className="font-medium text-accent hover:underline">
                  Clear filters
                </Link>
              </TableEmpty>
            ) : (
              page.rows.map((r) => (
                <TR key={r.id}>
                  <TD className="max-w-0">
                    <p className="truncate font-medium text-ink">{r.courseTitle}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {r.adjustment ? "Refund correction" : `Order ${r.orderId}`}
                      <span className="sm:hidden"> · {formatDate(r.createdAt)}</span>
                    </p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(r.createdAt)}</TD>
                  <TD className="hidden whitespace-nowrap text-right tabular-nums text-ink-muted md:table-cell">{r.adjustment ? "—" : money(r.gross, r.currency)}</TD>
                  <TD className="whitespace-nowrap text-right font-medium tabular-nums">
                    {money(r.share, r.currency)}
                    <span className="mt-0.5 block sm:hidden">
                      <EarningStatusBadge status={r.status} />
                    </span>
                  </TD>
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
          href={(p) => `/teach/earnings?${earningFilterQuery(filter, { tab: "sales", ...(p > 1 ? { page: String(p) } : {}) })}`}
        />
      </div>
    );
  } else {
    const page = paginate(data.payouts, filter.page, MARKETPLACE_PAGE_SIZE);
    exportHref = data.payouts.length ? "/teach/earnings/export?type=payouts" : null;
    body = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
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
              {page.rows.length === 0 ? (
                <TableEmpty colSpan={4}>No payouts yet. Unpaid earnings are sent to your payout email.</TableEmpty>
              ) : (
                page.rows.map((p) => (
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
          <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="payouts" href={(p) => `/teach/earnings?tab=payouts${p > 1 ? `&page=${p}` : ""}`} />
        </div>
        <Card className="h-fit">
          <CardHeader title="Payout email" />
          <CardBody>
            <TeachPayoutEmailForm payoutEmail={data.profile.payoutEmail ?? user.email} />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Earnings"
        description={`Your ${data.profile.revenueSharePercent}% share of the net revenue of the courses you teach.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Teach", href: "/teach" }, { label: "Earnings" }]} />}
        actions={
          exportHref ? (
            <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" aria-hidden="true" />
              Export CSV
            </a>
          ) : undefined
        }
      />
      <section aria-label="Earnings summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unpaid" value={<span className="text-xl sm:text-2xl">{moneyList(pending, currency)}</span>} hint="Included in your next payout" icon={<Icon.Clock className="size-5" />} />
        <StatCard label="Paid out" value={<span className="text-xl sm:text-2xl">{moneyList(paid, currency)}</span>} hint={`${formatNumber(data.payouts.length)} payouts`} icon={<Icon.CreditCard className="size-5" />} />
        <StatCard label="Sales" value={formatNumber(sales)} hint={`${formatNumber(data.byCourse.length)} courses`} icon={<Icon.TrendingUp className="size-5" />} />
        <StatCard label="Revenue share" value={`${data.profile.revenueSharePercent}%`} hint="Of net course revenue" icon={<Icon.Percent className="size-5" />} />
      </section>
      <Tabs
        className="mb-5"
        items={[
          { label: "Overview", value: "overview" },
          { label: "Sales", value: "sales" },
          { label: "Payouts", value: "payouts", count: data.payouts.length || undefined },
        ]}
      />
      {body}
    </div>
  );
}

function SalesFilters({ filter, courses }: { filter: EarningFilter; courses: { id: string; title: string }[] }) {
  return (
    <form
      method="get"
      action="/teach/earnings"
      role="search"
      aria-label="Filter earnings"
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_9rem_9.5rem_9.5rem_auto] lg:items-center"
    >
      <input type="hidden" name="tab" value="sales" />
      <label htmlFor="earn-q" className="sr-only">
        Search
      </label>
      <Input id="earn-q" name="q" type="search" defaultValue={filter.q} placeholder="Course or order" leftAddon={<Icon.Search className="size-4" />} />
      <label htmlFor="earn-course" className="sr-only">
        Course
      </label>
      <Select id="earn-course" name="course" defaultValue={filter.courseId} options={[{ value: "", label: "All courses" }, ...courses.map((c) => ({ value: c.id, label: c.title }))]} />
      <label htmlFor="earn-status" className="sr-only">
        Status
      </label>
      <Select
        id="earn-status"
        name="status"
        defaultValue={filter.status}
        options={[
          { value: "all", label: "All statuses" },
          { value: "pending", label: "Unpaid" },
          { value: "paid", label: "Paid" },
          { value: "void", label: "Void" },
        ]}
      />
      <label htmlFor="earn-from" className="sr-only">
        From date
      </label>
      <Input id="earn-from" name="from" type="date" defaultValue={filter.from} />
      <label htmlFor="earn-to" className="sr-only">
        To date
      </label>
      <Input id="earn-to" name="to" type="date" defaultValue={filter.to} />
      <div className="flex gap-2">
        <button type="submit" className={buttonClasses({ variant: "outline" })}>
          Apply
        </button>
        {isEarningFilterActive(filter) && (
          <Link href="/teach/earnings?tab=sales" className={buttonClasses({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
