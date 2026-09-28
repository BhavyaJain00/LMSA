import { clamp, cn } from "@/lib/utils";

export function ProgressBar({
  value,
  className,
  size = "md",
  tone = "accent",
  showLabel = false,
  label,
}: {
  value: number;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  tone?: "accent" | "success" | "warning" | "danger" | "white";
  showLabel?: boolean;
  label?: string;
}) {
  const v = clamp(Math.round(value), 0, 100);
  const heights = { xs: "h-1", sm: "h-1.5", md: "h-2", lg: "h-3" };
  const colors = {
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    white: "bg-white",
  };
  return (
    <div className={cn("w-full", className)}>
      {(showLabel || label) && (
        <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
          <span>{label}</span>
          {showLabel && <span className="font-medium text-ink">{v}%</span>}
        </div>
      )}
      <div
        className={cn("w-full overflow-hidden rounded-full bg-surface-3", heights[size])}
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", colors[tone])} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  className,
  children,
  tone = "accent",
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  tone?: "accent" | "success" | "white";
}) {
  const v = clamp(value, 0, 100);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (v / 100) * c;
  const color = tone === "success" ? "var(--success)" : tone === "white" ? "#fff" : "var(--accent)";
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-ink">{children ?? `${Math.round(v)}%`}</div>
    </div>
  );
}
