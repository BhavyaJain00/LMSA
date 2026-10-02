import { Skeleton } from "@/components/ui/skeleton";
import { CourseGridSkeleton } from "@/components/catalog/course-grid";
import { LoadingLabel } from "@/components/catalog/loading-label";

/** Catalog skeleton: header, tab strip, filters and 8 card placeholders. */
export default function CoursesLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Skeleton className="h-7 w-44" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9.5 w-28" />
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-xl" />
      <div className="mt-4 flex flex-col gap-3 lg:flex-row">
        <Skeleton className="h-10 flex-1" />
        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-10 w-36" />
        </div>
      </div>
      <Skeleton className="mb-5 mt-5 h-4 w-32" />
      <CourseGridSkeleton count={8} />
    </div>
  );
}
