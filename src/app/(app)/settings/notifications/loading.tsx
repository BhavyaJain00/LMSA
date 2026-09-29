import { Skeleton } from "@/components/ui/skeleton";

export default function EmailNotificationsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">Loading email preferences…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="rounded-card border border-border bg-surface-1">
        <div className="space-y-2 border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="divide-y divide-border px-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-3.5">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-5.5 w-10 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
