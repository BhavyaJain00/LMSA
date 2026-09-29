import type { ReactNode } from "react";
import type { LeaderboardPeriod, LeaderboardResult } from "@/lib/services/points";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { LevelSummary } from "./level-chip";
import { formatPoints } from "./levels";
import { TrendIndicator } from "./trend-indicator";

const periodPhrase: Record<LeaderboardPeriod, string> = {
  week: "this week",
  month: "this month",
  all: "so far",
};

/** The viewer's own standing above the leaderboard (or a login prompt for guests). */
export function ViewerStanding({ board, loginHref, className }: { board: LeaderboardResult; loginHref: string; className?: string }) {
  const { viewer } = board;
  const scope = board.course ? ` in ${board.course.title}` : "";

  if (viewer.status === "guest") {
    return (
      <Card className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between", className)}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden="true">
            <Icon.Trophy className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">See where you stand</p>
            <p className="text-sm text-ink-muted">Log in to earn points for your learning and climb the leaderboard.</p>
          </div>
        </div>
        <ButtonLink href={loginHref} size="sm" className="self-start sm:self-auto">
          Log in
        </ButtonLink>
      </Card>
    );
  }

  const level = viewer.level!;
  let headline: ReactNode;
  let detail: ReactNode;
  if (viewer.status === "ranked" && viewer.row) {
    headline = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-2xl font-bold tabular-nums text-ink">#{viewer.row.rank}</span>
        <span className="text-sm text-ink-muted">
          of {formatPoints(board.rankedCount)} {board.rankedCount === 1 ? "member" : "members"}
          {scope}
        </span>
        <TrendIndicator trend={viewer.row.trend} />
      </span>
    );
    detail = (
      <>
        You earned <span className="font-semibold text-ink">{formatPoints(viewer.periodPoints)} points</span> {periodPhrase[board.period]}
        {scope}.
      </>
    );
  } else if (viewer.status === "excluded") {
    headline = <span className="text-base font-semibold text-ink">Staff accounts are not ranked</span>;
    detail = (
      <>
        Admins, moderators, instructors and evaluators are hidden from this leaderboard. The {formatPoints(Math.max(0, viewer.periodPoints))} points you earned {periodPhrase[board.period]}
        still count toward your level.
      </>
    );
  } else {
    headline = <span className="text-base font-semibold text-ink">Not ranked {periodPhrase[board.period] === "so far" ? "yet" : periodPhrase[board.period]}</span>;
    detail =
      viewer.periodPoints < 0 ? (
        <>Your points {periodPhrase[board.period]} are below zero. Complete lessons and quizzes to get back on the board.</>
      ) : (
        <>Complete a lesson, pass a quiz or help someone in a discussion to get on the board{scope}.</>
      );
  }

  return (
    <Card className={cn("grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center", className)}>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Your standing</p>
        <div className="mt-1">{headline}</div>
        <p className="mt-1 text-sm text-ink-muted">{detail}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href="/leaderboard/points" size="sm" variant="outline" leftIcon={<Icon.Receipt className="size-4" />}>
            Points history
          </ButtonLink>
          {viewer.status !== "ranked" && viewer.status !== "excluded" && (
            <ButtonLink href="/dashboard" size="sm" variant="ghost" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
              Continue learning
            </ButtonLink>
          )}
        </div>
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <LevelSummary info={level} />
      </div>
    </Card>
  );
}
