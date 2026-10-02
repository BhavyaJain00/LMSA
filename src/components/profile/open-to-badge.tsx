"use client";

import type { User } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type OpenTo = NonNullable<User["openTo"]>;

/** The "open to" choices; labels are `profile.openTo.<value>` and descriptions `profile.openTo.<value>.description`. */
export const openToValues: OpenTo[] = ["work", "hiring"];

const tone: Record<OpenTo, string> = {
  work: "border-success/40 text-success",
  hiring: "border-accent/40 text-accent",
};

/**
 * "Open to Work" / "Hiring" pill. Drawn on a solid surface so it stays legible
 * when it overlaps an avatar photo; `overlay` pins it to the bottom centre of a
 * `relative` avatar wrapper.
 */
export function OpenToBadge({ value, overlay = false, size = "sm", className }: { value: User["openTo"]; overlay?: boolean; size?: "xs" | "sm"; className?: string }) {
  const t = useT("account");
  if (!value || !openToValues.includes(value)) return null;
  const label = t(`profile.openTo.${value}`);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-surface-1 font-semibold leading-none shadow-card",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
        tone[value],
        overlay && "absolute -bottom-2 left-1/2 z-10 -translate-x-1/2 ring-2 ring-surface",
        className,
      )}
    >
      <Icon.CheckCircleFilled className={size === "xs" ? "size-3" : "size-3.5"} aria-hidden="true" />
      {label}
    </span>
  );
}
