import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarSettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">Loading calendar settings…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-6">
        <div className="rounded-card border border-border bg-surface-1">
          <div className="space-y-2 border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-9.5 flex-1 rounded-lg" />
                <Skeleton className="h-9.5 w-28 rounded-lg" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-lg" />
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface-1">
          <div className="space-y-2 border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="divide-y divide-border p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-3">
                <Skeleton className="h-11 w-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
