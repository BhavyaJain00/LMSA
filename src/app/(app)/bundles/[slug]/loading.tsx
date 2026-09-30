import { Skeleton } from "@/components/ui/skeleton";

export default function BundleLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="pb-12">
      <span className="sr-only">Loading bundle…</span>
      <Skeleton className="mb-3 h-4 w-48" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <Skeleton className="h-44 w-full rounded-card sm:h-60" />
          <div className="space-y-3">
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full max-w-2xl" />
            <Skeleton className="h-4 w-5/6 max-w-2xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-4 rounded-card border border-border bg-surface-1 p-4">
                <Skeleton className="hidden h-24 w-40 shrink-0 rounded-lg sm:block" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-9 w-36" />
          <Skeleton className="mt-5 h-11 w-full rounded-xl" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
