import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Batch, BatchSummary, User } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { Markdown } from "@/lib/markdown";
import { pluralize } from "@/lib/utils";
import {
  acceptsEnrollment,
  canManageBatch,
  canViewBatch,
  ensureBatchReminders,
  feedbackAverages,
  getBatchAnnouncements,
  getBatchAssessmentRows,
  getBatchBySlug,
  getBatchCertificationInfo,
  getBatchCourseItems,
  getBatchEnrollment,
  getBatchFeedback,
  getBatchLiveClasses,
  getBatchSummary,
  getBatchThreads,
  getBatchTimetable,
  serverNow,
} from "@/lib/data/batches";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { getUpcomingEvaluationsForUser } from "@/lib/data/certificates";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { isBatchPublic } from "@/lib/seo/visibility";
import { batchPath } from "@/lib/seo/content-index";
import { batchTrail } from "@/lib/seo/breadcrumbs";
import { getBatchJsonLd } from "@/lib/data/seo";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { BatchEvaluations } from "@/components/batches/batch-evaluations";
import { BatchStatusBadge, InstructorNames, SeatBadge } from "@/components/batches/batch-meta";
import { EnrollPanel } from "@/components/batches/enroll-panel";
import { BatchCourseGrid } from "@/components/batches/batch-courses";
import { AssessmentList } from "@/components/batches/assessment-list";
import { LiveClassList } from "@/components/batches/live-class-list";
import { AnnouncementList } from "@/components/batches/announcement-list";
import { BatchDiscussions } from "@/components/batches/batch-discussions";
import { TimetableView } from "@/components/batches/timetable-view";
import { BatchFeedbackForm, FeedbackSummaryCard } from "@/components/batches/batch-feedback";
import { LocalTimeRange } from "@/components/batches/local-time";
import { dayKeyInZone, formatClockRange, formatDateRange, formatDayKey, formatTzLabel, zonedTimeToUtc } from "@/components/batches/tz";
import type { BatchCourseItem, BatchDetailTab } from "@/components/batches/types";

export async function generateMetadata(props: PageProps<"/batches/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [batch, settings] = await Promise.all([getBatchBySlug(slug), getSettings()]);
  // Unpublished batches are private (enrolled learners and staff only): never indexed.
  if (!batch || !isBatchPublic(batch) || !settings.features.batches) return notFoundMetadata(batch ? batch.title : "Batch");
  return pageMetadata(
    {
      title: batch.title,
      description: [batch.description, batch.details],
      path: batchPath(batch.slug),
      generatedImage: true,
    },
    settings,
  );
}

function BatchHero({ batch, isManager, enrolled, showFacts }: { batch: BatchSummary; isManager: boolean; enrolled: boolean; showFacts: boolean }) {
  const startsAt = zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone);
  return (
    <header className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BatchStatusBadge status={batch.status} />
        {isManager && (batch.published ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Unpublished</Badge>)}
        {enrolled && (
          <Badge tone="dark">
            <Icon.Check className="size-3" /> Enrolled
          </Badge>
        )}
        {batch.category && <Badge tone="outline">{batch.category.name}</Badge>}
        {showFacts && <SeatBadge seatsLeft={batch.seatsLeft} />}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{batch.title}</h1>
      {batch.description && <p className="mt-3 max-w-3xl text-base text-ink-muted">{batch.description}</p>}
      {batch.instructors.length > 0 && <InstructorNames users={batch.instructors} linked size="sm" className="mt-4" />}
      {showFacts && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon.Calendar className="size-4 text-ink-faint" /> {formatDateRange(batch.startDate, batch.endDate)}
          </span>
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <Icon.Clock className="size-4 text-ink-faint" /> {formatClockRange(batch.startTime, batch.endTime)}
            <span className="text-ink-faint">· {Number.isNaN(startsAt) ? batch.timezone : formatTzLabel(batch.timezone, startsAt)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {batch.medium === "online" ? <Icon.Monitor className="size-4 text-ink-faint" /> : <Icon.MapPin className="size-4 text-ink-faint" />}
            {batch.medium === "online" ? "Online" : "In person"}
          </span>
          <LocalTimeRange date={batch.startDate} startTime={batch.startTime} endTime={batch.endTime} timezone={batch.timezone} className="w-full text-sm" />
        </div>
      )}
    </header>
  );
}

function IncludedTile({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-border bg-surface-1 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-5">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-sm text-ink-muted">{description}</span>
      </span>
    </li>
  );
}

