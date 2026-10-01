import { Skeleton } from "@/components/ui/skeleton";

export default function DevelopersLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-6xl pb-16">
      <span className="sr-only">Loading the API reference…</span>
      <div className="mb-8 border-b border-border pb-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <Skeleton className="mt-1.5 h-4 w-2/3 max-w-md" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-32" />
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-card lg:hidden" />
        <div className="min-w-0 space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <div className="space-y-2 rounded-lg border border-border p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
          <Skeleton className="h-24 w-full rounded-lg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
