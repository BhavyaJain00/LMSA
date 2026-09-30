import Link from "next/link";
import type { InstructorCard as InstructorCardData } from "@/lib/data/seo";
import { instructorPath } from "@/lib/seo/content-index";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { cn, formatNumber, pluralize } from "@/lib/utils";

/**
 * Instructor summary linking to the teaching profile: avatar, name, headline,
 * what they teach and their numbers (courses, learners, average rating).
 * The whole card is clickable through the stretched name link. Server Component.
 */
export function InstructorCard({ instructor, headingLevel = "h2", className }: { instructor: InstructorCardData; headingLevel?: "h2" | "h3"; className?: string }) {
  const Heading = headingLevel;
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-shadow hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <Avatar name={instructor.name} src={instructor.avatarUrl} size="lg" />
        <div className="min-w-0">
          <Heading className="truncate text-base font-semibold tracking-tight text-ink">
            <Link href={instructorPath(instructor.username)} className="outline-none before:absolute before:inset-0 before:content-[''] group-hover:text-accent">
              {instructor.name}
            </Link>
          </Heading>
          {instructor.headline && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{instructor.headline}</p>}
        </div>
      </div>
      {instructor.categories.length > 0 && <p className="mt-3 line-clamp-1 text-xs text-ink-muted">Teaches {instructor.categories.slice(0, 3).join(", ")}</p>}
      <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-ink-muted">
        <div className="inline-flex items-center gap-1">
          <Icon.BookOpen className="size-3.5" aria-hidden="true" />
          <dt className="sr-only">Courses</dt>
          <dd>{pluralize(instructor.courseCount, "course")}</dd>
        </div>
        {instructor.learnerCount > 0 && (
          <div className="inline-flex items-center gap-1">
            <Icon.Users className="size-3.5" aria-hidden="true" />
            <dt className="sr-only">Learners</dt>
            <dd>
              {formatNumber(instructor.learnerCount)} {instructor.learnerCount === 1 ? "learner" : "learners"}
            </dd>
          </div>
        )}
        {instructor.averageRating !== null && (
          <div className="inline-flex items-center gap-1">
            <Icon.StarFilled className="size-3.5 text-warning" aria-hidden="true" />
            <dt className="sr-only">Average rating</dt>
            <dd>
              {instructor.averageRating.toFixed(1)} ({formatNumber(instructor.reviewCount)})
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}
