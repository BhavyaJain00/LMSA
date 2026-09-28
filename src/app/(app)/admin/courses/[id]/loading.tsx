import { Skeleton } from "@/components/ui/skeleton";

export default function ManageCourseLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading course…</span>
      <Skeleton className="h-4 w-40" />
      <div className="mt-3 flex items-center gap-3">
        <Skeleton className="hidden h-9 w-16 rounded-lg sm:block" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="mt-6 flex gap-2 overflow-hidden border-b border-border pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24 shrink-0 rounded-md" />
        ))}
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-4 h-9.5 w-full rounded-lg" />
            <Skeleton className="mt-3 h-9.5 w-2/3 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
