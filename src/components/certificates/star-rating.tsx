"use client";

import { useRef, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Read-only 0–5 stars. */
export function StarRatingDisplay({ value, className }: { value: number; className?: string }) {
  const t = useT("public");
  const v = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={t("certificates.stars.outOf5", { value: v })}>
      {Array.from({ length: 5 }, (_, i) =>
        i < v ? <Icon.StarFilled key={i} className="size-4 text-warning" /> : <Icon.Star key={i} className="size-4 text-ink-faint" />,
      )}
    </span>
  );
}

/** Keyboard-accessible 0–5 star input (radio group) with a hidden form field. */
export function StarRatingInput({
  name,
  value,
  onChange,
  disabled,
  label,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useT("public");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, index + 2);
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, index);
    if (e.key === "Home") next = 1;
    if (e.key === "End") next = 5;
    if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") next = 0;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    refs.current[Math.max(0, next - 1)]?.focus();
  };
  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div role="radiogroup" aria-label={label ?? t("reviews.form.rating")} className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const starValue = i + 1;
          const filled = starValue <= value;
          const focusable = value === 0 ? i === 0 : starValue === value;
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={starValue === value}
              aria-label={t("certificates.stars.count", { count: starValue })}
              tabIndex={focusable ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(starValue === value ? 0 : starValue)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="rounded p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {filled ? <Icon.StarFilled className="size-6 text-warning" /> : <Icon.Star className="size-6 text-ink-faint" />}
            </button>
          );
        })}
        <span className="ms-2 text-sm text-ink-muted">{value ? t("certificates.stars.value", { value }) : t("certificates.stars.notRated")}</span>
      </div>
    </div>
  );
}
