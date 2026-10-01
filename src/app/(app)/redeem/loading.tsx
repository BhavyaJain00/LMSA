import { Skeleton } from "@/components/ui/skeleton";

export default function RedeemLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your gift…</span>
      <Skeleton className="h-7 w-44" />
      <div className="mx-auto mt-6 w-full max-w-lg space-y-5">
        <div className="overflow-hidden rounded-card border border-border bg-surface-1">
          <Skeleton className="aspect-[16/7] w-full rounded-none" />
          <div className="space-y-3 p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-28 w-full rounded-card" />
      </div>
    </div>
  );
}
