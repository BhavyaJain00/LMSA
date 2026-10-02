import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function PricingLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="pb-12">
      <LoadingLabel />
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 pt-4 sm:pt-8">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="mt-4 h-9 w-56 rounded-lg" />
      </div>
      <div className="mx-auto mt-8 grid max-w-3xl gap-5 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-10 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
            <div className="mt-6 space-y-3">
              {Array.from({ length: 5 }).map((__, r) => (
                <Skeleton key={r} className="h-3.5 w-full" />
              ))}
            </div>
            <Skeleton className="mt-6 h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
