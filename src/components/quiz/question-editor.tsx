"use client";

import { useId, useState } from "react";
import { Markdown } from "@/lib/markdown";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Select, Switch, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { QuizIcon } from "./icons";
import { QuestionTypeIcon } from "./shared";
import { MAX_MARKS, MAX_OPTIONS, MAX_POSSIBILITIES, uiTypes, type QuestionInput, type UiQuestionType } from "./types";

const PRESET_MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Translate = ReturnType<typeof useT<"learning">>;

/**
 * Translates the messages of `validateQuestionInput`, which the server action
 * shares and returns in English. Any other message is shown as given.
 */
export function localizeQuestionError(message: string, t: Translate): string {
  switch (message) {
    case "Type the question.":
      return t("quizAdmin.validation.text");
    case `Marks must be a whole number between 1 and ${MAX_MARKS}.`:
      return t("quizAdmin.validation.marks", { max: MAX_MARKS });
    case `A question can have at most ${MAX_OPTIONS} options.`:
      return t("quizAdmin.validation.optionsMax", { max: MAX_OPTIONS });
    case "Add at least two options.":
      return t("quizAdmin.validation.optionsMin");
    case "A correct option can't be empty.":
      return t("quizAdmin.validation.correctEmpty");
    case "Mark the correct answer":
      return t("quizAdmin.validation.correctOne");
    case "Mark at least two correct answers":
      return t("quizAdmin.validation.correctMany");
    case "Duplicate options found for this question.":
      return t("quizAdmin.validation.duplicateOptions");
    case `Add at most ${MAX_POSSIBILITIES} accepted answers.`:
      return t("quizAdmin.validation.possibilitiesMax", { max: MAX_POSSIBILITIES });
    case "Add at least one accepted answer.":
      return t("quizAdmin.validation.possibilitiesMin");
    default:
      return message;
  }
}

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
export function QuestionEditor({ value, onChange, errors, showErrors, allowedTypes, usedIn, disabled, autoFocus, marksLabel }: QuestionEditorProps) {
  const t = useT("learning");
  const id = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [customMarks, setCustomMarks] = useState(!PRESET_MARKS.includes(value.marks));
  const types = allowedTypes && allowedTypes.length ? allowedTypes : uiTypes;
  const locked = types.length === 1;
  const isChoices = value.uiType === "single" || value.uiType === "multiple";
  const err = (key: string) => (showErrors && errors[key] ? localizeQuestionError(errors[key], t) : undefined);
  const noMixing = t("quizAdmin.editor.noMixing");

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
            {t("quizAdmin.editor.type")}
          </label>
          <div className="relative">
            <Select
              id={`${id}-type`}
              value={value.uiType}
              onChange={(e) => onChange(changeQuestionType(value, e.target.value as UiQuestionType))}
              disabled={disabled || locked}
              title={locked ? noMixing : undefined}
              className="ps-9"
            >
              {uiTypes.map((type) => (
                <option key={type} value={type} disabled={!types.includes(type)}>
                  {t(`global.quiz.type.${type}`)}
                </option>
              ))}
            </Select>
            <span className="pointer-events-none absolute inset-s-3 top-1/2 -translate-y-1/2 text-ink-muted">
              {locked ? <Icon.Lock className="size-3.5" /> : <QuestionTypeIcon type={value.uiType} />}
            </span>
          </div>
          {locked && <span className="sr-only">{noMixing}</span>}
        </div>

        <div className="w-full sm:w-44">
          <label htmlFor={`${id}-marks`} className="mb-1.5 block text-xs font-medium text-ink-muted">
            {marksLabel ?? t("quizAdmin.editor.marks")}
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
                rightAddon={<span className="text-xs">{t("quizAdmin.editor.marksUnit", { count: Number.isFinite(value.marks) ? value.marks : 0 })}</span>}
              />
              <IconButton label={t("quizAdmin.editor.chooseFromList")} size="icon-sm" onClick={() => setCustomMarks(false)} disabled={disabled}>
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
                className="ps-9"
              >
                {PRESET_MARKS.map((m) => (
                  <option key={m} value={m}>
                    {t("global.quiz.marks", { count: m })}
                  </option>
                ))}
                <option value="custom">{t("quizAdmin.editor.customMarks")}</option>
              </Select>
              <QuizIcon.Gauge className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            </div>
          )}
          {err("marks") && <p className="mt-1 text-xs text-danger">{err("marks")}</p>}
        </div>

        {usedIn !== undefined && usedIn > 1 && (
          <Badge tone="warning" className="mb-2">
            {t("quizAdmin.editor.usedIn", { count: usedIn })}
          </Badge>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor={`${id}-text`} className="text-xs font-medium text-ink-muted">
            {t("quizAdmin.editor.question")} <span className="text-danger">*</span>
          </label>
          <SegmentedControl
            size="xs"
            value={tab}
            onChange={setTab}
            options={[
              { value: "write", label: t("quizAdmin.editor.write") },
              { value: "preview", label: t("quizAdmin.editor.preview") },
            ]}
          />
        </div>
        {tab === "write" ? (
          <Textarea
            id={`${id}-text`}
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            placeholder={t("quizAdmin.editor.questionPlaceholder")}
            rows={3}
            maxLength={10000}
            autoFocus={autoFocus}
            disabled={disabled}
            invalid={!!err("text")}
            className="min-h-20"
          />
        ) : (
          <div className="min-h-20 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
            {value.text.trim() ? <Markdown content={value.text} className="text-sm" /> : <p className="text-sm italic text-ink-faint">{t("quizAdmin.editor.nothingToPreview")}</p>}
          </div>
        )}
        {err("text") ? (
          <p className="mt-1 text-xs text-danger">{err("text")}</p>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">{t("quizAdmin.editor.markdownHint")}</p>
        )}
      </div>

      {isChoices && (
        <Switch
          id={`${id}-multiple`}
          label={t("quizAdmin.editor.multiple")}
          description={t("quizAdmin.editor.multipleHint")}
          checked={value.uiType === "multiple"}
          disabled={disabled}
          onChange={(e) => onChange(changeQuestionType(value, e.target.checked ? "multiple" : "single"))}
        />
      )}

      {isChoices && (
        <fieldset className="space-y-2.5">
          <legend className="mb-1.5 text-xs font-medium text-ink-muted">
            {value.uiType === "single" ? t("quizAdmin.editor.optionsSingle") : t("quizAdmin.editor.optionsMultiple")}
          </legend>
          {value.options.map((o, i) => {
            const n = i + 1;
            const correctLabel = value.uiType === "single" ? t("quizAdmin.editor.isTheCorrect", { number: n }) : t("quizAdmin.editor.isACorrect", { number: n });
            return (
              <div key={i} className="rounded-lg border border-border bg-surface-1 p-2.5">
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 cursor-pointer items-center" title={correctLabel}>
                    <input
                      type={value.uiType === "single" ? "radio" : "checkbox"}
                      name={`${id}-correct`}
                      checked={o.isCorrect}
                      onChange={(e) => setOption(i, { isCorrect: value.uiType === "single" ? true : e.target.checked })}
                      disabled={disabled}
                      className="size-4 cursor-pointer accent-success"
                    />
                    <span className="sr-only">{correctLabel}</span>
                  </label>
                  <Input
                    value={o.text}
                    onChange={(e) => setOption(i, { text: e.target.value })}
                    placeholder={t("quizAdmin.editor.option", { number: n })}
                    aria-label={t("quizAdmin.editor.option", { number: n })}
                    maxLength={1000}
                    disabled={disabled}
                    invalid={showErrors && i < 2 && !o.text.trim()}
                    className={cn(o.isCorrect && "border-success/60")}
                  />
                  {value.options.length > 2 && (
                    <IconButton
                      label={t("quizAdmin.editor.removeOption", { number: n })}
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
                  placeholder={t("quizAdmin.editor.explanationPlaceholder", { number: n })}
                  aria-label={t("quizAdmin.editor.explanationLabel", { number: n })}
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
                {t("quizAdmin.editor.addOption")}
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
          <legend className="mb-1.5 text-xs font-medium text-ink-muted">{t("quizAdmin.editor.acceptedAnswers")}</legend>
          {value.possibilities.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" checked disabled readOnly aria-hidden="true" tabIndex={-1} className="size-4 shrink-0 accent-success" />
              <Input
                value={p}
                onChange={(e) => onChange({ ...value, possibilities: value.possibilities.map((x, idx) => (idx === i ? e.target.value : x)) })}
                placeholder={t("quizAdmin.editor.acceptedAnswer", { number: i + 1 })}
                aria-label={t("quizAdmin.editor.acceptedAnswer", { number: i + 1 })}
                maxLength={500}
                disabled={disabled}
                invalid={showErrors && i === 0 && !p.trim()}
              />
              {value.possibilities.length > 1 && (
                <IconButton
                  label={t("quizAdmin.editor.removeAnswer", { number: i + 1 })}
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
                {t("quizAdmin.editor.addAccepted")}
              </Button>
            )}
            <span className="text-xs tabular-nums text-ink-faint">
              {value.possibilities.length}/{MAX_POSSIBILITIES}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
              <Icon.Info className="size-3.5" />
              {t("quizAdmin.editor.autoGraded")}
            </span>
          </div>
        </fieldset>
      )}

      {value.uiType === "open_ended" && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
          <QuizIcon.AlignLeft className="mt-0.5 size-4 shrink-0" />
          {t("quizAdmin.editor.openEndedHint")}
        </p>
      )}
    </div>
  );
}

/** Read-only rendering of a question (used when the viewer can't edit it). */
export function QuestionReadOnly({ value }: { value: QuestionInput }) {
  const t = useT("learning");
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
          <span className="font-medium text-ink">{t("quizAdmin.editor.acceptedLabel")}</span> {value.possibilities.join(", ")}
        </p>
      )}
    </div>
  );
}
