import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "outline" | "dark";

/*
 * Tinted tones use the bright status colour for the fill and its text-safe
 * `-ink` shade for the label (≥ 4.5:1 in both themes).
 */
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-muted",
  accent: "bg-accent/12 text-accent-ink",
  success: "bg-success/12 text-success-ink",
  warning: "bg-warning/15 text-warning-ink",
  danger: "bg-danger/12 text-danger-ink",
  info: "bg-info/12 text-info-ink",
  outline: "border border-border-strong text-ink-muted",
  dark: "bg-ink text-surface-1",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  className,
  children,
  dot,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; size?: "xs" | "sm" | "md"; dot?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "xs" && "px-1.5 py-px text-micro",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Colored chip for tags/categories. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-ink-muted", className)}>
      {children}
    </span>
  );
}

const statusTones: Record<string, BadgeTone> = {
  published: "success",
  approved: "success",
  paid: "success",
  pass: "success",
  passed: "success",
  complete: "success",
  completed: "success",
  active: "success",
  open: "success",
  upcoming: "info",
  in_progress: "info",
  pending: "warning",
  not_graded: "warning",
  under_review: "warning",
  partial: "warning",
  draft: "neutral",
  incomplete: "neutral",
  not_applicable: "neutral",
  closed: "neutral",
  archived: "neutral",
  cancelled: "danger",
  fail: "danger",
  failed: "danger",
  refunded: "danger",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = statusTones[status] ?? "neutral";
  const label = status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}
