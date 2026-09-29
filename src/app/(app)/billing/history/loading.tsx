import { Skeleton } from "@/components/ui/skeleton";

export default function OrderHistoryLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your orders…</span>
      <Skeleton className="h-7 w-52" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <Skeleton className="mt-6 h-4 w-48" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4 rounded-card border border-border bg-surface-1 p-4 sm:p-5">
            <Skeleton className="hidden aspect-video w-28 shrink-0 rounded-lg sm:block" />
            <div className="flex-1 space-y-2">
              <div className="flex justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-72 max-w-full" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-8 w-36 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
