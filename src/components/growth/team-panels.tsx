import Link from "next/link";
import type { ReactNode } from "react";
import { TEAM_PAGE_SIZE, getTeamProgress, listSeats, type MemberProgressRow, type TeamCourseView, type TeamOverview } from "@/lib/growth/teams";
import { paginate } from "@/lib/growth/affiliates-shared";
import { PROGRESS_STATE_LABELS, type MemberCourseProgress, type ProgressFilter, type SeatFilter } from "@/lib/growth/teams-shared";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import { ListPagination } from "./list-pagination";
import { ProgressStateBadge } from "./team-badges";
import { ClaimSeatButton, TeamInviteForm } from "./team-invite-form";
import { TeamSeatsTable } from "./team-seats-table";
import { formatDate, formatDuration, formatNumber, pluralize, relativeTime } from "@/lib/utils";

/**
 * Server-rendered sections of a team: seats, progress and orders. Shared by
 * the manager dashboard (`/team`) and the administrator's team page
 * (`/admin/teams/<id>`); `base` says which page the filters and pagination
 * links point back to.
 */

export interface TeamPanelBase {
  path: string;
  /** Query parameters that select the team and tab on that page. */
  params: Record<string, string>;
}

export function panelHref(base: TeamPanelBase, extra: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams(base.params);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === "" || value === "all" || value === "current") continue;
    if (key === "page" && Number(value) <= 1) continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `${base.path}?${s}` : base.path;
}

function exportHref(orgId: string, type: "seats" | "progress", params: Record<string, string>): string {
  const qs = new URLSearchParams({ org: orgId, type });
  for (const [key, value] of Object.entries(params)) if (value && value !== "all" && value !== "current") qs.set(key, value);
  return `/team/export?${qs.toString()}`;
}

