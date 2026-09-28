import { Skeleton } from "@/components/ui/skeleton";

export default function AdminBatchesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="mb-5 h-9 w-full max-w-lg" />
      <div className="overflow-hidden rounded-card border border-border bg-surface-1">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
