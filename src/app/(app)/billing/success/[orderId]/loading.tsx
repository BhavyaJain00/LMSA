import { Skeleton } from "@/components/ui/skeleton";

export default function OrderLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading order…</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-7 w-32" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <div className="flex gap-4 rounded-card border border-border bg-surface-1 p-6">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="mt-4 h-9 w-40 rounded-lg" />
            </div>
          </div>
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
        <Skeleton className="h-80 w-full rounded-card" />
      </div>
    </div>
  );
}
