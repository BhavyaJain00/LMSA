import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function ProgramLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <Skeleton className="h-4 w-44" />
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-2/3 max-w-xl" />
        <div className="flex gap-5 pt-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="mt-6 h-24 w-full max-w-3xl rounded-card" />
      <Skeleton className="mt-8 h-6 w-48" />
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-border bg-surface-1">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-3 h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
