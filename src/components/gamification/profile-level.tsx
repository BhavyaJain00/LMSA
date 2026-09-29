import Link from "next/link";
import { getMemberLevel } from "@/lib/services/points";
import { formatPoints } from "./levels";
import { LevelEmblem } from "./level-chip";

/**
 * Level chip + progress for the profile header. Renders nothing while
 * points are off, or for other members who have no points yet. Your own
 * chip links to your points history.
 */
export async function ProfileLevel({ userId, isSelf, canViewHistory = false, username }: { userId: string; isSelf: boolean; canViewHistory?: boolean; username: string }) {
  const { enabled, level, totals } = await getMemberLevel(userId);
  if (!enabled || (!isSelf && totals.all <= 0)) return null;

  const href = isSelf ? "/leaderboard/points" : canViewHistory ? `/leaderboard/points?member=${encodeURIComponent(username)}` : null;
  const body = (
    <>
      <LevelEmblem level={level.level} tone={level.tierTone} size="sm" />
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold text-ink">Level {level.level}</span>
          <span className="text-ink-muted">{level.tier}</span>
          <span className="text-xs tabular-nums text-ink-faint">· {formatPoints(level.points)} pts</span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3 sm:w-32"
            role="progressbar"
            aria-valuenow={level.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${level.progress}% of the way to level ${level.level + 1}`}
          >
            <span className="block h-full rounded-full bg-accent" style={{ width: `${level.progress}%` }} />
          </span>
          <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-faint">
            {formatPoints(level.pointsToNext)} to Lv {level.level + 1}
          </span>
        </span>
      </span>
    </>
  );

  const classes = "inline-flex max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface-1 py-1.5 pl-1.5 pr-3 shadow-sm";
  return href ? (
    <Link href={href} className={`${classes} transition-colors hover:border-border-strong hover:bg-surface-2`} title={isSelf ? "See your points history" : "See points history"}>
      {body}
    </Link>
  ) : (
    <span className={classes}>{body}</span>
  );
}
