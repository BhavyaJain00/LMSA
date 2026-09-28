import { Skeleton } from "@/components/ui/skeleton";

export default function StatisticsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading statistics…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-60 rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-3 w-40" />
            <Skeleton className="mt-5 h-52 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-64 w-full rounded-card" />
    </div>
  );
}
