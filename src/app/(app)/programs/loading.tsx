import { Skeleton } from "@/components/ui/skeleton";

export default function ProgramsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-24" />
        </div>
        <Skeleton className="h-9 w-60" />
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="size-10 rounded-xl" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex gap-4 pt-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
