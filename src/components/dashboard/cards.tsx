import Link from "next/link";
import type {
  BatchStatus,
  ContinueLearningItem,
  CourseCardData,
  DashboardBatch,
  DashboardProgram,
} from "@/lib/data/dashboard";
import { AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { getFormatter, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { CourseThumb } from "./course-thumb";

/* ------------------------------------------------------------------ */
/* Continue learning                                                    */
/* ------------------------------------------------------------------ */

export async function ContinueLearningCard({ item, className }: { item: ContinueLearningItem; className?: string }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const started = item.completedLessons > 0 || item.progress > 0;
  const href = item.next?.href ?? `/courses/${item.slug}`;
  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-colors hover:border-border-strong sm:flex-row",
        className,
      )}
    >
      <Link href={`/courses/${item.slug}`} className="relative block aspect-video w-full shrink-0 overflow-hidden bg-surface-2 sm:aspect-auto sm:w-44" tabIndex={-1} aria-hidden="true">
        <CourseThumb title={item.title} imageUrl={item.imageUrl} gradient={item.cardGradient} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-ink">
              <Link href={`/courses/${item.slug}`} className="line-clamp-2 hover:text-accent">
                {item.title}
              </Link>
            </h3>
            {item.instructors.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-ink-muted">{t("dashboard.cards.byInstructors", { names: f.list(item.instructors.map((i) => i.name)) })}</p>
            )}
          </div>
          {item.batchTitle && (
            <Badge tone="info" size="xs" className="hidden shrink-0 sm:inline-flex">
              {t("dashboard.cards.batchBadge")}
            </Badge>
          )}
        </div>
        {item.next && (
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
            <Icon.Play className="size-3 shrink-0 text-accent" />
            <span className="shrink-0 text-ink-faint">{started ? t("dashboard.cards.upNext") : t("dashboard.cards.startWith")}</span>
            <span className="truncate text-ink">{item.next.title}</span>
          </p>
        )}
        <div className="mt-auto pt-3">
          <ProgressBar value={item.progress} size="sm" label={t("dashboard.cards.progressLabel", { title: item.title })} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink">{f.percent(item.progress)}</span> ·{" "}
              {item.totalLessons > 0 ? t("dashboard.cards.lessonsDone", { done: item.completedLessons, total: item.totalLessons }) : t("dashboard.cards.noLessons")}
            </p>
            <ButtonLink href={href} size="xs" rightIcon={<Icon.ArrowRight className="size-3.5 rtl:rotate-180" />}>
              {started ? t("dashboard.cards.continue") : t("dashboard.cards.start")}
            </ButtonLink>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Course card                                                          */
/* ------------------------------------------------------------------ */

