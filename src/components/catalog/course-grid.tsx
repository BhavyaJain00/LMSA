import type { ReactNode } from "react";
import type { CourseSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CourseCard, CourseCardSkeleton } from "./course-card";

/** Responsive 1 / 2 / 3 / 4-column grid of course cards. */
export const courseGridClasses = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function CourseGrid({
  courses,
  empty,
  className,
  columns = "default",
  headingLevel,
}: {
  courses: CourseSummary[];
  /** Rendered when the list is empty. */
  empty?: ReactNode;
  className?: string;
  /** "compact" caps the grid at three columns (used inside narrower sections). */
  columns?: "default" | "compact";
  headingLevel?: "h2" | "h3";
}) {
  if (!courses.length) return <>{empty ?? null}</>;
  return (
    <ul className={cn(columns === "compact" ? "grid gap-5 sm:grid-cols-2 lg:grid-cols-3" : courseGridClasses, className)}>
      {courses.map((course) => (
        <li key={course.id} className="min-w-0">
          <CourseCard course={course} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export function CourseGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(courseGridClasses, className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <CourseCardSkeleton key={i} />
      ))}
    </div>
  );
}
