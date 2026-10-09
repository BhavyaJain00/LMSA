import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

function chipClasses(selected: boolean, className?: string) {
  return cn(
    "tap-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    selected ? "border-accent/40 bg-accent/10 text-accent" : "border-border-strong bg-surface-1 text-ink-muted hover:bg-surface-2 hover:text-ink",
    className,
  );
}

function ChipInner({ icon, count, selected, children }: { icon?: ReactNode; count?: number; selected: boolean; children: ReactNode }) {
  return (
    <>
      {icon && <span className="[&>svg]:size-4" aria-hidden="true">{icon}</span>}
      {children}
      {count !== undefined && (
        <span className={cn("rounded-full px-1.5 text-micro tabular-nums", selected ? "bg-accent/15" : "bg-surface-3")}>{count}</span>
      )}
    </>
  );
}

export interface ChipToggleProps extends Omit<ComponentProps<"button">, "children"> {
  /** Whether the filter is on (shown with the accent tint and `aria-pressed`). */
  selected: boolean;
  icon?: ReactNode;
  count?: number;
  children: ReactNode;
}

/**
 * Filter chip that switches something on or off ("Certification", "All types").
 * Use it for selected filters instead of a `secondary` button. For links that
 * change a `?filter=` use `ChipLink`.
 */
export function ChipToggle({ selected, icon, count, className, children, type = "button", ...props }: ChipToggleProps) {
  return (
    <button type={type} aria-pressed={selected} className={chipClasses(selected, className)} {...props}>
      <ChipInner icon={icon} count={count} selected={selected}>
        {children}
      </ChipInner>
    </button>
  );
}

/** A filter chip that navigates (URL-driven filters). The selected one is marked `aria-current`. */
export function ChipLink({
  href,
  selected,
  icon,
  count,
  className,
  children,
  scroll = false,
}: {
  href: string;
  selected: boolean;
  icon?: ReactNode;
  count?: number;
  className?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <Link href={href} scroll={scroll} aria-current={selected ? "true" : undefined} className={chipClasses(selected, className)}>
      <ChipInner icon={icon} count={count} selected={selected}>
        {children}
      </ChipInner>
    </Link>
  );
}

/** A wrapping row of chips with consistent spacing. */
export function ChipGroup({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
