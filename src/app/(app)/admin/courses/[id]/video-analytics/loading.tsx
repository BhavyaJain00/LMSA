import { Skeleton } from "@/components/ui/skeleton";

export default function VideoAnalyticsLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading video analytics…</span>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-card border border-border bg-surface-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
            <Skeleton className="h-3 w-8" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="hidden h-6 w-28 lg:block" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-card border border-border bg-surface-1 p-5">
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="mt-5 h-60 w-full rounded-lg" />
      </div>
    </div>
  );
}
