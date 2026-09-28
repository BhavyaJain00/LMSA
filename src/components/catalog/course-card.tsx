import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration } from "@/lib/utils";
import { CourseCover } from "./course-cover";
import { InstructorByline } from "./instructor-byline";
import { PriceTag } from "./price-tag";
import { RatingInline } from "./rating-stars";
import { compactCount, plural } from "./format";

export interface CourseCardProps {
  course: CourseSummary;
  className?: string;
  /** Heading level for the title (h3 inside a titled section, h2 on flat pages). */
  headingLevel?: "h2" | "h3";
}

/**
 * Course summary card used in the catalog, related courses and the landing
 * page. The whole card is clickable through a stretched title link; the
 * instructor links sit above it.
 */
export function CourseCard({ course, className, headingLevel = "h3" }: CourseCardProps) {
  if (!course.title) return null;
  const Heading = headingLevel;
  const href = `/courses/${course.slug}`;
  const enrolled = !!course.enrollment;
  const progress = Math.min(100, Math.ceil(course.progress ?? course.enrollment?.progress ?? 0));
  const certification = course.enableCertification || course.paidCertificate;

  return (
    <article
      className={cn(
        "group relative flex h-full min-h-[22rem] flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} className="h-42 shrink-0 border-b border-border">
        {!course.published && (
          <Badge tone="dark" size="xs">
            <Icon.EyeOff className="size-3" aria-hidden="true" />
            Unpublished
          </Badge>
        )}
        {course.upcoming && (
          <Badge tone="info" size="xs" className="bg-surface-1 shadow-sm">
            <Icon.Clock className="size-3" aria-hidden="true" />
            Upcoming
          </Badge>
        )}
        {course.featured && (
          <Badge tone="warning" size="xs" className="bg-surface-1 shadow-sm">
            <Icon.Award className="size-3" aria-hidden="true" />
            Featured
          </Badge>
        )}
      </CourseCover>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {course.category && <span className="font-medium text-accent">{course.category.name}</span>}
          {course.lessonCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.BookOpen className="size-3.5" aria-hidden="true" />
              {course.lessonCount} {plural(course.lessonCount, "lesson")}
            </span>
          )}
          {course.totalDurationSeconds > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.Clock className="size-3.5" aria-hidden="true" />
              {formatDuration(course.totalDurationSeconds)}
            </span>
          )}
        </div>

        <Heading className="mt-2 line-clamp-2 text-base font-semibold leading-snug tracking-tight text-ink">
          <Link href={href} className="outline-none before:absolute before:inset-0 before:z-0 before:content-['']">
            {course.title}
          </Link>
        </Heading>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-muted">{course.shortIntroduction}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
          <RatingInline average={course.averageRating} count={course.reviewCount} />
          {course.enrollmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.Users className="size-3.5" aria-hidden="true" />
              {compactCount(course.enrollmentCount)} {plural(course.enrollmentCount, "student")}
            </span>
          )}
          {course.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
              {tag}
            </span>
          ))}
        </div>

        {enrolled && (
          <div className="mt-4">
            <ProgressBar value={progress} size="xs" label={`${progress}% completed`} />
            <p className="mt-1.5 text-xs font-medium text-ink-muted" aria-hidden="true">
              {progress >= 100 ? "Completed" : `${progress}% completed`}
            </p>
          </div>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <InstructorByline instructors={course.instructors} className="min-w-0 flex-1" />
            <div className="flex shrink-0 items-center gap-2">
              {certification && (
                <span className="relative z-10 text-ink-faint" title="Get Certified">
                  <Icon.GraduationCap className="size-5" aria-hidden="true" />
                  <span className="sr-only">Offers a certificate</span>
                </span>
              )}
              {course.upcoming ? <span className="text-sm font-medium text-info">Coming soon</span> : <PriceTag course={course} />}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-card border border-border bg-surface-1" aria-hidden="true">
      <Skeleton className="h-42 w-full rounded-none" />
      <div className="flex flex-1 flex-col p-4">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-2/3" />
        <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    </div>
  );
}
