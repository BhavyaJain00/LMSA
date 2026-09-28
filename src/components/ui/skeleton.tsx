import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-card border border-border bg-surface-1 p-4">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="mt-4 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <Skeleton className="mt-4 h-3 w-full" />
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong text-center",
        compact ? "px-4 py-8" : "px-6 py-16",
        className,
      )}
    >
      <div className={cn("mb-3 flex items-center justify-center rounded-full bg-surface-2 text-ink-faint", compact ? "size-10 [&>svg]:size-5" : "size-14 [&>svg]:size-7")}>
        {icon ?? <Icon.Inbox />}
      </div>
      <h3 className={cn("font-semibold text-ink", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className={cn("mt-1 max-w-sm text-ink-muted", compact ? "text-xs" : "text-sm")}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
