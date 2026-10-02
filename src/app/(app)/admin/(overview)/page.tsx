import { hasRole, isAdmin, isModerator, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getAdminOverview } from "@/lib/data/dashboard";
import { runAutomaticPaymentReminders } from "@/lib/data/commerce";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { DashboardBatchCard, DashboardCourseCard } from "@/components/dashboard/cards";
import { EvaluationCard } from "@/components/dashboard/evaluation-card";
import { LiveClassCard } from "@/components/dashboard/live-class-card";
import { DashboardSection } from "@/components/dashboard/section";
import {
  ActivityFeed,
  KpiCard,
  QuickLinksGrid,
  RecentEnrollmentsTable,
  RecentSignupsList,
  type QuickLink,
} from "@/components/dashboard/admin/overview-blocks";
import type { Metadata } from "next";
import { getFormatter, getT } from "@/i18n/server";
import type { Formatters } from "@/i18n/formatters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.overview.metaTitle") };
}

function money(f: Formatters, cents: number, currency: string): string {
  try {
    return f.number(cents / 100, { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export default async function AdminOverviewPage() {
  const user = await requireRole(["course_creator", "moderator", "batch_evaluator"], "/admin");
  // Daily payment reminders (no scheduler): idempotent, at most once per unpaid order per day.
  if (isAdmin(user)) await runAutomaticPaymentReminders();
  const [settings, data, t, fmt] = await Promise.all([getSettings(), getAdminOverview(user), getT("admin"), getFormatter()]);
  const formatNumber = (n: number) => fmt.number(n);
  const liveCount = data.upcomingCounts.liveClasses;
  const evalCount = data.upcomingCounts.evaluations;
  const subtitle =
    liveCount && evalCount
      ? t("pages.overview.subtitle.both", { live: liveCount, evaluations: evalCount })
      : liveCount
        ? t("pages.overview.subtitle.live", { live: liveCount })
        : evalCount
          ? t("pages.overview.subtitle.evaluations", { evaluations: evalCount })
          : t("pages.overview.subtitle.none");
  const f = settings.features;
  const moderator = isModerator(user);
  const creator = hasRole(user, "course_creator", "moderator");
  const evaluator = hasRole(user, "batch_evaluator", "moderator");
  const k = data.kpis;
  const pendingGrading = k.pendingAssignments + k.pendingQuizzes;

  const links: QuickLink[] = [];
  if (creator && f.courses) {
    links.push({ label: t("pages.overview.links.courses.label"), description: t("pages.overview.links.courses.description"), href: "/admin/courses", icon: "Book", count: data.counts.courses });
  }
  if (f.batches) {
    links.push({ label: t("pages.overview.links.batches.label"), description: t("pages.overview.links.batches.description"), href: "/admin/batches", icon: "Users", count: data.counts.batches });
  }
  if (moderator && f.programs) {
    links.push({ label: t("pages.overview.links.programs.label"), description: t("pages.overview.links.programs.description"), href: "/admin/programs", icon: "Layers", count: data.counts.programs });
  }
  if (creator) {
    links.push({ label: t("pages.overview.links.quizzes.label"), description: t("pages.overview.links.quizzes.description"), href: "/admin/quizzes", icon: "ListChecks", count: data.counts.quizzes });
    links.push({ label: t("pages.overview.links.questions.label"), description: t("pages.overview.links.questions.description"), href: "/admin/questions", icon: "Question", count: data.counts.questions });
  }
  links.push({ label: t("pages.overview.links.assignments.label"), description: t("pages.overview.links.assignments.description"), href: "/admin/assignments", icon: "ClipboardList", count: data.counts.assignments });
  links.push({
    label: t("pages.overview.links.gradingQueue.label"),
    description: t("pages.overview.links.gradingQueue.description"),
    href: "/admin/assignments/submissions?status=not_graded",
    icon: "Inbox",
    count: k.pendingAssignments,
    highlight: k.pendingAssignments > 0,
  });
  if (creator) {
    links.push({
      label: t("pages.overview.links.quizSubmissions.label"),
      description: t("pages.overview.links.quizSubmissions.description"),
      href: "/admin/quizzes/submissions",
      icon: "Target",
      count: k.pendingQuizzes,
      highlight: k.pendingQuizzes > 0,
    });
  }
  if (creator && f.programmingExercises) {
    links.push({ label: t("pages.overview.links.exercises.label"), description: t("pages.overview.links.exercises.description"), href: "/admin/exercises", icon: "Code", count: data.counts.exercises });
  }
  if (evaluator && f.certifications) {
    links.push({ label: t("pages.overview.links.certificates.label"), description: t("pages.overview.links.certificates.description"), href: "/admin/certificates", icon: "Certificate", count: data.counts.certificates });
  }
  if (moderator && f.jobs) {
    links.push({ label: t("pages.overview.links.jobs.label"), description: t("pages.overview.links.jobs.description"), href: "/admin/jobs", icon: "Briefcase", count: data.counts.jobs });
  }
  if (moderator) {
    links.push({ label: t("pages.overview.links.members.label"), description: t("pages.overview.links.members.description"), href: "/admin/members", icon: "UserPlus", count: data.counts.members });
  }
  if (creator && f.statistics) {
    links.push({ label: t("pages.overview.links.statistics.label"), description: t("pages.overview.links.statistics.description"), href: "/statistics", icon: "BarChart" });
  }
  if (isAdmin(user)) {
    links.push({ label: t("pages.overview.links.transactions.label"), description: t("pages.overview.links.transactions.description"), href: "/admin/settings/transactions", icon: "Receipt" });
    links.push({ label: t("pages.overview.links.coupons.label"), description: t("pages.overview.links.coupons.description"), href: "/admin/settings/coupons", icon: "Ticket" });
    links.push({ label: t("pages.overview.links.settings.label"), description: t("pages.overview.links.settings.description"), href: "/admin/settings", icon: "Settings" });
  }

  const showEmptyState = data.createdCourses.length === 0 && data.upcomingBatches.length === 0;

  return (
    <div className="animate-fade-in space-y-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {t("pages.overview.greeting", { name: user.name })} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-base text-ink-muted">{subtitle}</p>
          {data.scope === "mine" && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">
              <Icon.Info className="size-3.5" /> {t("pages.overview.scopeMine")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {creator && f.statistics && (
            <ButtonLink href="/statistics" variant="outline" leftIcon={<Icon.BarChart className="size-4" />}>
              {t("pages.overview.links.statistics.label")}
            </ButtonLink>
          )}
          {creator && f.courses && (
            <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
              {t("pages.overview.createCourse")}
            </ButtonLink>
          )}
        </div>
      </header>

      <section aria-label={t("pages.overview.kpi.label")} className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          href={creator ? "/admin/courses" : undefined}
          label={t("pages.overview.kpi.courses")}
          value={formatNumber(k.courses)}
          hint={t("pages.overview.kpi.coursesHint", { published: k.published, drafts: k.courses - k.published })}
          icon={<Icon.Book className="size-4" />}
        />
        <KpiCard
          label={t("pages.overview.kpi.learners")}
          value={formatNumber(k.learners)}
          hint={data.scope === "site" ? t("pages.overview.kpi.newSignups", { count: k.newSignupsThisWeek }) : t("pages.overview.kpi.learnersMine")}
          icon={<Icon.Users className="size-4" />}
        />
        <KpiCard
          label={t("pages.overview.kpi.enrollmentsWeek")}
          value={formatNumber(k.enrollmentsThisWeek)}
          icon={<Icon.UserPlus className="size-4" />}
          trend={k.enrollmentTrend !== null ? { value: k.enrollmentTrend, label: t("pages.overview.kpi.vsLastWeek", { count: k.enrollmentsLastWeek }) } : undefined}
          hint={k.enrollmentTrend === null ? t("pages.overview.kpi.noEnrollments") : undefined}
        />
        <KpiCard
          label={t("pages.overview.kpi.completions")}
          value={formatNumber(k.completions)}
          hint={t("pages.overview.kpi.completionRate", { rate: fmt.percent(k.completionRate) })}
          icon={<Icon.Trophy className="size-4" />}
        />
        {f.courses && (
          <KpiCard
            href={isAdmin(user) ? "/admin/settings/transactions" : undefined}
            label={t("pages.overview.kpi.revenue")}
            value={money(fmt, k.revenueThisMonth, k.revenueCurrency)}
            icon={<Icon.CreditCard className="size-4" />}
            trend={k.revenueTrend !== null ? { value: k.revenueTrend, label: t("pages.overview.kpi.vsLastMonth") } : undefined}
            hint={k.revenueTrend === null ? t("pages.overview.kpi.payments", { count: k.paymentsThisMonth }) : undefined}
          />
        )}
        <KpiCard
          href={
            k.pendingAssignments
              ? "/admin/assignments/submissions?status=not_graded"
              : k.pendingQuizzes && creator
                ? "/admin/quizzes/submissions"
                : undefined
          }
          label={t("pages.overview.kpi.pendingGrading")}
          value={formatNumber(pendingGrading)}
          hint={t("pages.overview.kpi.pendingHint", { assignments: k.pendingAssignments, quizzes: k.pendingQuizzes })}
          icon={<Icon.ClipboardList className="size-4" />}
        />
        <KpiCard
          href={moderator ? "/admin/courses?tab=under_review" : undefined}
          label={t("pages.overview.kpi.underReview")}
          value={formatNumber(k.underReview)}
          hint={k.underReview ? t("pages.overview.kpi.waitingModerator") : t("pages.overview.kpi.nothingWaiting")}
          icon={<Icon.ShieldCheck className="size-4" />}
        />
        <KpiCard
          label={t("pages.overview.kpi.published")}
          value={formatNumber(k.published)}
          hint={k.courses ? t("pages.overview.kpi.liveShare", { rate: fmt.percent(Math.round((k.published / k.courses) * 100)) }) : t("pages.overview.kpi.noCourses")}
          icon={<Icon.Globe className="size-4" />}
        />
      </section>

      <DashboardSection title={t("pages.overview.sections.quickLinks")} id="quick-links">
        <QuickLinksGrid links={links} />
      </DashboardSection>

      {data.evaluations.length > 0 && (
        <DashboardSection title={t("pages.overview.sections.evaluations")} id="evaluations" href={`/user/${user.username}/schedule`} linkLabel={t("pages.overview.sections.mySchedule")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.evaluations.map((e) => (
              <EvaluationCard key={e.id} evaluation={e} variant="evaluator" scheduleHref={`/user/${user.username}/schedule`} />
            ))}
          </div>
        </DashboardSection>
      )}

      {data.liveClasses.length > 0 && (
        <DashboardSection title={t("pages.overview.sections.liveClasses")} id="live-classes" href="/admin/batches" linkLabel={t("pages.overview.sections.manageBatches")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.liveClasses.map((c) => (
              <LiveClassCard key={c.id} liveClass={c} />
            ))}
          </div>
        </DashboardSection>
      )}

      <div className="grid gap-8 xl:grid-cols-3">
        <DashboardSection title={t("pages.overview.sections.recentEnrollments")} id="recent-enrollments" className="xl:col-span-2">
          <RecentEnrollmentsTable rows={data.recentEnrollments} />
        </DashboardSection>
        <DashboardSection
          title={data.scope === "site" ? t("pages.overview.sections.recentSignups") : t("pages.overview.sections.newestLearners")}
          id="recent-signups"
          href={moderator ? "/admin/members" : undefined}
          linkLabel={t("pages.overview.sections.allMembers")}
        >
          <RecentSignupsList users={data.recentSignups} showEmail={moderator} />
        </DashboardSection>
      </div>

      <DashboardSection title={t("pages.overview.sections.activity")} id="activity">
        <ActivityFeed items={data.activity} />
      </DashboardSection>

      {showEmptyState ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <Icon.GraduationCap className="size-10 text-ink-faint" />
          <h2 className="mt-3 text-lg font-semibold text-ink">{t("pages.overview.empty.title")}</h2>
          <p className="mt-1 max-w-md text-sm text-ink-muted">{t("pages.overview.empty.description")}</p>
          {creator && (
            <ButtonLink href="/admin/courses/new" className="mt-5" leftIcon={<Icon.Plus className="size-4" />}>
              {t("pages.overview.createCourse")}
            </ButtonLink>
          )}
        </Card>
      ) : (
        <>
          {data.createdCourses.length > 0 && (
            <DashboardSection title={t("pages.overview.sections.coursesCreated")} id="courses-created" href="/admin/courses">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.createdCourses.map((c) => (
                  <DashboardCourseCard key={c.id} course={c} />
                ))}
              </div>
            </DashboardSection>
          )}
          {data.upcomingBatches.length > 0 && (
            <DashboardSection title={t("pages.overview.sections.upcomingBatches")} id="upcoming-batches" href="/admin/batches">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {data.upcomingBatches.map((b) => (
                  <DashboardBatchCard key={b.id} batch={b} />
                ))}
              </div>
            </DashboardSection>
          )}
        </>
      )}
    </div>
  );
}
