import { Skeleton } from "@/components/ui/skeleton";

export default function GiftLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading gifts…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-surface-1 p-6">
              <Skeleton className="h-5 w-40" />
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} className="space-y-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-9.5 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="order-first lg:order-last">
          <div className="rounded-card border border-border bg-surface-2 p-5">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="mt-4 h-4 w-3/4" />
            <Skeleton className="mt-6 h-6 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
