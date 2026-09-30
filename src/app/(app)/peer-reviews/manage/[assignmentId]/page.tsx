import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments } from "@/lib/data/assessments";
import { getDb } from "@/lib/db/store";
import { getPeerAssignmentOverview, syncPeerAssignments, type CoverageFilter, type ReviewStatusFilter } from "@/lib/teaching/peer-review";
import { activePeerConfig } from "@/lib/teaching/peer-shared";
import { percent } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { LocalDateTime } from "@/components/assessments/client-time";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { PeerAssignmentToolbar } from "@/components/teaching/peer-review-admin";
import { PeerCoverageList, PeerReviewList } from "@/components/teaching/peer-review-lists";

const REVIEW_STATUS_OPTIONS: { value: Exclude<ReviewStatusFilter, "">; label: string }[] = [
  { value: "assigned", label: "Not submitted yet" },
  { value: "overdue", label: "Overdue" },
  { value: "submitted", label: "Submitted" },
  { value: "overridden", label: "Edited by an instructor" },
];

const COVERAGE_OPTIONS: { value: Exclude<CoverageFilter, "">; label: string }[] = [
  { value: "unreviewed", label: "No reviewers yet" },
  { value: "waiting", label: "Waiting for feedback" },
  { value: "owing", label: "Still has reviews to write" },
  { value: "done", label: "All done" },
];

function oneOf<T extends string>(value: string | undefined, options: { value: T }[]): T | "" {
  return options.find((o) => o.value === value)?.value ?? "";
}

export async function generateMetadata(props: PageProps<"/peer-reviews/manage/[assignmentId]">): Promise<Metadata> {
  const { assignmentId } = await props.params;
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  return { title: assignment ? `Peer reviews: ${assignment.title}` : "Peer reviews" };
}

