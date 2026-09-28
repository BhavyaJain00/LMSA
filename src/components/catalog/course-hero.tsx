import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { VideoPlayer } from "@/components/player";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import { CourseCover } from "./course-cover";
import { InstructorByline } from "./instructor-byline";
import { compactCount, plural } from "./format";
import { RatingStars } from "./rating-stars";

function Dot() {
  return (
    <span aria-hidden="true" className="text-ink-faint">
      ·
    </span>
  );
}

/**
 * Course page hero: breadcrumbs, status badges, title, short introduction,
 * meta row (category, rating, students, duration, instructors), tags and
 * the promo video (custom player) or cover artwork.
 */
export function CourseHero({ course, manager, className }: { course: CourseSummary; manager: boolean; className?: string }) {
  const updated = course.updatedAt ? formatDate(course.updatedAt, { month: "long", year: "numeric", day: undefined }) : "";
  return (
    <section aria-labelledby="course-title" className={cn("space-y-5", className)}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-ink-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link href="/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
          </li>
          {course.category && (
            <>
              <li aria-hidden="true">
                <Icon.ChevronRight className="size-3.5 text-ink-faint" />
              </li>
              <li className="hidden sm:block">
                <Link href={`/courses?category=${course.category.slug}`} className="hover:text-ink hover:underline">
                  {course.category.name}
                </Link>
              </li>
              <li aria-hidden="true" className="hidden sm:block">
                <Icon.ChevronRight className="size-3.5 text-ink-faint" />
              </li>
            </>
          )}
          {!course.category && (
            <li aria-hidden="true">
              <Icon.ChevronRight className="size-3.5 text-ink-faint" />
            </li>
          )}
          <li className="min-w-0 truncate font-medium text-ink" aria-current="page">
            {course.title}
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {manager && course.published && <StatusBadge status="published" />}
        {!course.published && (
          <Badge tone="dark" size="sm">
            <Icon.EyeOff className="size-3" aria-hidden="true" />
            Unpublished
          </Badge>
        )}
        {!course.published && course.status !== "approved" && <StatusBadge status={course.status} />}
        {course.upcoming && (
          <Badge tone="info" size="sm">
            <Icon.Clock className="size-3" aria-hidden="true" />
            Upcoming
          </Badge>
        )}
        {course.featured && (
          <Badge tone="warning" size="sm">
            <Icon.Award className="size-3" aria-hidden="true" />
            Featured
          </Badge>
        )}
        {course.enforceLessonCompletion && (
          <Badge tone="neutral" size="sm">
            <Icon.ListChecks className="size-3" aria-hidden="true" />
            Lessons unlock in order
          </Badge>
        )}
      </div>

      <div>
        <h1 id="course-title" className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {course.title}
        </h1>
        {course.shortIntroduction && <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted sm:text-lg">{course.shortIntroduction}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-sm text-ink-muted">
        {course.category && (
          <>
            <Link href={`/courses?category=${course.category.slug}`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              <Icon.Tag className="size-4" aria-hidden="true" />
              {course.category.name}
            </Link>
            <Dot />
          </>
        )}
        {course.averageRating && course.reviewCount > 0 ? (
          <>
            <a href="#reviews" className="inline-flex items-center gap-1.5 hover:underline">
              <span className="font-semibold text-ink">{course.averageRating.toFixed(1)}</span>
              <RatingStars value={course.averageRating} size="sm" />
              <span>
                ({compactCount(course.reviewCount)} {plural(course.reviewCount, "rating")})
              </span>
            </a>
            <Dot />
          </>
        ) : null}
        {course.enrollmentCount > 0 && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Icon.Users className="size-4" aria-hidden="true" />
              {compactCount(course.enrollmentCount)} {plural(course.enrollmentCount, "Student")}
            </span>
            <Dot />
          </>
        )}
        {course.lessonCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Icon.BookOpen className="size-4" aria-hidden="true" />
            {course.lessonCount} {plural(course.lessonCount, "lesson")}
            {course.totalDurationSeconds > 0 && ` · ${formatDuration(course.totalDurationSeconds)}`}
          </span>
        )}
        {updated && (
          <>
            {course.lessonCount > 0 && <Dot />}
            <span className="inline-flex items-center gap-1.5">
              <Icon.Refresh className="size-4" aria-hidden="true" />
              Updated {updated}
            </span>
          </>
        )}
      </div>

      {course.instructors.length > 0 && <InstructorByline instructors={course.instructors} size="sm" prefix="Created by" />}

      {course.tags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Tags">
          {course.tags.map((tag) => (
            <li key={tag}>
              <Link
                href={`/courses?search=${encodeURIComponent(tag)}`}
                className="inline-flex items-center rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
              >
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-black shadow-card">
        {course.videoUrl ? (
          <VideoPlayer src={course.videoUrl} poster={course.imageUrl} title={`${course.title} — course preview`} className="rounded-none" />
        ) : (
          <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} variant="hero" alt={course.title} className="aspect-video w-full" />
        )}
      </div>
    </section>
  );
}
