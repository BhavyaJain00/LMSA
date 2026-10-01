import Link from "next/link";
import { cn, gradientFor, pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { InstructorNames } from "./batch-meta";
import type { BatchCourseItem } from "./types";

function CourseCover({ course }: { course: BatchCourseItem }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
      {course.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className={cn("absolute inset-0 flex items-end bg-gradient-to-br p-4", gradientFor(course.cardGradient))} aria-hidden="true">
          <span className="line-clamp-2 text-lg font-semibold leading-tight text-white">{course.title}</span>
        </div>
      )}
      {course.completed && (
        <Badge tone="success" className="absolute right-3 top-3 bg-surface-1/90 backdrop-blur">
          <Icon.CheckCircle className="size-3" /> Completed
        </Badge>
      )}
    </div>
  );
}

/**
 * Course cards for a batch. With `showProgress`, enrolled learners see their
 * progress and a Continue link to the next lesson.
 */
export function BatchCourseGrid({ courses, showProgress = false, className }: { courses: BatchCourseItem[]; showProgress?: boolean; className?: string }) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {courses.map((course) => {
        const cta = !showProgress
          ? null
          : !course.enrolled
            ? { href: `/courses/${course.slug}`, label: "View course", variant: "outline" as const }
            : course.completed
              ? { href: course.continueHref ?? `/courses/${course.slug}`, label: "Review course", variant: "outline" as const }
              : { href: course.continueHref ?? `/courses/${course.slug}`, label: (course.progress ?? 0) > 0 ? "Continue" : "Start course", variant: "primary" as const };
        return (
          <article key={course.id} className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
            <Link href={`/courses/${course.slug}`} className="group block" aria-label={course.title}>
              <CourseCover course={course} />
            </Link>
            <div className="flex flex-1 flex-col p-4">
              <Link href={`/courses/${course.slug}`} className="line-clamp-2 font-semibold leading-snug text-ink hover:text-accent">
                {course.title}
              </Link>
              {course.shortIntroduction && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{course.shortIntroduction}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <Icon.BookOpen className="size-3.5" /> {pluralize(course.lessonCount, "lesson")}
                </span>
                {!course.published && <Badge tone="warning" size="xs">Unpublished</Badge>}
              </div>
              {course.instructors.length > 0 && <InstructorNames users={course.instructors} className="mt-3" />}
              {showProgress && (
                <div className="mt-auto space-y-3 pt-4">
                  {course.enrolled ? (
                    <ProgressBar value={course.progress ?? 0} showLabel label="Progress" size="sm" tone={course.completed ? "success" : "accent"} />
                  ) : (
                    <p className="text-xs text-ink-muted">You are not enrolled in this course yet.</p>
                  )}
                  {course.enrolled && course.nextLessonTitle && !course.completed && (
                    <p className="truncate text-xs text-ink-muted">
                      Next: <span className="text-ink">{course.nextLessonTitle}</span>
                    </p>
                  )}
                  {cta && (
                    <ButtonLink href={cta.href} variant={cta.variant} size="sm" className="w-full" rightIcon={<Icon.ArrowRight className="size-4" />}>
                      {cta.label}
                    </ButtonLink>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
