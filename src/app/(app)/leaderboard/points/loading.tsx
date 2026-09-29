import { Skeleton } from "@/components/ui/skeleton";

export default function PointsHistoryLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your points…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex items-center gap-4 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-surface-1 p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="overflow-hidden rounded-card border border-border bg-surface-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-56 max-w-full" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-96 w-full rounded-card lg:block" />
      </div>
    </div>
  );
}