export async function DashboardCourseCard({ course, href, className }: { course: CourseCardData; href?: string; className?: string }) {
  const [t, tc, f] = await Promise.all([getT("account"), getT("common"), getFormatter()]);
  const target = href ?? `/courses/${course.slug}`;
  return (
    <Link
      href={target}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border-strong",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-surface-2">
        <CourseThumb title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} size="lg" className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute start-2 top-2 flex flex-wrap gap-1">
          {!course.published && (
            <Badge tone="dark" size="xs">
              {t("dashboard.cards.unpublished")}
            </Badge>
          )}
          {course.status === "under_review" && (
            <Badge tone="warning" size="xs" className="bg-surface-1">
              {t("dashboard.cards.underReview")}
            </Badge>
          )}
          {course.upcoming && (
            <Badge tone="info" size="xs" className="bg-surface-1">
              {t("dashboard.cards.upcoming")}
            </Badge>
          )}
          {course.featured && (
            <Badge tone="accent" size="xs" className="bg-surface-1">
              {t("dashboard.cards.featured")}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        {course.category && <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{course.category}</p>}
        <h3 className="mt-0.5 line-clamp-2 font-semibold text-ink group-hover:text-accent">{course.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{course.shortIntroduction}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Icon.BookOpen className="size-3.5" />
            {t("count.lessons", { count: course.lessonCount })}
          </span>
          {course.totalDurationSeconds > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.Clock className="size-3.5" />
              {f.duration(course.totalDurationSeconds)}
            </span>
          )}
          <span className="inline-flex items-center gap-1" title={t("count.learners", { count: course.enrollmentCount })}>
            <Icon.Users className="size-3.5" />
            {f.count(course.enrollmentCount)}
          </span>
          {course.averageRating !== null && (
            <span className="inline-flex items-center gap-1">
              <Icon.StarFilled className="size-3.5 text-warning" />
              {f.number(course.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              <span className="text-ink-faint">({f.count(course.reviewCount)})</span>
            </span>
          )}
        </div>
        {course.progress !== undefined ? (
          <ProgressBar value={course.progress} size="xs" className="mt-3" label={t("dashboard.cards.progressLabel", { title: course.title })} />
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {course.instructors.length > 0 ? (
            <div className="flex min-w-0 items-center gap-2">
              <AvatarGroup users={course.instructors} size="xs" max={3} />
              <span className="truncate text-xs text-ink-muted">{course.instructors[0]!.name}</span>
            </div>
          ) : (
            <span />
          )}
          <span className="shrink-0 text-sm font-semibold text-ink">{course.paidCourse ? f.price(course.price, course.currency, tc("status.free")) : tc("status.free")}</span>
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Batch card                                                           */
/* ------------------------------------------------------------------ */

const batchStatusTone: Record<BatchStatus, "success" | "info" | "neutral"> = {
  active: "success",
  upcoming: "info",
  completed: "neutral",
};
const batchStatusLabel = {
  active: "dashboard.cards.batchActive",
  upcoming: "dashboard.cards.batchUpcoming",
  completed: "dashboard.cards.batchCompleted",
} as const satisfies Record<BatchStatus, string>;

export async function DashboardBatchCard({ batch, className }: { batch: DashboardBatch; className?: string }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const seatsLeft = batch.seatCount > 0 ? Math.max(0, batch.seatCount - batch.studentCount) : null;
  return (
    <Link
      href={`/batches/${batch.slug}`}
      className={cn(
        "group flex h-full flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Badge tone={batchStatusTone[batch.status]} dot size="xs">
          {t(batchStatusLabel[batch.status])}
        </Badge>
        {!batch.published && (
          <Badge tone="dark" size="xs">
            {t("dashboard.cards.unpublished")}
          </Badge>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 font-semibold text-ink group-hover:text-accent">{batch.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{batch.description}</p>
      <dl className="mt-3 space-y-1.5 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("dashboard.cards.dates")}</dt>
          <Icon.Calendar className="size-3.5 shrink-0" />
          <dd>{t("dashboard.cards.dateRange", { start: f.date(batch.startDate, { year: undefined }), end: f.date(batch.endDate) })}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("dashboard.cards.schedule")}</dt>
          <Icon.Clock className="size-3.5 shrink-0" />
          <dd className="truncate">
            {f.clock(batch.startTime)}–{f.clock(batch.endTime)} · {batch.timezone}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("dashboard.cards.format")}</dt>
          {batch.medium === "online" ? <Icon.Wifi className="size-3.5 shrink-0" /> : <Icon.MapPin className="size-3.5 shrink-0" />}
          <dd>
            {batch.medium === "online" ? t("dashboard.cards.online") : t("dashboard.cards.inPerson")} · {t("count.courses", { count: batch.courseCount })}
          </dd>
        </div>
        {batch.nextClass && batch.status !== "completed" && (
          <div className="flex items-center gap-2 text-ink">
            <dt className="sr-only">{t("dashboard.cards.nextLiveClass")}</dt>
            <Icon.Radio className="size-3.5 shrink-0 text-accent" />
            <dd className="truncate">{t("dashboard.cards.next", { title: batch.nextClass.title })}</dd>
          </div>
        )}
      </dl>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {batch.instructors.length > 0 ? <AvatarGroup users={batch.instructors} size="xs" max={3} /> : <span />}
        <span className="text-xs text-ink-muted">
          {seatsLeft !== null && batch.status === "upcoming" ? t("count.seatsLeft", { count: seatsLeft }) : t("count.students", { count: batch.studentCount })}
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Program progress                                                     */
/* ------------------------------------------------------------------ */

export async function ProgramProgressCard({ program }: { program: DashboardProgram }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  return (
    <article className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">
            <Link href={`/programs/${program.slug}`} className="hover:text-accent">
              {program.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {program.enforceCourseOrder
              ? t("dashboard.cards.coursesInOrder", { count: program.courses.length })
              : t("count.courses", { count: program.courses.length })}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-ink">{f.percent(program.progress)}</span>
      </div>
      <ProgressBar
        value={program.progress}
        size="sm"
        className="mt-3"
        label={t("dashboard.cards.progressLabel", { title: program.title })}
        tone={program.progress >= 100 ? "success" : "accent"}
      />
      <ol className="mt-4 space-y-2">
        {program.courses.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                c.completed ? "bg-success/15 text-success" : c.locked ? "bg-surface-2 text-ink-faint" : "bg-accent/10 text-accent",
              )}
              aria-hidden="true"
            >
              {c.completed ? <Icon.Check className="size-3.5" /> : c.locked ? <Icon.Lock className="size-3" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              {c.locked ? (
                <span className="block truncate text-ink-faint">{c.title}</span>
              ) : (
                <Link href={`/courses/${c.slug}`} className="block truncate text-ink hover:text-accent">
                  {c.title}
                </Link>
              )}
            </span>
            <span className="shrink-0 text-xs text-ink-muted">
              {c.completed
                ? t("dashboard.cards.courseDone")
                : c.locked
                  ? t("dashboard.cards.courseLocked")
                  : c.enrolled
                    ? f.percent(c.progress)
                    : t("dashboard.cards.courseNotStarted")}
            </span>
          </li>
        ))}
      </ol>
      {program.nextCourse && (
        <ButtonLink
          href={`/courses/${program.nextCourse.slug}`}
          variant="subtle"
          size="sm"
          className="mt-4 w-full"
          rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}
        >
          {t("dashboard.cards.next", { title: program.nextCourse.title })}
        </ButtonLink>
      )}
    </article>
  );
}
