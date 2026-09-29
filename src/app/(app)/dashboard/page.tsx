import type { ReactNode } from "react";
import Link from "next/link";
import { isCreator, isEvaluator, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { ensureBatchReminders } from "@/lib/data/batches";
import { getStudentDashboard } from "@/lib/data/dashboard";
import { getOrderHistory } from "@/lib/data/commerce";
import { ensureDripNotifications } from "@/lib/services/drip";
import { profileCompleteness } from "@/lib/data/profile";
import { ProfileCompletenessCard } from "@/components/profile/profile-sections";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { ContinueLearningCard, DashboardBatchCard, DashboardCourseCard, ProgramProgressCard } from "@/components/dashboard/cards";
import { EvaluationCard } from "@/components/dashboard/evaluation-card";
import { LiveClassCard } from "@/components/dashboard/live-class-card";
import { DashboardSection } from "@/components/dashboard/section";
import { StreakWidget } from "@/components/dashboard/streak-widget";
import { CertificateList, MiniStat, PendingWorkList, RecentBadges, YourRankWidget } from "@/components/dashboard/widgets";
import { CommandPaletteButton } from "@/components/command-palette/open-button";
import { formatDate, formatDuration, formatPrice, pluralize } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function subtitleFor(liveCount: number, evalCount: number, hasCoursesInProgress: boolean): string {
  const classes = `${liveCount} upcoming live ${liveCount === 1 ? "class" : "classes"}`;
  const evals = `${evalCount} ${evalCount === 1 ? "evaluation" : "evaluations"} scheduled`;
  if (liveCount && evalCount) return `You have ${classes} and ${evals}.`;
  if (liveCount) return `You have ${classes}.`;
  if (evalCount) return `You have ${evals}.`;
  return hasCoursesInProgress ? "Resume where you left off" : "Find a course and start learning today.";
}

/** One row of the "Teaching at a glance" card; plain text when the viewer cannot open the linked page. */
function TeachingRow({ href, icon, label, value }: { href?: string; icon: ReactNode; label: string; value: number }) {
  const content = (
    <>
      <span className="flex items-center gap-2 text-ink-muted">
        {icon} {label}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </>
  );
  const rowClass = "-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={`${rowClass} hover:bg-surface-2`}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const settings = await getSettings();
  // No scheduler: send any due "batch starts tomorrow" / "live class today" reminders before reading the dashboard.
  // Best effort: a failed reminder write must never break the dashboard.
  if (settings.features.batches) await ensureBatchReminders(user.id).catch(() => 0);
  // Same for "new lesson unlocked" drip notices (never throws).
  await ensureDripNotifications(user.id);
  const [data, orders] = await Promise.all([getStudentDashboard(user, settings), getOrderHistory(user.id)]);
  // Latest completed purchases (paid or refunded) with their invoices.
  const recentOrders = orders.filter((o) => o.status === "paid" || o.status === "refunded").slice(0, 3);
  const profileHref = `/user/${user.username}`;
  // Enrollments in unpublished or deleted courses are not shown, so they don't count here.
  const hasEnrollments = data.continueLearning.length > 0 || data.completedCourses.length > 0;
  const f = settings.features;
  const completeness = profileCompleteness(user);
  const showCompleteProfile = !user.avatarUrl || !user.headline || !user.bio;

  return (
    <div className="animate-fade-in space-y-8">
      {/* Greeting */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Hey, {user.name} <span aria-hidden="true">👋</span>
            </h1>
            <StreakWidget current={data.streak.current} longest={data.streak.longest} activeToday={data.streak.activeToday} />
          </div>
          <p className="mt-1 text-base text-ink-muted">{subtitleFor(data.upcomingCounts.liveClasses, data.upcomingCounts.evaluations, data.continueLearning.length > 0)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CommandPaletteButton className="w-full sm:w-64" />
          {data.teaching && (
            <ButtonLink href="/admin" variant="outline" size="md" leftIcon={<Icon.Layout className="size-4" />}>
              Admin overview
            </ButtonLink>
          )}
        </div>
      </header>

      {user.personaCaptured === false && (
        <Card className="flex flex-col gap-3 border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Icon.Sparkles className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Personalise your learning</p>
              <p className="text-sm text-ink-muted">Answer three quick questions so we can suggest the right courses for you.</p>
            </div>
          </div>
          <ButtonLink href="/persona" size="sm" className="self-start sm:self-auto">
            Get started
          </ButtonLink>
        </Card>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 space-y-10 lg:col-span-2">
          {data.evaluations.length > 0 && (
            <DashboardSection title="Upcoming Evaluations" id="evaluations">
              <div className="grid gap-4 sm:grid-cols-2">
                {data.evaluations.map((e) => (
                  <EvaluationCard key={e.id} evaluation={e} />
                ))}
              </div>
            </DashboardSection>
          )}

          {data.liveClasses.length > 0 && (
            <DashboardSection title="Upcoming Live Classes" id="live-classes" href="/batches?tab=enrolled" linkLabel="My batches">
              <div className="grid gap-4 sm:grid-cols-2">
                {data.liveClasses.map((c) => (
                  <LiveClassCard key={c.id} liveClass={c} />
                ))}
              </div>
            </DashboardSection>
          )}

          <DashboardSection
            title="Continue learning"
            id="continue"
            href={hasEnrollments ? "/courses?tab=enrolled" : undefined}
            linkLabel="My courses"
          >
            {data.continueLearning.length > 0 ? (
              <div className="space-y-4">
                {data.continueLearning.map((item) => (
                  <ContinueLearningCard key={item.courseId} item={item} />
                ))}
              </div>
            ) : hasEnrollments ? (
              <EmptyState
                compact
                icon={<Icon.Trophy />}
                title="You're all caught up"
                description="You have finished every course you enrolled in. Pick something new to keep your streak going."
                action={
                  <ButtonLink href="/courses" size="sm">
                    Browse courses
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                compact
                icon={<Icon.BookOpen />}
                title="You haven't enrolled in any courses yet"
                description="Courses you enroll in appear here with your progress and the next lesson to pick up."
                action={
                  <ButtonLink href="/courses" size="sm">
                    Browse courses
                  </ButtonLink>
                }
              />
            )}
          </DashboardSection>

          {data.pending.items.length > 0 && (
            <DashboardSection
              title="Pending assignments & quizzes"
              description="Work waiting for you in your courses and batches."
              id="pending"
            >
              <PendingWorkList items={data.pending.items} total={data.pending.total} />
            </DashboardSection>
          )}

          {data.batches.length > 0 && (
            <DashboardSection title="My Batches" id="batches" href="/batches">
              <div className="grid gap-4 sm:grid-cols-2">
                {data.batches.slice(0, 4).map((b) => (
                  <DashboardBatchCard key={b.id} batch={b} />
                ))}
              </div>
            </DashboardSection>
          )}

          {data.programs.length > 0 && (
            <DashboardSection title="My Programs" id="programs" href="/programs">
              <div className="grid gap-4 sm:grid-cols-2">
                {data.programs.map((p) => (
                  <ProgramProgressCard key={p.id} program={p} />
                ))}
              </div>
            </DashboardSection>
          )}

          {f.courses && (
            <DashboardSection
              title={hasEnrollments ? "Recommended for you" : "Our Popular Courses"}
              id="recommended"
              href="/courses"
            >
              {data.recommended.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {data.recommended.map((c) => (
                    <DashboardCourseCard key={c.id} course={c} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={<Icon.Sparkles />}
                  title="You're enrolled in every live course"
                  description="New courses will be recommended here as soon as they are published."
                  action={
                    <ButtonLink href="/courses?tab=upcoming" size="sm" variant="outline">
                      See upcoming courses
                    </ButtonLink>
                  }
                />
              )}
            </DashboardSection>
          )}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Your progress">
          {showCompleteProfile && (
            <ProfileCompletenessCard percent={completeness.percent} items={completeness.items.filter((i) => !i.done).slice(0, 4)} editHref={`${profileHref}/edit`} />
          )}

          <Card className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Learning activity</h2>
                <p className="text-xs text-ink-muted">Last 16 weeks</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold leading-tight tabular-nums text-ink">
                  <span aria-hidden="true">🔥 </span>
                  {pluralize(data.streak.current, "day")}
                </p>
                <p className="text-[11px] text-ink-muted">Longest: {pluralize(data.streak.longest, "day")}</p>
              </div>
            </div>
            <ActivityHeatmap days={data.streak.heatmap} />
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <MiniStat icon={<Icon.BookOpen />} label="Enrolled" value={data.stats.enrolled} href="/courses?tab=enrolled" />
            <MiniStat icon={<Icon.Trophy />} label="Completed" value={data.stats.completed} />
            <MiniStat icon={<Icon.CheckCircle />} label="Lessons done" value={data.stats.lessonsCompleted} />
            <MiniStat icon={<Icon.Timer />} label="Time learning" value={data.stats.minutesLearned ? formatDuration(data.stats.minutesLearned * 60) : "0m"} />
          </div>

          <YourRankWidget user={user} />

          {f.badges && <RecentBadges badges={data.badges.recent} total={data.badges.total} profileHref={profileHref} />}
          {f.certifications && <CertificateList certificates={data.certificates} profileHref={profileHref} />}

          {data.completedCourses.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Completed courses</h2>
              <ul className="space-y-2.5">
                {data.completedCourses.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 text-sm">
                    <Icon.CheckCircleFilled className="size-4 shrink-0 text-success" />
                    <Link href={`/courses/${c.slug}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent">
                      {c.title}
                    </Link>
                    <span className="shrink-0 text-xs text-ink-faint">{formatDate(c.completedAt, { year: undefined })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {recentOrders.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Recent orders</h2>
                <Link href="/billing/history" className="text-xs font-medium text-ink-muted hover:text-accent">
                  Orders &amp; invoices
                </Link>
              </div>
              <ul className="space-y-3">
                {recentOrders.map((o) => (
                  <li key={o.id} className="flex items-start gap-2.5 text-sm">
                    <Icon.Receipt className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-ink">{o.itemTitle}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                        <span className="tabular-nums">{formatPrice(o.amount, o.currency)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(o.paidAt ?? o.createdAt, { year: undefined })}</span>
                        {o.status === "refunded" && <span className="text-warning">Refunded</span>}
                      </p>
                    </div>
                    {o.invoiceNumber ? (
                      <Link
                        href={`/billing/invoice/${encodeURIComponent(o.orderId)}`}
                        className="shrink-0 text-xs font-medium text-accent hover:underline"
                        aria-label={`Invoice for ${o.itemTitle}`}
                      >
                        Invoice
                      </Link>
                    ) : (
                      <Link
                        href={`/billing/success/${encodeURIComponent(o.orderId)}`}
                        className="shrink-0 text-xs font-medium text-accent hover:underline"
                        aria-label={`Order details for ${o.itemTitle}`}
                      >
                        Details
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.teaching && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Teaching at a glance</h2>
                <Link href="/admin" className="text-xs font-medium text-ink-muted hover:text-accent">
                  Open overview
                </Link>
              </div>
              <ul className="space-y-2 text-sm">
                <TeachingRow href={isCreator(user) && f.courses ? "/admin/courses" : undefined} icon={<Icon.Book className="size-4" />} label="Your courses" value={data.teaching.courses} />
                <TeachingRow href={f.batches ? "/admin/batches" : undefined} icon={<Icon.Users className="size-4" />} label="Upcoming batches" value={data.teaching.upcomingBatches} />
                <TeachingRow
                  href="/admin/assignments/submissions?status=not_graded"
                  icon={<Icon.ClipboardList className="size-4" />}
                  label="Waiting to be graded"
                  value={data.teaching.pendingGrading}
                />
                <TeachingRow
                  href={isEvaluator(user) ? `${profileHref}/schedule` : undefined}
                  icon={<Icon.Calendar className="size-4" />}
                  label="Evaluations to run"
                  value={data.teaching.evaluations}
                />
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
