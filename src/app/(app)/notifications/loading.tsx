import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading notifications…</span>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <Skeleton className="mb-6 h-10 w-full" />
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="mb-8">
          <Skeleton className="mb-2 h-3 w-24" />
          <div className="divide-y divide-border rounded-card border border-border bg-surface-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
