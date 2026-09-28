import { Skeleton } from "@/components/ui/skeleton";

export default function BillingLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading checkout…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5 lg:order-first">
          <div className="rounded-card border border-border bg-surface-1 p-6">
            <Skeleton className="h-5 w-24" />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-9.5 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-36 w-full rounded-card" />
        </div>
        <div className="order-first space-y-4 lg:order-last">
          <div className="rounded-card border border-border bg-surface-2 p-5">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="mt-4 h-3 w-32" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-6 h-6 w-full" />
          </div>
          <Skeleton className="h-28 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
