"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useLessonRuntime } from "./lesson-runtime";

export type ViewerMode = "learner" | "instructor" | "preview" | "guest";

/**
 * End-of-lesson completion card: "Mark as complete" for learners (with the
 * list of unmet requirements when completion fails), a completed state, or a
 * short explanation for instructors, previewers and guests.
 */
export function CompletionPanel({ mode, loginHref }: { mode: ViewerMode; loginHref: string }) {
  const rt = useLessonRuntime();

  if (mode === "instructor") {
    return (
      <div id="lesson-completion" className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 p-4 text-sm">
        <Icon.Eye className="mt-0.5 size-5 shrink-0 text-ink-faint" />
        <p className="text-ink-muted">You are viewing this lesson as an instructor. Progress is only tracked for enrolled learners.</p>
      </div>
    );
  }

  if (mode === "preview" || mode === "guest") {
    return (
      <div id="lesson-completion" className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info/8 p-4 sm:flex-row sm:items-center">
        <Icon.Info className="size-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-ink">You are previewing this lesson</p>
          <p className="text-ink-muted">
            {mode === "guest" ? "Log in and enroll to save your progress and unlock every lesson." : "Enroll in the course to track your progress and unlock every lesson."}
          </p>
        </div>
        {mode === "guest" ? (
          <ButtonLink href={loginHref} size="sm" leftIcon={<Icon.LogIn className="size-4" />}>
            Log in
          </ButtonLink>
        ) : (
          <ButtonLink href={rt.courseHref} size="sm">
            View course
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
          <p className="font-medium text-ink">Lesson completed</p>
          <p className="text-sm text-ink-muted">{rt.next ? "Nice work. Keep the momentum going." : "You reached the last lesson of this course."}</p>
        </div>
        {rt.canGoNext ? (
          <Button size="sm" onClick={() => void rt.goNext()} loading={rt.navigating} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Next lesson
          </Button>
        ) : (
          <ButtonLink href={rt.courseHref} variant="outline" size="sm">
            Back to course
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
          <p className="font-medium text-ink">Finished this lesson?</p>
          <p className="text-sm text-ink-muted">Mark it as complete to update your course progress.</p>
        </div>
        <Button onClick={() => void rt.attemptComplete()} loading={rt.completing} leftIcon={<Icon.Check className="size-4" />}>
          Mark as complete
        </Button>
      </div>
      {rt.missing && rt.missing.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg border border-warning/35 bg-warning/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Icon.AlertTriangle className="size-4 text-warning" /> Almost there! To complete this lesson:
            </p>
            <button type="button" onClick={rt.dismissMissing} className="rounded p-0.5 text-ink-faint hover:text-ink" aria-label="Dismiss">
              <Icon.X className="size-4" />
            </button>
          </div>
          <ul className="mt-2 space-y-1.5 pl-6">
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
  if (!rt.tracking || rt.status !== "complete") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
      <Icon.CheckCircleFilled className="size-3.5" />
      Completed
    </span>
  );
}
