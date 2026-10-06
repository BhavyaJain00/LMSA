"use client";

import { useEffect, useState } from "react";
import { loadLessonReleaseAction, type LessonReleaseInfo } from "@/lib/actions/drip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { shortRuleLabel, type ReleaseRule } from "@/components/learn/drip-shared";
import { ReleaseScheduleFields, draftErrors, draftRule, releaseDraftFrom, serializeDraft, type ReleaseDraft } from "./release-schedule-fields";

export interface LessonReleaseState {
  status: "loading" | "ready" | "error";
  error: string | null;
  info: LessonReleaseInfo | null;
  draft: ReleaseDraft;
  setDraft: (draft: ReleaseDraft) => void;
  /** Loaded and changed since the last save. */
  dirty: boolean;
  /** The draft has a validation error (blocks saving). */
  invalid: boolean;
  /** Reset the baseline to what the server saved. */
  markSaved: (rule: ReleaseRule) => void;
  retry: () => void;
}

/**
 * Release schedule state for the lesson editor. Uses the schedule passed by
 * the page when available, otherwise loads it (with the chapter's schedule)
 * through `loadLessonReleaseAction`. Until it is loaded the editor does not
 * submit release fields, so saving the lesson never clears a schedule it has
 * not seen.
 */
export function useLessonRelease(lessonId: string, provided: LessonReleaseInfo | null | undefined): LessonReleaseState {
  const [info, setInfo] = useState<LessonReleaseInfo | null>(provided ?? null);
  const [status, setStatus] = useState<LessonReleaseState["status"]>(provided ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>(() => releaseDraftFrom(provided?.rule));
  const [baseline, setBaseline] = useState(() => serializeDraft(releaseDraftFrom(provided?.rule)));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (provided) return;
    let cancelled = false;
    loadLessonReleaseAction(lessonId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          const next = releaseDraftFrom(result.data.rule);
          setInfo(result.data);
          setDraft(next);
          setBaseline(serializeDraft(next));
          setStatus("ready");
        } else {
          setError(result.error);
          setStatus("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("The release schedule could not be loaded. Check your connection and try again.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, provided, attempt]);

  return {
    status,
    error,
    info,
    draft,
    setDraft,
    dirty: status === "ready" && serializeDraft(draft) !== baseline,
    invalid: status === "ready" && Object.keys(draftErrors(draft)).length > 0,
    markSaved: (rule) => {
      const next = releaseDraftFrom(rule);
      setDraft(next);
      setBaseline(serializeDraft(next));
    },
    retry: () => {
      setError(null);
      setStatus("loading");
      setAttempt((n) => n + 1);
    },
  };
}

/**
 * "Release schedule" section of the lesson editor (collapsible, like the
 * instructor notes). Renders the shared release fields once the schedule is
 * known; they submit with the lesson form.
 */
export function LessonReleaseSection({
  state,
  errors,
  reveal = 0,
  preview = false,
}: {
  state: LessonReleaseState;
  errors: { dripDays?: string; availableFrom?: string };
  /** Increment to expand the section (e.g. after a blocked save). */
  reveal?: number;
  /** The lesson is a free preview (day-based schedules do not apply to it). */
  preview?: boolean;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  // Expand when asked to, or when the server reports a schedule error (adjusting state during render).
  const attentionKey = `${reveal}|${errors.dripDays ?? ""}|${errors.availableFrom ?? ""}`;
  const [seenAttention, setSeenAttention] = useState(attentionKey);
  if (attentionKey !== seenAttention) {
    setSeenAttention(attentionKey);
    if (reveal > 0 || errors.dripDays || errors.availableFrom) setOpen(true);
  }
  const rule = state.status === "ready" ? draftRule(state.draft) : null;
  const label = rule && state.draft.scheduled ? shortRuleLabel(rule) : null;
  const chapterLabel = state.info ? shortRuleLabel(state.info.chapter.rule) : null;
  const isOpen = open ?? !!(label || chapterLabel);

  return (
    <details className="group rounded-xl border border-border" open={isOpen} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Icon.Clock className="size-4 text-ink-muted" aria-hidden="true" />
        <span className="text-sm font-medium text-ink">Release schedule</span>
        {state.status === "ready" && (
          <Badge tone={label ? "accent" : "neutral"} size="xs">
            {label ?? "Immediately"}
          </Badge>
        )}
        {chapterLabel && (
          <Badge tone="outline" size="xs" className="hidden sm:inline-flex">
            Chapter: {chapterLabel}
          </Badge>
        )}
        {state.dirty && <span className="size-1.5 rounded-full bg-warning" aria-label="Changed" />}
        <Icon.ChevronRight className="ms-auto size-4 text-ink-faint transition-transform group-open:rotate-90 rtl:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border p-3 sm:p-4">
        {state.status === "loading" ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading the release schedule">
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
            <Skeleton className="h-10" />
          </div>
        ) : state.status === "error" ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
            <span>{state.error ?? "The release schedule could not be loaded."}</span>
            <Button variant="outline" size="xs" onClick={state.retry} leftIcon={<Icon.Refresh className="size-3.5" />}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-muted">Drip this lesson: keep it locked until some days after a learner enrolls, until a date, or both.</p>
            <ReleaseScheduleFields
              idPrefix="lesson-editor"
              subject="lesson"
              value={state.draft}
              onChange={state.setDraft}
              errors={errors}
              chapter={state.info ? { title: state.info.chapter.title, rule: state.info.chapter.rule } : null}
              enforceOrder={state.info?.enforceOrder}
              preview={preview}
            />
          </>
        )}
      </div>
    </details>
  );
}
