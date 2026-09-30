import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLogLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the audit log…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9.5 w-36 rounded-lg" />
      </div>
      <div className="mb-5 flex gap-3 border-b border-border pb-2.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <div className="mb-4 space-y-2 rounded-card border border-border p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9.5 rounded-lg" />
          ))}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-40 rounded-lg" />
          <Skeleton className="h-9.5 w-40 rounded-lg" />
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface-1">
        <div className="border-b border-border bg-surface-2 px-4 py-3">
          <Skeleton className="h-3 w-48" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="h-3 w-16" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-3.5 w-32 sm:block" />
            <Skeleton className="hidden h-3.5 w-28 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
