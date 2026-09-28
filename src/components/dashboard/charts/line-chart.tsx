"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { chartColor, niceScale, type ChartTone } from "./scale";

export interface LinePoint {
  date: string;
  value: number;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

function parseDay(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function tickLabel(key: string, spanDays: number): string {
  const d = parseDay(key);
  if (spanDays > 120) return d.toLocaleDateString("en-US", { month: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fullLabel(key: string): string {
  return parseDay(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * Responsive SVG line chart with an area fill, hover/keyboard tooltips and an
 * accessible data table fallback. Built without any chart library.
 */
export function LineChart({
  data,
  label,
  tone = "accent",
  height = 220,
  unit = "",
  className,
}: {
  data: LinePoint[];
  /** Series name used in tooltips, e.g. "Signups". */
  label: string;
  tone?: ChartTone;
  height?: number;
  /** Singular unit appended in tooltips, e.g. "signup". */
  unit?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const color = chartColor(tone);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = data.length;
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);
  const max = Math.max(0, ...data.map((d) => d.value));
  const { max: yMax, ticks } = niceScale(max, 4);
  const total = data.reduce((acc, d) => acc + d.value, 0);

  const points = useMemo(
    () =>
      data.map((d, i) => ({
        x: PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW),
        y: PAD.top + plotH - (yMax ? (d.value / yMax) * plotH : 0),
      })),
    [data, n, plotW, plotH, yMax],
  );

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${PAD.top + plotH} L${points[0]!.x.toFixed(1)},${PAD.top + plotH} Z`
      : "";

  const tickCount = Math.min(n, width < 420 ? 4 : 6);
  const xTicks = useMemo(() => {
    if (n === 0) return [] as number[];
    if (n === 1) return [0];
    const out = new Set<number>();
    for (let i = 0; i < tickCount; i++) out.add(Math.round((i / (tickCount - 1)) * (n - 1)));
    return Array.from(out);
  }, [n, tickCount]);

  const indexFromX = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * width;
    if (n <= 1) return 0;
    const ratio = (x - PAD.left) / plotW;
    return Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    setActive(indexFromX(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const current = active ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, current + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "PageUp") next = Math.max(0, current - 7);
    else if (e.key === "PageDown") next = Math.min(n - 1, current + 7);
    else if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const activePoint = active !== null ? points[active] : undefined;
  const activeDatum = active !== null ? data[active] : undefined;
  const describe = (d: LinePoint) => `${fullLabel(d.date)}: ${d.value} ${unit ? (d.value === 1 ? unit : `${unit}s`) : label.toLowerCase()}`;

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={containerRef} className="relative w-full" style={{ height }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          tabIndex={0}
          role="img"
          aria-label={`${label} per day. ${total} in total over ${n} days. Use the arrow keys to read individual days.`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="block touch-pan-y overflow-visible rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <defs>
            <linearGradient id={`fill-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {ticks.map((t) => {
            const y = PAD.top + plotH - (yMax ? (t / yMax) * plotH : 0);
            return (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
                <text x={PAD.left - 8} y={y + 3.5} textAnchor="end" fontSize={10} className="fill-ink-faint tabular-nums">
                  {t}
                </text>
              </g>
            );
          })}

          {xTicks.map((i) => {
            const p = points[i];
            const d = data[i];
            if (!p || !d) return null;
            const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
            return (
              <text key={d.date} x={p.x} y={height - 8} textAnchor={anchor} fontSize={10} className="fill-ink-faint">
                {tickLabel(d.date, n)}
              </text>
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#fill-${gradientId})`} />}
          {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}

          {n <= 45 &&
            points.map((p, i) =>
              data[i]!.value > 0 ? <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--surface-1)" stroke={color} strokeWidth={1.5} /> : null,
            )}

          {activePoint && (
            <g pointerEvents="none">
              <line x1={activePoint.x} x2={activePoint.x} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border-strong)" />
              <circle cx={activePoint.x} cy={activePoint.y} r={4.5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>

        {total === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6">
            <p className="rounded-md bg-surface-1/90 px-2 py-1 text-xs text-ink-muted">No {label.toLowerCase()} in this period</p>
          </div>
        )}

        {activePoint && activeDatum && (
          <div
            className="pointer-events-none absolute z-10 min-w-28 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-xs shadow-pop"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: Math.max(0, activePoint.y - 52),
              transform: activePoint.x > width * 0.7 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
            }}
          >
            <p className="text-ink-muted">{fullLabel(activeDatum.date)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
              <span className="size-2 rounded-full" style={{ background: color }} />
              {activeDatum.value} {label.toLowerCase()}
            </p>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {activeDatum ? describe(activeDatum) : ""}
      </p>

      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <svg viewBox="0 0 24 24" className="size-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
          View as table
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border scrollbar-thin">
          <table className="w-full text-xs">
            <caption className="sr-only">{label} per day</caption>
            <thead className="sticky top-0 bg-surface-2 text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  {label}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...data].reverse().map((d) => (
                <tr key={d.date} className={d.value ? "text-ink" : "text-ink-faint"}>
                  <td className="px-3 py-1">{fullLabel(d.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
