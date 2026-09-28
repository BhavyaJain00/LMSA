import { cn } from "@/lib/utils";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Donut chart drawn with stroked SVG circles; legend doubles as the accessible description. */
export function DonutChart({
  segments,
  centerLabel,
  size = 176,
  thickness = 22,
  className,
}: {
  segments: DonutSegment[];
  centerLabel: string;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arcs: { segment: DonutSegment; length: number; offset: number }[] = [];
  for (const segment of segments) {
    const prev = arcs[arcs.length - 1];
    arcs.push({ segment, length: total ? (segment.value / total) * c : 0, offset: prev ? prev.offset + prev.length : 0 });
  }
  const summary = segments.map((s) => `${s.label}: ${s.value} (${total ? Math.round((s.value / total) * 100) : 0}%)`).join(", ");

  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row sm:justify-center", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}: ${total}. ${summary}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {total > 0 &&
            arcs.map(({ segment: s, length, offset }) => (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${Math.max(0, length - (segments.length > 1 && s.value > 0 ? 2 : 0))} ${c}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
            ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-ink">{total}</span>
          <span className="text-xs text-ink-muted">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full max-w-56 space-y-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{s.label}</span>
            <span className="font-medium tabular-nums text-ink">{s.value}</span>
            <span className="w-10 text-right text-xs tabular-nums text-ink-faint">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
