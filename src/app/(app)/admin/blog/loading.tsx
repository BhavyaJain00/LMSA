import { Skeleton } from "@/components/ui/skeleton";

export default function AdminBlogLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <Skeleton className="h-8 w-72 max-w-full rounded-full" />
        <Skeleton className="h-9.5 w-80 max-w-full rounded-lg" />
      </div>
      <div className="mt-4 rounded-card border border-border bg-surface-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
            <Skeleton className="size-4 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-64 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
