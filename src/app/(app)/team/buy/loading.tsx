import { Skeleton } from "@/components/ui/skeleton";

export default function TeamBuyLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the team purchase page…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
