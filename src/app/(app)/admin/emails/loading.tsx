import { Skeleton } from "@/components/ui/skeleton";

export default function OutboxLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the outbox…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-36 rounded-lg" />
          <Skeleton className="h-9.5 w-40 rounded-lg" />
        </div>
      </div>
      <div className="mb-4 flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Skeleton className="h-9.5 rounded-lg" />
        <Skeleton className="h-9.5 rounded-lg" />
      </div>
      <div className="rounded-card border border-border bg-surface-1">
        <div className="border-b border-border bg-surface-2 px-4 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <div className="w-1/3 space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-3.5 flex-1 md:block" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
