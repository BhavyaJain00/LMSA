import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function BatchesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20" />
          ))}
        </div>
        <Skeleton className="h-9 w-60" />
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-border bg-surface-1">
            <Skeleton className="aspect-[16/7] w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-4 h-3 w-1/2" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center justify-between border-t border-border pt-3">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
