import { Skeleton } from "@/components/ui/skeleton";

export default function JobsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading jobs…</span>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="mt-3 h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <Skeleton className="mt-6 h-9.5 w-full rounded-lg" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-4">
            <div className="flex gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3 w-1/2" />
            <div className="mt-5 flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
