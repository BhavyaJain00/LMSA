import Link from "next/link";
import type { User } from "@/lib/types";
import { getRankSummary } from "@/lib/services/points";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn, relativeTime } from "@/lib/utils";
import { LevelSummary } from "./level-chip";
import { formatPoints, formatSignedPoints } from "./levels";
import { REASON_META } from "./reasons";
import { TrendIndicator } from "./trend-indicator";

/**
 * Dashboard "Your rank" card: weekly and all-time rank, points this week,
 * level progress and the latest award. Renders nothing while points are off.
 */
export async function YourRankWidget({ user, className }: { user: User; className?: string }) {
  const s = await getRankSummary(user);
  if (!s.enabled) return null;
  const board = s.showLeaderboard;

  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Your rank</h2>
        <Link href={board ? "/leaderboard" : "/leaderboard/points"} className="text-xs font-medium text-ink-muted hover:text-accent">
          {board ? "Leaderboard" : "Your points"}
        </Link>
      </div>

      {s.excluded ? (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-xs text-ink-muted">
          <Icon.Info className="mt-px size-3.5 shrink-0 text-ink-faint" />
          Staff accounts are not ranked, but your points still add up to your level.
        </p>
      ) : (
        <dl className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-2 p-3">
            <dt className="text-xs text-ink-muted">This week</dt>
            <dd className="mt-0.5 flex items-center gap-1.5">
              {s.week.rank ? (
                <>
                  <span className="text-xl font-semibold tabular-nums text-ink">#{s.week.rank}</span>
                  {s.week.trend && <TrendIndicator trend={s.week.trend} />}
                </>
              ) : (
                <span className="text-sm font-medium text-ink-muted">Not ranked yet</span>
              )}
            </dd>
            <dd className="text-[11px] text-ink-faint tabular-nums">
              {formatPoints(Math.max(0, s.totals.week))} pts
              {s.week.ranked > 0 && ` · ${formatPoints(s.week.ranked)} ranked`}
            </dd>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <dt className="text-xs text-ink-muted">All time</dt>
            <dd className="mt-0.5">
              {s.allTime.rank ? (
                <span className="text-xl font-semibold tabular-nums text-ink">#{s.allTime.rank}</span>
              ) : (
                <span className="text-sm font-medium text-ink-muted">Not ranked yet</span>
              )}
            </dd>
            <dd className="text-[11px] text-ink-faint tabular-nums">
              {formatPoints(s.totals.all)} pts{s.allTime.ranked > 0 && ` · of ${formatPoints(s.allTime.ranked)}`}
            </dd>
          </div>
        </dl>
      )}

      <LevelSummary info={s.level} />

      {(s.weekGapToNext !== null || s.lastEarned) && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-ink-muted">
          {s.weekGapToNext !== null && board && (
            <li className="flex items-center gap-1.5">
              <Icon.TrendingUp className="size-3.5 shrink-0 text-accent" />
              {formatPoints(s.weekGapToNext)} more {s.weekGapToNext === 1 ? "point" : "points"} this week to move up a place.
            </li>
          )}
          {s.lastEarned && (
            <li className="flex items-center gap-1.5">
              <Icon.Sparkles className="size-3.5 shrink-0 text-warning" />
              <span className="min-w-0 truncate">
                <span className={cn("font-medium tabular-nums", s.lastEarned.points >= 0 ? "text-success" : "text-danger")}>{formatSignedPoints(s.lastEarned.points)}</span>{" "}
                {REASON_META[s.lastEarned.reason].label.toLowerCase()} · {relativeTime(s.lastEarned.createdAt)}
              </span>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
