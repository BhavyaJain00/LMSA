import { Skeleton } from "@/components/ui/skeleton";

export default function NewQuizLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-3 h-7 w-44" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 space-y-5 rounded-card border border-border bg-surface-1 p-5 md:max-w-[calc(100%-17rem)]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9.5 w-full rounded-lg" />
          </div>
        ))}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Skeleton className="h-9.5 w-20 rounded-lg" />
          <Skeleton className="h-9.5 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
