import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">Loading your dashboard…</span>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full sm:w-64" />
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-44" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 sm:flex-row">
                <Skeleton className="aspect-video w-full rounded-none sm:aspect-auto sm:h-32 sm:w-44" />
                <div className="flex-1 space-y-3 p-4">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-2 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-card border border-border bg-surface-1 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-28 w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-36 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
