"use client";

import { useId, useState } from "react";
import type { Rubric, RubricScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { RUBRIC_LIMITS, criterionMaxPoints, formatPoints, pointsToPass, scoreRubric, type RubricSelection } from "@/lib/teaching/rubric-shared";

/** Selected level + optional comment per criterion id. */
export type RubricSelections = Record<string, { levelIndex: number; comment: string }>;

export function selectionsFromScores(scores: readonly RubricScore[] | undefined): RubricSelections {
  const out: RubricSelections = {};
  for (const s of scores ?? []) out[s.criterionId] = { levelIndex: s.levelIndex, comment: s.comment ?? "" };
  return out;
}

export function selectionList(value: RubricSelections): RubricSelection[] {
  return Object.entries(value).map(([criterionId, v]) => ({ criterionId, levelIndex: v.levelIndex, comment: v.comment }));
}

/**
 * Click-to-score rubric. Each criterion is a radio group of level cards
 * (arrow keys move between levels), with an optional comment. The running
 * total and the pass/fail outcome update live. Submits the selections as
 * JSON in a hidden `name` field.
 */
export function RubricScorer({
  rubric,
  value,
  onChange,
  name = "selections",
  disabled,
  allowComments = true,
  hints,
  error,
  outcomeLabels = { pass: "Pass", fail: "Fail" },
}: {
  rubric: Pick<Rubric, "criteria" | "passPercent">;
  value: RubricSelections;
  onChange: (next: RubricSelections) => void;
  name?: string;
  disabled?: boolean;
  allowComments?: boolean;
  /** Extra text under a criterion title, e.g. the peer average. */
  hints?: Record<string, string>;
  error?: string;
  outcomeLabels?: { pass: string; fail: string };
}) {
  const baseId = useId();
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set(Object.entries(value).filter(([, v]) => v.comment).map(([id]) => id)));
  const result = scoreRubric(rubric, selectionList(value));
  const selected = rubric.criteria.length - result.missing.length;

  const pick = (criterionId: string, levelIndex: number) => onChange({ ...value, [criterionId]: { levelIndex, comment: value[criterionId]?.comment ?? "" } });
  const comment = (criterionId: string, text: string) => {
    const current = value[criterionId];
    if (!current) return;
    onChange({ ...value, [criterionId]: { ...current, comment: text } });
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={JSON.stringify(selectionList(value))} />
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {rubric.criteria.map((criterion, ci) => {
        const groupId = `${baseId}-c${ci}`;
        const current = value[criterion.id];
        const commentOpen = openComments.has(criterion.id);
        return (
          <fieldset key={criterion.id} className={cn("rounded-xl border bg-surface-1 p-3 sm:p-4", current ? "border-border" : "border-border-strong border-dashed")} disabled={disabled}>
            <legend className="sr-only">{criterion.title}</legend>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-ink" aria-hidden="true">
                  {criterion.title}
                </p>
                {criterion.description && <p className="mt-0.5 text-sm text-ink-muted">{criterion.description}</p>}
                {hints?.[criterion.id] && <p className="mt-1 text-xs text-info">{hints[criterion.id]}</p>}
              </div>
              <Badge tone={current ? "accent" : "neutral"}>
                {current ? `${formatPoints(criterion.levels[current.levelIndex]?.points ?? 0)} / ${formatPoints(criterionMaxPoints(criterion))}` : `Up to ${formatPoints(criterionMaxPoints(criterion))}`} pts
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label={criterion.title}>
              {criterion.levels.map((level, li) => {
                const checked = current?.levelIndex === li;
                const inputId = `${groupId}-l${li}`;
                return (
                  <label
                    key={li}
                    htmlFor={inputId}
                    className={cn(
                      "relative flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm transition-colors",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50",
                      checked ? "border-accent bg-accent/8 ring-1 ring-accent/40" : "border-border bg-surface-2/40 hover:border-border-strong hover:bg-surface-2",
                      disabled && "cursor-not-allowed opacity-70",
                    )}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={`${groupId}-level`}
                      value={li}
                      checked={checked}
                      onChange={() => pick(criterion.id, li)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        {checked && <Icon.Check className="mr-1 inline size-3.5 text-accent" aria-hidden="true" />}
                        {level.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatPoints(level.points)} pts</span>
                    </span>
                    {level.description && <span className="mt-1 text-xs leading-relaxed text-ink-muted">{level.description}</span>}
                  </label>
                );
              })}
            </div>
            {allowComments && (
              <div className="mt-2">
                {commentOpen ? (
                  <Textarea
                    aria-label={`Comment on ${criterion.title}`}
                    rows={2}
                    maxLength={RUBRIC_LIMITS.commentMax}
                    value={current?.comment ?? ""}
                    onChange={(e) => comment(criterion.id, e.target.value)}
                    disabled={disabled || !current}
                    placeholder={current ? "Why this level? What would move it up?" : "Pick a level first"}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenComments((prev) => new Set(prev).add(criterion.id))}
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Icon.Plus className="size-3.5" aria-hidden="true" /> Add a comment
                  </button>
                )}
              </div>
            )}
          </fieldset>
        );
      })}
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-1/95 px-4 py-3 text-sm shadow-card backdrop-blur" aria-live="polite">
        <p className="text-ink">
          <span className="font-semibold tabular-nums">
            {formatPoints(result.total)} / {formatPoints(result.max)} pts
          </span>
          <span className="text-ink-muted"> ({result.percent}%)</span>
          <span className="ml-2 text-xs text-ink-muted">
            {selected} of {rubric.criteria.length} scored
          </span>
        </p>
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          Pass mark {rubric.passPercent}% ({formatPoints(pointsToPass(result.max, rubric.passPercent))} pts)
          {result.complete && (
            <Badge tone={result.passed ? "success" : "danger"} dot>
              {result.passed ? outcomeLabels.pass : outcomeLabels.fail}
            </Badge>
          )}
        </p>
      </div>
    </div>
  );
}
