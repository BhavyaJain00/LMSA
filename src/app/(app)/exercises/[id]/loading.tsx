import { Skeleton } from "@/components/ui/skeleton";

export default function ExerciseLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading exercise…</span>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-3 h-7 w-64 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[5fr_7fr]">
        <div className="rounded-card border border-border bg-surface-1 p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-5/6" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-[400px] w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
