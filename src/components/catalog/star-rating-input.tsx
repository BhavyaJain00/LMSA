"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const ratingLabels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"] as const;

/**
 * Accessible 1–5 star picker built on a native radio group, so it works with
 * plain form submissions and arrow-key navigation.
 */
export function StarRatingInput({
  name = "rating",
  value,
  onChange,
  invalid,
  describedBy,
  size = "lg",
}: {
  name?: string;
  value: number;
  onChange: (value: number) => void;
  invalid?: boolean;
  describedBy?: string;
  size?: "md" | "lg";
}) {
  const id = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const starClass = size === "lg" ? "size-8" : "size-6";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Rating"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const inputId = `${id}-${n}`;
          const active = n <= shown;
          return (
            <span key={n} className="relative">
              <input
                id={inputId}
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                onChange={() => onChange(n)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                onMouseEnter={() => setHover(n)}
                className="flex cursor-pointer rounded-md p-0.5 transition-transform hover:scale-110 peer-focus-visible:ring-2 peer-focus-visible:ring-accent motion-reduce:transition-none motion-reduce:hover:scale-100"
              >
                <Icon.StarFilled className={cn(starClass, active ? "text-warning" : "text-surface-3")} aria-hidden="true" />
                <span className="sr-only">
                  {n} {n === 1 ? "star" : "stars"} – {ratingLabels[n]}
                </span>
              </label>
            </span>
          );
        })}
      </div>
      <span className="min-w-20 text-sm font-medium text-ink-muted" aria-hidden="true">
        {shown ? ratingLabels[shown] : "Select a rating"}
      </span>
    </div>
  );
}
