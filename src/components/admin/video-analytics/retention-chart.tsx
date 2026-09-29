"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clamp, cn, formatTime } from "@/lib/utils";
import type { DropOffPoint } from "./types";

const W = 1000;
const GRID = [0, 25, 50, 75, 100];

/** Time at the middle of a 1% bin. */
function binTime(bin: number, bins: number, duration: number): number {
  return ((bin + 0.5) / bins) * duration;
}

/**
 * Audience retention curve: share of viewers who watched each 1% of the
 * video. Custom SVG (single series in the accent color, 2px line over a 10%
 * wash, hairline grid), a snapping crosshair with a tooltip on hover and on
 * keyboard focus (←/→, Home/End), drop-off markers, and a table view.
 */
export function RetentionChart({
  retention,
  passes,
  duration,
  dropOffs = [],
  height = 220,
  title = "Audience retention",
  className,
  onSelectTime,
}: {
  retention: number[];
  passes?: number[];
  duration: number;
  dropOffs?: DropOffPoint[];
  height?: number;
  title?: string;
  className?: string;
  /** Clicking the chart reports the time under the crosshair. */
  onSelectTime?: (seconds: number) => void;
}) {
  const id = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const bins = retention.length;
  const H = height;

  const { line, area } = useMemo(() => {
    if (!bins) return { line: "", area: "" };
    const x = (i: number) => (bins === 1 ? W / 2 : (i / (bins - 1)) * W);
    const y = (v: number) => H - (clamp(v, 0, 100) / 100) * H;
    const pts = retention.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    return { line: `M${pts.join("L")}`, area: `M0,${H}L${pts.join("L")}L${W},${H}Z` };
  }, [retention, bins, H]);

  const summary = useMemo(() => {
    if (!bins) return "No retention data yet.";
    const at = (pct: number) => retention[Math.min(bins - 1, Math.round((pct / 100) * (bins - 1)))] ?? 0;
    return `${title}: ${Math.round(at(25))}% of viewers are still watching at a quarter of the video, ${Math.round(at(50))}% at the halfway point and ${Math.round(at(90))}% near the end.`;
  }, [retention, bins, title]);

  const binFromClientX = (clientX: number): number | null => {
    const el = plotRef.current;
    if (!el || !bins) return null;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(ratio * (bins - 1));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => setActive(binFromClientX(e.clientX));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!bins) return;
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(bins - 1, (active ?? -1) + step);
    else if (e.key === "ArrowLeft") next = Math.max(0, (active ?? bins) - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = bins - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else if ((e.key === "Enter" || e.key === " ") && active !== null && onSelectTime) {
      e.preventDefault();
      onSelectTime(binTime(active, bins, duration));
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const activeValue = active !== null ? (retention[active] ?? 0) : null;
  const activePasses = active !== null && passes ? (passes[active] ?? 0) : null;
  const activeX = active !== null && bins > 1 ? (active / (bins - 1)) * 100 : 50;
  const activeY = activeValue !== null ? 100 - clamp(activeValue, 0, 100) : 0;
  const tableRows = useMemo(() => {
    const rows: { label: string; time: number; value: number; passes: number | null }[] = [];
    for (let pct = 0; pct <= 100; pct += 10) {
      const bin = Math.min(bins - 1, Math.round((pct / 100) * (bins - 1)));
      if (bin < 0) break;
      rows.push({ label: `${pct}%`, time: binTime(bin, bins, duration), value: retention[bin] ?? 0, passes: passes ? (passes[bin] ?? 0) : null });
    }
    return rows;
  }, [bins, duration, retention, passes]);

  return (
    <figure className={cn("min-w-0", className)} aria-labelledby={`${id}-title`}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-title`} className="text-sm font-semibold text-ink">
          {title}
        </span>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-accent hover:underline" aria-expanded={showTable} aria-controls={`${id}-table`}>
          {showTable ? "Show chart" : "Show as table"}
        </button>
      </figcaption>

      {!showTable ? (
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2">
          {/* Y axis labels */}
          <div className="relative text-right text-[11px] tabular-nums text-ink-faint" style={{ height }} aria-hidden="true">
            {GRID.map((g) => (
              <span key={g} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - g}%` }}>
                {g}%
              </span>
            ))}
          </div>

          <div
            ref={plotRef}
            role="group"
            aria-roledescription="chart"
            tabIndex={0}
            aria-label={`${summary} Use the left and right arrow keys to read values.`}
            aria-describedby={`${id}-live`}
            className={cn("relative touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50", onSelectTime && "cursor-pointer")}
            style={{ height }}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerMove}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setActive(null);
            }}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              const bin = binFromClientX(e.clientX);
              if (bin !== null && onSelectTime) onSelectTime(binTime(bin, bins, duration));
            }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
              {GRID.map((g) => (
                <line key={g} x1={0} x2={W} y1={H - (g / 100) * H} y2={H - (g / 100) * H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
              {area && <path d={area} fill="var(--accent)" fillOpacity={0.1} />}
              {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
              {dropOffs.map((d) => {
                const x = bins > 1 ? (d.bin / (bins - 1)) * W : W / 2;
                return <line key={d.bin} x1={x} x2={x} y1={0} y2={H} stroke="var(--danger)" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
              })}
            </svg>

            {/* Drop-off markers (HTML so they keep their shape) */}
            {dropOffs.map((d) => (
              <span
                key={`m-${d.bin}`}
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger ring-2 ring-surface-1"
                style={{ left: `${bins > 1 ? (d.bin / (bins - 1)) * 100 : 50}%`, top: `${100 - clamp(d.from, 0, 100)}%` }}
                aria-hidden="true"
              />
            ))}

            {/* Crosshair + tooltip */}
            {active !== null && activeValue !== null && (
              <>
                <span className="pointer-events-none absolute inset-y-0 w-px bg-ink-faint/60" style={{ left: `${activeX}%` }} aria-hidden="true" />
                <span
                  className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1 bg-accent shadow"
                  style={{ left: `${activeX}%`, top: `${activeY}%` }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute top-1 z-10 w-max max-w-48 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs shadow-pop"
                  style={{ left: `${clamp(activeX, 12, 88)}%`, transform: "translateX(-50%)" }}
                >
                  <p className="font-medium tabular-nums text-ink">{formatTime(binTime(active, bins, duration))}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-ink-muted">
                    <span className="h-0.5 w-3 rounded-full bg-accent" aria-hidden="true" />
                    <span>
                      <span className="font-semibold tabular-nums text-ink">{Math.round(activeValue)}%</span> still watching
                    </span>
                  </p>
                  {activePasses !== null && activePasses > 0 && (
                    <p className="mt-0.5 text-ink-muted">
                      <span className="tabular-nums text-ink">{activePasses.toFixed(1)}</span> views per viewer
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* X axis labels */}
          <div aria-hidden="true" />
          <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-ink-faint" aria-hidden="true">
            {[0, 25, 50, 75, 100].map((pct) => (
              <span key={pct} className={cn("absolute", pct === 0 ? "left-0" : pct === 100 ? "right-0" : "-translate-x-1/2")} style={pct === 0 || pct === 100 ? undefined : { left: `${pct}%` }}>
                {formatTime((pct / 100) * duration)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div id={`${id}-table`} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{title} by position in the video</caption>
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Position
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Still watching
                </th>
                {passes && (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Views per viewer
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tableRows.map((row) => (
                <tr key={row.label}>
                  <td className="px-3 py-1.5 text-ink">{row.label}</td>
                  <td className="px-3 py-1.5 tabular-nums text-ink-muted">{formatTime(row.time)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink">{Math.round(row.value)}%</td>
                  {passes && <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{(row.passes ?? 0).toFixed(1)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p id={`${id}-live`} className="sr-only" aria-live="polite">
        {active !== null && activeValue !== null ? `${formatTime(binTime(active, bins, duration))}: ${Math.round(activeValue)}% still watching.` : ""}
      </p>
    </figure>
  );
}
