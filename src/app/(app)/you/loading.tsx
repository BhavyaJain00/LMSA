import { Skeleton } from "@/components/ui/skeleton";

function GroupPlaceholder({ rows }: { rows: number }) {
  return (
    <div>
      <Skeleton className="mb-2 ml-1 h-3 w-16" />
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 px-4 py-2">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="ml-auto size-4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function YouLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-lg space-y-8">
      <span className="sr-only">Loading your account…</span>
      <div className="flex flex-col items-center pt-2">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="mt-3 h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-56 max-w-full" />
        <Skeleton className="mt-3 h-4 w-24" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>
      <GroupPlaceholder rows={3} />
      <GroupPlaceholder rows={6} />
    </div>
  );
}
