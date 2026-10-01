import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLeadsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-44 w-full rounded-card" />
      <div className="mt-8 flex flex-wrap gap-3">
        <Skeleton className="h-8 w-80 max-w-full rounded-full" />
        <Skeleton className="h-9.5 w-96 max-w-full rounded-lg" />
      </div>
      <div className="mt-4 rounded-card border border-border bg-surface-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
            <Skeleton className="size-4 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-56 max-w-full" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
