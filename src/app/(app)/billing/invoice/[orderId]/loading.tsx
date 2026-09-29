import { Skeleton } from "@/components/ui/skeleton";

export default function InvoiceLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading invoice…</span>
      <Skeleton className="h-4 w-48" />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-7 w-56" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>
      <div className="mx-auto mt-6 w-full max-w-3xl rounded-card border border-border bg-surface-1 p-5 sm:p-10">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="flex gap-3">
            <Skeleton className="size-12 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="space-y-2 sm:items-end">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
        <Skeleton className="mt-8 h-16 w-full" />
        <div className="ml-auto mt-6 w-full max-w-xs space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
