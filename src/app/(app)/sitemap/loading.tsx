import { Skeleton } from "@/components/ui/skeleton";

export default function HtmlSitemapLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-4 h-4 w-32" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      {Array.from({ length: 3 }).map((_, section) => (
        <div key={section} className="mt-10">
          <Skeleton className="h-6 w-44" />
          <div className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
