"use client";

import { useId, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { QuizIcon } from "./icons";
import { QuestionTypeIcon } from "./shared";
import { MAX_MARKS, MAX_OPTIONS, MAX_POSSIBILITIES, uiTypeLabels, uiTypes, type QuestionInput, type UiQuestionType } from "./types";

const PRESET_MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Switch the UI type, keeping as much of the answer data as makes sense. */
export function changeQuestionType(value: QuestionInput, next: UiQuestionType): QuestionInput {
  if (value.uiType === next) return value;
  let options = value.options;
  let possibilities = value.possibilities;
  if (next === "single" || next === "multiple") {
    if (options.length < 2) options = [...options, ...Array.from({ length: 2 - options.length }, () => ({ text: "", isCorrect: false, explanation: "" }))];
    if (next === "single") {
      let seen = false;
      options = options.map((o) => {
        if (o.isCorrect && !seen) {
          seen = true;
          return o;
        }
        return o.isCorrect ? { ...o, isCorrect: false } : o;
      });
    }
  }
  if (next === "user_input" && possibilities.length === 0) possibilities = [""];
  return { ...value, uiType: next, options, possibilities };
}

export interface QuestionEditorProps {
  value: QuestionInput;
  onChange: (next: QuestionInput) => void;
  /** Field errors from validateQuestionInput / the server. */
  errors: Record<string, string>;
  /** Show errors (after the first save attempt or for stored questions). */
  showErrors: boolean;
  /** Types this question may switch to (open-ended can't be mixed with other types in a quiz). */
  allowedTypes?: UiQuestionType[];
  usedIn?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Label override for the marks control (e.g. "Marks in this quiz"). */
  marksLabel?: string;
}

/**
 * Fields of a question-bank entry: type, marks, markdown text with preview,
 * and the answer block (options with correct markers and explanations,
 * accepted answers, or nothing for open-ended questions).
 */
export function QuestionEditor({ value, onChange, errors, showErrors, allowedTypes, usedIn, disabled, autoFocus, marksLabel = "Marks" }: QuestionEditorProps) {
  const id = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [customMarks, setCustomMarks] = useState(!PRESET_MARKS.includes(value.marks));
  const types = allowedTypes && allowedTypes.length ? allowedTypes : uiTypes;
  const locked = types.length === 1;
  const isChoices = value.uiType === "single" || value.uiType === "multiple";
  const err = (key: string) => (showErrors ? errors[key] : undefined);

  const setOption = (i: number, patch: Partial<QuestionInput["options"][number]>) => {
    const options = value.options.map((o, idx) => {
      if (idx === i) return { ...o, ...patch };
      // Single choice: marking one option correct clears the others.
      if (patch.isCorrect && value.uiType === "single") return { ...o, isCorrect: false };
      return o;
    });
    onChange({ ...value, options });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-52">
          <label htmlFor={`${id}-type`} className="mb-1.5 block text-xs font-medium text-ink-muted">
            Type
          </label>
          <div className="relative">
            <Select
              id={`${id}-type`}
              value={value.uiType}
              onChange={(e) => onChange(changeQuestionType(value, e.target.value as UiQuestionType))}
              disabled={disabled || locked}
              title={locked ? "A quiz cannot mix Open Ended questions with other question types." : undefined}
              className="pl-9"
            >
              {uiTypes.map((t) => (
                <option key={t} value={t} disabled={!types.includes(t)}>
                  {uiTypeLabels[t]}
                </option>
              ))}
            </Select>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
              {locked ? <Icon.Lock className="size-3.5" /> : <QuestionTypeIcon type={value.uiType} />}
            </span>
          </div>
          {locked && <span className="sr-only">A quiz cannot mix Open Ended questions with other question types.</span>}
        </div>

        <div className="w-full sm:w-44">
          <label htmlFor={`${id}-marks`} className="mb-1.5 block text-xs font-medium text-ink-muted">
            {marksLabel}
          </label>
          {customMarks ? (
            <div className="flex items-center gap-1.5">
              <Input
                id={`${id}-marks`}
                type="number"
                min={1}
                max={MAX_MARKS}
                step={1}
                value={Number.isFinite(value.marks) ? String(value.marks) : ""}
                onChange={(e) => onChange({ ...value, marks: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCustomMarks(false);
                    onChange({ ...value, marks: PRESET_MARKS.includes(value.marks) ? value.marks : 1 });
                  }
                }}
                disabled={disabled}
                invalid={!!err("marks")}
                rightAddon={<span className="text-xs">{value.marks === 1 ? "mark" : "marks"}</span>}
              />
              <IconButton label="Choose from the list" size="icon-sm" onClick={() => setCustomMarks(false)} disabled={disabled}>
                <Icon.ChevronsUpDown className="size-4" />
              </IconButton>
            </div>
          ) : (
            <div className="relative">
              <Select
                id={`${id}-marks`}
                value={String(value.marks)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setCustomMarks(true);
                    return;
                  }
                  onChange({ ...value, marks: Number(e.target.value) });
                }}
                disabled={disabled}
                className="pl-9"
              >
                {PRESET_MARKS.map((m) => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? "mark" : "marks"}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
              <QuizIcon.Gauge className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            </div>
          )}
          {err("marks") && <p className="mt-1 text-xs text-danger">{err("marks")}</p>}
        </div>

        {usedIn !== undefined && usedIn > 1 && (
          <Badge tone="warning" className="mb-2">
            Used in {usedIn} quizzes
          </Badge>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor={`${id}-text`} className="text-xs font-medium text-ink-muted">
            Question <span className="text-danger">*</span>
          </label>
          <SegmentedControl
            size="xs"
            value={tab}
            onChange={setTab}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
        {tab === "write" ? (
          <Textarea
            id={`${id}-text`}
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            placeholder="Type your question here"
            rows={3}
            maxLength={10000}
            autoFocus={autoFocus}
            disabled={disabled}
            invalid={!!err("text")}
            className="min-h-20"
          />
        ) : (
          <div className="min-h-20 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
            {value.text.trim() ? <Markdown content={value.text} className="text-sm" /> : <p className="text-sm italic text-ink-faint">Nothing to preview yet.</p>}
          </div>
        )}
        {err("text") ? (
          <p className="mt-1 text-xs text-danger">{err("text")}</p>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">Markdown is supported: **bold**, `code`, lists, links and images.</p>
        )}
      </div>

      {isChoices && (
        <fieldset className="space-y-2.5">
          <legend className="mb-1.5 text-xs font-medium text-ink-muted">
            Options · {value.uiType === "single" ? "mark the correct answer" : "mark every correct answer"}
          </legend>
          {value.options.map((o, i) => {
            const n = i + 1;
            return (
              <div key={i} className="rounded-lg border border-border bg-surface-1 p-2.5">
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 cursor-pointer items-center" title={value.uiType === "single" ? `Option ${n} is the correct answer` : `Option ${n} is a correct answer`}>
                    <input
                      type={value.uiType === "single" ? "radio" : "checkbox"}
                      name={`${id}-correct`}
                      checked={o.isCorrect}
                      onChange={(e) => setOption(i, { isCorrect: value.uiType === "single" ? true : e.target.checked })}
                      disabled={disabled}
                      className="size-4 cursor-pointer accent-success"
                    />
                    <span className="sr-only">{value.uiType === "single" ? `Option ${n} is the correct answer` : `Option ${n} is a correct answer`}</span>
                  </label>
                  <Input
                    value={o.text}
                    onChange={(e) => setOption(i, { text: e.target.value })}
                    placeholder={`Option ${n}`}
                    aria-label={`Option ${n}`}
                    maxLength={1000}
                    disabled={disabled}
                    invalid={showErrors && i < 2 && !o.text.trim()}
                    className={cn(o.isCorrect && "border-success/60")}
                  />
                  {value.options.length > 2 && (
                    <IconButton
                      label={`Remove option ${n}`}
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() => onChange({ ...value, options: value.options.filter((_, idx) => idx !== i) })}
                    >
                      <Icon.X className="size-4" />
                    </IconButton>
                  )}
                </div>
                <Input
                  value={o.explanation}
                  onChange={(e) => setOption(i, { explanation: e.target.value })}
                  placeholder={`Explanation for option ${n}, shown as feedback (optional)`}
                  aria-label={`Explanation for option ${n}`}
                  maxLength={2000}
                  disabled={disabled}
                  className="mt-2 h-8 border-dashed text-xs"
                />
              </div>
            );
          })}
          {(err("correct") || err("options")) && (
            <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
              <Icon.AlertCircle className="size-3.5" />
              {err("correct") ?? err("options")}
            </p>
          )}
          {value.options.length < MAX_OPTIONS && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onChange({ ...value, options: [...value.options, { text: "", isCorrect: false, explanation: "" }] })}
                leftIcon={<Icon.Plus className="size-4" />}
              >
                Add option
              </Button>
              <span className="text-xs tabular-nums text-ink-faint">
                {value.options.length}/{MAX_OPTIONS}
              </span>
            </div>
          )}
        </fieldset>
      )}

      {value.uiType === "user_input" && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-muted">Accepted answers</legend>
          {value.possibilities.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" checked disabled readOnly aria-hidden="true" tabIndex={-1} className="size-4 shrink-0 accent-success" />
              <Input
                value={p}
                onChange={(e) => onChange({ ...value, possibilities: value.possibilities.map((x, idx) => (idx === i ? e.target.value : x)) })}
                placeholder={`Accepted answer ${i + 1}`}
                aria-label={`Accepted answer ${i + 1}`}
                maxLength={500}
                disabled={disabled}
                invalid={showErrors && i === 0 && !p.trim()}
              />
              {value.possibilities.length > 1 && (
                <IconButton
                  label={`Remove answer ${i + 1}`}
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, possibilities: value.possibilities.filter((_, idx) => idx !== i) })}
                >
                  <Icon.X className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
          {err("possibilities") && (
            <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
              <Icon.AlertCircle className="size-3.5" />
              {err("possibilities")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {value.possibilities.length < MAX_POSSIBILITIES && (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onChange({ ...value, possibilities: [...value.possibilities, ""] })}
                leftIcon={<Icon.Plus className="size-4" />}
              >
                Add accepted answer
              </Button>
            )}
            <span className="text-xs tabular-nums text-ink-faint">
              {value.possibilities.length}/{MAX_POSSIBILITIES}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
              <Icon.Info className="size-3.5" />
              Auto-graded: matches ignore capitalisation and extra spaces
            </span>
          </div>
        </fieldset>
      )}

      {value.uiType === "open_ended" && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
          <QuizIcon.AlignLeft className="mt-0.5 size-4 shrink-0" />
          Learners write a free-form answer (Markdown supported). You grade it from the submissions page; the attempt shows as pending until then.
        </p>
      )}
    </div>
  );
}

/** Read-only rendering of a question (used when the viewer can't edit it). */
export function QuestionReadOnly({ value }: { value: QuestionInput }) {
  return (
    <div className="space-y-3">
      <Markdown content={value.text} className="text-sm font-medium" />
      {(value.uiType === "single" || value.uiType === "multiple") && (
        <ul className="space-y-1.5">
          {value.options.map((o, i) => (
            <li key={o.id ?? i} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", o.isCorrect ? "border-success/40 bg-success/8" : "border-border")}>
              {o.isCorrect ? <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" /> : <Icon.Circle className="mt-0.5 size-4 shrink-0 text-ink-faint" />}
              <span className="min-w-0">
                <span className="text-ink">{o.text}</span>
                {o.explanation && <span className="mt-0.5 block text-xs text-ink-muted">{o.explanation}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {value.uiType === "user_input" && (
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">Accepted answers:</span> {value.possibilities.join(", ")}
        </p>
      )}
    </div>
  );
}
