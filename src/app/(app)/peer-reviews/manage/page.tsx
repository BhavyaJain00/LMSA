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

export const metadata: Metadata = { title: "Manage peer reviews" };

const STATE_OPTIONS = [
  { value: "waiting", label: "Waiting for the deadline" },
  { value: "in_progress", label: "Reviews in progress" },
  { value: "overdue", label: "Has overdue reviews" },
  { value: "done", label: "All reviews in" },
];

function StateBadge({ row }: { row: PeerAssignmentRow }) {
  if (!row.open) {
    return (
      <Badge tone="info" dot>
        Waiting for deadline
      </Badge>
    );
  }
  if (row.overdue > 0) {
    return (
      <Badge tone="danger" dot>
        {row.overdue} overdue
      </Badge>
    );
  }
  if (row.assigned === 0) return <Badge tone="neutral">No reviews yet</Badge>;
  if (row.completed === row.assigned) {
    return (
      <Badge tone="success" dot>
        All reviews in
      </Badge>
    );
  }
  return (
    <Badge tone="warning" dot>
      In progress
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

  const [all, rows] = await Promise.all([listPeerReviewAssignments(), listPeerReviewAssignments({ search, state })]);
  const shown = rows.slice(0, limit);
  const filtered = !!(search || state);
  const totals = all.reduce((t, r) => ({ assigned: t.assigned + r.assigned, completed: t.completed + r.completed, overdue: t.overdue + r.overdue }), { assigned: 0, completed: 0, overdue: 0 });

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments", href: "/admin/assignments" }, { label: "Peer reviews" }]} />}
        title="Peer reviews"
        description="Assignments where learners review each other's work. Open one to see every review, step in for a reviewer or nudge the ones who are late."
        actions={
          <>
            <ButtonLink href="/admin/rubrics" variant="outline" leftIcon={<Icon.ListChecks className="size-4" />}>
              Rubrics
            </ButtonLink>
            <ButtonLink href="/peer-reviews" variant="outline" leftIcon={<Icon.Inbox className="size-4" />}>
              My reviews
            </ButtonLink>
          </>
        }
      />
      {all.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Assignments with peer review" value={all.length} icon={<Icon.ClipboardList className="size-4" />} />
          <StatCard
            label="Reviews submitted"
            value={`${totals.completed} / ${totals.assigned}`}
            hint={totals.assigned ? `${percent(totals.completed, totals.assigned)}% complete` : "None handed out yet"}
            icon={<Icon.CheckCircle className="size-4" />}
          />
          <StatCard label="Overdue reviews" value={totals.overdue} hint={totals.overdue ? "Open an assignment to remind reviewers" : "Nobody is late"} icon={<Icon.Clock className="size-4" />} />
        </div>
      )}
      {all.length > 0 && (
        <FilterBar
          filters={[
            { param: "q", kind: "search", label: "Search", placeholder: "Search assignments" },
            { param: "state", kind: "select", label: "State", placeholder: "Any state", options: STATE_OPTIONS, className: "sm:w-60" },
          ]}
        />
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Users />}
          title={filtered ? "No assignments match these filters" : "No assignment uses peer review yet"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "Open an assignment and turn on Peer review under “Rubric & peer review”. Learners who submit are then asked to review a few classmates."
          }
          action={
            filtered ? undefined : (
              <ButtonLink href="/admin/assignments" leftIcon={<Icon.ClipboardList className="size-4" />}>
                Go to assignments
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Assignment</TH>
                <TH className="hidden md:table-cell">Submissions</TH>
                <TH className="hidden sm:table-cell">Reviews</TH>
                <TH className="text-right sm:text-left">State</TH>
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
                      <span>{row.courseTitle ?? "No course"}</span>
                      <span>
                        · {row.reviewsPerSubmission} {row.reviewsPerSubmission === 1 ? "review" : "reviews"} each
                      </span>
                      {row.anonymous && <span>· anonymous</span>}
                      {row.rubricTitle && <span>· {row.rubricTitle}</span>}
                      <span className="sm:hidden">
                        · {row.completed}/{row.assigned} reviews in
                      </span>
                    </p>
                    {!row.open && row.deadline && (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Reviews go out <LocalDateTime iso={row.deadline} />
                      </p>
                    )}
                  </TD>
                  <TD className="hidden tabular-nums md:table-cell">{row.submissions}</TD>
                  <TD className="hidden sm:table-cell">
                    <div className="w-32">
                      <p className="mb-1 text-xs tabular-nums text-ink-muted">
                        {row.completed} of {row.assigned} submitted
                      </p>
                      <ProgressBar value={percent(row.completed, row.assigned)} size="sm" tone={row.assigned > 0 && row.completed === row.assigned ? "success" : "accent"} />
                    </div>
                  </TD>
                  <TD className="text-right sm:text-left">
                    <StateBadge row={row} />
                  </TD>
                </LinkRow>
              ))}
            </TBody>
          </Table>
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="assignments" />
        </>
      )}
    </div>
  );
}
