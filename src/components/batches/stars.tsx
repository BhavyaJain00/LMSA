import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";

/** Read-only 5-star rating (rounded to the nearest whole star). */
export function Stars({ value, className, size = "sm" }: { value: number | null; className?: string; size?: "xs" | "sm" | "md" }) {
  const filled = value === null ? 0 : Math.round(value);
  const cls = size === "xs" ? "size-3" : size === "md" ? "size-5" : "size-4";
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={value === null ? "No rating" : `${value} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) =>
        i < filled ? <Icon.StarFilled key={i} className={cn(cls, "text-warning")} /> : <Icon.Star key={i} className={cn(cls, "text-ink-faint")} />,
      )}
    </span>
  );
}
