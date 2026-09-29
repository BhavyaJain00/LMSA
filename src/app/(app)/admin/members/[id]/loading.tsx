import { Skeleton } from "@/components/ui/skeleton";

export default function MemberLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading member…</span>
      <Skeleton className="h-4 w-48" />
      <div className="mt-3 flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      <div className="mt-5 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="rounded-card border border-border bg-surface-1 p-5">
              <Skeleton className="h-4 w-24" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((__, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-9.5 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-card border border-border bg-surface-1 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="mb-4 space-y-1.5 last:mb-0">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
