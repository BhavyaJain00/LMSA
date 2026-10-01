import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getAdminLeads } from "@/lib/seo/lead-capture";
import { type LeadStatus, leadSourceLabel, leadStatus } from "@/lib/seo/leads";
import { parsePageParam } from "@/lib/seo/landing";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { LeadsTable } from "@/components/marketing/admin/leads-table";
import { PageLinks } from "@/components/gamification/page-links";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Leads" };

const BASE = "/admin/leads";
type StatusFilter = LeadStatus | "all";
const STATUSES: StatusFilter[] = ["all", "confirmed", "pending", "unsubscribed"];

interface ListState {
  status: StatusFilter;
  q: string;
  source: string;
  course: string;
  from: string;
  to: string;
  page?: number;
}

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, 200);
}

function dateParam(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function query(state: ListState): string {
  const params = new URLSearchParams();
  if (state.status !== "all") params.set("status", state.status);
  for (const key of ["q", "source", "course", "from", "to"] as const) if (state[key]) params.set(key, state[key]);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  return params.toString();
}

function hrefFor(state: ListState): string {
  const q = query(state);
  return q ? `${BASE}?${q}` : BASE;
}

/**
 * Marketing leads (admins): sign-up stats (status, confirmation rate, last
 * 7/30 days, sources, daily trend), a filterable list (status, source,
 * course, dates, search) with bulk resend/delete, and a CSV export of the
 * filtered list.
 */
export default async function AdminLeadsPage(props: PageProps<"/admin/leads">) {
  await requireRole(["admin"], BASE);
  const sp = await props.searchParams;
  const rawStatus = first(sp.status) as StatusFilter;
  const state: ListState = {
    status: STATUSES.includes(rawStatus) ? rawStatus : "all",
    q: first(sp.q),
    source: first(sp.source),
    course: first(sp.course),
    from: dateParam(first(sp.from)),
    to: dateParam(first(sp.to)),
  };
  const list = await getAdminLeads({
    status: state.status,
    search: state.q,
    source: state.source || undefined,
    courseId: state.course || undefined,
    from: state.from || undefined,
    to: state.to || undefined,
    page: parsePageParam(sp.page),
  });
  const { stats } = list;
  const filtered = state.status !== "all" || !!state.q || !!state.source || !!state.course || !!state.from || !!state.to;
  const exportQuery = query({ ...state, page: undefined });
  const peak = Math.max(1, ...stats.daily.map((d) => d.count));
  const counts: Record<StatusFilter, number> = { all: stats.total, confirmed: stats.confirmed, pending: stats.pending, unsubscribed: stats.unsubscribed };
  const tabLabels: Record<StatusFilter, string> = { all: "All", confirmed: "Confirmed", pending: "Awaiting confirmation", unsubscribed: "Unsubscribed" };

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Leads" }]} />}
        title="Leads"
        description="People who subscribed through the lead forms. Only confirmed leads (double opt-in) receive broadcasts and email sequences."
        actions={
          <>
            <ButtonLink href="/free" variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              Free resources page
            </ButtonLink>
            {stats.total > 0 && (
              <a href={`${BASE}/export${exportQuery ? `?${exportQuery}` : ""}`} className={buttonClasses({ variant: "outline" })} download>
                <Icon.Download className="size-4" aria-hidden="true" />
                Export CSV
              </a>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total leads" value={stats.total} hint={`${stats.last7Days} in the last 7 days`} icon={<Icon.Inbox className="size-4" />} />
        <StatCard label="Confirmed" value={stats.confirmed} hint={`${stats.confirmationRate}% confirmation rate`} icon={<Icon.CheckCircle className="size-4" />} />
        <StatCard label="Awaiting confirmation" value={stats.pending} hint="Clicked nothing yet" icon={<Icon.Clock className="size-4" />} />
        <StatCard label="Last 30 days" value={stats.last30Days} hint={`${stats.unsubscribed} unsubscribed in total`} icon={<Icon.TrendingUp className="size-4" />} />
      </div>

      {stats.total > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Sign-ups per day</h2>
            <p className="text-xs text-ink-muted">Last 30 days</p>
            <div className="mt-4 flex h-28 items-end gap-0.5" role="img" aria-label={`Sign-ups over the last 30 days: ${stats.last30Days} in total, most on one day: ${peak}.`}>
              {stats.daily.map((d) => (
                <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${formatDate(d.date)}: ${d.count}`}>
                  <div className={cn("w-full rounded-t-sm", d.count ? "bg-accent" : "bg-surface-3")} style={{ height: `${Math.max(4, Math.round((d.count / peak) * 100))}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
              <span>{formatDate(stats.daily[0]!.date)}</span>
              <span>Today</span>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">By source</h2>
            <ul className="mt-3 space-y-2.5">
              {stats.bySource.map((s) => (
                <li key={s.source}>
                  <Link href={hrefFor({ ...state, source: s.source, page: undefined })} className="group block">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-ink group-hover:text-accent">{s.label}</span>
                      <span className="tabular-nums text-ink-muted">{s.count}</span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((s.count / stats.total) * 100)}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mb-4 mt-8 flex flex-col gap-3">
        <nav aria-label="Filter leads by status" className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {STATUSES.map((status) => (
            <Link
              key={status}
              href={hrefFor({ ...state, status, page: undefined })}
              aria-current={state.status === status ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                state.status === status ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {tabLabels[status]}
              <span className={cn("rounded-full px-1.5 text-[11px]", state.status === status ? "bg-surface-1/20" : "bg-surface-3")}>{counts[status]}</span>
            </Link>
          ))}
        </nav>
        <form action={BASE} method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {state.status !== "all" && <input type="hidden" name="status" value={state.status} />}
          <Input type="search" name="q" defaultValue={state.q} placeholder="Email or name" aria-label="Search leads" leftAddon={<Icon.Search className="size-4" />} className="sm:w-56" />
          {list.sources.length > 1 && (
            <Select name="source" defaultValue={state.source} aria-label="Source" className="sm:w-40">
              <option value="">All sources</option>
              {list.sources.map((s) => (
                <option key={s} value={s}>
                  {leadSourceLabel(s)}
                </option>
              ))}
            </Select>
          )}
          {list.courses.length > 0 && (
            <Select name="course" defaultValue={state.course} aria-label="Course" className="sm:w-48">
              <option value="">All courses</option>
              {list.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            From
            <Input type="date" name="from" defaultValue={state.from} className="sm:w-40" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            To
            <Input type="date" name="to" defaultValue={state.to} className="sm:w-40" />
          </label>
          <button type="submit" className={buttonClasses({ variant: "outline" })}>
            Filter
          </button>
          {filtered && (
            <Link href={BASE} className="text-sm font-medium text-accent hover:underline">
              Clear
            </Link>
          )}
        </form>
      </div>

      <LeadsTable
        total={list.total}
        filtered={filtered}
        clearHref={BASE}
        rows={list.rows.map((l) => ({
          id: l.id,
          email: l.email,
          name: l.name ?? "",
          status: leadStatus(l),
          source: l.source,
          sourceLabel: leadSourceLabel(l.source),
          courseTitle: l.courseTitle ?? "",
          createdLabel: formatDate(l.createdAt),
          confirmedLabel: l.confirmedAt ? formatDate(l.confirmedAt) : "",
        }))}
      />

      <PageLinks className="mt-6" page={list.page} pageCount={list.pages} hrefFor={(p) => hrefFor({ ...state, page: p })} label="Lead pages" />
    </div>
  );
}
