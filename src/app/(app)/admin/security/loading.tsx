import { Skeleton } from "@/components/ui/skeleton";

export default function LoginActivityLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading login activity…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_14rem_9rem]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9.5 w-full rounded-lg" />
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface-1">
        <div className="border-b border-border bg-surface-2 px-4 py-3">
          <Skeleton className="h-3 w-1/2" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <Skeleton className="h-3 w-16" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-5 w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
