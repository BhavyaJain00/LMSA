import type { User } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type OpenTo = NonNullable<User["openTo"]>;

export const openToOptions: { value: OpenTo; label: string; description: string }[] = [
  { value: "work", label: "Open to Work", description: "Looking for new work" },
  { value: "hiring", label: "Hiring", description: "Hiring talent" },
];

const tone: Record<OpenTo, string> = {
  work: "border-success/40 text-success",
  hiring: "border-accent/40 text-accent",
};

export function openToLabel(value: User["openTo"]): string | null {
  return openToOptions.find((o) => o.value === value)?.label ?? null;
}

/**
 * "Open to Work" / "Hiring" pill. Drawn on a solid surface so it stays legible
 * when it overlaps an avatar photo; `overlay` pins it to the bottom centre of a
 * `relative` avatar wrapper.
 */
export function OpenToBadge({ value, overlay = false, size = "sm", className }: { value: User["openTo"]; overlay?: boolean; size?: "xs" | "sm"; className?: string }) {
  const label = openToLabel(value);
  if (!value || !label) return null;
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
