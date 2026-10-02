"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

/** Loading state for submission detail pages (sidebar card + main card). */
export function DetailPageSkeleton({ label }: { label?: string }) {
  const tc = useT("common");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? tc("status.loading")}</span>
      <Skeleton className="h-4 w-60" />
      <Skeleton className="mt-3 h-7 w-72 max-w-full" />
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
