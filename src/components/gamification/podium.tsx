import Link from "next/link";
import type { LeaderboardRow } from "@/lib/services/points";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { LevelBadge } from "./level-chip";
import { formatPoints } from "./levels";
import { TrendIndicator } from "./trend-indicator";
import { MEDAL_CHIP } from "./medals";

/** Medal styling from the design tokens, so both themes work. */
const medal: Record<number, { ring: string; chip: string; block: string; label: string }> = {
  1: { ring: "ring-warning", chip: MEDAL_CHIP[0]!, block: "h-24 sm:h-28 bg-warning/15 border-warning/40", label: "Gold" },
  2: { ring: "ring-border-strong", chip: MEDAL_CHIP[1]!, block: "h-16 sm:h-20 bg-surface-3 border-border-strong", label: "Silver" },
  3: { ring: "ring-accent", chip: MEDAL_CHIP[2]!, block: "h-12 sm:h-14 bg-accent/10 border-accent/30", label: "Bronze" },
};

function medalFor(rank: number) {
  return medal[Math.min(3, Math.max(1, rank))]!;
}

/** Top three members, shown 2 · 1 · 3 like a podium. Ties keep their shared rank. */
export function Podium({ rows, pointsLabel }: { rows: LeaderboardRow[]; pointsLabel: string }) {
  const top = rows.slice(0, 3);
  if (!top.length) return null;
  const order = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top.length === 2 ? [top[1]!, top[0]!] : [top[0]!];

  return (
    <section aria-label="Top three" className="rounded-card border border-border bg-surface-1 px-3 pb-0 pt-5 shadow-card sm:px-6">
      <ol className={cn("mx-auto grid items-end gap-2 sm:gap-4", order.length === 3 ? "max-w-2xl grid-cols-3" : order.length === 2 ? "max-w-md grid-cols-2" : "max-w-xs grid-cols-1")}>
        {order.map((row) => {
          const m = medalFor(row.rank);
          const first = row.rank === 1;
          return (
            <li key={row.member.id} className="flex min-w-0 flex-col items-center text-center">
              <Link href={`/user/${row.member.username}`} className="group flex min-w-0 max-w-full flex-col items-center">
                <span className="relative">
                  <Avatar
                    name={row.member.name}
                    src={row.member.avatarUrl}
                    size={first ? "xl" : "lg"}
                    className={cn("ring-4 ring-offset-2 ring-offset-surface-1", m.ring)}
                  />
                  <span
                    className={cn("absolute -bottom-1.5 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-full text-xs font-bold shadow-sm", m.chip)}
                    aria-hidden="true"
                  >
                    {row.rank}
                  </span>
                </span>
                <span className={cn("mt-3 block max-w-full truncate text-sm font-semibold text-ink group-hover:text-accent", row.isViewer && "text-accent")}>
                  <span className="sr-only">Rank {row.rank}: </span>
                  {row.member.name}
                  {row.isViewer && <span className="sr-only"> (you)</span>}
                </span>
              </Link>
              <span className="mt-0.5 text-base font-bold tabular-nums text-ink sm:text-lg">
                {formatPoints(row.points)} <span className="text-xs font-medium text-ink-muted">{pointsLabel}</span>
              </span>
              <span className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <LevelBadge level={row.level} tier={row.tier} tone={row.tierTone} size="xs" className="hidden sm:inline-flex" />
                <TrendIndicator trend={row.trend} />
              </span>
              <div className={cn("mt-3 w-full rounded-t-lg border border-b-0", m.block)} aria-hidden="true">
                <span className="sr-only">{m.label}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
