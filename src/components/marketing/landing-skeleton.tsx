import { CourseGridSkeleton } from "@/components/catalog/course-grid";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shared by the landing pages: breadcrumb, title, intro,
 * then either a course grid or a grid of plain cards (hub and directory pages).
 */
export function LandingSkeleton({ variant = "courses" }: { variant?: "courses" | "cards" }) {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-4 h-4 w-48" />
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-40" />
      <Skeleton className="mt-5 h-4 w-full max-w-2xl" />
      <Skeleton className="mt-2 h-4 w-4/5 max-w-xl" />
      <Skeleton className="mb-4 mt-9 h-6 w-52" />
      {variant === "courses" ? (
        <CourseGridSkeleton count={8} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-card" />
          ))}
        </div>
      )}
    </div>
  );
}
