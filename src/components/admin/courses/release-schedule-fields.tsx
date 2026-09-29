"use client";

import { Checkbox, Input, RadioCard } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import {
  MAX_DRIP_DAYS,
  cleanReleaseRule,
  dateKeyToUtcMs,
  describeReleaseRule,
  releaseTime,
  shortRuleLabel,
  validateReleaseInput,
  type ReleaseRule,
} from "@/components/learn/drip-shared";
import { fullLocalDateTime, useNow } from "@/components/learn/unlock-time";

/* ------------------------------------------------------------------ */
/* Draft model                                                          */
/* ------------------------------------------------------------------ */

/** Editable state of a release schedule ("Available immediately" / days / date, combinable). */
export interface ReleaseDraft {
  scheduled: boolean;
  useDays: boolean;
  days: string;
  useDate: boolean;
  date: string;
}

export function releaseDraftFrom(rule: ReleaseRule | null | undefined): ReleaseDraft {
  const clean = cleanReleaseRule(rule);
  return {
    scheduled: !!(clean.dripDays || clean.availableFrom),
    useDays: !!clean.dripDays,
    days: clean.dripDays ? String(clean.dripDays) : "",
    useDate: !!clean.availableFrom,
    date: clean.availableFrom ?? "",
  };
}

/** The raw values the draft submits (empty strings = not used). */
export function draftValues(draft: ReleaseDraft): { dripDays: string; availableFrom: string } {
  return {
    dripDays: draft.scheduled && draft.useDays ? draft.days.trim() : "",
    availableFrom: draft.scheduled && draft.useDate ? draft.date.trim() : "",
  };
}

/** Stable string for dirty checks. */
export function serializeDraft(draft: ReleaseDraft): string {
  const v = draftValues(draft);
  return `${v.dripDays}|${v.availableFrom}`;
}

/** Client-side validation with the same rules as the server. */
export function draftErrors(draft: ReleaseDraft): { dripDays?: string; availableFrom?: string } {
  const v = draftValues(draft);
  if (draft.scheduled && draft.useDays && !v.dripDays) return { dripDays: "Enter the number of days." };
  if (draft.scheduled && draft.useDate && !v.availableFrom) return { availableFrom: "Pick a date." };
  const result = validateReleaseInput(v);
  return result.ok ? {} : result.errors;
}

/** The rule the draft describes (invalid parts dropped). */
export function draftRule(draft: ReleaseDraft): ReleaseRule {
  const result = validateReleaseInput(draftValues(draft));
  return result.ok ? result.rule : {};
}

/* ------------------------------------------------------------------ */
/* Fields                                                               */
/* ------------------------------------------------------------------ */

export interface ReleaseScheduleFieldsProps {
  /** Prefix for element ids (unique per form). */
  idPrefix: string;
  subject: "chapter" | "lesson";
  value: ReleaseDraft;
  onChange: (value: ReleaseDraft) => void;
  /** Server-side errors (fieldErrors.dripDays / availableFrom). */
  errors?: { dripDays?: string; availableFrom?: string };
  /** Lessons: the chapter's own schedule, which also applies (the later time wins). */
  chapter?: { title: string; rule: ReleaseRule } | null;
  /** The course unlocks lessons in order as well. */
  enforceOrder?: boolean;
  /** Lessons: it is a free preview, so day-based schedules do not hold it back. */
  preview?: boolean;
  disabled?: boolean;
  /** Render the hidden form fields (`releaseSchedule`, `dripDays`, `availableFrom`). */
  withInputs?: boolean;
}

/**
 * "Release schedule" editor shared by the chapter dialog, the lesson editor
 * and the outline's per-lesson dialog: available immediately, N days after
 * enrollment, on a date — the two schedules can be combined (the later one
 * wins). Shows a live preview sentence, including what the date means in the
 * author's own time zone and when a learner enrolling today would get it.
 */
