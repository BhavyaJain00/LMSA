import { Skeleton } from "@/components/ui/skeleton";

export default function AdminQuizzesLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-32" />
      <div className="mt-3 flex items-end justify-between gap-4">
        <Skeleton className="h-7 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>
      <Skeleton className="mt-6 h-9.5 w-full max-w-xs rounded-lg" />
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface-1">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="size-4" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/5" />
              </div>
              <Skeleton className="hidden h-3.5 w-16 md:block" />
              <Skeleton className="h-3.5 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
