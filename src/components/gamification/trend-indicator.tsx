import type { LeaderboardTrend } from "@/lib/services/points";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Rank movement vs. the previous period: ▲ 3, ▼ 1, —, or "New". */
export function TrendIndicator({ trend, className }: { trend: LeaderboardTrend; className?: string }) {
  if (trend.kind === "new") {
    return (
      <span className={cn("inline-flex items-center rounded-full bg-info/12 px-1.5 py-px text-[11px] font-medium text-info", className)} title="Not ranked in the previous period">
        New
      </span>
    );
  }
  if (trend.kind === "same") {
    return (
      <span className={cn("inline-flex items-center text-xs text-ink-faint", className)} title={`Same rank as before (#${trend.previousRank})`}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No change</span>
      </span>
    );
  }
  const up = trend.kind === "up";
  const places = Math.abs(trend.change);
  const text = `${up ? "Up" : "Down"} ${places} ${places === 1 ? "place" : "places"} (was #${trend.previousRank})`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", up ? "text-success" : "text-danger", className)} title={text}>
      {up ? <Icon.ChevronUp className="size-3.5" /> : <Icon.ChevronDown className="size-3.5" />}
      <span aria-hidden="true">{places}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
