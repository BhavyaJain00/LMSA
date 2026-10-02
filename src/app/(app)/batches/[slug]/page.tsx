import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Batch, BatchSummary, User } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { Markdown } from "@/lib/markdown";
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
import { getLocale, getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";

type PublicT = Translator<MessageKey<"public">>;

export async function generateMetadata(props: PageProps<"/batches/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [batch, settings, t, locale] = await Promise.all([getBatchBySlug(slug), getSettings(), getT("public"), getLocale()]);
  // Unpublished batches are private (enrolled learners and staff only): never indexed.
  if (!batch || !isBatchPublic(batch) || !settings.features.batches) return notFoundMetadata(batch ? batch.title : t("batches.detail.metaFallback"));
  return pageMetadata(
    {
      title: batch.title,
      description: [batch.description, batch.details],
      path: batchPath(batch.slug),
      locale,
      generatedImage: true,
    },
    settings,
  );
}

async function BatchHero({ batch, isManager, enrolled, showFacts }: { batch: BatchSummary; isManager: boolean; enrolled: boolean; showFacts: boolean }) {
  const [t, locale] = await Promise.all([getT("public"), getLocale()]);
  const startsAt = zonedTimeToUtc(batch.startDate, batch.startTime, batch.timezone);
  return (
    <header className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BatchStatusBadge status={batch.status} />
        {isManager && (batch.published ? <Badge tone="success">{t("batches.detail.published")}</Badge> : <Badge tone="warning">{t("card.unpublished")}</Badge>)}
        {enrolled && (
          <Badge tone="dark">
            <Icon.Check className="size-3" /> {t("enroll.enrolled")}
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
            <Icon.Calendar className="size-4 text-ink-faint" /> {formatDateRange(batch.startDate, batch.endDate, locale)}
          </span>
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <Icon.Clock className="size-4 text-ink-faint" /> {formatClockRange(batch.startTime, batch.endTime, locale)}
            <span className="text-ink-faint">· {Number.isNaN(startsAt) ? batch.timezone : formatTzLabel(batch.timezone, startsAt)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {batch.medium === "online" ? <Icon.Monitor className="size-4 text-ink-faint" /> : <Icon.MapPin className="size-4 text-ink-faint" />}
            {batch.medium === "online" ? t("batches.medium.online") : t("batches.medium.inPerson")}
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

async function OverviewContent({
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
  const [t, locale] = await Promise.all([getT("public"), getLocale()]);
  const milestones = batch.timetable.filter((item) => item.milestone).length;
  const certificateDescription = batch.evaluationEndDate
    ? t("batches.included.certificateUntil", { date: formatDayKey(batch.evaluationEndDate, "short", locale) })
    : t("batches.included.certificate");
  return (
    <div className="min-w-0 space-y-10">
      {batch.details && (
        <section aria-labelledby="batch-details">
          <h2 id="batch-details" className="sr-only">
            {t("batches.detail.details")}
          </h2>
          <Markdown content={batch.details} />
        </section>
      )}

      <section aria-labelledby="whats-included">
        <h2 id="whats-included" className="mb-4 text-xl font-semibold tracking-tight text-ink">
          {t("batches.included.title")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <IncludedTile
            icon={<Icon.BookOpen />}
            title={t("catalog.courseCount", { count: courses.length })}
            description={courses.length ? courses.map((c) => c.title).join(", ") : t("batches.included.coursesLater")}
          />
          <IncludedTile
            icon={<Icon.ClipboardList />}
            title={t("batches.assessmentCount", { count: assessmentCount })}
            description={assessmentCount ? t("batches.included.assessments") : t("batches.included.noAssessments")}
          />
          <IncludedTile
            icon={<Icon.Video />}
            title={t("batches.liveClassCount", { count: liveClassCount })}
            description={liveClassCount ? t("batches.included.liveClasses") : t("batches.included.liveClassesLater")}
          />
          <IncludedTile
            icon={batch.certification ? <Icon.Award /> : <Icon.Calendar />}
            title={batch.certification ? t("batches.certificate") : t("batches.included.schedule")}
            description={
              batch.certification
                ? certificateDescription
                : milestones
                  ? t("batches.included.milestones", { count: milestones })
                  : t("batches.included.scheduleDescription")
            }
          />
        </ul>
      </section>

      {batch.instructors.length > 0 && (
        <section aria-labelledby="batch-instructors">
          <h2 id="batch-instructors" className="mb-4 text-xl font-semibold tracking-tight text-ink">
            {t("batches.detail.instructors", { count: batch.instructors.length })}
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
            {t("batches.detail.tabs.courses")}
          </h2>
          <BatchCourseGrid courses={courses} />
        </section>
      )}
    </div>
  );
}

function buildTabs(
  batch: Batch,
  opts: { liveClasses: boolean; discussions: boolean; enrolled: boolean; isManager: boolean; counts: Record<string, number> },
  t: PublicT,
): (TabItem & { value: BatchDetailTab })[] {
  const tabs: (TabItem & { value: BatchDetailTab })[] = [
    { value: "overview", label: t("batches.detail.tabs.overview"), icon: <Icon.Info className="hidden size-4 sm:block" /> },
    { value: "courses", label: t("batches.detail.tabs.courses"), icon: <Icon.BookOpen className="hidden size-4 sm:block" />, count: batch.courseIds.length },
    { value: "assessments", label: t("batches.detail.tabs.assessments"), icon: <Icon.ClipboardList className="hidden size-4 sm:block" />, count: batch.assessments.length },
  ];
  if (opts.liveClasses) tabs.push({ value: "classes", label: t("batches.detail.tabs.classes"), icon: <Icon.Video className="hidden size-4 sm:block" />, count: opts.counts.classes });
  tabs.push({ value: "announcements", label: t("batches.detail.tabs.announcements"), icon: <Icon.Mail className="hidden size-4 sm:block" />, count: opts.counts.announcements });
  if (opts.discussions) tabs.push({ value: "discussions", label: t("batches.detail.tabs.discussions"), icon: <Icon.MessageCircle className="hidden size-4 sm:block" /> });
  tabs.push({ value: "timetable", label: t("batches.detail.tabs.timetable"), icon: <Icon.Calendar className="hidden size-4 sm:block" /> });
  if (opts.enrolled || opts.isManager) tabs.push({ value: "feedback", label: t("batches.detail.tabs.feedback"), icon: <Icon.Star className="hidden size-4 sm:block" /> });
  return tabs;
}

export default async function BatchPage(props: PageProps<"/batches/[slug]">) {
  const [{ slug }, sp, user, settings, t] = await Promise.all([props.params, props.searchParams, getCurrentUser(), getSettings(), getT("public")]);
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
  }, t);
  const requested = typeof sp.tab === "string" ? sp.tab : "overview";
  const active: BatchDetailTab = tabs.some((tab) => tab.value === requested) ? (requested as BatchDetailTab) : "overview";

  return (
    <div className="animate-fade-in pb-10">
      <JsonLd data={structuredData} />
      {crumbs}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <BatchHero batch={summary} isManager={isManager} enrolled={enrolled} showFacts />
        {isManager && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <ButtonLink href={`/admin/batches/${batch.id}`} leftIcon={<Icon.Settings className="size-4" />}>
              {t("batches.manageBatch")}
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
  const [t, locale] = await Promise.all([getT("public"), getLocale()]);
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
            title={t("batches.courses.emptyTitle")}
            description={t("batches.courses.emptyDescription")}
            action={isManager ? <ButtonLink href={manageHref("courses")}>{t("batches.courses.add")}</ButtonLink> : null}
          />
        );
      }
      const done = courses.filter((c) => c.completed).length;
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t("batches.courses.curriculum")}</h2>
            <p className="text-sm text-ink-muted">
              {batch.assessments.length ? t("batches.courses.introWithAssessments") : t("batches.courses.intro")}
              {enrolled && <> {t("batches.courses.completed", { done, total: courses.length })}</>}
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
              title={t("batches.assessments.emptyTitle")}
              description={t("batches.assessments.emptyDescription")}
              action={isManager ? <ButtonLink href={manageHref("assessments")}>{t("batches.assessments.add")}</ButtonLink> : null}
            />
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">{t("batches.detail.tabs.assessments")}</h2>
                <p className="text-sm text-ink-muted">{enrolled ? t("batches.assessments.passed", { passed, total: rows.length }) : t("batches.assessments.description")}</p>
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
                {t("batches.classes.schedule")}
              </ButtonLink>
            </div>
          )}
          <LiveClassList
            classes={classes}
            serverNow={now}
            isManager={isManager}
            canJoin
            emptyAction={isManager ? <ButtonLink href={manageHref("classes")}>{t("batches.classes.schedule")}</ButtonLink> : null}
          />
        </div>
      );
    }
    case "announcements": {
      const announcements = await getBatchAnnouncements(batch.id);
      return (
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{t("batches.detail.tabs.announcements")}</h2>
            {isManager && (
              <ButtonLink href={manageHref("announcements")} size="sm" leftIcon={<Icon.Send className="size-4" />}>
                {t("batches.announcements.new")}
              </ButtonLink>
            )}
          </div>
          {announcements.length ? (
            <AnnouncementList announcements={announcements} showCc={isManager} />
          ) : (
            <EmptyState icon={<Icon.Megaphone />} title={t("batches.announcements.emptyTitle")} description={t("batches.announcements.emptyDescription")} />
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
                {t("batches.timetable.edit")}
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
            title={t("batches.feedback.closedTitle")}
            description={t("batches.feedback.closedDescription", { date: formatDayKey(batch.endDate, "long", locale) })}
          />
        );
      }
      return (
        <Card className="max-w-3xl">
          <CardHeader title={t("global.batchFeedback.title")} description={t("batches.feedback.description")} />
          <CardBody>
            <BatchFeedbackForm batchId={batch.id} existing={own} />
          </CardBody>
        </Card>
      );
    }
  }
}
