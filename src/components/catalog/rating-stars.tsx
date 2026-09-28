import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";

const starSizes = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
} as const;

/**
 * Read-only 5-star rating. Fractional values (e.g. an average of 4.6) fill
 * the last star partially. Stars use the `warning` token (amber).
 */
export function RatingStars({
  value,
  size = "sm",
  className,
  label,
}: {
  value: number;
  size?: keyof typeof starSizes;
  className?: string;
  /** Accessible label; defaults to "Rated X out of 5". */
  label?: string;
}) {
  const v = Math.max(0, Math.min(5, value || 0));
  const aria = label ?? `Rated ${Math.round(v * 10) / 10} out of 5`;
  return (
    <span role="img" aria-label={aria} className={cn("inline-flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className={cn("relative inline-flex shrink-0", starSizes[size])}>
            <Icon.StarFilled className={cn("absolute inset-0 text-surface-3", starSizes[size])} />
            {fill > 0 && (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Icon.StarFilled className={cn("text-warning", starSizes[size])} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Compact "★ 4.7 (12)" rating chip used on cards and meta rows. */
export function RatingInline({
  average,
  count,
  className,
  showCount = true,
}: {
  average: number | null;
  count: number;
  className?: string;
  showCount?: boolean;
}) {
  if (!average || !count) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon.StarFilled className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="font-semibold text-ink">{average.toFixed(1)}</span>
      {showCount && <span className="text-ink-muted">({count})</span>}
      <span className="sr-only">
        average rating from {count} {count === 1 ? "review" : "reviews"}
      </span>
    </span>
  );
}
