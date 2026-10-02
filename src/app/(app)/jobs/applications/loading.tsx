import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function MyApplicationsLoading() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 rounded-card border border-border bg-surface-1 p-5">
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}
