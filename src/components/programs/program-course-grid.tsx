import Link from "next/link";
import { cn, gradientFor } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { StartProgramCourseButton } from "./program-actions";
import type { ProgramCourseView } from "./types";
import { getFormatter, getT } from "@/i18n/server";

async function Cover({ course }: { course: ProgramCourseView }) {
  const t = await getT("public");
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
      <span className="absolute start-3 top-3 flex size-7 items-center justify-center rounded-full bg-surface-1/90 text-sm font-semibold text-ink shadow backdrop-blur">
        {course.position}
      </span>
      {course.completed && (
        <Badge tone="success" className="absolute end-3 top-3 bg-surface-1/90 backdrop-blur">
          <Icon.CheckCircle className="size-3" /> {t("card.completed")}
        </Badge>
      )}
    </div>
  );
}

/**
 * Ordered program courses. For members, a course that is not yet eligible
 * (enforced order) is covered by a lock overlay and cannot be opened.
 */
export async function ProgramCourseGrid({ programId, courses, isMember }: { programId: string; courses: ProgramCourseView[]; isMember: boolean }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
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
                <span className="inline-flex items-center gap-1">
                  <Icon.BookOpen className="size-3.5" /> {t("catalog.lessonCount", { count: course.lessonCount })}
                </span>
                <span className="inline-flex items-center gap-1" title={t("programs.grid.enrolledStudents")}>
                  <Icon.User className="size-3.5" /> {t("card.students", { count: course.enrollmentCount, formatted: f.number(course.enrollmentCount) })}
                </span>
                {!course.published && (
                  <Badge tone="warning" size="xs">
                    {t("card.unpublished")}
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
                      <ProgressBar value={course.progress ?? 0} showLabel label={t("enroll.yourProgress")} size="sm" tone={course.completed ? "success" : "accent"} />
                      <ButtonLink
                        href={course.continueHref ?? `/courses/${course.slug}`}
                        size="sm"
                        variant={course.completed ? "outline" : "primary"}
                        className="w-full"
                        rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}
                      >
                        {course.completed ? t("enroll.reviewCourse") : (course.progress ?? 0) > 0 ? t("batches.courses.continue") : t("programs.grid.start")}
                      </ButtonLink>
                    </>
                  ) : course.access === "payment" ? (
                    <ButtonLink href={`/billing/course/${course.id}`} size="sm" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
                      {t("enroll.buy")}
                    </ButtonLink>
                  ) : course.access === "unpublished" ? (
                    <p className="rounded-lg bg-surface-2 px-3 py-2 text-center text-sm text-ink-muted">{t("programs.grid.notAvailable")}</p>
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
                aria-label={t("programs.grid.lockedLabel", { title: course.title })}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                  <Icon.Lock className="size-5" />
                </span>
                <p className="text-sm font-medium text-ink">{t("programs.grid.locked")}</p>
                <p className="text-xs text-ink-muted">{t("programs.grid.position", { position: course.position })}</p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
