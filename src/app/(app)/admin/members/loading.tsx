import { Skeleton } from "@/components/ui/skeleton";

export default function MembersLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading members…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-5 h-9.5 w-full rounded-lg" />
      <div className="mt-4 rounded-card border border-border bg-surface-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
