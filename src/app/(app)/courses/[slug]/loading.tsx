import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

/** Course page skeleton: hero, media, outline rows and the CTA card. */
export default function CourseLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Skeleton className="h-4 w-56" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-2/3" />
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="space-y-3 pt-6">
            <Skeleton className="h-7 w-48" />
            <div className="overflow-hidden rounded-card border border-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5 lg:h-fit">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="space-y-3 border-t border-border pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
