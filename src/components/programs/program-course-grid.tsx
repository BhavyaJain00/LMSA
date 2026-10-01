import Link from "next/link";
import { cn, gradientFor, pluralize } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { StartProgramCourseButton } from "./program-actions";
import type { ProgramCourseView } from "./types";

function Cover({ course }: { course: ProgramCourseView }) {
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
      <span className="absolute left-3 top-3 flex size-7 items-center justify-center rounded-full bg-surface-1/90 text-sm font-semibold text-ink shadow backdrop-blur">
        {course.position}
      </span>
      {course.completed && (
        <Badge tone="success" className="absolute right-3 top-3 bg-surface-1/90 backdrop-blur">
          <Icon.CheckCircle className="size-3" /> Completed
        </Badge>
      )}
    </div>
  );
}

/**
 * Ordered program courses. For members, a course that is not yet eligible
 * (enforced order) is covered by a lock overlay and cannot be opened.
 */
export function ProgramCourseGrid({ programId, courses, isMember }: { programId: string; courses: ProgramCourseView[]; isMember: boolean }) {
  return (
    <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => {
        const locked = isMember && !course.eligible;
        const instructor = course.instructors[0];
        return (
          <li key={course.id} className="group/card relative flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
            {locked ? <Cover course={course} /> : (
              <Link href={`/courses/${course.slug}`} aria-label={course.title}>
                <Cover course={course} />
              </Link>
            )}
            <div className="flex flex-1 flex-col p-4">
              {locked ? (
                <span className="line-clamp-2 font-semibold leading-snug text-ink">{course.title}</span>
              ) : (
                <Link href={`/courses/${course.slug}`} className="line-clamp-2 font-semibold leading-snug text-ink hover:text-accent">
                  {course.title}
                </Link>
              )}
              {course.shortIntroduction && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{course.shortIntroduction}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1" title="Lessons">
                  <Icon.BookOpen className="size-3.5" /> {pluralize(course.lessonCount, "lesson")}
                </span>
                <span className="inline-flex items-center gap-1" title="Enrolled Students">
                  <Icon.User className="size-3.5" /> {pluralize(course.enrollmentCount, "student")}
                </span>
                {!course.published && (
                  <Badge tone="warning" size="xs">
                    Unpublished
                  </Badge>
                )}
              </div>
              {instructor && (
                <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                  <Avatar name={instructor.name} src={instructor.avatarUrl} size="xs" />
                  <span className="truncate">{instructor.name}</span>
                </p>
              )}
              {isMember && !locked && (
                <div className="mt-auto space-y-3 pt-4">
                  {course.enrolled ? (
                    <>
                      <ProgressBar value={course.progress ?? 0} showLabel label="Progress" size="sm" tone={course.completed ? "success" : "accent"} />
                      <ButtonLink
                        href={course.continueHref ?? `/courses/${course.slug}`}
                        size="sm"
                        variant={course.completed ? "outline" : "primary"}
                        className="w-full"
                        rightIcon={<Icon.ArrowRight className="size-4" />}
                      >
                        {course.completed ? "Review course" : (course.progress ?? 0) > 0 ? "Continue" : "Start"}
                      </ButtonLink>
                    </>
                  ) : course.access === "payment" ? (
                    <ButtonLink href={`/billing/course/${course.id}`} size="sm" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
                      Buy this course
                    </ButtonLink>
                  ) : course.access === "unpublished" ? (
                    <p className="rounded-lg bg-surface-2 px-3 py-2 text-center text-sm text-ink-muted">This course is not available yet.</p>
                  ) : (
                    <StartProgramCourseButton programId={programId} courseId={course.id} />
                  )}
                </div>
              )}
            </div>
            {locked && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-1/80 p-6 text-center backdrop-blur-[2px]"
                role="note"
                aria-label={`${course.title} is locked`}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                  <Icon.Lock className="size-5" />
                </span>
                <p className="text-sm font-medium text-ink">Please complete the previous course to unlock this one.</p>
                <p className="text-xs text-ink-muted">Course {course.position}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
