import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { InstructorByline } from "./instructor-byline";
import { MetaDots } from "./course-page/section-card";

/**
 * Course page header (simple layout): a back button to the catalog, the status badges that matter (unpublished,
 * review status, upcoming), the title, one meta row (instructors, chapters, lessons, total duration and, when
 * there are reviews, the rating linking to them) and the short introduction. The artwork and the enroll card
 * are rendered by the page underneath.
 */
export async function CourseHero({
  course,
  reviewsAnchor = true,
  className,
}: {
  course: CourseSummary;
  /** The page renders a `#reviews` section the rating can link to. */
  reviewsAnchor?: boolean;
  className?: string;
}) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const showBadges = !course.published || course.upcoming;
  const rated = !!course.averageRating && course.reviewCount > 0;
  const ratingLabel = rated ? f.number(course.averageRating!, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "";
  const rating = rated ? (
    <>
      <Icon.StarFilled className="size-4 text-warning" aria-hidden="true" />
      <span aria-hidden="true">
        <span className="font-semibold text-ink">{ratingLabel}</span> ({f.number(course.reviewCount)})
      </span>
      <span className="sr-only">{t("course.page.ratingLink", { rating: ratingLabel, count: course.reviewCount })}</span>
    </>
  ) : null;

  const meta = [
    course.instructors.length > 0 ? (
      <span className="inline-flex min-w-0 items-center">
        <span className="sr-only">{t("course.page.instructorLabel")} </span>
        <InstructorByline instructors={course.instructors} size="xs" />
      </span>
    ) : null,
    course.chapterCount > 0 ? (
      <span className="inline-flex items-center gap-1.5">
        <Icon.Layers className="size-4 text-ink-faint" aria-hidden="true" />
        {t("card.chapterCount", { count: course.chapterCount })}
      </span>
    ) : null,
    course.lessonCount > 0 ? (
      <span className="inline-flex items-center gap-1.5">
        <Icon.BookOpen className="size-4 text-ink-faint" aria-hidden="true" />
        {t("catalog.lessonCount", { count: course.lessonCount })}
      </span>
    ) : null,
    course.totalDurationSeconds > 0 ? (
      <span className="inline-flex items-center gap-1.5">
        <Icon.Clock className="size-4 text-ink-faint" aria-hidden="true" />
        {f.duration(course.totalDurationSeconds)}
      </span>
    ) : null,
    rated ? (
      reviewsAnchor ? (
        <a
          href="#reviews"
          className="inline-flex items-center gap-1.5 rounded-sm hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {rating}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5">{rating}</span>
      )
    ) : null,
  ];

  return (
    <header className={cn("min-w-0", className)}>
      <Link
        href="/courses"
        aria-label={t("course.page.back")}
        title={t("course.page.back")}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon.ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Link>

      {showBadges && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!course.published && (
            <Badge tone="dark" size="sm">
              <Icon.EyeOff className="size-3" aria-hidden="true" />
              {t("card.unpublished")}
            </Badge>
          )}
          {!course.published && course.status !== "approved" && <StatusBadge status={course.status} />}
          {course.upcoming && (
            <Badge tone="info" size="sm">
              <Icon.Clock className="size-3" aria-hidden="true" />
              {t("card.upcoming")}
            </Badge>
          )}
        </div>
      )}

      <h1 id="course-title" className={cn("max-w-4xl text-3xl font-extrabold tracking-tight text-ink sm:text-4xl", showBadges ? "mt-3" : "mt-5")}>
        {course.title}
      </h1>
      <MetaDots parts={meta} className="mt-3 text-sm text-ink-muted" />
      {course.shortIntroduction && <p className="mt-3 max-w-3xl text-body text-ink-muted">{course.shortIntroduction}</p>}
    </header>
  );
}
