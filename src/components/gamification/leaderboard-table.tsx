import Link from "next/link";
import type { LeaderboardRow } from "@/lib/services/points";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LevelBadge } from "./level-chip";
import { formatPoints } from "./levels";
import { TrendIndicator } from "./trend-indicator";

function RankCell({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        rank <= 3 ? "bg-warning/15 text-warning" : "bg-surface-2 text-ink-muted",
      )}
    >
      {rank}
    </span>
  );
}

function Row({ row, pointsLabel }: { row: LeaderboardRow; pointsLabel: string }) {
  return (
    <TR className={cn(row.isViewer && "bg-accent/5")} aria-current={row.isViewer ? "true" : undefined}>
      <TD className="w-12 py-2.5 pl-3 pr-1 sm:pl-4">
        <RankCell rank={row.rank} />
      </TD>
      <TD className="max-w-0 py-2.5 pl-1">
        <Link href={`/user/${row.member.username}`} className="group flex min-w-0 items-center gap-2.5">
          <Avatar name={row.member.name} src={row.member.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-ink group-hover:text-accent">{row.member.name}</span>
              {row.isViewer && (
                <Badge tone="accent" size="xs">
                  You
                </Badge>
              )}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              <span className="sm:hidden">
                Lv {row.level} · {row.tier}
              </span>
              <span className="hidden sm:inline">@{row.member.username}</span>
            </span>
          </span>
        </Link>
      </TD>
      <TD className="hidden py-2.5 sm:table-cell">
        <LevelBadge level={row.level} tier={row.tier} tone={row.tierTone} size="xs" />
      </TD>
      <TD className="py-2.5 text-right">
        <span className="font-semibold tabular-nums text-ink">{formatPoints(row.points)}</span>
        <span className="sr-only"> {pointsLabel}</span>
      </TD>
      <TD className="w-14 py-2.5 pr-3 text-center sm:pr-4">
        <TrendIndicator trend={row.trend} />
      </TD>
    </TR>
  );
}

/**
 * Ranked table. `rows` are the visible ranks; `pinned` is the viewer's own
 * row when it falls below them (shown after a gap).
 */
export function LeaderboardTable({
  rows,
  pinned,
  pointsLabel,
  trendLabel,
  caption,
}: {
  rows: LeaderboardRow[];
  pinned: LeaderboardRow | null;
  pointsLabel: string;
  trendLabel: string;
  caption: string;
}) {
  return (
    <Table className="table-fixed">
      <caption className="sr-only">{caption}</caption>
      <THead>
        <tr>
          <TH scope="col" className="w-12 pl-3 pr-1 sm:pl-4">
            <span className="sr-only sm:not-sr-only">Rank</span>
            <span className="sm:hidden" aria-hidden="true">
              #
            </span>
          </TH>
          <TH scope="col" className="pl-1">
            Member
          </TH>
          <TH scope="col" className="hidden w-40 sm:table-cell">
            Level
          </TH>
          <TH scope="col" className="w-20 text-right sm:w-24">
            Points
          </TH>
          <TH scope="col" className="w-14 pr-3 text-center sm:pr-4" title={`Rank change ${trendLabel}`}>
            <span className="sr-only">Rank change {trendLabel}</span>
            <span aria-hidden="true">Trend</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Row key={row.member.id} row={row} pointsLabel={pointsLabel} />
        ))}
        {pinned && (
          <>
            <tr aria-hidden="true">
              <td colSpan={5} className="bg-surface-2/60 py-1 text-center text-xs tracking-[0.3em] text-ink-faint">
                •••
              </td>
            </tr>
            <Row row={pinned} pointsLabel={pointsLabel} />
          </>
        )}
      </TBody>
    </Table>
  );
}
