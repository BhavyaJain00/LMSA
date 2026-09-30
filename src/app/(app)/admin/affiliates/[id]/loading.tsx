import { Skeleton } from "@/components/ui/skeleton";

export default function AffiliateLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading affiliate…</span>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 rounded-card" />
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
      </div>
    </div>
  );
}
