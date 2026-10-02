import { Skeleton } from "@/components/ui/skeleton";
import { BundleCardSkeleton } from "@/components/commerce/bundle-card";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function BundlesLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="pb-12">
      <LoadingLabel />
      <div className="mb-6 space-y-3">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9.5 flex-1 rounded-lg" />
        <Skeleton className="h-9.5 w-full rounded-lg sm:w-52" />
      </div>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <BundleCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
