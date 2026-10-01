import { Skeleton } from "@/components/ui/skeleton";

export default function ErrorDetailLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the error…</span>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-xl space-y-2">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-36 rounded-lg" />
          <Skeleton className="h-9.5 w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-2 rounded-card border border-border p-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className={i === 0 ? "h-3.5 w-3/4" : "ml-4 h-3 w-5/6"} />
          ))}
        </div>
        <div className="space-y-5">
          <Skeleton className="h-72 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      </div>
    </div>
  );
}
