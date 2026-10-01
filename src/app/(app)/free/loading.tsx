import { Skeleton } from "@/components/ui/skeleton";

export default function FreeResourcesLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <div className="grid gap-10 rounded-3xl border border-border bg-surface-1 px-5 py-10 sm:px-10 lg:grid-cols-2">
        <div>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="mt-5 h-10 w-full max-w-md" />
          <Skeleton className="mt-3 h-10 w-3/4" />
          <Skeleton className="mt-5 h-4 w-full max-w-sm" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full max-w-sm" />
            ))}
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
      <Skeleton className="mt-14 h-7 w-56" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
