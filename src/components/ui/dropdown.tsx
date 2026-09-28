"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DropdownItem {
  label: ReactNode;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Submit a form action instead of onClick (e.g. logout). */
  action?: () => void | Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders a divider before this item. */
  separator?: boolean;
  description?: ReactNode;
}

export function Dropdown({
  trigger,
  items,
  align = "end",
  className,
  menuClassName,
  header,
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={cn(
            "absolute z-50 mt-1.5 min-w-48 overflow-hidden rounded-xl border border-border bg-surface-1 p-1 shadow-pop animate-scale-in",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            menuClassName,
          )}
        >
          {header && <div className="border-b border-border px-3 py-2">{header}</div>}
          {items.map((item, i) => {
            const classes = cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
              item.destructive ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-surface-2",
              item.disabled && "pointer-events-none opacity-50",
            );
            const inner = (
              <>
                {item.icon && <span className="text-ink-muted [&>svg]:size-4">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description && <span className="block text-xs text-ink-muted">{item.description}</span>}
                </span>
              </>
            );
            return (
              <div key={i}>
                {item.separator && <div className="my-1 border-t border-border" />}
                {item.href ? (
                  <Link href={item.href} role="menuitem" className={classes} onClick={() => setOpen(false)}>
                    {inner}
                  </Link>
                ) : item.action ? (
                  <form
                    action={async () => {
                      setOpen(false);
                      await item.action?.();
                    }}
                  >
                    <button type="submit" role="menuitem" className={classes} disabled={item.disabled}>
                      {inner}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={classes}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onClick?.();
                    }}
                  >
                    {inner}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Simple hover/focus tooltip. */
export function Tooltip({ label, children, side = "top", className }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  const pos = {
    top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
    left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
    right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
  };
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface-1 opacity-0 shadow transition-opacity group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          pos[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
