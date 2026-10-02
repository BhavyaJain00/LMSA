"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { useLessonRuntime } from "./lesson-runtime";

export type ViewerMode = "learner" | "instructor" | "preview" | "guest";

/**
 * End-of-lesson completion card: "Mark as complete" for learners (with the
 * list of unmet requirements when completion fails), a completed state, or a
 * short explanation for instructors, previewers and guests.
 */
export function CompletionPanel({ mode, loginHref }: { mode: ViewerMode; loginHref: string }) {
  const rt = useLessonRuntime();
  const t = useT("learning");
  const shell = useT("shell");
  const common = useT("common");

  if (mode === "instructor") {
    return (
      <div id="lesson-completion" className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 p-4 text-sm">
        <Icon.Eye className="mt-0.5 size-5 shrink-0 text-ink-faint" />
        <p className="text-ink-muted">{t("learn.completion.instructor")}</p>
      </div>
    );
  }

  if (mode === "preview" || mode === "guest") {
    return (
      <div id="lesson-completion" className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/8 p-4 sm:flex-row sm:items-center">
        <Icon.Info className="size-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-ink">{t("learn.completion.previewTitle")}</p>
          <p className="text-ink-muted">
            {mode === "guest" ? t("learn.completion.previewGuest") : t("learn.completion.previewMember")}
          </p>
        </div>
        {mode === "guest" ? (
          <ButtonLink href={loginHref} size="sm" leftIcon={<Icon.LogIn className="size-4" />}>
            {shell("header.logIn")}
          </ButtonLink>
        ) : (
          <ButtonLink href={rt.courseHref} size="sm">
            {t("learn.completion.viewCourse")}
          </ButtonLink>
        )}
      </div>
    );
  }

  if (rt.status === "complete") {
    return (
      <div id="lesson-completion" className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/8 p-4 sm:flex-row sm:items-center" role="status">
        <Icon.CheckCircleFilled className="size-6 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{t("learn.completion.doneTitle")}</p>
          <p className="text-sm text-ink-muted">{rt.next ? t("learn.completion.doneNext") : t("learn.completion.doneLast")}</p>
        </div>
        {rt.canGoNext ? (
          <Button size="sm" onClick={() => void rt.goNext()} loading={rt.navigating} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
            {t("learn.nextLesson")}
          </Button>
        ) : (
          <ButtonLink href={rt.courseHref} variant="outline" size="sm">
            {t("learn.backToCourse")}
          </ButtonLink>
        )}
      </div>
    );
  }

  return (
    <div id="lesson-completion" className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Icon.CheckCircle className="size-6 shrink-0 text-ink-faint" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{t("learn.completion.prompt")}</p>
          <p className="text-sm text-ink-muted">{t("learn.completion.promptHint")}</p>
        </div>
        <Button onClick={() => void rt.attemptComplete()} loading={rt.completing} leftIcon={<Icon.Check className="size-4" />}>
          {t("learn.completion.markComplete")}
        </Button>
      </div>
      {rt.missing && rt.missing.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Icon.AlertTriangle className="size-4 text-warning" /> {t("learn.completion.missingTitle")}
            </p>
            <button type="button" onClick={rt.dismissMissing} className="rounded p-0.5 text-ink-faint hover:text-ink" aria-label={common("actions.dismiss")}>
              <Icon.X className="size-4" />
            </button>
          </div>
          <ul className="mt-2 space-y-1.5 ps-6">
            {rt.missing.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-ink-muted">
                <Icon.Circle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Green "Completed" badge next to the lesson title (updates optimistically). */
export function CompletedBadge() {
  const rt = useLessonRuntime();
  const t = useT("learning");
  if (!rt.tracking || rt.status !== "complete") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
      <Icon.CheckCircleFilled className="size-3.5" />
      {t("learn.completed")}
    </span>
  );
}
