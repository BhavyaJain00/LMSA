import { Skeleton } from "@/components/ui/skeleton";

export default function BroadcastLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the broadcast…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-56 max-w-full" />
          <Skeleton className="h-7 w-80 max-w-full" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-20 rounded-lg" />
          <Skeleton className="h-9.5 w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-[480px] w-full rounded-card" />
        </div>
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-card border border-border bg-surface-1 p-5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
