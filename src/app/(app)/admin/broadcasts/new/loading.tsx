import { Skeleton } from "@/components/ui/skeleton";

export default function BroadcastComposerLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the composer…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-5">
        <div className="space-y-5 rounded-card border border-border bg-surface-1 p-5">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-48 rounded-lg" />
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
            </div>
          ))}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-72 w-full rounded-lg" />
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    </div>
  );
}
