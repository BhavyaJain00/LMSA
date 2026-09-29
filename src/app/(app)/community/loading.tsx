import { Skeleton } from "@/components/ui/skeleton";

export default function CommunityLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading discussions…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-9.5 w-full sm:w-64" />
            <Skeleton className="h-9.5 flex-1" />
          </div>
          <div className="flex gap-4 border-b border-border pb-2.5">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="overflow-hidden rounded-card border border-border bg-surface-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 border-b border-border px-4 py-4 last:border-b-0">
                <Skeleton className="hidden size-10 rounded-full sm:block" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-10 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-card" />
          <Skeleton className="h-44 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
