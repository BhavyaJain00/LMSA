"use client";

import { useEffect, useState } from "react";
import { loadPrerequisiteSettingsAction, type PrerequisiteSettings } from "@/lib/actions/drip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { MAX_PREREQUISITES } from "@/components/learn/drip-shared";
import { MultiSelect } from "./form-controls";

export interface PrerequisiteFieldState {
  status: "loading" | "ready" | "error";
  error: string | null;
  settings: PrerequisiteSettings | null;
  selected: string[];
  setSelected: (ids: string[]) => void;
  /** Loaded and changed since it was loaded. */
  dirty: boolean;
  /** Stable string for the form's unsaved-changes snapshot. */
  snapshot: string;
  retry: () => void;
}

const key = (ids: string[]) => ids.join(",");

/**
 * Prerequisite selection for the course settings form. Uses the settings the
 * page passed, or loads them through `loadPrerequisiteSettingsAction`. The
 * form submits the selection only once it is loaded.
 */
export function usePrerequisiteField(courseId: string, provided: PrerequisiteSettings | null | undefined): PrerequisiteFieldState {
  const [settings, setSettings] = useState<PrerequisiteSettings | null>(provided ?? null);
  const [status, setStatus] = useState<PrerequisiteFieldState["status"]>(provided ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(provided?.selected ?? []);
  const [baseline, setBaseline] = useState(() => key(provided?.selected ?? []));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (provided) return;
    let cancelled = false;
    loadPrerequisiteSettingsAction(courseId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setSettings(result.data);
          setSelected(result.data.selected);
          setBaseline(key(result.data.selected));
          setStatus("ready");
        } else {
          setError(result.error);
          setStatus("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("The prerequisites could not be loaded. Check your connection and try again.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, provided, attempt]);

  return {
    status,
    error,
    settings,
    selected,
    setSelected,
    dirty: status === "ready" && key(selected) !== baseline,
    snapshot: status === "ready" ? key(selected) : baseline,
    retry: () => {
      setError(null);
      setStatus("loading");
      setAttempt((n) => n + 1);
    },
  };
}

/** "Prerequisites" field: multi-select of other published courses (no cycles). */
export function CoursePrerequisitesField({ state, error }: { state: PrerequisiteFieldState; error?: string }) {
  if (state.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading prerequisites">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9.5 w-full" />
      </div>
    );
  }
  if (state.status === "error" || !state.settings) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
        <span>{state.error ?? "The prerequisites could not be loaded."}</span>
        <Button variant="outline" size="xs" onClick={state.retry} leftIcon={<Icon.Refresh className="size-3.5" />}>
          Try again
        </Button>
      </div>
    );
  }

  const { options, excludedTitles } = state.settings;
  const unpublished = options.filter((o) => !o.published && state.selected.includes(o.id));
  return (
    <div className="space-y-3">
      <input type="hidden" name="prerequisitesField" value="1" />
      <Field
        label="Required courses"
        htmlFor="settings-prerequisites"
        error={error}
        hint={`Learners must complete every selected course before they can enroll in or buy this one. Joining through a batch skips this check. Up to ${MAX_PREREQUISITES}.`}
      >
        {options.length ? (
          <MultiSelect
            id="settings-prerequisites"
            name="prerequisiteCourseIds"
            options={options.map((o) => ({
              value: o.id,
              label: o.title,
              description: o.published ? `${o.lessonCount} ${o.lessonCount === 1 ? "lesson" : "lessons"}` : "Unpublished: learners can't take it",
            }))}
            value={state.selected}
            onChange={state.setSelected}
            placeholder="No prerequisites (anyone can enroll)"
            searchPlaceholder="Search courses…"
            emptyText="No published course matches"
            invalid={!!error}
            max={MAX_PREREQUISITES}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-sm text-ink-muted">There are no other published courses to require yet.</p>
        )}
      </Field>
      {unpublished.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <Icon.AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {unpublished.map((o) => `“${o.title}”`).join(", ")} {unpublished.length === 1 ? "is" : "are"} unpublished, so {unpublished.length === 1 ? "it is" : "they are"} not enforced until published.
        </p>
      )}
      {excludedTitles.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-ink-muted">
          <Icon.Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Not offered because they already require this course: {excludedTitles.join(", ")}.
        </p>
      )}
    </div>
  );
}