function OverviewContent({
  batch,
  courses,
  liveClassCount,
  assessmentCount,
}: {
  batch: BatchSummary;
  courses: BatchCourseItem[];
  liveClassCount: number;
  assessmentCount: number;
}) {
  const milestones = batch.timetable.filter((t) => t.milestone).length;
  return (
    <div className="min-w-0 space-y-10">
      {batch.details && (
        <section aria-labelledby="batch-details">
          <h2 id="batch-details" className="sr-only">
            Batch details
          </h2>
          <Markdown content={batch.details} />
        </section>
      )}

      <section aria-labelledby="whats-included">
        <h2 id="whats-included" className="mb-4 text-xl font-semibold tracking-tight text-ink">
          What&apos;s included
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <IncludedTile
            icon={<Icon.BookOpen />}
            title={pluralize(courses.length, "course")}
            description={courses.length ? courses.map((c) => c.title).join(", ") : "Courses will be added before the batch starts."}
          />
          <IncludedTile
            icon={<Icon.ClipboardList />}
            title={pluralize(assessmentCount, "assessment")}
            description={assessmentCount ? "Quizzes, assignments and exercises to check your progress." : "No graded assessments in this batch."}
          />
          <IncludedTile
            icon={<Icon.Video />}
            title={pluralize(liveClassCount, "live class", "live classes")}
            description={liveClassCount ? "Join live sessions with the instructors; recordings are shared afterwards." : "Live classes will be scheduled by the instructors."}
          />
          <IncludedTile
            icon={batch.certification ? <Icon.Award /> : <Icon.Calendar />}
            title={batch.certification ? "Certificate" : "Structured schedule"}
            description={
              batch.certification
                ? `Earn a certificate after the final evaluation${batch.evaluationEndDate ? ` (evaluations until ${formatDayKey(batch.evaluationEndDate)})` : ""}.`
                : milestones
                  ? `${pluralize(milestones, "milestone")} on the batch timetable.`
                  : "A shared timetable keeps the cohort on track."
            }
          />
        </ul>
      </section>

      {batch.instructors.length > 0 && (
        <section aria-labelledby="batch-instructors">
          <h2 id="batch-instructors" className="mb-4 text-xl font-semibold tracking-tight text-ink">
            {batch.instructors.length > 1 ? "Instructors" : "Instructor"}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {batch.instructors.map((u) => (
              <li key={u.id}>
                <Link href={`/user/${u.username}`} className="flex items-center gap-3 rounded-card border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong">
                  <Avatar name={u.name} src={u.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{u.name}</span>
                    {u.headline && <span className="block truncate text-sm text-ink-muted">{u.headline}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {courses.length > 0 && (
        <section aria-labelledby="batch-courses">
          <h2 id="batch-courses" className="mb-4 text-xl font-semibold tracking-tight text-ink">
            Courses
          </h2>
          <BatchCourseGrid courses={courses} />
        </section>
      )}
    </div>
  );
}

function buildTabs(batch: Batch, opts: { liveClasses: boolean; discussions: boolean; enrolled: boolean; isManager: boolean; counts: Record<string, number> }): (TabItem & { value: BatchDetailTab })[] {
  const tabs: (TabItem & { value: BatchDetailTab })[] = [
    { value: "overview", label: "Overview", icon: <Icon.Info className="hidden size-4 sm:block" /> },
    { value: "courses", label: "Courses", icon: <Icon.BookOpen className="hidden size-4 sm:block" />, count: batch.courseIds.length },
    { value: "assessments", label: "Assessments", icon: <Icon.ClipboardList className="hidden size-4 sm:block" />, count: batch.assessments.length },
  ];
  if (opts.liveClasses) tabs.push({ value: "classes", label: "Classes", icon: <Icon.Video className="hidden size-4 sm:block" />, count: opts.counts.classes });
  tabs.push({ value: "announcements", label: "Announcements", icon: <Icon.Mail className="hidden size-4 sm:block" />, count: opts.counts.announcements });
  if (opts.discussions) tabs.push({ value: "discussions", label: "Discussions", icon: <Icon.MessageCircle className="hidden size-4 sm:block" /> });
  tabs.push({ value: "timetable", label: "Timetable", icon: <Icon.Calendar className="hidden size-4 sm:block" /> });
  if (opts.enrolled || opts.isManager) tabs.push({ value: "feedback", label: "Feedback", icon: <Icon.Star className="hidden size-4 sm:block" /> });
  return tabs;
}

export default async function BatchPage(props: PageProps<"/batches/[slug]">) {
  const [{ slug }, sp, user, settings] = await Promise.all([props.params, props.searchParams, getCurrentUser(), getSettings()]);
  if (!settings.features.batches) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(`/batches/${slug}`)}`);

  const batch = await getBatchBySlug(slug);
  if (!batch) notFound();
  const enrollment = await getBatchEnrollment(user?.id, batch.id);
  const enrolled = !!enrollment;
  const isManager = canManageBatch(user, batch);
  if (!canViewBatch(user, batch, enrolled)) notFound();
  // Best effort: a failed reminder write must never break the batch page.
  if (user && enrolled) await ensureBatchReminders(user.id).catch(() => 0);

  const now = serverNow();
  const summary = await getBatchSummary(batch, user);
  const db = await getDb();
  const liveClassCount = db.liveClasses.filter((c) => c.batchId === batch.id).length;
  const announcementCount = db.announcements.filter((a) => a.batchId === batch.id).length;
  const tabsMode = enrolled || isManager;
  const structuredData = await getBatchJsonLd(batch);
  const crumbs = <Breadcrumbs items={batchTrail(batch)} structuredData={isBatchPublic(batch)} />;

  if (!tabsMode) {
    const courses = await getBatchCourseItems(batch, user);
    const panel = (
      <EnrollPanel
        batch={summary}
        loggedIn={!!user}
        isManager={isManager}
        enrolled={enrolled}
        acceptsEnrollment={acceptsEnrollment(batch, now)}
        liveClassCount={liveClassCount}
        assessmentCount={batch.assessments.length}
      />
    );
    return (
      <div className="animate-fade-in pb-10">
        <JsonLd data={structuredData} />
        {crumbs}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <BatchHero batch={summary} isManager={false} enrolled={false} showFacts={false} />
            <div className="lg:hidden">{panel}</div>
            <OverviewContent batch={summary} courses={courses} liveClassCount={liveClassCount} assessmentCount={batch.assessments.length} />
          </div>
          <div className="hidden lg:block">
            <div className="sticky top-20">{panel}</div>
          </div>
        </div>
      </div>
    );
  }

  const tabs = buildTabs(batch, {
    liveClasses: settings.features.liveClasses,
    discussions: settings.features.discussions,
    enrolled,
    isManager,
    counts: { classes: liveClassCount, announcements: announcementCount },
  });
  const requested = typeof sp.tab === "string" ? sp.tab : "overview";
  const active: BatchDetailTab = tabs.some((t) => t.value === requested) ? (requested as BatchDetailTab) : "overview";

  return (
    <div className="animate-fade-in pb-10">
      <JsonLd data={structuredData} />
      {crumbs}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <BatchHero batch={summary} isManager={isManager} enrolled={enrolled} showFacts />
        {isManager && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <ButtonLink href={`/admin/batches/${batch.id}`} leftIcon={<Icon.Settings className="size-4" />}>
              Manage batch
            </ButtonLink>
          </div>
        )}
      </div>
      <Tabs items={tabs} className="mt-6" />
      <div className="mt-6">
        <TabContent
          active={active}
          batch={batch}
          summary={summary}
          user={user!}
          enrolled={enrolled}
          isManager={isManager}
          now={now}
          liveClassCount={liveClassCount}
          certificationsEnabled={settings.features.certifications}
        />
      </div>
    </div>
  );
}

async function TabContent({
  active,
  batch,
  summary,
  user,
  enrolled,
  isManager,
  now,
  liveClassCount,
  certificationsEnabled,
}: {
  active: BatchDetailTab;
  batch: Batch;
  summary: BatchSummary;
  user: User;
  enrolled: boolean;
  isManager: boolean;
  now: number;
  liveClassCount: number;
  certificationsEnabled: boolean;
}) {
  const manageHref = (tab: string) => `/admin/batches/${batch.id}?tab=${tab}`;

  switch (active) {
    case "overview": {
      const courses = await getBatchCourseItems(batch, user);
      return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <OverviewContent batch={summary} courses={courses} liveClassCount={liveClassCount} assessmentCount={batch.assessments.length} />
          <div>
            <div className="sticky top-20">
              <EnrollPanel
                batch={summary}
                loggedIn
                isManager={isManager}
                enrolled={enrolled}
                acceptsEnrollment={acceptsEnrollment(batch, now)}
                liveClassCount={liveClassCount}
                assessmentCount={batch.assessments.length}
              />
            </div>
          </div>
        </div>
      );
    }
    case "courses": {
      const courses = await getBatchCourseItems(batch, user);
      if (!courses.length) {
        return (
          <EmptyState
            icon={<Icon.BookOpen />}
            title="No courses added to this batch"
            description="Courses that are part of this batch's curriculum will show up here."
            action={isManager ? <ButtonLink href={manageHref("courses")}>Add courses</ButtonLink> : null}
          />
        );
      }
      const done = courses.filter((c) => c.completed).length;
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Curriculum</h2>
            <p className="text-sm text-ink-muted">
              As a part of this batch&apos;s curriculum you will have to complete the following courses
              {batch.assessments.length ? " and assessments" : ""}.{enrolled && ` ${done} of ${courses.length} completed.`}
            </p>
          </div>
          <BatchCourseGrid courses={courses} showProgress={enrolled} />
        </div>
      );
    }
    case "assessments": {
      const rows = await getBatchAssessmentRows(batch, enrolled ? user.id : null);
      const showCertification = enrolled && batch.certification && certificationsEnabled;
      const [certInfo, evaluations] = showCertification
        ? await Promise.all([getBatchCertificationInfo(batch, user.id, now), getUpcomingEvaluationsForUser(user.id, { courseIds: batch.courseIds })])
        : [null, []];
      const batchEvaluations = evaluations.filter((e) => !e.batchId || e.batchId === batch.id);
      const passed = rows.filter((r) => r.status === "pass").length;
      return (
        <div className="space-y-10">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.ClipboardList />}
              title="No assessments added to this batch"
              description="Quizzes, assignments and programming exercises for this batch will be listed here."
              action={isManager ? <ButtonLink href={manageHref("assessments")}>Add assessments</ButtonLink> : null}
            />
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">Assessments</h2>
                <p className="text-sm text-ink-muted">{enrolled ? `${passed} of ${rows.length} passed.` : "Assessments learners complete as part of this batch."}</p>
              </div>
              <AssessmentList rows={rows} showStatus={enrolled} />
            </div>
          )}
          {certInfo && <BatchEvaluations info={certInfo} evaluations={batchEvaluations} />}
        </div>
      );
    }
    case "classes": {
      const classes = await getBatchLiveClasses(batch.id, user.id, { forManager: isManager });
      return (
        <div className="space-y-4">
          {isManager && (
            <div className="flex justify-end">
              <ButtonLink href={manageHref("classes")} variant="outline" size="sm" leftIcon={<Icon.Plus className="size-4" />}>
                Schedule a class
              </ButtonLink>
            </div>
          )}
          <LiveClassList
            classes={classes}
            serverNow={now}
            isManager={isManager}
            canJoin
            emptyAction={isManager ? <ButtonLink href={manageHref("classes")}>Schedule a class</ButtonLink> : null}
          />
        </div>
      );
    }
    case "announcements": {
      const announcements = await getBatchAnnouncements(batch.id);
      return (
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Announcements</h2>
            {isManager && (
              <ButtonLink href={manageHref("announcements")} size="sm" leftIcon={<Icon.Send className="size-4" />}>
                Make Announcement
              </ButtonLink>
            )}
          </div>
          {announcements.length ? (
            <AnnouncementList announcements={announcements} showCc={isManager} />
          ) : (
            <EmptyState icon={<Icon.Megaphone />} title="No announcements have been made yet for this batch" description="Updates from your instructors will appear here." />
          )}
        </div>
      );
    }
    case "discussions": {
      const threads = await getBatchThreads(batch.id);
      return (
        <div className="mx-auto max-w-3xl">
          <BatchDiscussions batchId={batch.id} threads={threads} viewerId={user.id} canModerate={isManager} />
        </div>
      );
    }
    case "timetable": {
      const entries = await getBatchTimetable(batch, enrolled ? user.id : null);
      return (
        <div className="space-y-4">
          {isManager && (
            <div className="flex justify-end">
              <ButtonLink href={manageHref("timetable")} variant="outline" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                Edit timetable
              </ButtonLink>
            </div>
          )}
          <TimetableView
            entries={entries}
            legends={batch.timetableLegends}
            startDate={batch.startDate}
            endDate={batch.endDate}
            todayKey={dayKeyInZone(now, batch.timezone)}
            timezone={batch.timezone}
          />
        </div>
      );
    }
    case "feedback": {
      const feedback = await getBatchFeedback(batch.id);
      if (isManager && !enrolled) {
        return <FeedbackSummaryCard averages={feedbackAverages(feedback)} feedback={feedback} className="max-w-2xl" />;
      }
      const own = feedback.find((f) => f.userId === user.id) ?? null;
      if (summary.status !== "completed" && !own) {
        return (
          <EmptyState
            icon={<Icon.Star />}
            title="Feedback opens when the batch ends"
            description={`You'll be able to rate the content, instructors and value of this batch after ${formatDayKey(batch.endDate, "long")}.`}
          />
        );
      }
      return (
        <Card className="max-w-3xl">
          <CardHeader title="Feedback" description="Your ratings help instructors improve future cohorts." />
          <CardBody>
            <BatchFeedbackForm batchId={batch.id} existing={own} />
          </CardBody>
        </Card>
      );
    }
  }
}
