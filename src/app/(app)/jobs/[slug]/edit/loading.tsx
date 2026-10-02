import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function JobFormLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-52" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9.5 w-full rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-9.5 rounded-lg" />
            <Skeleton className="h-9.5 rounded-lg" />
            <Skeleton className="h-9.5 rounded-lg" />
          </div>
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
