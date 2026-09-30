import { Skeleton } from "@/components/ui/skeleton";

export default function AdminTeamsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading teams…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="mb-5 flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24" />
        ))}
      </div>
      <Skeleton className="mb-4 h-9.5 w-full rounded-lg" />
      <div className="rounded-card border border-border bg-surface-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-2.5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
