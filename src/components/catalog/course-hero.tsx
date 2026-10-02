import Link from "next/link";
import { preload } from "react-dom";
import type { CourseSummary } from "@/lib/types";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { tagSlug } from "@/lib/seo/text";
import { VideoPlayer } from "@/components/player";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { CourseCover } from "./course-cover";
import { InstructorByline } from "./instructor-byline";
import { compactCount } from "./format";
import { RatingStars } from "./rating-stars";

function Dot() {
  return (
    <span aria-hidden="true" className="text-ink-faint">
      ·
    </span>
  );
}

/**
 * Course page hero: status badges, title, short introduction, meta row
 * (category, rating, students, duration, instructors), tags and the promo
 * video (custom player) or cover artwork. The breadcrumb trail is rendered by
 * the page (`<Breadcrumbs>`), and the category and tags link to their landing
 * pages. The cover (or the video poster) is the page's largest image, so it
 * is fetched with high priority.
 */
export async function CourseHero({ course, manager, className }: { course: CourseSummary; manager: boolean; className?: string }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const updated = course.updatedAt ? f.date(course.updatedAt, { month: "long", year: "numeric", day: undefined }) : "";
  if (course.videoUrl && course.imageUrl) preload(course.imageUrl, { as: "image", fetchPriority: "high" });
  return (
    <section aria-labelledby="course-title" className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {manager && course.published && <StatusBadge status="published" />}
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
        {course.featured && (
          <Badge tone="warning" size="sm">
            <Icon.Award className="size-3" aria-hidden="true" />
            {t("card.featured")}
          </Badge>
        )}
        {course.enforceLessonCompletion && (
          <Badge tone="neutral" size="sm">
            <Icon.ListChecks className="size-3" aria-hidden="true" />
            {t("course.hero.lessonsInOrder")}
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
            <Link href={categoryPath(course.category.slug)} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              <Icon.Tag className="size-4" aria-hidden="true" />
              {course.category.name}
            </Link>
            <Dot />
          </>
        )}
        {course.averageRating && course.reviewCount > 0 ? (
          <>
            <a href="#reviews" className="inline-flex items-center gap-1.5 hover:underline">
              <span className="font-semibold text-ink">{f.number(course.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
              <RatingStars value={course.averageRating} size="sm" />
              <span>{t("course.hero.ratings", { count: course.reviewCount, formatted: compactCount(course.reviewCount, f.locale) })}</span>
            </a>
            <Dot />
          </>
        ) : null}
        {course.enrollmentCount > 0 && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Icon.Users className="size-4" aria-hidden="true" />
              {t("card.students", { count: course.enrollmentCount, formatted: compactCount(course.enrollmentCount, f.locale) })}
            </span>
            <Dot />
          </>
        )}
        {course.lessonCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Icon.BookOpen className="size-4" aria-hidden="true" />
            {course.totalDurationSeconds > 0
              ? t("course.hero.lessonsWithDuration", { count: course.lessonCount, duration: f.duration(course.totalDurationSeconds) })
              : t("catalog.lessonCount", { count: course.lessonCount })}
          </span>
        )}
        {updated && (
          <>
            {course.lessonCount > 0 && <Dot />}
            <span className="inline-flex items-center gap-1.5">
              <Icon.Refresh className="size-4" aria-hidden="true" />
              {t("course.hero.updated", { date: updated })}
            </span>
          </>
        )}
      </div>

      {course.instructors.length > 0 && <InstructorByline instructors={course.instructors} size="sm" prefix={t("course.hero.createdBy")} />}

      {course.tags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("course.hero.tags")}>
          {course.tags.map((tag) => (
            <li key={tag}>
              <Link
                href={tagSlug(tag) ? tagPath(tagSlug(tag)) : `/courses?search=${encodeURIComponent(tag)}`}
                className="inline-flex items-center rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
              >
                {tag}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-3 shadow-card">
        {course.videoUrl ? (
          <VideoPlayer src={course.videoUrl} poster={course.imageUrl} title={t("course.hero.previewTitle", { title: course.title })} className="rounded-none" />
        ) : (
          <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} variant="hero" alt={course.title} priority="high" className="aspect-video w-full" />
        )}
      </div>
    </section>
  );
}
