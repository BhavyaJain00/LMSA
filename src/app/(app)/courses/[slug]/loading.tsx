import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

/** Course page skeleton: back button, title and meta row, the enroll card next to the cover, then the content card. */
export default function CourseLoading() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <div>
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="mt-5 h-9 w-4/5 max-w-2xl" />
        <div className="mt-4 flex flex-wrap gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-6">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="mt-5 h-11 w-full rounded-xl" />
          <div className="mt-5 space-y-2.5 border-t border-border pt-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <Skeleton className="aspect-video w-full rounded-card" />
      </div>

      <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
        <Skeleton className="h-6 w-44" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-3.5 w-56" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
