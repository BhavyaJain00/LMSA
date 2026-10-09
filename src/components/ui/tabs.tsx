"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export interface TabItem {
  label: ReactNode;
  /** Link target. Either `href` or `value` must be provided. */
  href?: string;
  /** Value written to the `?tab=` query param. */
  value?: string;
  count?: number;
  icon?: ReactNode;
}

/**
 * URL-driven tabs. With `href`, the active tab matches the pathname.
 * With `value`, the active tab is read from `?tab=` (first tab is the default).
 */
export function Tabs({ items, param = "tab", className, variant = "underline" }: { items: TabItem[]; param?: string; className?: string; variant?: "underline" | "pills" }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get(param);
  const t = useT("common");

  return (
    <nav className={cn("no-scrollbar flex gap-1 overflow-x-auto", variant === "underline" && "border-b border-border", className)} aria-label={t("a11y.tabs")}>
      {items.map((item, i) => {
        let active = false;
        let href = item.href ?? "";
        if (item.href) {
          active = pathname === item.href || (i > 0 && pathname.startsWith(item.href + "/"));
        } else {
          const params = new URLSearchParams(search.toString());
          if (item.value && i > 0) params.set(param, item.value);
          else params.delete(param);
          const qs = params.toString();
          href = qs ? `${pathname}?${qs}` : pathname;
          active = current ? current === item.value : i === 0;
        }
        return (
          <Link
            key={i}
            href={href}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors",
              variant === "underline" && "-mb-px border-b-2 px-3 py-2.5",
              variant === "underline" && (active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink"),
              variant === "pills" && "tap-target rounded-full px-3 py-1.5",
              variant === "pills" && (active ? "bg-accent/10 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"),
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className={cn("rounded-full px-1.5 py-px text-micro tabular-nums", active ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-muted")}>{item.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Local-state segmented control (no navigation). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "sm",
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg bg-surface-2 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "tap-target inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
              size === "xs" && "px-2 py-0.5 text-xs",
              size === "sm" && "px-2.5 py-1 text-xs",
              size === "md" && "px-3 py-1.5 text-sm",
              active ? "bg-surface-1 text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
