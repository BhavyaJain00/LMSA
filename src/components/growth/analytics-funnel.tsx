import type { FunnelStage } from "@/lib/growth/analytics-metrics";
import { formatNumber } from "@/lib/utils";

/**
 * Conversion funnel as stacked bars: each bar is sized against the first
 * stage, and the drop-off between two stages is spelled out, so the list
 * reads the same without the bars.
 */
export function AnalyticsFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <ol className="space-y-1" aria-label="Conversion funnel">
      {stages.map((s, i) => (
        <li key={s.key}>
          {i > 0 && (
            <p className="flex items-center gap-1.5 py-1.5 pl-1 text-xs text-ink-muted">
              <span aria-hidden="true" className="text-ink-faint">
                ↓
              </span>
              <span className="tabular-nums">{s.stepRate}%</span> continued
              {s.dropOff > 0 && (
                <span className="text-danger">
                  · <span className="tabular-nums">{s.dropOff}%</span> dropped off
                </span>
              )}
            </p>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-ink">{s.label}</span>
            <span className="shrink-0 text-sm tabular-nums text-ink">
              <span className="font-semibold">{formatNumber(s.count)}</span>
              {i > 0 && <span className="ml-1.5 text-xs text-ink-muted">{s.overallRate}% of visits</span>}
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(s.count > 0 ? 2 : 0, s.overallRate)}%`, opacity: 1 - i * 0.15 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
