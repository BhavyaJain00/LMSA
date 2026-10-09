import type { Metadata } from "next";
import Link from "next/link";
import { isCreator, isEvaluator, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { ensureBatchReminders } from "@/lib/data/batches";
import { getCourseSummaries } from "@/lib/data/courses";
import { getStudentDashboard } from "@/lib/data/dashboard";
import { ensureDripNotifications } from "@/lib/services/drip";
import { profileCompleteness } from "@/lib/data/profile";
import type { CourseSummary } from "@/lib/types";
import { CourseGrid } from "@/components/catalog/course-grid";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { PageContainer } from "@/components/ui/page";
import { buildComingUp, ComingUpList } from "@/components/dashboard/home/coming-up";
import { ContinueEmpty, ContinueHero, ContinueRows } from "@/components/dashboard/home/continue-learning";
import { HomeSection } from "@/components/dashboard/home/home-section";
import { TeachingList } from "@/components/dashboard/home/teaching";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("account");
  return { title: t("dashboard.metaTitle") };
}

/** Profiles below this completeness get one slim "Complete your profile" link. */
const PROFILE_NUDGE_BELOW = 60;

/** First word of the display name, for the greeting. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The learner home: a greeting, the course to continue, what is coming up and a few recommendations. Badges,
 * certificates and points live on the profile page, orders under /billing/history and batches at /batches.
 */
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const [settings, t, tc] = await Promise.all([getSettings(), getT("account"), getT("common")]);
  // No scheduler: send any due "batch starts tomorrow" / "live class today" reminders before reading the dashboard.
  // Best effort: a failed reminder write must never break the dashboard.
  if (settings.features.batches) await ensureBatchReminders(user.id).catch(() => 0);
  // Same for "new lesson unlocked" drip notices (never throws).
  await ensureDripNotifications(user.id);
  const data = await getStudentDashboard(user, settings);
  const f = settings.features;

  // The loader picks the recommendations; the catalog card needs the full course summaries, in the same order.
  let recommended: CourseSummary[] = [];
  if (f.courses && data.recommended.length > 0) {
    const catalog = new Map((await getCourseSummaries(user, { tab: "live", sort: "popular" })).map((c) => [c.id, c]));
    recommended = data.recommended.map((c) => catalog.get(c.id)).filter((c): c is CourseSummary => !!c);
  }

  const profileHref = `/user/${user.username}`;
  // Enrollments in unpublished or deleted courses are not shown, so they don't count here.
  const hasEnrollments = data.continueLearning.length > 0 || data.completedCourses.length > 0;
  const [current, ...others] = data.continueLearning;
  const showProfileNudge = profileCompleteness(user).percent < PROFILE_NUDGE_BELOW;
  const comingUp = buildComingUp(data, t);
  const hasComingUp = comingUp.events.length > 0 || comingUp.pending.length > 0;
  const subtitle = current ? t("dashboard.hello.resume") : hasEnrollments ? t("dashboard.hello.next") : t("dashboard.hello.start");

  return (
    <PageContainer className="animate-fade-in space-y-10">
      {/* Greeting */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{t("dashboard.greeting", { name: firstName(user.name) })}</h1>
          <p className="mt-1 text-base text-ink-muted">{subtitle}</p>
          {showProfileNudge && (
            <Link href={`${profileHref}/edit`} className="tap-target mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
              {t("dashboard.completeProfile")}
              <Icon.ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          )}
        </div>
        {data.teaching && (
          <ButtonLink href="/admin" variant="secondary" className="self-start sm:mt-1" leftIcon={<Icon.Layout className="size-4" />}>
            {t("dashboard.adminOverview")}
          </ButtonLink>
        )}
      </header>

      {/* Continue learning */}
      <HomeSection id="continue" title={t("dashboard.sections.continue")} href={hasEnrollments ? "/courses?tab=enrolled" : undefined} linkLabel={tc("actions.viewAll")}>
        {current ? (
          <>
            <ContinueHero item={current} />
            <ContinueRows items={others.slice(0, 2)} />
          </>
        ) : (
          <ContinueEmpty
            icon={hasEnrollments ? <Icon.Trophy /> : <Icon.BookOpen />}
            title={hasEnrollments ? t("dashboard.empty.caughtUp") : t("dashboard.empty.noCourses")}
            body={hasEnrollments ? t("dashboard.empty.caughtUpBody") : t("dashboard.empty.noCoursesBody")}
            action={
              <ButtonLink href="/courses" size="lg" className="w-full font-bold sm:w-auto" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                {t("dashboard.browseCourses")}
              </ButtonLink>
            }
          />
        )}
      </HomeSection>

      {/* Coming up: live classes, evaluations and pending work in one short list */}
      {hasComingUp && (
        <HomeSection
          id="coming-up"
          title={t("dashboard.sections.comingUp")}
          href={f.batches && data.batches.length > 0 ? "/batches?tab=enrolled" : undefined}
          linkLabel={t("dashboard.sections.myBatches")}
        >
          <ComingUpList events={comingUp.events} pending={comingUp.pending} hiddenCount={comingUp.hiddenCount} />
        </HomeSection>
      )}

      {/* Staff: what is waiting in the teaching tools */}
      {data.teaching && (
        <HomeSection id="teaching" title={t("dashboard.teaching.title")} href="/admin" linkLabel={t("dashboard.teaching.open")}>
          <TeachingList
            rows={[
              {
                key: "courses",
                icon: <Icon.Book />,
                label: t("dashboard.teaching.courses"),
                value: data.teaching.courses,
                href: isCreator(user) && f.courses ? "/admin/courses" : undefined,
              },
              { key: "batches", icon: <Icon.Users />, label: t("dashboard.teaching.batches"), value: data.teaching.upcomingBatches, href: f.batches ? "/admin/batches" : undefined },
              {
                key: "grading",
                icon: <Icon.ClipboardList />,
                label: t("dashboard.teaching.grading"),
                value: data.teaching.pendingGrading,
                href: "/admin/assignments/submissions?status=not_graded",
              },
              {
                key: "evaluations",
                icon: <Icon.Calendar />,
                label: t("dashboard.teaching.evaluations"),
                value: data.teaching.evaluations,
                href: isEvaluator(user) ? `${profileHref}/schedule` : undefined,
              },
            ]}
          />
        </HomeSection>
      )}

      {/* Recommended */}
      {recommended.length > 0 && (
        <HomeSection
          id="recommended"
          title={hasEnrollments ? t("dashboard.sections.recommended") : t("dashboard.sections.popular")}
          description={
            user.personaCaptured === false ? (
              <Link href="/persona" className="tap-target inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                {t("dashboard.persona.title")}
                <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
              </Link>
            ) : undefined
          }
          href="/courses"
          linkLabel={tc("actions.viewAll")}
        >
          <CourseGrid courses={recommended} columns="compact" />
        </HomeSection>
      )}
    </PageContainer>
  );
}