function HiddenParams({ base }: { base: TeamPanelBase }) {
  return (
    <>
      {Object.entries(base.params).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}

function ExportLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={buttonClasses({ variant: "outline", size: "sm" })} download>
      <Icon.Download className="size-4" aria-hidden="true" />
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Seats                                                               */
/* ------------------------------------------------------------------ */

export async function TeamSeatsPanel({
  overview,
  base,
  filter,
  buyHref,
  canClaim,
}: {
  overview: TeamOverview;
  base: TeamPanelBase;
  filter: SeatFilter;
  /** Where "Buy more seats" goes. */
  buyHref: string;
  /** The viewer manages the team and holds no seat in it yet. */
  canClaim: boolean;
}) {
  const { org, usage } = overview;
  const all = await listSeats(org.id, filter);
  const page = paginate(all, filter.page, TEAM_PAGE_SIZE);
  const filtered = filter.status !== "current" || !!filter.q;
  const assigned = usage.used > 0 || filtered || all.length > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Invite members"
          description={
            usage.available > 0
              ? `${usage.available} of ${pluralize(usage.total, "seat")} free. Each person gets an email with a link to accept their seat.`
              : usage.total > 1
                ? `All ${formatNumber(usage.total)} seats are assigned.`
                : usage.total === 1
                  ? "The team's only seat is assigned."
                  : "This team has no seats yet."
          }
          actions={canClaim && usage.available > 0 ? <ClaimSeatButton orgId={org.id} /> : undefined}
        />
        <CardBody>
          <TeamInviteForm orgId={org.id} available={usage.available} buyHref={buyHref} />
        </CardBody>
      </Card>

      <section aria-labelledby="seats-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="seats-heading" className="text-base font-semibold text-ink">
            Seats
          </h2>
          {assigned && <ExportLink href={exportHref(org.id, "seats", { status: filter.status, q: filter.q })}>Export CSV</ExportLink>}
        </div>
        {overview.expiredInvites > 0 && filter.status !== "expired" && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
            <Icon.Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {pluralize(overview.expiredInvites, "invitation")} expired and still {overview.expiredInvites === 1 ? "holds a seat" : "hold seats"}.{" "}
              <Link href={panelHref(base, { status: "expired" })} className="font-medium text-accent hover:underline">
                Review and send again
              </Link>
            </span>
          </p>
        )}
        {assigned && (
          <form method="get" action={base.path} role="search" aria-label="Filter seats" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center">
            <HiddenParams base={base} />
            <label htmlFor="seat-q" className="sr-only">
              Search seats
            </label>
            <Input id="seat-q" name="q" type="search" defaultValue={filter.q} placeholder="Search name or email" leftAddon={<Icon.Search className="size-4" />} />
            <label htmlFor="seat-status" className="sr-only">
              Seat status
            </label>
            <Select
              id="seat-status"
              name="status"
              defaultValue={filter.status}
              options={[
                { value: "current", label: "Seats in use" },
                { value: "active", label: "Active members" },
                { value: "invited", label: "Open invitations" },
                { value: "expired", label: "Expired invitations" },
                { value: "revoked", label: "Revoked" },
              ]}
            />
            <button type="submit" className={buttonClasses({ variant: "outline" })}>
              Apply
            </button>
          </form>
        )}
        <TeamSeatsTable
          key={`${filter.status}-${filter.q}-${page.page}`}
          orgId={org.id}
          rows={page.rows}
          emptyText={filtered ? "No seats match these filters." : "No one has a seat yet. Invite your first team members above."}
        />
        {filtered && page.total === 0 && (
          <p className="text-sm">
            <Link href={panelHref(base)} className="font-medium text-accent hover:underline">
              Clear filters
            </Link>
          </p>
        )}
        <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="seats" href={(p) => panelHref(base, { status: filter.status, q: filter.q, page: p })} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

function MemberCell({ row }: { row: MemberProgressRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
      <div className="min-w-0">
        <Link href={`/user/${row.user.username}`} className="block truncate font-medium text-ink hover:underline">
          {row.user.name}
        </Link>
        <p className="truncate text-xs text-ink-muted">{row.user.email}</p>
      </div>
    </div>
  );
}

function lastActive(iso: string | undefined): ReactNode {
  return iso ? <span title={formatDate(iso)}>{relativeTime(iso)}</span> : <span className="text-ink-faint">No activity yet</span>;
}

function CourseLine({ course, cell }: { course: TeamCourseView; cell: MemberCourseProgress }) {
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-ink">{course.title}</span>
        {cell.enrolled ? <ProgressStateBadge state={cell.state} /> : <span className="shrink-0 text-xs text-ink-faint">Not enrolled</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <ProgressBar value={cell.progress} size="xs" tone={cell.state === "completed" ? "success" : "accent"} />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted">
          {cell.progress}% · {cell.lessonsDone}/{cell.lessonsTotal}
        </span>
      </div>
    </li>
  );
}

export async function TeamProgressPanel({
  overview,
  base,
  filter,
  seatsHref,
}: {
  overview: TeamOverview;
  base: TeamPanelBase;
  filter: ProgressFilter;
  /** The seats section, where members are invited. */
  seatsHref: string;
}) {
  const { org } = overview;
  const progress = await getTeamProgress(org.id, filter);
  if (!progress) return null;
  const { summary } = progress;

  if (summary.members === 0) {
    return (
      <EmptyState
        icon={<Icon.BarChart />}
        title="No members yet"
        description="Progress appears here as soon as someone accepts their invitation and starts learning."
        action={
          <ButtonLink href={seatsHref} variant="outline" leftIcon={<Icon.UserPlus className="size-4" />}>
            Invite members
          </ButtonLink>
        }
      />
    );
  }

  const page = paginate(progress.rows, filter.page, TEAM_PAGE_SIZE);
  const single = progress.courses.length === 1 ? progress.courses[0] : null;
  const filtered = filter.state !== "all" || !!filter.q || !!filter.courseId;
  const titles = new Map(overview.courses.map((c) => [c.id, c]));
  const pageHref = (p: number) => panelHref(base, { course: filter.courseId, state: filter.state, q: filter.q, page: p });

  return (
    <div className="space-y-6">
      <section aria-label="Team progress summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Members" value={formatNumber(summary.members)} hint={`${summary.activeThisWeek} active this week`} icon={<Icon.Users className="size-5" />} />
        <StatCard label="Average progress" value={`${summary.average}%`} hint={`Across ${pluralize(overview.courses.length, "course")}`} icon={<Icon.TrendingUp className="size-5" />} />
        <StatCard label="Courses completed" value={formatNumber(summary.completions)} hint={`Of ${formatNumber(summary.members * overview.courses.length)} possible`} icon={<Icon.Award className="size-5" />} />
        <StatCard label="Not started" value={formatNumber(summary.notStarted)} hint={summary.notStarted ? "Members who haven't opened a lesson" : "Everyone has started"} icon={<Icon.Clock className="size-5" />} />
      </section>

      {overview.courses.length > 1 && (
        <Card>
          <CardHeader title="By course" description="Average progress of every member, and how many finished." />
          <CardBody>
            <ul className="space-y-4">
              {progress.perCourse.map((c) => {
                const course = titles.get(c.courseId);
                if (!course) return null;
                return (
                  <li key={c.courseId}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                      <Link href={panelHref(base, { course: c.courseId })} className="min-w-0 truncate font-medium text-ink hover:underline">
                        {course.title}
                      </Link>
                      <span className="text-xs tabular-nums text-ink-muted">
                        {c.average}% average · {c.completed} of {summary.members} completed · {c.started} started
                      </span>
                    </div>
                    <ProgressBar value={c.average} size="sm" tone={c.average >= 100 ? "success" : "accent"} />
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="progress-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="progress-heading" className="text-base font-semibold text-ink">
            {single ? `Progress in ${single.title}` : "Progress by member"}
          </h2>
          <ExportLink href={exportHref(org.id, "progress", { course: filter.courseId, state: filter.state, q: filter.q })}>Export CSV</ExportLink>
        </div>
        <form method="get" action={base.path} role="search" aria-label="Filter progress" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_16rem_12rem_auto] lg:items-center">
          <HiddenParams base={base} />
          <label htmlFor="progress-q" className="sr-only">
            Search members
          </label>
          <Input id="progress-q" name="q" type="search" defaultValue={filter.q} placeholder="Search name or email" leftAddon={<Icon.Search className="size-4" />} />
          {overview.courses.length > 1 && (
            <>
              <label htmlFor="progress-course" className="sr-only">
                Course
              </label>
              <Select id="progress-course" name="course" defaultValue={filter.courseId} options={[{ value: "", label: "All courses" }, ...overview.courses.map((c) => ({ value: c.id, label: c.title }))]} />
            </>
          )}
          <label htmlFor="progress-state" className="sr-only">
            Progress status
          </label>
          <Select
            id="progress-state"
            name="state"
            defaultValue={filter.state}
            options={[{ value: "all", label: "Any status" }, ...(["not_started", "in_progress", "completed"] as const).map((s) => ({ value: s, label: PROGRESS_STATE_LABELS[s] }))]}
          />
          <button type="submit" className={buttonClasses({ variant: "outline" })}>
            Apply
          </button>
        </form>

        <Table>
          <THead>
            {single ? (
              <tr>
                <TH>Member</TH>
                <TH>Progress</TH>
                <TH className="hidden md:table-cell">Lessons</TH>
                <TH className="hidden lg:table-cell">Time spent</TH>
                <TH className="hidden md:table-cell">Last activity</TH>
                <TH className="hidden lg:table-cell">Certificate</TH>
              </tr>
            ) : (
              <tr>
                <TH>Member</TH>
                <TH>Progress</TH>
                <TH className="hidden md:table-cell">Last activity</TH>
              </tr>
            )}
          </THead>
          <TBody>
            {page.rows.length === 0 ? (
              <TableEmpty colSpan={single ? 6 : 3}>
                No members match these filters.{" "}
                {filtered && (
                  <Link href={panelHref(base)} className="font-medium text-accent hover:underline">
                    Clear filters
                  </Link>
                )}
              </TableEmpty>
            ) : single ? (
              page.rows.map((row) => {
                const cell = row.courses[0];
                return (
                  <TR key={row.seatId}>
                    <TD className="max-w-0 w-[45%]">
                      <MemberCell row={row} />
                    </TD>
                    <TD className="min-w-32">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={cell.progress} size="sm" tone={cell.state === "completed" ? "success" : "accent"} />
                        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">{cell.progress}%</span>
                      </div>
                      <div className="mt-1">{cell.enrolled ? <ProgressStateBadge state={cell.state} /> : <span className="text-xs text-ink-faint">Not enrolled</span>}</div>
                    </TD>
                    <TD className="hidden whitespace-nowrap tabular-nums md:table-cell">
                      {cell.lessonsDone} / {cell.lessonsTotal}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{cell.timeSpentSeconds ? formatDuration(cell.timeSpentSeconds) : "—"}</TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted md:table-cell">{lastActive(cell.lastActivityAt)}</TD>
                    <TD className="hidden whitespace-nowrap lg:table-cell">
                      {cell.certificateCode ? (
                        <Link href={`/certificates/${cell.certificateCode}`} className="font-medium text-accent hover:underline">
                          View
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })
            ) : (
              page.rows.map((row) => (
                <TR key={row.seatId}>
                  <TD className="max-w-0 w-[45%] align-top">
                    <MemberCell row={row} />
                  </TD>
                  <TD className="min-w-40 align-top">
                    <details className="group">
                      <summary className="cursor-pointer list-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2">
                          <ProgressBar value={row.average} size="sm" tone={row.completed === row.courses.length ? "success" : "accent"} />
                          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">{row.average}%</span>
                        </span>
                        <span className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                          {row.completed} of {row.courses.length} completed
                          <Icon.ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                          <span className="sr-only">Show every course</span>
                        </span>
                      </summary>
                      <ul className="mt-2 divide-y divide-border border-t border-border text-sm">
                        {row.courses.map((cell) => {
                          const course = titles.get(cell.courseId);
                          return course ? <CourseLine key={cell.courseId} course={course} cell={cell} /> : null;
                        })}
                      </ul>
                    </details>
                  </TD>
                  <TD className="hidden whitespace-nowrap align-top text-ink-muted md:table-cell">{lastActive(row.lastActivityAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
        <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="members" href={pageHref} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export function TeamOrdersPanel({
  overview,
  buyHref,
  viewer,
  transactionsLink = false,
}: {
  overview: TeamOverview;
  /** Where "Buy more seats" goes; omitted when seats cannot be bought. */
  buyHref?: string;
  /** Invoices open for the buyer of the order and for administrators. */
  viewer: { id: string; admin: boolean };
  /** Link each order to the administrators' transaction list. */
  transactionsLink?: boolean;
}) {
  const { orders, seatPrice } = overview;
  return (
    <section aria-labelledby="orders-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="orders-heading" className="text-base font-semibold text-ink">
            Orders
          </h2>
          {seatPrice && <p className="text-sm text-ink-muted">One more seat costs {money(seatPrice.amount, seatPrice.currency)} today.</p>}
        </div>
        {buyHref && (
          <ButtonLink href={buyHref} size="sm" leftIcon={<Icon.Plus className="size-4" />}>
            Buy more seats
          </ButtonLink>
        )}
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Order</TH>
            <TH>Seats</TH>
            <TH className="hidden sm:table-cell">Amount</TH>
            <TH>Status</TH>
            <TH className="hidden md:table-cell">Bought by</TH>
            <TH className="w-24">
              <span className="sr-only">Invoice</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {orders.length === 0 ? (
            <TableEmpty colSpan={6}>No orders yet. Seats added by an administrator (for example after an invoice was paid) don&apos;t create an order.</TableEmpty>
          ) : (
            orders.map((o) => {
              const settled = o.status === "paid" || o.status === "refunded";
              const canOpen = settled && (viewer.admin || viewer.id === o.buyerId);
              return (
                <TR key={o.id}>
                  <TD className="max-w-0 w-[35%]">
                    {transactionsLink ? (
                      <Link href={`/admin/settings/transactions?search=${encodeURIComponent(o.orderId)}`} className="block truncate font-mono text-xs font-medium text-ink hover:underline">
                        {o.orderId}
                      </Link>
                    ) : (
                      <p className="truncate font-mono text-xs font-medium text-ink">{o.orderId}</p>
                    )}
                    <p className="truncate text-xs text-ink-muted">
                      {formatDate(o.paidAt ?? o.createdAt)}
                      <span className="sm:hidden"> · {money(o.amount, o.currency)}</span>
                    </p>
                  </TD>
                  <TD className="tabular-nums">{o.seats}</TD>
                  <TD className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                    {money(o.amount, o.currency)}
                    {!!o.refundedAmount && <p className="text-xs text-danger">−{money(o.refundedAmount, o.currency)} refunded</p>}
                  </TD>
                  <TD>
                    <PaymentStatusBadge status={o.status} failureReason={o.failureReason} refundedAmount={o.refundedAmount} amount={o.amount} audience={viewer.admin ? "admin" : "learner"} />
                  </TD>
                  <TD className="hidden max-w-40 truncate text-ink-muted md:table-cell">{o.buyerName}</TD>
                  <TD className="text-right">
                    {canOpen && (
                      <Link href={`/billing/invoice/${encodeURIComponent(o.orderId)}`} className="whitespace-nowrap text-sm font-medium text-accent hover:underline">
                        Invoice<span className="sr-only"> for order {o.orderId}</span>
                      </Link>
                    )}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </section>
  );
}
