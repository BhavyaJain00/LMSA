import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of the webhook endpoint page: header, counters, details and the delivery log. */
export default function WebhookEndpointLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the webhook endpoint…</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-6 w-56 max-w-full" />
      <Skeleton className="mt-3 h-8 w-full max-w-md" />
      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-6">
        <div className="rounded-card border border-border bg-surface-1">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface-1">
          <div className="border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-28" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-b-0">
              <Skeleton className="h-5 w-20 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="hidden h-3 w-24 sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
