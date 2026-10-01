import { Skeleton } from "@/components/ui/skeleton";

export default function TranscriptEditorLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the transcript editor…</span>
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="mt-4 h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="aspect-video w-full rounded-card" />
          <Skeleton className="h-16 rounded-card" />
          <Skeleton className="h-36 rounded-card" />
        </div>
        <div className="rounded-card border border-border bg-surface-1">
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="ml-auto h-8 w-48 rounded-lg" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-3">
                <Skeleton className="h-9 w-24 rounded-lg" />
                <Skeleton className="h-9 w-24 rounded-lg" />
                <Skeleton className="h-14 flex-1 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