export default async function ManageAssignmentPeerReviewsPage(props: PageProps<"/peer-reviews/manage/[assignmentId]">) {
  const { assignmentId } = await props.params;
  const user = await requireUser(`/peer-reviews/manage/${assignmentId}`);
  if (!canManageAssessments(user)) redirect("/peer-reviews");

  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment) notFound();
  if (!activePeerConfig(assignment)) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          breadcrumbs={<Breadcrumbs items={[{ label: "Peer reviews", href: "/peer-reviews/manage" }, { label: assignment.title }]} />}
          title={assignment.title}
        />
        <EmptyState
          icon={<Icon.Users />}
          title="Peer review is off for this assignment"
          description="Turn it on in the assignment's “Rubric & peer review” settings. Reviews written earlier are kept and show up again when you do."
          action={
            <ButtonLink href={`/admin/assignments/${assignment.id}`} leftIcon={<Icon.Settings className="size-4" />}>
              Open assignment settings
            </ButtonLink>
          }
        />
      </div>
    );
  }

  // Hand out anything that is due before showing the numbers.
  await syncPeerAssignments({ assignmentIds: [assignment.id] });

  const sp = await props.searchParams;
  const tab = param(sp.tab) === "learners" ? "learners" : "reviews";
  const search = param(sp.q);
  const status = oneOf(param(sp.status), REVIEW_STATUS_OPTIONS);
  const coverageFilter = oneOf(param(sp.coverage), COVERAGE_OPTIONS);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const overview = await getPeerAssignmentOverview(assignment.id, { status, coverage: coverageFilter, search });
  if (!overview) notFound();
  const { config, stats, rubric } = overview;
  const openReviews = stats.assigned - stats.completed;
  const filtered = !!(search || (tab === "reviews" ? status : coverageFilter));
  const total = tab === "reviews" ? overview.rows.length : overview.coverage.length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Assignments", href: "/admin/assignments" }, { label: "Peer reviews", href: "/peer-reviews/manage" }, { label: assignment.title }]}
          />
        }
        title={assignment.title}
        description={
          <>
            {overview.courseTitle ? `${overview.courseTitle} · ` : ""}
            {config.reviewsPerSubmission} {config.reviewsPerSubmission === 1 ? "review" : "reviews"} per submission · {config.dueDays} {config.dueDays === 1 ? "day" : "days"} to review ·{" "}
            {config.anonymous ? "anonymous to learners" : "names visible to learners"}
            {rubric ? ` · rubric: ${rubric.title}` : " · no rubric (written feedback only)"}
            {config.requiredForCompletion ? " · counts toward lesson completion" : ""}
          </>
        }
        actions={
          <ButtonLink href={`/admin/assignments/${assignment.id}`} variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
            Settings
          </ButtonLink>
        }
      />

      {!overview.open && assignment.scheduleEnd && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-ink">
          <Icon.Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            Reviews are handed out when submissions close on <LocalDateTime iso={assignment.scheduleEnd} />, so every learner who submitted is included.
          </span>
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Submissions" value={stats.submissions} hint={stats.submissions < 2 ? "Two are needed to start" : undefined} icon={<Icon.ClipboardList className="size-4" />} />
        <StatCard
          label="Reviews submitted"
          value={`${stats.completed} / ${stats.assigned}`}
          hint={stats.assigned ? `${percent(stats.completed, stats.assigned)}% complete` : "None handed out yet"}
          icon={<Icon.CheckCircle className="size-4" />}
        />
        <StatCard label="Overdue" value={stats.overdue} hint={stats.overdue ? "Remind or reassign" : "Nobody is late"} icon={<Icon.Clock className="size-4" />} />
        <StatCard label="Without reviewers" value={stats.unreviewed} hint={stats.unreviewed ? "See the Learners tab" : "Everyone is covered"} icon={<Icon.Users className="size-4" />} />
      </div>

      <div className="mb-5">
        <PeerAssignmentToolbar assignmentId={assignment.id} open={overview.open} openReviews={openReviews} />
      </div>

      <Tabs
        className="mb-4"
        items={[
          { label: "Reviews", value: "reviews", count: stats.assigned },
          { label: "Learners", value: "learners", count: stats.submissions },
        ]}
      />

      {tab === "reviews" ? (
        <>
          <FilterBar
            key="reviews"
            filters={[
              { param: "q", kind: "search", label: "Search", placeholder: "Search by learner name or email" },
              { param: "status", kind: "select", label: "Status", placeholder: "Any status", options: REVIEW_STATUS_OPTIONS },
            ]}
          />
          {total === 0 ? (
            <EmptyState
              icon={<Icon.Inbox />}
              title={filtered ? "No reviews match these filters" : "No reviews handed out yet"}
              description={
                filtered
                  ? "Try a different search or clear the filters."
                  : overview.open
                    ? "Reviews are handed out automatically once at least two learners have submitted."
                    : "Reviews go out when the submission deadline passes. You can also hand them out now to the learners who already submitted."
              }
            />
          ) : (
            <>
              <PeerReviewList rows={overview.rows.slice(0, limit)} rubric={rubric} reviewerOptions={overview.reviewerOptions} />
              <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} noun="reviews" />
            </>
          )}
        </>
      ) : (
        <>
          <FilterBar
            key="learners"
            filters={[
              { param: "q", kind: "search", label: "Search", placeholder: "Search by learner name or email" },
              { param: "coverage", kind: "select", label: "Progress", placeholder: "Any progress", options: COVERAGE_OPTIONS, className: "sm:w-60" },
            ]}
          />
          {total === 0 ? (
            <EmptyState
              icon={<Icon.Users />}
              title={filtered ? "No learners match these filters" : "No submissions yet"}
              description={filtered ? "Try a different search or clear the filters." : "Learners appear here once they submit the assignment."}
            />
          ) : (
            <>
              <PeerCoverageList rows={overview.coverage.slice(0, limit)} reviewerOptions={overview.reviewerOptions} />
              <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} noun="learners" />
            </>
          )}
        </>
      )}
    </div>
  );
}
