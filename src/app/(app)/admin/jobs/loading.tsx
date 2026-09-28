import { Skeleton } from "@/components/ui/skeleton";

export default function AdminJobsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-52" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 flex justify-between gap-3">
        <Skeleton className="h-8 w-60 rounded-full" />
        <Skeleton className="h-9.5 w-64 rounded-lg" />
      </div>
      <div className="mt-4 rounded-card border border-border bg-surface-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
