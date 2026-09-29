import { Skeleton } from "@/components/ui/skeleton";

export default function NewBatchLoading() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mb-6 mt-2 h-4 w-96 max-w-full" />
      <div className="rounded-card border border-border bg-surface-1">
        <div className="space-y-4 border-b border-border p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-4 p-6">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
