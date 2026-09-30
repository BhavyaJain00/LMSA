import Link from "next/link";
import type { BundleCardData } from "@/lib/commerce/bundle-views";
import { CourseCover } from "@/components/catalog/course-cover";
import { plural } from "@/components/catalog/format";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatDuration, formatPrice } from "@/lib/utils";

type CoverCourse = { id: string; title: string; imageUrl?: string; cardGradient: string };

/**
 * Artwork of a bundle: its own image, or the covers of its first courses side
 * by side (so a bundle without an image still shows what is inside).
 */
export function BundleCover({
  title,
  imageUrl,
  courses,
  className,
  variant = "card",
  priority,
}: {
  title: string;
  imageUrl?: string;
  courses: readonly CoverCourse[];
  className?: string;
  variant?: "card" | "hero";
  priority?: "high" | "eager";
}) {
  const tiles = courses.slice(0, 3);
  if (imageUrl || tiles.length < 2) {
    const only = tiles[0];
    return <CourseCover title={title} imageUrl={imageUrl ?? only?.imageUrl} gradient={only?.cardGradient ?? "teal"} variant={variant} priority={priority} className={className} />;
  }
  return (
    <div className={cn("grid gap-px overflow-hidden bg-border", tiles.length === 3 ? "grid-cols-3" : "grid-cols-2", className)} aria-hidden="true">
      {tiles.map((course) => (
        <CourseCover key={course.id} title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} priority={priority} className="h-full min-h-0" />
      ))}
    </div>
  );
}

/** "Save 30%" pill; nothing when the bundle is not cheaper than its courses. */
export function SavingsBadge({ percent, size = "sm", className }: { percent: number; size?: "xs" | "sm" | "md"; className?: string }) {
  if (percent <= 0) return null;
  return (
    <Badge tone="success" size={size} className={className}>
      <Icon.Percent className="size-3" aria-hidden="true" />
      Save {percent}%
    </Badge>
  );
}

/**
 * Bundle summary card for the bundles index and "more bundles" lists. The
 * whole card is clickable through the stretched title link.
 */
export function BundleCard({ bundle, headingLevel = "h2", priority, className }: { bundle: BundleCardData; headingLevel?: "h2" | "h3"; priority?: "high" | "eager"; className?: string }) {
  const Heading = headingLevel;
  const shown = bundle.courseTitles.slice(0, 3);
  const more = bundle.courseTitles.length - shown.length;
  const cheaper = bundle.comparable && bundle.savings > 0;
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="relative">
        <BundleCover title={bundle.title} imageUrl={bundle.imageUrl} courses={bundle.courses} priority={priority} className="h-40 border-b border-border" />
        <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          <SavingsBadge percent={bundle.savingsPercent} size="xs" className="bg-surface-1 shadow-sm" />
          {bundle.ownsAll && (
            <Badge tone="accent" size="xs" className="bg-surface-1 shadow-sm">
              <Icon.CheckCircle className="size-3" aria-hidden="true" />
              You own this
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1 font-medium text-accent">
            <Icon.Layers className="size-3.5" aria-hidden="true" />
            {bundle.courses.length} {plural(bundle.courses.length, "course")}
          </span>
          {bundle.lessonCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.BookOpen className="size-3.5" aria-hidden="true" />
              {bundle.lessonCount} {plural(bundle.lessonCount, "lesson")}
            </span>
          )}
          {bundle.durationSeconds > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.Clock className="size-3.5" aria-hidden="true" />
              {formatDuration(bundle.durationSeconds)}
            </span>
          )}
        </p>

        <Heading className="mt-2 line-clamp-2 text-base font-semibold leading-snug tracking-tight text-ink">
          <Link href={`/bundles/${bundle.slug}`} className="outline-none before:absolute before:inset-0 before:z-0 before:content-['']">
            {bundle.title}
          </Link>
        </Heading>
        {bundle.description && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-muted">{bundle.description}</p>}

        <ul className="mt-3 space-y-1.5 text-sm text-ink-muted" aria-label="Courses in this bundle">
          {shown.map((title, i) => (
            <li key={`${i}-${title}`} className="flex items-start gap-2">
              <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="line-clamp-1">{title}</span>
            </li>
          ))}
          {more > 0 && (
            <li className="pl-6 text-xs text-ink-faint">
              + {more} more {plural(more, "course")}
            </li>
          )}
        </ul>

        <div className="mt-auto pt-4">
          <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
            <p className="min-w-0">
              <span className="text-lg font-bold tabular-nums text-ink">{formatPrice(bundle.price, bundle.currency)}</span>
              {cheaper && (
                <>
                  {" "}
                  <span className="text-sm tabular-nums text-ink-muted line-through">
                    <span className="sr-only">Separately: </span>
                    {formatPrice(bundle.totalValue, bundle.currency)}
                  </span>
                </>
              )}
            </p>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent" aria-hidden="true">
              View bundle
              <Icon.ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function BundleCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1" aria-hidden="true">
      <Skeleton className="h-40 w-full rounded-none" />
      <div className="flex flex-1 flex-col p-4">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-3 h-4 w-4/5" />
        <Skeleton className="mt-2 h-3 w-full" />
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );
}
