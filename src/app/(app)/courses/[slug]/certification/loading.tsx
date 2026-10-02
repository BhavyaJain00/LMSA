import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function CertificationLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-3 h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-9 w-28" />
          </div>
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </div>
  );
}
