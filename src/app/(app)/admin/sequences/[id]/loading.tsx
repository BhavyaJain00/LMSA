import { Skeleton } from "@/components/ui/skeleton";

export default function SequenceLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the sequence…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-64 max-w-full" />
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-16 rounded-lg" />
          <Skeleton className="h-9.5 w-20 rounded-lg" />
          <Skeleton className="h-9.5 w-24 rounded-lg" />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-card border border-border bg-surface-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b border-border px-5 py-4 last:border-0">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-48 rounded-card" />
      </div>
      <Skeleton className="mb-3 h-6 w-24" />
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
