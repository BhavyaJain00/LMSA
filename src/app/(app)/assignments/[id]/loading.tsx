import { Skeleton } from "@/components/ui/skeleton";

export default function AssignmentLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading assignment…</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-7 w-72 max-w-full" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface-1 p-6">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-11/12" />
          <Skeleton className="mt-2 h-3 w-4/5" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
        <div className="rounded-card border border-border bg-surface-1 p-6">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
          <Skeleton className="mt-6 h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
