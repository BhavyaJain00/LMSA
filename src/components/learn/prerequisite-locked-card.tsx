import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { PrerequisiteList } from "@/components/catalog/prerequisite-list";
import { getT } from "@/i18n/server";
import type { PrerequisiteItem } from "./drip-shared";

/**
 * Shown on a lesson page when a logged-in visitor cannot enroll yet because
 * prerequisite courses are not completed: lists them with progress and links.
 */
export async function PrerequisiteLockedCard({ lessonTitle, prerequisites, courseHref }: { lessonTitle: string; prerequisites: PrerequisiteItem[]; courseHref: string }) {
  const t = await getT("learning");
  return (
    <div className="mx-auto w-full max-w-(--lesson-w) py-6">
      <section aria-labelledby="prereq-locked-title" className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex flex-col items-center gap-3 px-5 pt-8 text-center sm:px-8">
          <span className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
            <Icon.ListChecks className="size-7" aria-hidden="true" />
          </span>
          <div className="max-w-md">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{t("learn.prereq.eyebrow")}</p>
            <h1 id="prereq-locked-title" className="mt-1 text-xl font-semibold text-ink text-balance">
              {t("learn.prereq.title")}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {t.rich("learn.prereq.body", {
                lesson: lessonTitle,
                count: Math.max(1, prerequisites.length),
                b: (text) => <span className="font-medium text-ink">{text}</span>,
              })}
            </p>
          </div>
        </div>
        <div className="px-5 py-5 sm:px-8">
          {prerequisites.length ? (
            <PrerequisiteList items={prerequisites} />
          ) : (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-center text-sm text-ink-muted">{t("learn.prereq.allDone")}</p>
          )}
        </div>
        <div className="flex justify-center border-t border-border bg-surface-2/40 px-5 py-4">
          <ButtonLink href={courseHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
            {t("learn.backToCourse")}
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
