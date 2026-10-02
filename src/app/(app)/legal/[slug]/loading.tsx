import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function LegalPageLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-5xl">
      <LoadingLabel />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-60" />
      <div className="mt-8 grid gap-10 border-t border-border pt-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 pb-4">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
        <div className="hidden space-y-2 lg:block">
          <Skeleton className="h-3 w-24" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-40" />
          ))}
        </div>
      </div>
    </div>
  );
}
