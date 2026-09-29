import { Skeleton } from "@/components/ui/skeleton";

export default function LeaderboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the leaderboard…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-8 w-64 rounded-full" />
            <Skeleton className="h-9.5 w-full sm:w-72" />
          </div>
          <Skeleton className="h-3 w-56" />
          <div className="rounded-card border border-border bg-surface-1 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-40" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          </div>
          <div className="rounded-card border border-border bg-surface-1 px-6 pt-5">
            <div className="mx-auto grid max-w-2xl grid-cols-3 items-end gap-4">
              {["h-16", "h-24", "h-12"].map((h, i) => (
                <div key={i} className="flex flex-col items-center">
                  <Skeleton className={i === 1 ? "size-20 rounded-full" : "size-14 rounded-full"} />
                  <Skeleton className="mt-3 h-3 w-20" />
                  <Skeleton className="mt-2 h-4 w-14" />
                  <Skeleton className={`mt-3 w-full rounded-b-none ${h}`} />
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-card border border-border bg-surface-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden space-y-6 lg:block">
          <Skeleton className="h-80 w-full rounded-card" />
          <Skeleton className="h-72 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
