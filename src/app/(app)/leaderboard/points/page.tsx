import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PointsReason, User } from "@/lib/types";
import { isAdmin, isModerator, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getUserByUsername } from "@/lib/data/users";
import { getPointsHistory } from "@/lib/services/points";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { EarnPointsCard } from "@/components/gamification/how-points-work";
import { LevelEmblem, LevelMeter } from "@/components/gamification/level-chip";
import { formatPoints, formatSignedPoints } from "@/components/gamification/levels";
import { PageLinks } from "@/components/gamification/page-links";
import { PointsLedger, ReasonBreakdown } from "@/components/gamification/points-history";
import { REASON_META, isPointsReason } from "@/components/gamification/reasons";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Points history" };

export default async function PointsHistoryPage(props: PageProps<"/leaderboard/points">) {
  const [sp, settings] = await Promise.all([props.searchParams, getSettings()]);
  const memberParam = typeof sp.member === "string" ? sp.member.trim() : "";
  const viewer = await requireUser(`/leaderboard/points${memberParam ? `?member=${encodeURIComponent(memberParam)}` : ""}`);
  const g = settings.gamification;

  // Moderators may look at anyone's ledger; everyone else only sees their own.
  let member: User = viewer;
  if (memberParam && memberParam.toLowerCase() !== viewer.username.toLowerCase()) {
    if (!isModerator(viewer)) notFound();
    const target = await getUserByUsername(memberParam);
    if (!target) notFound();
    member = target;
  }
  const isSelf = member.id === viewer.id;
  const title = isSelf ? "Your points" : `${member.name}'s points`;
  const crumbs = [
    ...(g.showLeaderboard && g.enabled ? [{ label: "Leaderboard", href: "/leaderboard" }] : []),
    ...(!isSelf ? [{ label: member.name, href: `/user/${member.username}` }] : []),
    { label: "Points history" },
  ];

  if (!g.enabled) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={title} breadcrumbs={<Breadcrumbs items={crumbs} />} />
        <EmptyState
          icon={<Icon.Trophy />}
          title="Points are turned off"
          description="Points, levels and the leaderboard are not in use on this site right now."
          action={
            isAdmin(viewer) ? (
              <ButtonLink href="/admin/settings/gamification" leftIcon={<Icon.Settings className="size-4" />}>
                Points settings
              </ButtonLink>
            ) : undefined
          }
        />
      </div>
    );
  }

  const reason: PointsReason | null = isPointsReason(sp.reason) ? sp.reason : null;
  const requestedPage = Number(typeof sp.page === "string" ? sp.page : "1");
  const history = await getPointsHistory(member.id, { page: Number.isFinite(requestedPage) ? requestedPage : 1, reason });
  const { level, totals } = history;

  const base = new URLSearchParams();
  if (!isSelf) base.set("member", member.username);
  const hrefFor = (next: { page?: number; reason?: PointsReason | null }) => {
    const params = new URLSearchParams(base);
    const r = next.reason === undefined ? reason : next.reason;
    if (r) params.set("reason", r);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/leaderboard/points?${qs}` : "/leaderboard/points";
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={title}
        description={
          isSelf
            ? "Every point you have earned, where it came from, and how close you are to the next level."
            : `Every point ${member.name} has earned, with reasons and dates.`
        }
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        actions={
          isAdmin(viewer) && !isSelf ? (
            <ButtonLink href="/admin/settings/gamification#adjust" variant="outline" size="sm" leftIcon={<Icon.Sliders className="size-4" />}>
              Adjust points
            </ButtonLink>
          ) : g.showLeaderboard ? (
            <ButtonLink href="/leaderboard" variant="outline" size="sm" leftIcon={<Icon.Trophy className="size-4" />}>
              Leaderboard
            </ButtonLink>
          ) : undefined
        }
      />

      <section aria-label="Level and totals" className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <LevelEmblem level={level.level} tone={level.tierTone} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Current level</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-bold tracking-tight text-ink">Level {level.level}</span>
              <span className="text-base font-medium text-ink-muted">{level.tier}</span>
            </p>
            <LevelMeter info={level} className="mt-3" />
            <p className="mt-2 text-xs text-ink-muted">
              {level.nextTier
                ? `${level.nextTier.name} starts at level ${level.nextTier.level} (${formatPoints(level.nextTier.pointsAt)} points).`
                : "You have reached the top tier. Every point still counts toward your next level."}
            </p>
          </div>
        </Card>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "This week", value: totals.week },
            { label: "This month", value: totals.month },
            { label: "All time", value: totals.all },
          ].map((s) => (
            <Card key={s.label} className="flex flex-col justify-center p-4">
              <p className="text-xs text-ink-muted">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-ink sm:text-2xl">{formatPoints(s.value)}</p>
              <p className="text-[11px] text-ink-faint">points</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <section aria-labelledby="ledger-title" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="ledger-title" className="text-lg font-semibold tracking-tight text-ink">
                {reason ? REASON_META[reason].label : "All activity"}
              </h2>
              <p className="text-xs text-ink-muted">
                {formatPoints(history.total)} {history.total === 1 ? "entry" : "entries"}
                {history.firstEarnedAt && !reason && ` since ${formatDate(history.firstEarnedAt)}`}
                {reason && ` · ${formatSignedPoints(history.breakdown.find((b) => b.reason === reason)?.points ?? 0)} points`}
              </p>
            </div>
            {reason && (
              <ButtonLink href={hrefFor({ reason: null })} variant="ghost" size="sm" leftIcon={<Icon.X className="size-4" />}>
                Clear filter
              </ButtonLink>
            )}
          </div>

          {history.entryCount === 0 ? (
            <EmptyState
              icon={<Icon.Sparkles />}
              title={isSelf ? "You haven't earned any points yet" : `${member.name} hasn't earned any points yet`}
              description="Points appear here as soon as a lesson is completed, a quiz is passed or a question gets a helpful reply."
              action={
                isSelf ? (
                  <ButtonLink href="/dashboard" size="sm">
                    Continue learning
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : history.items.length === 0 ? (
            <EmptyState
              compact
              icon={<Icon.Filter />}
              title="No entries for this reason"
              description="Try another reason or show all activity."
              action={
                <ButtonLink href={hrefFor({ reason: null })} size="sm" variant="outline">
                  Show all activity
                </ButtonLink>
              }
            />
          ) : (
            <div className="space-y-4">
              <PointsLedger items={history.items} />
              <PageLinks page={history.page} pageCount={history.pageCount} hrefFor={(p) => hrefFor({ page: p })} label="Points history pages" />
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-6" aria-label="Points breakdown">
          <ReasonBreakdown rows={history.breakdown} active={reason} hrefFor={(r) => hrefFor({ reason: r, page: 1 })} total={totals.all} />
          {isSelf && <EarnPointsCard points={g.points} />}
        </aside>
      </div>
    </div>
  );
}
