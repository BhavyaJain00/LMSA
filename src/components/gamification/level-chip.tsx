import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { formatPoints, type LevelInfo, type TierName, type TierTone } from "./levels";

/**
 * Level visuals shared by the profile header, dashboard widget, leaderboard
 * and points page. Plain components (no hooks), usable from Server and
 * Client Components.
 */

const emblemTone: Record<TierTone, string> = {
  neutral: "bg-surface-3 text-ink ring-border-strong",
  info: "bg-info/15 text-info ring-info/30",
  success: "bg-success/15 text-success ring-success/30",
  accent: "bg-accent/15 text-accent ring-accent/30",
  warning: "bg-warning/15 text-warning ring-warning/35",
  dark: "bg-ink text-surface-1 ring-ink/40",
};

/** "Lv 4 · Learner" pill. */
export function LevelBadge({
  level,
  tier,
  tone,
  size = "sm",
  className,
}: {
  level: number;
  tier: TierName;
  tone: TierTone;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  return (
    <Badge tone={tone} size={size} className={cn("tabular-nums", className)} title={`Level ${level} · ${tier}`}>
      <Icon.Trophy className={size === "md" ? "size-4" : "size-3"} />
      <span>
        Lv {level}
        <span className="opacity-60"> · </span>
        {tier}
      </span>
    </Badge>
  );
}

/** Round level emblem with the level number. */
export function LevelEmblem({ level, tone, size = "md", className }: { level: number; tone: TierTone; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 flex-col items-center justify-center rounded-full font-semibold tabular-nums ring-2",
        size === "sm" && "size-9 text-sm",
        size === "md" && "size-12 text-lg",
        size === "lg" && "size-16 text-2xl",
        emblemTone[tone],
        className,
      )}
      aria-hidden="true"
    >
      <span className={cn("leading-none opacity-70", size === "lg" ? "text-[10px]" : "text-[9px]")}>LV</span>
      <span className="leading-none">{level}</span>
    </span>
  );
}

/** Progress through the current level with "N pts to level L". */
export function LevelMeter({ info, className, showNumbers = true }: { info: LevelInfo; className?: string; showNumbers?: boolean }) {
  return (
    <div className={cn("w-full", className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={info.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level ${info.level}: ${info.progress}% of the way to level ${info.level + 1}`}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${info.progress}%` }} />
      </div>
      {showNumbers && (
        <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-ink-muted">
          <span className="tabular-nums">
            <span className="font-medium text-ink">{formatPoints(info.points)}</span> / {formatPoints(info.nextLevelAt)} pts
          </span>
          <span className="tabular-nums">
            {formatPoints(info.pointsToNext)} to level {info.level + 1}
          </span>
        </p>
      )}
    </div>
  );
}

/** Compact level summary: emblem, tier and progress (dashboard widget, points page). */
export function LevelSummary({ info, className }: { info: LevelInfo; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LevelEmblem level={info.level} tone={info.tierTone} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold text-ink">Level {info.level}</span>
          <span className="text-ink-muted">{info.tier}</span>
        </p>
        <LevelMeter info={info} className="mt-1.5" />
      </div>
    </div>
  );
}
