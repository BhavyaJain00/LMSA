import { Skeleton } from "@/components/ui/skeleton";

export default function SequenceFormLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the sequence editor…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-64 max-w-full" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-5">
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9.5 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-5 w-20" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-card" />
        ))}
      </div>
    </div>
  );
}
