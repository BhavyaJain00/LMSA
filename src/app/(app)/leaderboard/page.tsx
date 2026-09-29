import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getLeaderboard, getLeaderboardCourses, parsePeriod, type LeaderboardPeriod } from "@/lib/services/points";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { EarnPointsCard, LevelTiersCard } from "@/components/gamification/how-points-work";
import { LeaderboardCourseFilter } from "@/components/gamification/leaderboard-filters";
import { LeaderboardTable } from "@/components/gamification/leaderboard-table";
import { formatPoints } from "@/components/gamification/levels";
import { Podium } from "@/components/gamification/podium";
import { ViewerStanding } from "@/components/gamification/viewer-standing";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "See the most active learners this week, this month and of all time.",
};

const emptyCopy: Record<LeaderboardPeriod, { title: string; description: string }> = {
  week: {
    title: "No points earned this week yet",
    description: "The weekly board resets every Monday. Complete a lesson or pass a quiz to be the first on it.",
  },
  month: {
    title: "No points earned this month yet",
    description: "The monthly board starts fresh on the 1st. Every lesson, quiz and helpful reply counts.",
  },
  all: {
    title: "Nobody has earned points yet",
    description: "Points are awarded for completing lessons, passing quizzes, finishing courses and helping others.",
  },
};

export default async function LeaderboardPage(props: PageProps<"/leaderboard">) {
  const [sp, user, settings] = await Promise.all([props.searchParams, getCurrentUser(), getSettings()]);
  const period = parsePeriod(sp.period);
  const courseParam = typeof sp.course === "string" && sp.course ? sp.course : null;
  const query = new URLSearchParams();
  if (period !== "week") query.set("period", period);
  if (courseParam) query.set("course", courseParam);
  const selfHref = query.toString() ? `/leaderboard?${query.toString()}` : "/leaderboard";
  if (!user && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(selfHref)}`);

  const g = settings.gamification;
  if (!g.enabled || !g.showLeaderboard) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Leaderboard" />
        <EmptyState
          icon={<Icon.Trophy />}
          title="The leaderboard is turned off"
          description={
            g.enabled
              ? "Points still count toward your level — you can follow them on your points page."
              : "Points and rankings are not in use on this site right now."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {isAdmin(user) && (
                <ButtonLink href="/admin/settings/gamification" leftIcon={<Icon.Settings className="size-4" />}>
                  Points settings
                </ButtonLink>
              )}
              {g.enabled && user && (
                <ButtonLink href="/leaderboard/points" variant="outline">
                  Your points
                </ButtonLink>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const [board, courses] = await Promise.all([getLeaderboard({ viewer: user, period, courseId: courseParam }), getLeaderboardCourses(user)]);
  const pointsLabel = "pts";
  const podiumRows = board.rows.slice(0, 3);
  const tableRows = board.rows.slice(3);
  const periodLabel = period === "week" ? "this week" : period === "month" ? "this month" : "all time";
  const caption = `Leaderboard for ${periodLabel}${board.course ? ` in ${board.course.title}` : ""}`;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Leaderboard"
        description="Earn points by completing lessons, passing quizzes, finishing courses and helping others in discussions."
        actions={
          user ? (
            <ButtonLink href="/leaderboard/points" variant="outline" size="sm" leftIcon={<Icon.Receipt className="size-4" />}>
              My points
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              param="period"
              variant="pills"
              items={[
                { label: "This week", value: "week" },
                { label: "This month", value: "month" },
                { label: "All time", value: "all" },
              ]}
            />
            <LeaderboardCourseFilter key={board.course?.id ?? "all"} courses={courses} value={board.course?.id ?? null} />
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon.Calendar className="size-3.5 text-ink-faint" />
              {board.rangeLabel}
            </span>
            {board.rankedCount > 0 && (
              <span>
                {formatPoints(board.rankedCount)} ranked {board.rankedCount === 1 ? "member" : "members"} · {formatPoints(board.totalPoints)} points
              </span>
            )}
            {board.excludeStaff && <span>Staff (admins, moderators, instructors and evaluators) are not ranked.</span>}
          </p>

          <ViewerStanding board={board} loginHref={`/login?next=${encodeURIComponent(selfHref)}`} />

          {board.rows.length === 0 ? (
            <EmptyState
              icon={<Icon.Trophy />}
              title={board.course ? `No points in ${board.course.title} ${period === "all" ? "yet" : periodLabel}` : emptyCopy[period].title}
              description={emptyCopy[period].description}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {period !== "all" && (
                    <ButtonLink href={`/leaderboard?period=all${board.course ? `&course=${encodeURIComponent(board.course.id)}` : ""}`} variant="outline" size="sm">
                      See all-time rankings
                    </ButtonLink>
                  )}
                  {board.course ? (
                    <ButtonLink href="/leaderboard" variant="ghost" size="sm">
                      Show all courses
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/courses" size="sm">
                      Browse courses
                    </ButtonLink>
                  )}
                </div>
              }
            />
          ) : (
            <>
              <Podium rows={podiumRows} pointsLabel={pointsLabel} />
              {(tableRows.length > 0 || board.viewer.pinned) && (
                <LeaderboardTable rows={tableRows} pinned={board.viewer.pinned ? board.viewer.row : null} pointsLabel={pointsLabel} trendLabel={board.trendLabel} caption={caption} />
              )}
              <p className="text-xs text-ink-faint">
                Trend shows rank change {board.trendLabel}. Ties share a rank; whoever reached the score first is listed first.
                {board.rankedCount > board.rows.length && ` Showing the top ${board.rows.length} of ${formatPoints(board.rankedCount)}.`}
              </p>
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-6" aria-label="About points">
          <EarnPointsCard points={g.points} />
          <LevelTiersCard currentLevel={board.viewer.level?.level} />
        </aside>
      </div>
    </div>
  );
}
