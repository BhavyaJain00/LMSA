import { Skeleton } from "@/components/ui/skeleton";

export default function QuestionBankLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading questions…</span>
      <Skeleton className="h-4 w-40" />
      <div className="mt-3 flex items-end justify-between gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9.5 w-36 rounded-lg" />
      </div>
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-9.5 w-full max-w-xs rounded-lg" />
        <Skeleton className="h-9.5 w-48 rounded-lg" />
      </div>
      <div className="mt-4 overflow-hidden rounded-card border border-border bg-surface-1">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="size-4" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
              <Skeleton className="hidden h-3.5 w-20 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
