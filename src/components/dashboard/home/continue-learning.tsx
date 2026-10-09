import Link from "next/link";
import type { ReactNode } from "react";
import type { ContinueLearningItem } from "@/lib/data/dashboard";
import { CourseCover } from "@/components/catalog/course-cover";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { getFormatter, getT } from "@/i18n/server";
import { CourseThumb } from "../course-thumb";

type AccountT = Awaited<ReturnType<typeof getT<"account">>>;

function started(item: ContinueLearningItem): boolean {
  return item.completedLessons > 0 || item.progress > 0;
}

/** Where "Continue" goes: the next lesson, or the course page when there is none. */
function continueHref(item: ContinueLearningItem): string {
  return item.next?.href ?? `/courses/${item.slug}`;
}

function lessonsLine(t: AccountT, item: ContinueLearningItem): string {
  return item.totalLessons > 0 ? t("dashboard.continue.lessons", { done: item.completedLessons, total: item.totalLessons }) : t("dashboard.cards.noLessons");
}

/** The most recent course in progress, as one large card with a single big "Continue" button. */
export async function ContinueHero({ item }: { item: ContinueLearningItem }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const courseHref = `/courses/${item.slug}`;
  const isStarted = started(item);
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card sm:flex-row">
      <Link href={courseHref} tabIndex={-1} aria-hidden="true" className="block shrink-0 sm:w-60 lg:w-96">
        <CourseCover title={item.title} imageUrl={item.imageUrl} gradient={item.cardGradient} priority="high" className="aspect-video h-full sm:aspect-auto sm:min-h-48" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <h3 className="text-xl font-bold leading-snug tracking-tight text-ink">
          <Link href={courseHref} className="line-clamp-2 hover:text-accent">
            {item.title}
          </Link>
        </h3>
        {item.next && (
          <p className="mt-1.5 flex min-w-0 gap-1.5 text-sm text-ink-muted">
            <span className="shrink-0">{isStarted ? t("dashboard.cards.upNext") : t("dashboard.cards.startWith")}</span>
            <span className="truncate font-medium text-ink">{item.next.title}</span>
          </p>
        )}
        <div className="mt-auto pt-6">
          <ProgressBar value={item.progress} size="sm" label={t("dashboard.cards.progressLabel", { title: item.title })} />
          <div className="mt-2 flex items-center justify-between gap-3 text-meta">
            <span className="text-ink-muted">{lessonsLine(t, item)}</span>
            <span className="font-semibold tabular-nums text-ink">{t("dashboard.continue.done", { percent: f.percent(item.progress) })}</span>
          </div>
          <ButtonLink
            href={continueHref(item)}
            size="lg"
            className="mt-5 w-full font-bold sm:w-auto sm:min-w-48"
            rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}
          >
            {isStarted ? t("dashboard.cards.continue") : t("dashboard.cards.start")}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}

/** The next courses in progress as compact rows; each row continues where the learner stopped. */
export async function ContinueRows({ items }: { items: ContinueLearningItem[] }) {
  if (items.length === 0) return null;
  const t = await getT("account");
  return (
    <ul className="mt-4 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      {items.map((item) => (
        <li key={item.courseId}>
          <Link href={continueHref(item)} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
            <span className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
              <CourseThumb title={item.title} imageUrl={item.imageUrl} gradient={item.cardGradient} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink group-hover:text-accent">{item.title}</span>
              <span className="mt-1.5 flex items-center gap-3">
                <ProgressBar value={item.progress} size="xs" className="max-w-40" label={t("dashboard.cards.progressLabel", { title: item.title })} />
                <span className="shrink-0 text-meta text-ink-faint">{lessonsLine(t, item)}</span>
              </span>
            </span>
            <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-accent sm:inline-flex">
              {started(item) ? t("dashboard.cards.continue") : t("dashboard.cards.start")}
              <Icon.ArrowRight className="size-4 rtl:rotate-180" />
            </span>
            <Icon.ChevronRight className="size-5 shrink-0 text-ink-faint sm:hidden rtl:rotate-180" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Friendly empty state with one primary button. */
export function ContinueEmpty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-border bg-surface-1 px-5 py-10 text-center shadow-card sm:py-12">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent [&>svg]:size-6" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-4 text-heading font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{body}</p>
      <div className="mt-6 w-full sm:w-auto">{action}</div>
    </div>
  );
}
