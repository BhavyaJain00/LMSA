"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

/** Loading state for admin/learner list pages: header, filter row and table rows. */
export function ListPageSkeleton({ columns = 4, rows = 8, filters = 2, label }: { columns?: number; rows?: number; filters?: number; label?: string }) {
  const tc = useT("common");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? tc("status.loading")}</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9.5 w-28" />
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        {Array.from({ length: filters }).map((_, i) => (
          <Skeleton key={i} className="h-9.5 w-full sm:w-56" />
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface-1">
        <div className="flex gap-4 border-b border-border bg-surface-2 px-4 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={c === 0 ? "h-4 flex-[2]" : "h-3 flex-1"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading state for card grids (certified members). */
export function GridPageSkeleton({ cards = 9, label }: { cards?: number; label?: string }) {
  const tc = useT("common");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? tc("status.loading")}</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-64" />
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9.5 w-full sm:w-64" />
        <Skeleton className="h-9.5 w-full sm:w-52" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="mt-5 flex justify-between">
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
