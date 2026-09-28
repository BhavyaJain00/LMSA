import Link from "next/link";
import { cn } from "@/lib/utils";

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  href?: string;
  /** Secondary text shown under the label (e.g. "+3 this period"). */
  note?: string;
}

/**
 * Horizontal bar chart built from divs (reads well on phones). Each row is a
 * list item with the value spelled out, so it is accessible without the bars.
 */
export function BarList({ data, valueLabel, className, color = "var(--accent)" }: { data: BarDatum[]; valueLabel: string; className?: string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ol className={cn("space-y-3", className)} aria-label={valueLabel}>
      {data.map((d, i) => {
        const width = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <li key={d.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="text-right text-xs tabular-nums text-ink-faint">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                {d.href ? (
                  <Link href={d.href} className="truncate text-sm text-ink hover:text-accent">
                    {d.label}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-ink">{d.label}</span>
                )}
                {d.note && <span className="hidden shrink-0 text-[11px] text-ink-faint sm:inline">{d.note}</span>}
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, background: color }} />
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums text-ink">
              {d.value}
              <span className="sr-only"> {valueLabel}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface StackedSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

/** A single 100% stacked bar with a legend. */
export function StackedBar({ segments, label }: { segments: StackedSegment[]; label: string }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div key={s.id} className="h-full border-r-2 border-surface-1 last:border-r-0" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />
            ))}
      </div>
    </div>
  );
}
