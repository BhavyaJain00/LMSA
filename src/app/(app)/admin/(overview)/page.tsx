import { hasRole, isAdmin, isModerator, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getAdminOverview } from "@/lib/data/dashboard";
import { runAutomaticPaymentReminders } from "@/lib/data/commerce";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { PageContainer } from "@/components/ui/page";
import {
  AttentionList,
  EventList,
  OverviewSection,
  RecentEnrollmentsList,
  StatTile,
  type AttentionItem,
} from "@/components/dashboard/admin/overview-blocks";
import { OverviewEventRow, type OverviewEvent } from "@/components/dashboard/admin/coming-up-row";
import type { Metadata } from "next";
import { getFormatter, getT } from "@/i18n/server";
import type { Formatters } from "@/i18n/formatters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.overview.metaTitle") };
}

/** Rows shown in "Coming up" and "Recent enrollments". */
const COMING_UP_MAX = 3;
const RECENT_MAX = 5;

function money(f: Formatters, cents: number, currency: string): string {
  try {
    return f.number(cents / 100, { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export default async function AdminOverviewPage() {
  const user = await requireRole(["course_creator", "moderator", "batch_evaluator"], "/admin");
  // Daily payment reminders (no scheduler): idempotent, at most once per unpaid order per day.
  if (isAdmin(user)) await runAutomaticPaymentReminders();
  const [settings, data, t, ta, fmt] = await Promise.all([getSettings(), getAdminOverview(user), getT("admin"), getT("account"), getFormatter()]);
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
  const admin = isAdmin(user);
  const moderator = isModerator(user);
  const creator = hasRole(user, "course_creator", "moderator");
  const k = data.kpis;
  const scheduleHref = `/user/${user.username}/schedule`;

  /* Needs your attention: every pending count the overview computes (rows with zero are hidden). */
  const attention: AttentionItem[] = [
    {
      key: "assignments",
      icon: "ClipboardList",
      count: k.pendingAssignments,
      label: t("pages.overview.attention.assignments"),
      description: t("pages.overview.links.gradingQueue.description"),
      href: "/admin/assignments/submissions?status=not_graded",
    },
    {
      key: "quizzes",
      icon: "ListChecks",
      count: k.pendingQuizzes,
      label: t("pages.overview.attention.quizzes"),
      description: t("pages.overview.links.quizSubmissions.description"),
      // Quiz submission review is limited to course creators and moderators.
      href: creator ? "/admin/quizzes/submissions" : undefined,
    },
    {
      key: "review",
      icon: "ShieldCheck",
      count: k.underReview,
      label: moderator ? t("pages.overview.attention.reviewModerator") : t("pages.overview.attention.reviewMine"),
      description: moderator ? t("pages.overview.attention.reviewModeratorHint") : t("pages.overview.kpi.waitingModerator"),
      href: moderator ? "/admin/courses?tab=under_review" : undefined,
    },
  ];

  /* Coming up: the next live classes and evaluations, soonest first. */
  const events: OverviewEvent[] = [
    ...data.liveClasses.map((c): OverviewEvent => {
      // startUrl is only present for viewers allowed to start the meeting.
      const startHref = c.startUrl || c.joinUrl;
      return {
        kind: "live",
        id: c.id,
        title: c.title,
        meta: t("pages.overview.comingUp.liveMeta", { batch: c.batch.title }),
        href: `/batches/${c.batch.slug}?tab=classes#class-${c.id}`,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        timezone: c.timezone,
        action: c.canStart && startHref ? { href: startHref, kind: "start" } : c.joinUrl ? { href: c.joinUrl, kind: "join" } : undefined,
      };
    }),
    ...data.evaluations.map(
      (e): OverviewEvent => ({
        kind: "evaluation",
        id: e.id,
        title: e.courseTitle,
        meta: e.member ? t("pages.overview.comingUp.evaluationWith", { name: e.member.name }) : t("pages.overview.comingUp.evaluation"),
        href: scheduleHref,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        timezone: e.timezone,
        action: e.meetingLink ? { href: e.meetingLink, kind: "joinCall" } : undefined,
      }),
    ),
  ]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, COMING_UP_MAX);
  const comingUpLink =
    data.liveClasses.length > 0
      ? { href: "/admin/batches", label: t("pages.overview.sections.manageBatches") }
      : { href: scheduleHref, label: t("pages.overview.sections.mySchedule") };

  return (
    <PageContainer className="animate-fade-in space-y-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{t("pages.overview.greeting", { name: firstName(user.name) })}</h1>
          <p className="mt-1 text-base text-ink-muted">{subtitle}</p>
        </div>
        {creator && (f.statistics || f.courses) && (
          <div className="flex flex-wrap gap-2">
            {creator && f.statistics && (
              <ButtonLink href="/statistics" variant="secondary" leftIcon={<Icon.BarChart className="size-4" />}>
                {t("pages.overview.links.statistics.label")}
              </ButtonLink>
            )}
            {creator && f.courses && (
              <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("pages.overview.createCourse")}
              </ButtonLink>
            )}
          </div>
        )}
      </header>

      <section aria-label={t("pages.overview.kpi.label")} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("pages.overview.kpi.learners")}
            value={formatNumber(k.learners)}
            hint={data.scope === "site" ? t("pages.overview.kpi.newSignups", { count: k.newSignupsThisWeek }) : t("pages.overview.kpi.learnersMine")}
          />
          <StatTile
            label={t("pages.overview.kpi.enrollmentsWeek")}
            value={formatNumber(k.enrollmentsThisWeek)}
            trend={k.enrollmentTrend !== null ? { value: k.enrollmentTrend, label: t("pages.overview.kpi.vsLastWeek", { count: k.enrollmentsLastWeek }) } : undefined}
            hint={k.enrollmentTrend === null ? t("pages.overview.kpi.noEnrollments") : undefined}
          />
          <StatTile
            label={t("pages.overview.kpi.completions")}
            value={formatNumber(k.completions)}
            hint={t("pages.overview.kpi.completionRate", { rate: fmt.percent(k.completionRate) })}
          />
          {admin && f.courses ? (
            <StatTile
              href="/admin/settings/transactions"
              label={t("pages.overview.kpi.revenue")}
              value={money(fmt, k.revenueThisMonth, k.revenueCurrency)}
              trend={k.revenueTrend !== null ? { value: k.revenueTrend, label: t("pages.overview.kpi.vsLastMonth") } : undefined}
              hint={k.revenueTrend === null ? t("pages.overview.kpi.payments", { count: k.paymentsThisMonth }) : undefined}
            />
          ) : (
            <StatTile
              href={creator ? "/admin/courses" : undefined}
              label={t("pages.overview.kpi.published")}
              value={formatNumber(k.published)}
              hint={
                k.courses
                  ? t("pages.overview.kpi.liveShare", { rate: fmt.percent(Math.round((k.published / k.courses) * 100)) })
                  : t("pages.overview.kpi.noCourses")
              }
            />
          )}
        </div>
        {data.scope === "mine" && (
          <p className="flex items-center gap-1.5 text-meta text-ink-faint">
            <Icon.Info className="size-4 shrink-0" aria-hidden="true" />
            {t("pages.overview.scopeMine")}
          </p>
        )}
      </section>

      <OverviewSection id="attention" title={t("pages.overview.attention.title")} description={t("pages.overview.attention.description")}>
        <AttentionList items={attention} />
      </OverviewSection>

      {events.length > 0 && (
        <OverviewSection
          id="coming-up"
          title={t("pages.overview.comingUp.title")}
          description={t("pages.overview.comingUp.description")}
          href={comingUpLink.href}
          linkLabel={comingUpLink.label}
        >
          <EventList>
            {events.map((event) => (
              <OverviewEventRow key={`${event.kind}:${event.id}`} event={event} />
            ))}
          </EventList>
        </OverviewSection>
      )}

      <OverviewSection
        id="recent-enrollments"
        title={t("pages.overview.sections.recentEnrollments")}
        description={t("pages.overview.recent.description")}
        href={moderator ? "/admin/members" : undefined}
        linkLabel={t("pages.overview.sections.allMembers")}
      >
        <RecentEnrollmentsList
          rows={data.recentEnrollments.slice(0, RECENT_MAX)}
          empty={
            creator && k.courses === 0 ? (
              <>
                <span className="block font-semibold text-ink">{t("pages.overview.empty.title")}</span>
                <span className="mt-0.5 block text-sm">{t("pages.overview.empty.description")}</span>
              </>
            ) : (
              ta("dashboard.admin.noEnrollments")
            )
          }
        />
      </OverviewSection>
    </PageContainer>
  );
}
