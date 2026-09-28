import { Skeleton } from "@/components/ui/skeleton";

export default function QuizBuilderLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading quiz builder…</span>
      <Skeleton className="h-4 w-40" />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-24 rounded-lg" />
          <Skeleton className="h-9.5 w-32 rounded-lg" />
          <Skeleton className="h-9.5 w-20 rounded-lg" />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Skeleton className="h-9.5 flex-1 rounded-lg" />
            <Skeleton className="h-9.5 w-32 rounded-lg" />
            <Skeleton className="h-9.5 w-36 rounded-lg" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-3">
              <Skeleton className="size-4" />
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
              <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
