import { CourseGridSkeleton } from "@/components/catalog/course-grid";
import { Skeleton } from "@/components/ui/skeleton";

export default function InstructorLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-4 h-4 w-48" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Skeleton className="size-28 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mt-3 h-5 w-80 max-w-full" />
          <Skeleton className="mt-4 h-8 w-56" />
        </div>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-card" />
        ))}
      </div>
      <Skeleton className="mb-4 mt-10 h-6 w-52" />
      <CourseGridSkeleton count={4} />
    </div>
  );
}
