import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

/**
 * Admin overview placeholder. It lives in the `(overview)` route group so it only
 * covers `/admin` itself; every admin section keeps its own loading state.
 */
export default function AdminOverviewLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-10">
      <span className="sr-only">Loading the admin overview…</span>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-60 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="mt-3 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <Skeleton className="h-5 w-44" />
          <div className="overflow-hidden rounded-card border border-border bg-surface-1">
            <div className="flex gap-4 border-b border-border bg-surface-2/60 px-4 py-3">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="ml-auto h-3 w-16" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <div className="rounded-card border border-border bg-surface-1 p-4">
            <ListSkeleton rows={5} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
