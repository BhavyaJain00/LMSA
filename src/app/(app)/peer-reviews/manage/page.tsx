import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments } from "@/lib/data/assessments";
import { listPeerReviewAssignments, runPeerReviewSweep, type PeerAssignmentRow } from "@/lib/teaching/peer-review";
import { percent } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { LocalDateTime } from "@/components/assessments/client-time";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { LinkRow } from "@/components/assessments/link-row";
import { param, parsePaging } from "@/components/assessments/shared";
import { getT } from "@/i18n/server";

type Translate = Awaited<ReturnType<typeof getT<"learning">>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("learning");
  return { title: t("peer.manage") };
}

const STATE_VALUES = ["waiting", "in_progress", "overdue", "done"] as const;

function StateBadge({ row, t }: { row: PeerAssignmentRow; t: Translate }) {
  if (!row.open) {
    return (
      <Badge tone="info" dot>
        {t("peer.admin.badgeWaiting")}
      </Badge>
    );
  }
  if (row.overdue > 0) {
    return (
      <Badge tone="danger" dot>
        {t("peer.admin.badgeOverdue", { count: row.overdue })}
      </Badge>
    );
  }
  if (row.assigned === 0) return <Badge tone="neutral">{t("peer.admin.badgeNone")}</Badge>;
  if (row.completed === row.assigned) {
    return (
      <Badge tone="success" dot>
        {t("peer.admin.badgeDone")}
      </Badge>
    );
  }
  return (
    <Badge tone="warning" dot>
      {t("peer.admin.badgeProgress")}
    </Badge>
  );
}

export default async function ManagePeerReviewsPage(props: PageProps<"/peer-reviews/manage">) {
  const user = await requireUser("/peer-reviews/manage");
  if (!canManageAssessments(user)) redirect("/peer-reviews");
  await runPeerReviewSweep();
  const sp = await props.searchParams;
  const search = param(sp.q);
  const state = param(sp.state);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);
  const t = await getT("learning");
  const stateOptions = STATE_VALUES.map((value) => ({ value, label: t(`peer.admin.state.${value}`) }));

  const [all, rows] = await Promise.all([listPeerReviewAssignments(), listPeerReviewAssignments({ search, state })]);
  const shown = rows.slice(0, limit);
  const filtered = !!(search || state);
  const totals = all.reduce((t, r) => ({ assigned: t.assigned + r.assigned, completed: t.completed + r.completed, overdue: t.overdue + r.overdue }), { assigned: 0, completed: 0, overdue: 0 });

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: t("assignment.page.crumbAssignments"), href: "/admin/assignments" }, { label: t("peer.title") }]} />}
        title={t("peer.title")}
        description={t("peer.admin.description")}
        actions={
          <>
            <ButtonLink href="/admin/rubrics" variant="outline" leftIcon={<Icon.ListChecks className="size-4" />}>
              {t("peer.admin.rubrics")}
            </ButtonLink>
            <ButtonLink href="/peer-reviews" variant="outline" leftIcon={<Icon.Inbox className="size-4" />}>
              {t("peer.admin.myReviews")}
            </ButtonLink>
          </>
        }
      />
      {all.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatCard label={t("peer.admin.statAssignments")} value={all.length} icon={<Icon.ClipboardList className="size-4" />} />
          <StatCard
            label={t("peer.admin.statSubmitted")}
            value={`${totals.completed} / ${totals.assigned}`}
            hint={totals.assigned ? t("peer.admin.percentComplete", { percent: percent(totals.completed, totals.assigned) }) : t("peer.admin.noneHandedOut")}
            icon={<Icon.CheckCircle className="size-4" />}
          />
          <StatCard
            label={t("peer.admin.statOverdue")}
            value={totals.overdue}
            hint={totals.overdue ? t("peer.admin.overdueHint") : t("peer.admin.nobodyLate")}
            icon={<Icon.Clock className="size-4" />}
          />
        </div>
      )}
      {all.length > 0 && (
        <FilterBar
          filters={[
            { param: "q", kind: "search", label: t("peer.admin.search"), placeholder: t("peer.admin.searchAssignments") },
            { param: "state", kind: "select", label: t("peer.admin.stateLabel"), placeholder: t("peer.admin.anyState"), options: stateOptions, className: "sm:w-60" },
          ]}
        />
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Users />}
          title={filtered ? t("peer.admin.noMatchTitle") : t("peer.admin.emptyTitle")}
          description={filtered ? t("peer.admin.noMatchBody") : t("peer.admin.emptyBody")}
          action={
            filtered ? undefined : (
              <ButtonLink href="/admin/assignments" leftIcon={<Icon.ClipboardList className="size-4" />}>
                {t("peer.admin.goToAssignments")}
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>{t("peer.admin.colAssignment")}</TH>
                <TH className="hidden md:table-cell">{t("peer.admin.colSubmissions")}</TH>
                <TH className="hidden sm:table-cell">{t("peer.admin.colReviews")}</TH>
                <TH className="text-end sm:text-start">{t("peer.admin.colState")}</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((row) => (
                <LinkRow key={row.id} href={`/peer-reviews/manage/${row.id}`}>
                  <TD>
                    <Link href={`/peer-reviews/manage/${row.id}`} className="font-medium text-ink hover:underline">
                      {row.title}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                      <span>{row.courseTitle ?? t("assessAdmin.noCourse")}</span>
                      <span>· {t("peer.admin.reviewsEach", { count: row.reviewsPerSubmission })}</span>
                      {row.anonymous && <span>· {t("peer.admin.anonymousLower")}</span>}
                      {row.rubricTitle && <span>· {row.rubricTitle}</span>}
                      <span className="sm:hidden">· {t("peer.admin.reviewsIn", { completed: row.completed, assigned: row.assigned })}</span>
                    </p>
                    {!row.open && row.deadline && (
                      <p className="mt-0.5 text-xs text-ink-muted">{t.rich("peer.admin.reviewsGoOut", { time: <LocalDateTime iso={row.deadline} /> })}</p>
                    )}
                  </TD>
                  <TD className="hidden tabular-nums md:table-cell">{row.submissions}</TD>
                  <TD className="hidden sm:table-cell">
                    <div className="w-32">
                      <p className="mb-1 text-xs tabular-nums text-ink-muted">{t("peer.admin.submittedOf", { completed: row.completed, assigned: row.assigned })}</p>
                      <ProgressBar value={percent(row.completed, row.assigned)} size="sm" tone={row.assigned > 0 && row.completed === row.assigned ? "success" : "accent"} />
                    </div>
                  </TD>
                  <TD className="text-end sm:text-start">
                    <StateBadge row={row} t={t} />
                  </TD>
                </LinkRow>
              ))}
            </TBody>
          </Table>
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} />
        </>
      )}
    </div>
  );
}
