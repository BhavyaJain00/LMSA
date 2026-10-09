import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { CourseCover } from "./course-cover";
import { isPaidCourse, PriceTag } from "./price-tag";

export interface CourseCardProps {
  course: CourseSummary;
  className?: string;
  /** Heading level for the title (h3 inside a titled section, h2 on flat pages). */
  headingLevel?: "h2" | "h3";
  /** Cover loading for cards above the fold (see `CourseCover`). */
  priority?: "high" | "eager";
}

/**
 * Course card used in the catalog, related courses and the home page, kept to what a learner needs to decide:
 * the cover, the title, how big the course is, the price (or their progress) and one clear button. The whole
 * card is clickable through a stretched title link; the button is a visual cue for that same link.
 */
export async function CourseCard({ course, className, headingLevel = "h3", priority }: CourseCardProps) {
  if (!course.title) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const Heading = headingLevel;
  const href = `/courses/${course.slug}`;
  const enrolled = !!course.enrollment;
  const progress = Math.min(100, Math.ceil(course.progress ?? course.enrollment?.progress ?? 0));
  const free = !isPaidCourse(course);

  const meta = [
    course.chapterCount > 0 ? t("card.chapterCount", { count: course.chapterCount }) : null,
    course.lessonCount > 0 ? t("catalog.lessonCount", { count: course.lessonCount }) : null,
    course.totalDurationSeconds > 0 ? f.duration(course.totalDurationSeconds) : null,
  ].filter((part): part is string => !!part);

  const action = course.upcoming
    ? t("card.comingSoon")
    : enrolled
      ? progress >= 100
        ? t("card.viewCourse")
        : progress > 0
          ? t("card.continue")
          : t("card.start")
      : t("card.enrollNow");

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} priority={priority} className="aspect-video shrink-0">
        {!course.published && (
          <Badge tone="dark" size="xs">
            <Icon.EyeOff className="size-3" aria-hidden="true" />
            {t("card.unpublished")}
          </Badge>
        )}
        {course.upcoming && (
          <Badge tone="info" size="xs" className="bg-surface-1 shadow-sm">
            <Icon.Clock className="size-3" aria-hidden="true" />
            {t("card.upcoming")}
          </Badge>
        )}
      </CourseCover>

      <div className="flex flex-1 flex-col p-4">
        <Heading className="line-clamp-2 text-[1.0625rem] font-bold leading-snug tracking-tight text-ink">
          <Link href={href} className="outline-none before:absolute before:inset-0 before:z-0 before:content-['']">
            {course.title}
          </Link>
        </Heading>

        {meta.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-faint">
            {meta.map((part, i) => (
              <span key={part} className="inline-flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="size-1 rounded-full bg-current opacity-60" />
                )}
                {part}
              </span>
            ))}
          </p>
        )}

        <div className="mt-auto pt-4">
          {enrolled ? (
            <div className="mb-3">
              <ProgressBar value={progress} size="xs" label={t("card.progress", { percent: progress })} />
              <p className="mt-1.5 text-xs font-medium text-ink-muted" aria-hidden="true">
                {progress >= 100 ? t("card.completed") : t("card.progress", { percent: progress })}
              </p>
            </div>
          ) : (
            !course.upcoming && (
              <div className="mb-3 flex items-center gap-2">
                {free ? (
                  <span className="text-xl font-extrabold tracking-tight text-ink">{t("catalog.free")}</span>
                ) : (
                  <PriceTag course={course} size="md" className="text-xl font-extrabold tracking-tight" />
                )}
              </div>
            )
          )}
          <span
            aria-hidden="true"
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold transition-colors",
              course.upcoming ? "bg-surface-2 text-ink-muted" : "bg-accent text-accent-fg group-hover:brightness-110",
            )}
          >
            {action}
            {!course.upcoming && <Icon.ArrowRight className="size-4 rtl:rotate-180" />}
          </span>
        </div>
      </div>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1" aria-hidden="true">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-1 flex-col p-4">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-2.5 h-3 w-1/2" />
        <Skeleton className="mt-5 h-5 w-16" />
        <Skeleton className="mt-3 h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}
