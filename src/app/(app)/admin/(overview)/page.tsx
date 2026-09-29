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
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Admin overview" };

function subtitleFor(liveCount: number, evalCount: number): string {
  const classes = `${liveCount} upcoming live ${liveCount === 1 ? "class" : "classes"}`;
  const evals = `${evalCount} ${evalCount === 1 ? "evaluation" : "evaluations"} scheduled`;
  if (liveCount && evalCount) return `You have ${classes} and ${evals}.`;
  if (liveCount) return `You have ${classes}.`;
  if (evalCount) return `You have ${evals}.`;
  return "Manage your courses and batches at a glance";
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export default async function AdminOverviewPage() {
  const user = await requireRole(["course_creator", "moderator", "batch_evaluator"], "/admin");
  // Daily payment reminders (no scheduler): idempotent, at most once per unpaid order per day.
  if (isAdmin(user)) await runAutomaticPaymentReminders();
  const [settings, data] = await Promise.all([getSettings(), getAdminOverview(user)]);
  const f = settings.features;
  const moderator = isModerator(user);
  const creator = hasRole(user, "course_creator", "moderator");
  const evaluator = hasRole(user, "batch_evaluator", "moderator");
  const k = data.kpis;
  const pendingGrading = k.pendingAssignments + k.pendingQuizzes;

  const links: QuickLink[] = [];
  if (creator && f.courses) {
    links.push({ label: "Courses", description: "Create, edit and publish courses", href: "/admin/courses", icon: "Book", count: data.counts.courses });
  }
  if (f.batches) {
    links.push({ label: "Batches", description: "Cohorts, live classes and timetables", href: "/admin/batches", icon: "Users", count: data.counts.batches });
  }
  if (moderator && f.programs) {
    links.push({ label: "Programs", description: "Group courses into learning paths", href: "/admin/programs", icon: "Layers", count: data.counts.programs });
  }
  if (creator) {
    links.push({ label: "Quizzes", description: "Build quizzes and review attempts", href: "/admin/quizzes", icon: "ListChecks", count: data.counts.quizzes });
    links.push({ label: "Question bank", description: "Reusable questions for quizzes", href: "/admin/questions", icon: "Question", count: data.counts.questions });
  }
  links.push({ label: "Assignments", description: "Assignments and their submissions", href: "/admin/assignments", icon: "ClipboardList", count: data.counts.assignments });
  links.push({
    label: "Grading queue",
    description: "Assignment submissions waiting for review",
    href: "/admin/assignments/submissions?status=not_graded",
    icon: "Inbox",
    count: k.pendingAssignments,
    highlight: k.pendingAssignments > 0,
  });
  if (creator) {
    links.push({
      label: "Quiz submissions",
      description: "Open-ended answers that need marks",
      href: "/admin/quizzes/submissions",
      icon: "Target",
      count: k.pendingQuizzes,
      highlight: k.pendingQuizzes > 0,
    });
  }
  if (creator && f.programmingExercises) {
    links.push({ label: "Exercises", description: "Programming exercises and test cases", href: "/admin/exercises", icon: "Code", count: data.counts.exercises });
  }
  if (evaluator && f.certifications) {
    links.push({ label: "Certificates", description: "Issue and manage certificates", href: "/admin/certificates", icon: "Certificate", count: data.counts.certificates });
  }
  if (moderator && f.jobs) {
    links.push({ label: "Job openings", description: "Post jobs and review applications", href: "/admin/jobs", icon: "Briefcase", count: data.counts.jobs });
  }
  if (moderator) {
    links.push({ label: "Members", description: "People, roles and access", href: "/admin/members", icon: "UserPlus", count: data.counts.members });
  }
  if (creator && f.statistics) {
    links.push({ label: "Statistics", description: "Signups, enrollments and completions", href: "/statistics", icon: "BarChart" });
  }
  if (isAdmin(user)) {
    links.push({ label: "Transactions", description: "Payments and refunds", href: "/admin/settings/transactions", icon: "Receipt" });
    links.push({ label: "Coupons", description: "Discount codes for checkout", href: "/admin/settings/coupons", icon: "Ticket" });
    links.push({ label: "Settings", description: "Branding, features and learning rules", href: "/admin/settings", icon: "Settings" });
  }

  const showEmptyState = data.createdCourses.length === 0 && data.upcomingBatches.length === 0;

  return (
    <div className="animate-fade-in space-y-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Hey, {user.name} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-base text-ink-muted">{subtitleFor(data.upcomingCounts.liveClasses, data.upcomingCounts.evaluations)}</p>
          {data.scope === "mine" && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">
              <Icon.Info className="size-3.5" /> Numbers cover the courses and batches you teach.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {creator && f.statistics && (
            <ButtonLink href="/statistics" variant="outline" leftIcon={<Icon.BarChart className="size-4" />}>
              Statistics
            </ButtonLink>
          )}
          {creator && f.courses && (
            <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create course
            </ButtonLink>
          )}
        </div>
      </header>

      <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          href={creator ? "/admin/courses" : undefined}
          label="Courses"
          value={formatNumber(k.courses)}
          hint={`${k.published} published · ${k.courses - k.published} draft`}
          icon={<Icon.Book className="size-4" />}
        />
        <KpiCard
          label="Learners"
          value={formatNumber(k.learners)}
          hint={data.scope === "site" ? `${k.newSignupsThisWeek} new signups this week` : "Enrolled in your courses and batches"}
          icon={<Icon.Users className="size-4" />}
        />
        <KpiCard
          label="Enrollments this week"
          value={formatNumber(k.enrollmentsThisWeek)}
          icon={<Icon.UserPlus className="size-4" />}
          trend={k.enrollmentTrend !== null ? { value: k.enrollmentTrend, label: `vs ${k.enrollmentsLastWeek} last week` } : undefined}
          hint={k.enrollmentTrend === null ? "No enrollments in the last two weeks" : undefined}
        />
        <KpiCard
          label="Completions"
          value={formatNumber(k.completions)}
          hint={`${k.completionRate}% completion rate`}
          icon={<Icon.Trophy className="size-4" />}
        />
        {f.courses && (
          <KpiCard
            href={isAdmin(user) ? "/admin/settings/transactions" : undefined}
            label="Revenue this month"
            value={money(k.revenueThisMonth, k.revenueCurrency)}
            icon={<Icon.CreditCard className="size-4" />}
            trend={k.revenueTrend !== null ? { value: k.revenueTrend, label: "vs last month" } : undefined}
            hint={k.revenueTrend === null ? `${k.paymentsThisMonth} payments` : undefined}
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
          label="Pending grading"
          value={formatNumber(pendingGrading)}
          hint={`${k.pendingAssignments} assignments · ${k.pendingQuizzes} quizzes`}
          icon={<Icon.ClipboardList className="size-4" />}
        />
        <KpiCard
          href={moderator ? "/admin/courses?tab=under_review" : undefined}
          label="Courses under review"
          value={formatNumber(k.underReview)}
          hint={k.underReview ? "Waiting for a moderator" : "Nothing waiting for review"}
          icon={<Icon.ShieldCheck className="size-4" />}
        />
        <KpiCard
          label="Published"
          value={formatNumber(k.published)}
          hint={k.courses ? `${Math.round((k.published / k.courses) * 100)}% of courses are live` : "No courses yet"}
          icon={<Icon.Globe className="size-4" />}
        />
      </section>

      <DashboardSection title="Quick links" id="quick-links">
        <QuickLinksGrid links={links} />
      </DashboardSection>

      {data.evaluations.length > 0 && (
        <DashboardSection title="Upcoming Evaluations" id="evaluations" href={`/user/${user.username}/schedule`} linkLabel="My schedule">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.evaluations.map((e) => (
              <EvaluationCard key={e.id} evaluation={e} variant="evaluator" scheduleHref={`/user/${user.username}/schedule`} />
            ))}
          </div>
        </DashboardSection>
      )}

      {data.liveClasses.length > 0 && (
        <DashboardSection title="Upcoming Live Classes" id="live-classes" href="/admin/batches" linkLabel="Manage batches">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.liveClasses.map((c) => (
              <LiveClassCard key={c.id} liveClass={c} />
            ))}
          </div>
        </DashboardSection>
      )}

      <div className="grid gap-8 xl:grid-cols-3">
        <DashboardSection title="Recent enrollments" id="recent-enrollments" className="xl:col-span-2">
          <RecentEnrollmentsTable rows={data.recentEnrollments} />
        </DashboardSection>
        <DashboardSection
          title={data.scope === "site" ? "Recent signups" : "Newest learners"}
          id="recent-signups"
          href={moderator ? "/admin/members" : undefined}
          linkLabel="All members"
        >
          <RecentSignupsList users={data.recentSignups} showEmail={moderator} />
        </DashboardSection>
      </div>

      <DashboardSection title="Recent activity" id="activity">
        <ActivityFeed items={data.activity} />
      </DashboardSection>

      {showEmptyState ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <Icon.GraduationCap className="size-10 text-ink-faint" />
          <h2 className="mt-3 text-lg font-semibold text-ink">No courses created</h2>
          <p className="mt-1 max-w-md text-sm text-ink-muted">There are no courses currently. Create your first course to get started!</p>
          {creator && (
            <ButtonLink href="/admin/courses/new" className="mt-5" leftIcon={<Icon.Plus className="size-4" />}>
              Create Course
            </ButtonLink>
          )}
        </Card>
      ) : (
        <>
          {data.createdCourses.length > 0 && (
            <DashboardSection title="Courses Created" id="courses-created" href="/admin/courses">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.createdCourses.map((c) => (
                  <DashboardCourseCard key={c.id} course={c} />
                ))}
              </div>
            </DashboardSection>
          )}
          {data.upcomingBatches.length > 0 && (
            <DashboardSection title="Upcoming Batches" id="upcoming-batches" href="/admin/batches">
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
