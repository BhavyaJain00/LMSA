import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder of the blog index and archive pages. */
export function BlogListSkeleton({ featured = false }: { featured?: boolean }) {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading articles…</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-6 h-9.5 w-full max-w-md rounded-lg" />
      {featured && <Skeleton className="mt-8 h-80 w-full rounded-card" />}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-card border border-border bg-surface-1">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading placeholder of an article. */
export function PostSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading article…</span>
      <Skeleton className="mb-5 h-4 w-56" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-10 w-full" />
      <Skeleton className="mt-2 h-10 w-2/3" />
      <Skeleton className="mt-4 h-5 w-full" />
      <div className="mt-5 flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="mt-6 aspect-video w-full rounded-card" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className={i % 4 === 3 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
}
