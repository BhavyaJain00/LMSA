import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading analytics…</span>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <Skeleton className="h-9 w-72 max-w-full rounded-full" />
        <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface-1 p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-7 w-80 max-w-full rounded-lg" />
        <Skeleton className="mt-4 h-56 w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-3 w-48" />
            <div className="mt-5 space-y-4">
              {Array.from({ length: 4 }).map((__, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
