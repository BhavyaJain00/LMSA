import { Skeleton } from "@/components/ui/skeleton";

export default function OutboxEmailLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading email…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-card border border-border bg-surface-1">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-7 w-72 max-w-full rounded-lg" />
          </div>
          <div className="bg-surface-2 p-4">
            <Skeleton className="h-[520px] w-full rounded-lg" />
          </div>
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
