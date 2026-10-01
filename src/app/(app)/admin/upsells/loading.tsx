import { Skeleton } from "@/components/ui/skeleton";

export default function UpsellsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading upsells…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-36" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-6 h-10 w-full rounded-lg" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
