import { Skeleton } from "@/components/ui/skeleton";

export default function SubmissionsLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading submissions…</span>
      <Skeleton className="h-4 w-44" />
      <div className="mt-3 flex items-end justify-between gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9.5 w-32 rounded-lg" />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9.5 w-44 rounded-lg" />
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface-1">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="size-4" />
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="hidden h-5 w-20 rounded-full lg:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