export function ReleaseScheduleFields({ idPrefix, subject, value, onChange, errors = {}, chapter, enforceOrder, preview, disabled, withInputs = true }: ReleaseScheduleFieldsProps) {
  const now = useNow("minute");
  const localErrors = draftErrors(value);
  const daysError = errors.dripDays ?? (value.useDays ? localErrors.dripDays : undefined);
  const dateError = errors.availableFrom ?? (value.useDate ? localErrors.availableFrom : undefined);
  const values = draftValues(value);
  const rule = draftRule(value);
  const chapterRule = chapter ? cleanReleaseRule(chapter.rule) : null;
  const chapterLabel = chapterRule ? shortRuleLabel(chapterRule) : null;
  const nothingChosen = value.scheduled && !value.useDays && !value.useDate;

  const set = (patch: Partial<ReleaseDraft>) => onChange({ ...value, ...patch });
  const setMode = (mode: string) => {
    if (mode === "immediate") set({ scheduled: false });
    else if (!value.useDays && !value.useDate) set({ scheduled: true, useDays: true, days: value.days || "7" });
    else set({ scheduled: true });
  };

  const dateMs = dateKeyToUtcMs(rule.availableFrom);
  const example = now === null ? null : releaseTime(chapterRule, rule, preview ? null : now);
  const daysIgnored = !!preview && !!(rule.dripDays || chapterRule?.dripDays);

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="sr-only">Release schedule</legend>
      {withInputs && (
        <>
          <input type="hidden" name="releaseSchedule" value="1" />
          <input type="hidden" name="dripDays" value={values.dripDays} />
          <input type="hidden" name="availableFrom" value={values.availableFrom} />
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <RadioCard
          name={`${idPrefix}-release-mode`}
          value="immediate"
          checked={!value.scheduled}
          onChange={setMode}
          disabled={disabled}
          icon={<Icon.Unlock className="size-4" />}
          title="Available immediately"
          description={subject === "chapter" ? "Lessons open as soon as a learner enrolls." : "Opens as soon as a learner enrolls."}
        />
        <RadioCard
          name={`${idPrefix}-release-mode`}
          value="scheduled"
          checked={value.scheduled}
          onChange={setMode}
          disabled={disabled}
          icon={<Icon.Clock className="size-4" />}
          title="Scheduled"
          description="After some days, on a date, or both."
        />
      </div>

      {value.scheduled && (
        <div className="space-y-4 rounded-xl border border-border bg-surface-2/40 p-3 sm:p-4">
          <div className="space-y-2">
            <Checkbox
              id={`${idPrefix}-use-days`}
              checked={value.useDays}
              onChange={(e) => set({ useDays: e.target.checked, days: e.target.checked && !value.days ? "7" : value.days })}
              label="Days after enrollment"
              description="Counted from each learner's enrollment. Batch learners count from the batch start."
            />
            {value.useDays && (
              <div className="pl-6.5">
                <div className="flex items-center gap-2">
                  <label htmlFor={`${idPrefix}-days`} className="sr-only">
                    Days after enrollment
                  </label>
                  <Input
                    id={`${idPrefix}-days`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_DRIP_DAYS}
                    step={1}
                    value={value.days}
                    onChange={(e) => set({ days: e.target.value })}
                    invalid={!!daysError}
                    aria-describedby={daysError ? `${idPrefix}-days-error` : undefined}
                    className="w-28"
                  />
                  <span className="text-sm text-ink-muted">{value.days.trim() === "1" ? "day" : "days"}</span>
                </div>
                {daysError && (
                  <p id={`${idPrefix}-days-error`} className="mt-1.5 text-xs text-danger">
                    {daysError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Checkbox
              id={`${idPrefix}-use-date`}
              checked={value.useDate}
              onChange={(e) => set({ useDate: e.target.checked })}
              label="On a date"
              description="Opens for everyone at 00:00 UTC on this day, free previews included."
            />
            {value.useDate && (
              <div className="pl-6.5">
                <label htmlFor={`${idPrefix}-date`} className="sr-only">
                  Release date
                </label>
                <Input
                  id={`${idPrefix}-date`}
                  type="date"
                  value={value.date}
                  onChange={(e) => set({ date: e.target.value })}
                  invalid={!!dateError}
                  aria-describedby={dateError ? `${idPrefix}-date-error` : undefined}
                  className="w-44"
                />
                {dateError ? (
                  <p id={`${idPrefix}-date-error`} className="mt-1.5 text-xs text-danger">
                    {dateError}
                  </p>
                ) : dateMs !== null && now !== null ? (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    That&apos;s {fullLocalDateTime(dateMs, now)} for you.
                    {dateMs <= now && " This date has passed, so it no longer delays anything."}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {nothingChosen && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <Icon.AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Choose days, a date or both — or switch to “Available immediately”.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-sm" aria-live="polite">
        <p className="flex items-start gap-2 text-ink">
          <Icon.Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            {describeReleaseRule(rule, subject)}
            {example !== null && now !== null && example > now && (
              <span className="text-ink-muted"> A learner enrolling now gets it on {fullLocalDateTime(example, now)}.</span>
            )}
          </span>
        </p>
        {chapter && chapterLabel && (
          <p className="mt-1.5 pl-6 text-xs text-ink-muted">
            Chapter “{chapter.title}” is scheduled too ({chapterLabel}). Learners get this lesson at whichever time is later.
          </p>
        )}
        {daysIgnored && (
          <p className="mt-1.5 pl-6 text-xs text-warning">This lesson is a free preview, so day-based schedules don&apos;t hold it back; only a date does.</p>
        )}
        {enforceOrder && <p className="mt-1.5 pl-6 text-xs text-ink-muted">This course also unlocks lessons in order, so learners must finish the previous lessons first.</p>}
      </div>
    </fieldset>
  );
}
