import { Skeleton } from "@/components/ui/skeleton";

export default function QuestionLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading question…</span>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-3 h-7 w-32" />
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          <div className="flex gap-3">
            <Skeleton className="h-9.5 w-52 rounded-lg" />
            <Skeleton className="h-9.5 w-44 rounded-lg" />
          </div>
          <Skeleton className="h-24 w-full rounded-lg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
