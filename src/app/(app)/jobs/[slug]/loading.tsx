import { Skeleton } from "@/components/ui/skeleton";

export default function JobLoading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading job…</span>
      <Skeleton className="h-4 w-48" />
      <div className="mt-3 flex justify-end gap-2">
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="mt-5 rounded-card border border-border bg-surface-1 p-8">
        <div className="flex gap-4">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        <div className="mt-10 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
