"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/** Read-only 5-star rating (rounded to the nearest whole star). */
export function Stars({ value, className, size = "sm" }: { value: number | null; className?: string; size?: "xs" | "sm" | "md" }) {
  // `global.` keys: the stars are also shown on the admin batch page.
  const t = useT("public");
  const filled = value === null ? 0 : Math.round(value);
  const cls = size === "xs" ? "size-3" : size === "md" ? "size-5" : "size-4";
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={value === null ? t("global.batchFeedback.noRating") : t("global.batchFeedback.outOf5", { value })}>
      {Array.from({ length: 5 }).map((_, i) =>
        i < filled ? <Icon.StarFilled key={i} className={cn(cls, "text-warning")} /> : <Icon.Star key={i} className={cn(cls, "text-ink-faint")} />,
      )}
    </span>
  );
}
