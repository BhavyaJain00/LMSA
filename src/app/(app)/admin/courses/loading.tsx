import { Skeleton } from "@/components/ui/skeleton";

export default function AdminCoursesLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading courses…</span>
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-9 w-32 rounded-lg sm:block" />
      </div>
      <div className="mt-6 flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-md" />
        ))}
      </div>
      <Skeleton className="mt-4 h-9.5 w-full max-w-sm rounded-lg" />
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <Skeleton className="h-12 w-20 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
            <Skeleton className="hidden h-4 w-12 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
