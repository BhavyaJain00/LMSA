import { Skeleton } from "@/components/ui/skeleton";

export default function SalesPageLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the sales page builder…</span>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-3 h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-4 h-9.5 w-full rounded-lg" />
              <Skeleton className="mt-3 h-20 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-surface-1 p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-4 h-16 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
