import { Skeleton } from "@/components/ui/skeleton";

export default function AudienceLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the audience builder…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-6 flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-28" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5 rounded-card border border-border bg-surface-1 p-5">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-44 rounded-lg" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
