import { Skeleton } from "@/components/ui/skeleton";

export default function ErrorLogLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the error log…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9.5 w-36 rounded-lg" />
      </div>
      <Skeleton className="mb-5 h-12 rounded-card" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <div className="mb-3 flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-9.5 flex-1 rounded-lg" />
        <Skeleton className="h-9.5 w-48 rounded-lg" />
      </div>
      <div className="rounded-card border border-border bg-surface-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="size-4 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3.5 w-8" />
            <Skeleton className="hidden h-3.5 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
