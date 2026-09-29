import { cn, formatTime } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import type { DropOffPoint, RewatchPoint } from "./types";

/**
 * Drop-off and rewatch hotspots for one video. Each entry carries an icon
 * and a text label, so meaning never depends on color alone.
 */
export function Hotspots({
  dropOffs,
  rewatches,
  duration,
  viewers,
  compact,
  className,
}: {
  dropOffs: DropOffPoint[];
  rewatches: RewatchPoint[];
  duration: number;
  viewers: number;
  compact?: boolean;
  className?: string;
}) {
  const bin = duration / 100;
  if (viewers < 2) {
    return (
      <p className={cn("rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-sm text-ink-muted", className)}>
        Hotspots appear once at least two learners have watched this video.
      </p>
    );
  }
  if (!dropOffs.length && !rewatches.length) {
    return (
      <p className={cn("flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-3 text-sm text-ink-muted", className)}>
        <Icon.CheckCircle className="size-4 shrink-0 text-success" />
        No sharp drop-offs or heavily replayed sections so far.
      </p>
    );
  }
  return (
    <div className={cn("grid gap-3", !compact && "sm:grid-cols-2", className)}>
      <section aria-label="Drop-off hotspots" className="rounded-lg border border-border p-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Icon.TrendingUp className="size-3.5 -scale-y-100 text-danger" /> Biggest drop-offs
        </h4>
        {dropOffs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Viewers stay with the video without sudden drops.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {dropOffs.map((d) => (
              <li key={d.bin} className="flex items-center justify-between gap-3 text-sm">
                <span className="tabular-nums text-ink">
                  {formatTime(d.time)}–{formatTime(d.time + bin * 3)}
                </span>
                <span className="text-ink-muted">
                  <span className="font-semibold tabular-nums text-ink">−{Math.round(d.drop)}</span> pts ({Math.round(d.from)}% → {Math.round(d.to)}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Rewatched sections" className="rounded-lg border border-border p-3">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Icon.Replay className="size-3.5 text-info" /> Most rewatched
        </h4>
        {rewatches.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No section is replayed much more than the rest.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {rewatches.map((r) => (
              <li key={r.bin} className="flex items-center justify-between gap-3 text-sm">
                <span className="tabular-nums text-ink">{formatTime(r.time)}</span>
                <span className="text-ink-muted">
                  <span className="font-semibold tabular-nums text-ink">{r.passesPerViewer.toFixed(1)}×</span> views per viewer
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
