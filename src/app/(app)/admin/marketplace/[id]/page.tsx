import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getInstructorRow, listEarnings, listInstructorPayouts } from "@/lib/teaching/marketplace";
import { earningsByCourse, MARKETPLACE_PAGE_SIZE } from "@/lib/teaching/marketplace-shared";
import { methodLabel, pageParam, paginate } from "@/lib/growth/affiliates-shared";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatCard } from "@/components/ui/card";
import { Tag } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { moneyList } from "@/components/growth/affiliate-badges";
import { ListPagination } from "@/components/growth/list-pagination";
import { ApplicationStatusBadge, EarningStatusBadge } from "@/components/teaching/marketplace-badges";
import { InstructorPayoutButton, InstructorReviewButtons, InstructorTermsForm } from "@/components/teaching/marketplace-admin";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Instructor" };

export default async function AdminInstructorPage(props: PageProps<"/admin/marketplace/[id]">) {
  const { id } = await props.params;
  await requireRole(["admin"], `/admin/marketplace/${id}`);
  const sp = await props.searchParams;
  const row = await getInstructorRow(id);
  if (!row) notFound();

  const { profile, application, user } = row;
  const name = user?.name ?? "Deleted member";
  const [settings, earnings, payouts] = await Promise.all([
    getSettings(),
    listEarnings({ status: "all", q: "", courseId: "", from: "", to: "", page: 1, instructorId: profile.userId }),
    listInstructorPayouts(profile.userId),
  ]);
  const currency = settings.commerce.defaultCurrency;
  const byCourse = earningsByCourse(earnings);
  const titles = new Map(earnings.map((e) => [e.courseId, e.courseTitle]));
  const page = paginate(earnings, pageParam(sp), MARKETPLACE_PAGE_SIZE);
  const pending = row.totals.map((t) => ({ currency: t.currency, amount: t.pending }));
  const paid = row.totals.map((t) => ({ currency: t.currency, amount: t.paid }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={name} src={user?.avatarUrl} size="md" />
            <span className="truncate">{name}</span>
          </span>
        }
        description={user?.email}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Instructors & payouts", href: "/admin/marketplace" },
              { label: name },
            ]}
          />
        }
        actions={
          <>
            {profile.status === "approved" || row.balances.length ? (
              <InstructorPayoutButton
                target={{
                  instructorId: profile.userId,
                  profileId: profile.id,
                  name,
                  avatarUrl: user?.avatarUrl,
                  payTo: profile.payoutEmail ?? user?.email ?? "no email on file",
                  balances: row.balances,
                }}
              />
            ) : null}
            <InstructorReviewButtons target={{ id: profile.id, name, status: profile.status, sharePercent: profile.revenueSharePercent }} />
          </>
        }
      />

      <section aria-label="Instructor summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Status" value={<ApplicationStatusBadge status={profile.status} />} hint={profile.reviewedAt ? `Reviewed ${formatDate(profile.reviewedAt)}` : `Applied ${formatDate(profile.createdAt)}`} />
        <StatCard label="Revenue share" value={`${profile.revenueSharePercent}%`} hint={`${row.courseCount} courses taught`} icon={<Icon.Percent className="size-5" />} />
        <StatCard label="Unpaid" value={<span className="text-xl sm:text-2xl">{moneyList(pending, currency)}</span>} icon={<Icon.Clock className="size-5" />} />
        <StatCard label="Paid out" value={<span className="text-xl sm:text-2xl">{moneyList(paid, currency)}</span>} hint={`${payouts.length} payouts`} icon={<Icon.CreditCard className="size-5" />} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Application" description={`Sent ${formatDateTime(profile.createdAt)}`} />
            <CardBody className="space-y-5">
              {profile.status === "rejected" && profile.rejectionReason && (
                <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm">
                  <p className="font-medium text-ink">Reason given</p>
                  <p className="mt-1 whitespace-pre-line text-ink-muted">{profile.rejectionReason}</p>
                </div>
              )}
              <dl className="space-y-4">
                <DetailItem label="About">
                  <span className="whitespace-pre-line">{application.bio || "—"}</span>
                </DetailItem>
                <DetailItem label="Subjects">
                  {application.expertise.length ? (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {application.expertise.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )}
                </DetailItem>
                {application.sampleUrl && (
                  <DetailItem label="Sample link">
                    <a href={application.sampleUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                      {application.sampleUrl}
                      <Icon.ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </DetailItem>
                )}
                {application.sample && (
                  <DetailItem label="Sample outline">
                    <span className="whitespace-pre-line">{application.sample}</span>
                  </DetailItem>
                )}
                {user && (
                  <DetailItem label="Profile">
                    <Link href={`/user/${user.username}`} className="text-accent hover:underline">
                      View public profile
                    </Link>
                  </DetailItem>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Earnings"
              actions={
                earnings.length ? (
                  <a href={`/admin/marketplace/export?type=earnings&instructor=${profile.userId}`} className={buttonClasses({ variant: "outline", size: "sm" })} download>
                    <Icon.Download className="size-4" aria-hidden="true" />
                    CSV
                  </a>
                ) : undefined
              }
            />
            <CardBody className="space-y-4">
              {byCourse.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {byCourse.map((c) => (
                    <li key={`${c.courseId}-${c.currency}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0 truncate font-medium text-ink">{titles.get(c.courseId)}</span>
                      <span className="tabular-nums text-ink-muted">
                        {c.sales} sales · {money(c.pending, c.currency)} unpaid · {money(c.paid, c.currency)} paid
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Table>
                <THead>
                  <tr>
                    <TH>Course</TH>
                    <TH className="hidden sm:table-cell">Date</TH>
                    <TH className="text-right">Share</TH>
                    <TH className="hidden sm:table-cell">Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {page.rows.length === 0 ? (
                    <TableEmpty colSpan={4}>No earnings yet.</TableEmpty>
                  ) : (
                    page.rows.map((r) => (
                      <TR key={r.id}>
                        <TD className="max-w-0">
                          <p className="truncate text-ink">{r.courseTitle}</p>
                          <p className="truncate text-xs text-ink-muted">{r.adjustment ? "Refund correction" : `Order ${r.orderId} · net ${money(r.gross, r.currency)}`}</p>
                        </TD>
                        <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(r.createdAt)}</TD>
                        <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.share, r.currency)}</TD>
                        <TD className="hidden sm:table-cell">
                          <EarningStatusBadge status={r.status} />
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
              <ListPagination page={page.page} pageCount={page.pageCount} total={page.total} noun="earnings" href={(p) => `/admin/marketplace/${profile.id}${p > 1 ? `?page=${p}` : ""}`} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <InstructorTermsForm profile={{ id: profile.id, revenueSharePercent: profile.revenueSharePercent, payoutEmail: profile.payoutEmail }} />
          <Card>
            <CardHeader title="Payouts" />
            <CardBody>
              {payouts.length === 0 ? (
                <p className="text-sm text-ink-muted">No payouts yet.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {payouts.slice(0, 10).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-ink">{formatDate(p.createdAt)}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {methodLabel(p.method)}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{money(p.amount, p.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {payouts.length > 10 && (
                <a href={`/admin/marketplace/export?type=payouts&instructor=${profile.userId}`} className="mt-3 inline-block text-sm text-accent hover:underline" download>
                  Download all {payouts.length} payouts (CSV)
                </a>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
