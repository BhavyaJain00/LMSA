import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function MessageModerationLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}
