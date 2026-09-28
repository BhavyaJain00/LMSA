import { Skeleton } from "@/components/ui/skeleton";

export default function AdminBatchLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-48" />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="mt-6 flex gap-3 border-b border-border pb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-20" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-8 h-64 w-full rounded-card" />
    </div>
  );
}
