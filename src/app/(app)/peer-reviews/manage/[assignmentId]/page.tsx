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
import { getT } from "@/i18n/server";

const REVIEW_STATUS_OPTIONS: { value: Exclude<ReviewStatusFilter, ""> }[] = [{ value: "assigned" }, { value: "overdue" }, { value: "submitted" }, { value: "overridden" }];

const COVERAGE_OPTIONS: { value: Exclude<CoverageFilter, ""> }[] = [{ value: "unreviewed" }, { value: "waiting" }, { value: "owing" }, { value: "done" }];

function oneOf<T extends string>(value: string | undefined, options: { value: T }[]): T | "" {
  return options.find((o) => o.value === value)?.value ?? "";
}

export async function generateMetadata(props: PageProps<"/peer-reviews/manage/[assignmentId]">): Promise<Metadata> {
  const { assignmentId } = await props.params;
  const [db, t] = await Promise.all([getDb(), getT("learning")]);
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  return { title: assignment ? t("peer.admin.metaTitle", { title: assignment.title }) : t("peer.title") };
}

export default async function ManageAssignmentPeerReviewsPage(props: PageProps<"/peer-reviews/manage/[assignmentId]">) {
  const { assignmentId } = await props.params;
  const user = await requireUser(`/peer-reviews/manage/${assignmentId}`);
  if (!canManageAssessments(user)) redirect("/peer-reviews");

  const [db, t] = await Promise.all([getDb(), getT("learning")]);
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment) notFound();
  if (!activePeerConfig(assignment)) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          breadcrumbs={<Breadcrumbs items={[{ label: t("peer.title"), href: "/peer-reviews/manage" }, { label: assignment.title }]} />}
          title={assignment.title}
        />
        <EmptyState
          icon={<Icon.Users />}
          title={t("peer.admin.offTitle")}
          description={t("peer.admin.offBody")}
          action={
            <ButtonLink href={`/admin/assignments/${assignment.id}`} leftIcon={<Icon.Settings className="size-4" />}>
              {t("peer.admin.openSettings")}
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
  const statusOptions = REVIEW_STATUS_OPTIONS.map(({ value }) => ({ value, label: t(`peer.admin.status.${value}`) }));
  const coverageOptions = COVERAGE_OPTIONS.map(({ value }) => ({ value, label: t(`peer.admin.coverage.${value}`) }));
  const summary = [
    ...(overview.courseTitle ? [overview.courseTitle] : []),
    t("peer.admin.perSubmission", { count: config.reviewsPerSubmission }),
    t("peer.admin.daysToReview", { count: config.dueDays }),
    config.anonymous ? t("peer.admin.anonymousToLearners") : t("peer.admin.namesVisible"),
    rubric ? t("peer.admin.withRubric", { title: rubric.title }) : t("peer.admin.noRubric"),
    ...(config.requiredForCompletion ? [t("peer.admin.countsForCompletion")] : []),
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: t("assignment.page.crumbAssignments"), href: "/admin/assignments" },
              { label: t("peer.title"), href: "/peer-reviews/manage" },
              { label: assignment.title },
            ]}
          />
        }
        title={assignment.title}
        description={summary.join(" · ")}
        actions={
          <ButtonLink href={`/admin/assignments/${assignment.id}`} variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
            {t("peer.admin.settings")}
          </ButtonLink>
        }
      />

      {!overview.open && assignment.scheduleEnd && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-ink">
          <Icon.Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <span>{t.rich("peer.admin.handedOutOn", { time: <LocalDateTime iso={assignment.scheduleEnd} /> })}</span>
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("peer.admin.colSubmissions")}
          value={stats.submissions}
          hint={stats.submissions < 2 ? t("peer.admin.twoNeeded") : undefined}
          icon={<Icon.ClipboardList className="size-4" />}
        />
        <StatCard
          label={t("peer.admin.statSubmitted")}
          value={`${stats.completed} / ${stats.assigned}`}
          hint={stats.assigned ? t("peer.admin.percentComplete", { percent: percent(stats.completed, stats.assigned) }) : t("peer.admin.noneHandedOut")}
          icon={<Icon.CheckCircle className="size-4" />}
        />
        <StatCard
          label={t("peer.overdue")}
          value={stats.overdue}
          hint={stats.overdue ? t("peer.admin.remindHint") : t("peer.admin.nobodyLate")}
          icon={<Icon.Clock className="size-4" />}
        />
        <StatCard
          label={t("peer.admin.withoutReviewers")}
          value={stats.unreviewed}
          hint={stats.unreviewed ? t("peer.admin.seeLearners") : t("peer.admin.everyoneCovered")}
          icon={<Icon.Users className="size-4" />}
        />
      </div>

      <div className="mb-5">
        <PeerAssignmentToolbar assignmentId={assignment.id} open={overview.open} openReviews={openReviews} />
      </div>

      <Tabs
        className="mb-4"
        items={[
          { label: t("peer.admin.tabReviews"), value: "reviews", count: stats.assigned },
          { label: t("peer.admin.tabLearners"), value: "learners", count: stats.submissions },
        ]}
      />

      {tab === "reviews" ? (
        <>
          <FilterBar
            key="reviews"
            filters={[
              { param: "q", kind: "search", label: t("peer.admin.search"), placeholder: t("peer.admin.searchLearners") },
              { param: "status", kind: "select", label: t("peer.admin.statusLabel"), placeholder: t("peer.admin.anyStatus"), options: statusOptions },
            ]}
          />
          {total === 0 ? (
            <EmptyState
              icon={<Icon.Inbox />}
              title={filtered ? t("peer.admin.noReviewsMatch") : t("peer.admin.noReviewsTitle")}
              description={filtered ? t("peer.admin.noMatchBody") : overview.open ? t("peer.admin.noReviewsOpen") : t("peer.admin.noReviewsClosed")}
            />
          ) : (
            <>
              <PeerReviewList rows={overview.rows.slice(0, limit)} rubric={rubric} reviewerOptions={overview.reviewerOptions} />
              <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} />
            </>
          )}
        </>
      ) : (
        <>
          <FilterBar
            key="learners"
            filters={[
              { param: "q", kind: "search", label: t("peer.admin.search"), placeholder: t("peer.admin.searchLearners") },
              { param: "coverage", kind: "select", label: t("peer.admin.progressLabel"), placeholder: t("peer.admin.anyProgress"), options: coverageOptions, className: "sm:w-60" },
            ]}
          />
          {total === 0 ? (
            <EmptyState
              icon={<Icon.Users />}
              title={filtered ? t("peer.admin.noLearnersMatch") : t("peer.admin.noSubmissionsTitle")}
              description={filtered ? t("peer.admin.noMatchBody") : t("peer.admin.noSubmissionsBody")}
            />
          ) : (
            <>
              <PeerCoverageList rows={overview.coverage.slice(0, limit)} reviewerOptions={overview.reviewerOptions} />
              <ListFooter shown={Math.min(limit, total)} total={total} size={size} pages={pages} />
            </>
          )}
        </>
      )}
    </div>
  );
}
