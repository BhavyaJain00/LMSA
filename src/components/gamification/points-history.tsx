import Link from "next/link";
import type { PointsHistoryItem, ReasonTotal } from "@/lib/services/points";
import type { PointsReason } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { formatPoints, formatSignedPoints } from "./levels";
import { REASON_META } from "./reasons";

function ReasonIcon({ reason, className }: { reason: PointsReason; className?: string }) {
  const IconCmp = Icon[REASON_META[reason].icon];
  return <IconCmp className={className} />;
}

function detailLine(item: PointsHistoryItem): { text: string | null; href: string | null } {
  if (item.reason === "streak_day") return { text: `A day of learning on ${formatDate(item.createdAt, { weekday: "short" })}`, href: null };
  if (item.reason === "manual") return { text: item.title, href: null };
  return { text: item.title ?? "No longer available", href: item.href };
}

/** The ledger: one row per entry with reason, what it was for (linked), context, date and points. */
export function PointsLedger({ items }: { items: PointsHistoryItem[] }) {
  return (
    <Card className="overflow-hidden">
      <ol className="divide-y divide-border">
        {items.map((item) => {
          const detail = detailLine(item);
          const positive = item.points >= 0;
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                  item.reason === "manual" ? "bg-surface-2 text-ink-muted" : positive ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
                )}
                aria-hidden="true"
              >
                <ReasonIcon reason={item.reason} className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.label}</p>
                {detail.text && (
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {detail.href ? (
                      <Link href={detail.href} className="break-words text-ink hover:text-accent hover:underline">
                        {detail.text}
                      </Link>
                    ) : (
                      <span className={cn("break-words", !item.title && item.reason !== "streak_day" && item.reason !== "manual" && "italic")}>{detail.text}</span>
                    )}
                    {item.context && <span className="text-ink-faint"> · {item.context}</span>}
                  </p>
                )}
                {item.note && <p className="mt-0.5 text-xs text-ink-muted">{item.note}</p>}
                <p className="mt-1 text-xs text-ink-faint">
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                </p>
              </div>
              <span className={cn("shrink-0 text-sm font-semibold tabular-nums", positive ? "text-success" : "text-danger")}>
                {formatSignedPoints(item.points)}
                <span className="sr-only"> points</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Points per reason; each row filters the ledger. */
export function ReasonBreakdown({ rows, active, hrefFor, total }: { rows: ReasonTotal[]; active: PointsReason | null; hrefFor: (reason: PointsReason | null) => string; total: number }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">Where your points come from</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">Nothing earned yet.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          <li>
            <Link
              href={hrefFor(null)}
              scroll={false}
              aria-current={active === null ? "true" : undefined}
              className={cn(
                "-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                active === null ? "bg-accent/10 font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <span>All activity</span>
              <span className="tabular-nums">{formatPoints(total)}</span>
            </Link>
          </li>
          {rows.map((row) => {
            const meta = REASON_META[row.reason];
            const isActive = active === row.reason;
            return (
              <li key={row.reason}>
                <Link
                  href={hrefFor(row.reason)}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                    isActive ? "bg-accent/10 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <ReasonIcon reason={row.reason} className="size-4 shrink-0 text-ink-faint" />
                  <span className={cn("min-w-0 flex-1 truncate", isActive && "font-medium")}>{meta.label}</span>
                  <span className="shrink-0 text-xs text-ink-faint tabular-nums">×{row.count}</span>
                  <span className={cn("w-14 shrink-0 text-right font-medium tabular-nums", row.points < 0 ? "text-danger" : "text-ink")}>{formatSignedPoints(row.points)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
