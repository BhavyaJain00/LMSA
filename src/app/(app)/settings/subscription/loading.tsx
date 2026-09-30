import { Skeleton } from "@/components/ui/skeleton";

export default function SubscriptionSettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl pb-10">
      <span className="sr-only">Loading your membership…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-6">
        <div className="rounded-card border border-border bg-surface-1">
          <div className="space-y-2 border-b border-border px-5 py-4">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface-1">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="space-y-4 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
