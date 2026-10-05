import Link from "next/link";
import { preload } from "react-dom";
import type { CourseSalesPage, CourseSummary } from "@/lib/types";
import { categoryPath } from "@/lib/seo/content-index";
import { CourseCover } from "@/components/catalog/course-cover";
import { InstructorByline } from "@/components/catalog/instructor-byline";
import { compactCount } from "@/components/catalog/format";
import { RatingStars } from "@/components/catalog/rating-stars";
import { VideoPlayer } from "@/components/player";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";
import { coursePreviewPlayback } from "@/lib/media/course-preview";
import { SalesCountdown } from "./sales-countdown";

/**
 * Hero of a course sales page: headline (the page's H1), subheadline,
 * optional stats row (rating, learners, lessons, length), instructors, the
 * offer countdown and the promo video or cover. When the page has its own
 * video section the hero shows the cover instead, so the video is not
 * repeated. The enroll card stays next to it (rendered by the page).
 */
export async function SalesHero({ course, page, manager, serverNow }: { course: CourseSummary; page: CourseSalesPage; manager: boolean; serverNow: number }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const headline = page.heroHeadline?.trim() || course.title;
  const subheadline = page.heroSubheadline?.trim() || course.shortIntroduction;
  const preview = coursePreviewPlayback(course);
  const videoInHero = !!preview && !page.sections.some((s) => s.type === "video");
  if (videoInHero && course.imageUrl) preload(course.imageUrl, { as: "image", fetchPriority: "high" });

  return (
    <section aria-labelledby="course-title" className="space-y-5">
      {(!course.published || course.upcoming || (manager && course.published)) && (
        <div className="flex flex-wrap items-center gap-2">
          {!course.published && (
            <Badge tone="dark" size="sm">
              <Icon.EyeOff className="size-3" aria-hidden="true" />
              {t("card.unpublished")}
            </Badge>
          )}
          {course.upcoming && (
            <Badge tone="info" size="sm">
              <Icon.Clock className="size-3" aria-hidden="true" />
              {t("card.upcoming")}
            </Badge>
          )}
          {manager && course.published && (
            <Badge tone="success" size="sm">
              <Icon.Layout className="size-3" aria-hidden="true" />
              {t("sales.badge")}
            </Badge>
          )}
        </div>
      )}

      <div>
        {course.category && (
          <Link href={categoryPath(course.category.slug)} className="text-xs font-semibold uppercase tracking-wide text-accent hover:underline">
            {course.category.name}
          </Link>
        )}
        <h1 id="course-title" className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-ink text-balance sm:text-4xl lg:text-5xl">
          {headline}
        </h1>
        {headline !== course.title && <p className="mt-2 text-sm font-medium text-ink-muted">{course.title}</p>}
        {subheadline && <p className="mt-4 max-w-3xl text-base leading-7 text-ink-muted sm:text-lg">{subheadline}</p>}
      </div>

      {page.showStats && (
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted" aria-label={t("sales.atAGlance")}>
          {course.averageRating && course.reviewCount > 0 ? (
            <li>
              <a href="#reviews" className="inline-flex items-center gap-1.5 hover:underline">
                <span className="font-semibold text-ink">{f.number(course.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                <RatingStars value={course.averageRating} size="sm" />
                <span>{t("course.hero.ratings", { count: course.reviewCount, formatted: compactCount(course.reviewCount, f.locale) })}</span>
              </a>
            </li>
          ) : null}
          {course.enrollmentCount > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <Icon.Users className="size-4" aria-hidden="true" />
              {t("sales.learners", { count: course.enrollmentCount, formatted: compactCount(course.enrollmentCount, f.locale) })}
            </li>
          )}
          {course.lessonCount > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <Icon.BookOpen className="size-4" aria-hidden="true" />
              {t("catalog.lessonCount", { count: course.lessonCount })}
            </li>
          )}
          {course.totalDurationSeconds > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <Icon.Clock className="size-4" aria-hidden="true" />
              {f.duration(course.totalDurationSeconds)}
            </li>
          )}
        </ul>
      )}

      {course.instructors.length > 0 && <InstructorByline instructors={course.instructors} size="sm" prefix={t("sales.taughtBy")} />}

      {page.countdownEndsAt && <SalesCountdown endsAt={page.countdownEndsAt} serverNow={serverNow} />}

      <div className="overflow-hidden rounded-xl border border-border bg-surface-3 shadow-card">
        {videoInHero && preview ? (
          <VideoPlayer src={preview.src} hlsUrl={preview.hlsUrl} poster={preview.poster} title={t("course.hero.previewTitle", { title: course.title })} className="rounded-none" />
        ) : (
          <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} variant="hero" alt={course.title} priority="high" className="aspect-video w-full" />
        )}
      </div>
    </section>
  );
}
