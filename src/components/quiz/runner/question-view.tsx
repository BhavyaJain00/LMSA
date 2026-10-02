"use client";

import { useId } from "react";
import { Markdown } from "@/lib/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { OptionOutcomeList } from "../result-breakdown";
import { formatScore, type CheckAnswerResult, type RunnerQuestion } from "../types";

function instructionKey(q: RunnerQuestion) {
  if (q.type === "choices") return q.multiple ? "quiz.question.chooseMany" : "quiz.question.chooseOne";
  if (q.type === "user_input") return "quiz.question.typeAnswer";
  return "quiz.question.writeAnswer";
}

function OptionCard({
  name,
  type,
  checked,
  disabled,
  onChange,
  label,
  index,
}: {
  name: string;
  type: "radio" | "checkbox";
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: string;
  index: number;
}) {
  const letter = String.fromCharCode(65 + index);
  const t = useT("learning");
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
        checked ? "border-accent bg-accent/6" : "border-border bg-surface-2/50 hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 transition-colors",
          type === "radio" ? "rounded-full" : "rounded-md",
          checked ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface-1",
        )}
      >
        {checked && (type === "radio" ? <span className="size-2 rounded-full bg-current" /> : <Icon.Check className="size-3.5" strokeWidth={3} />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{t("quiz.question.optionLabel", { letter })} </span>
        <Markdown content={label} className="text-sm [&_p]:m-0" />
      </span>
      <span aria-hidden="true" className="mt-0.5 hidden text-xs font-medium text-ink-faint sm:inline">
        {letter}
      </span>
    </label>
  );
}

export interface QuestionViewProps {
  question: RunnerQuestion;
  index: number;
  total: number;
  answer: string[];
  onAnswer: (next: string[]) => void;
  check?: CheckAnswerResult;
  showAnswers: boolean;
  checking: boolean;
  busy: boolean;
  reviewMarked: boolean;
  onToggleReview: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCheck: () => void;
  onSubmit: () => void;
}

export function QuestionView({
  question,
  index,
  total,
  answer,
  onAnswer,
  check,
  showAnswers,
  checking,
  busy,
  reviewMarked,
  onToggleReview,
  onPrev,
  onNext,
  onCheck,
  onSubmit,
}: QuestionViewProps) {
  const uid = useId();
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const locked = !!check || busy;
  const textValue = answer[0] ?? "";
  const canCheck = showAnswers && !check && question.type !== "open_ended";
  const t = useT("learning");
  const f = useFormatter();

  const primary = () => {
    if (canCheck) onCheck();
    else if (isLast) onSubmit();
    else onNext();
  };

  return (
    <div className="rounded-card border border-border bg-surface-1 shadow-card">
      <div className="px-5 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-3 text-sm">
          <p className="text-ink-muted">
            <span className="font-medium text-ink">{t("quiz.question.position", { index: index + 1, total })}</span>
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">{t(instructionKey(question))}</span>
          </p>
          <span className="shrink-0 font-semibold text-ink">{t("quiz.question.marks", { count: Number(formatScore(question.marks)) })}</span>
        </div>
        <ProgressBar value={((index + 1) / total) * 100} size="xs" className="mt-3" label={t("quiz.question.position", { index: index + 1, total })} />
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div id={`${uid}-q`} className="mb-4">
          <Markdown content={question.text} className="text-base font-semibold [&_p]:m-0" />
        </div>

        {question.type === "choices" &&
          (check?.options ? (
            <OptionOutcomeList options={check.options} />
          ) : (
            <div role={question.multiple ? "group" : "radiogroup"} aria-labelledby={`${uid}-q`} className="space-y-2.5">
              {question.options.map((o, i) => {
                const checked = answer.includes(o.id);
                return (
                  <OptionCard
                    key={o.id}
                    name={`${uid}-opt`}
                    type={question.multiple ? "checkbox" : "radio"}
                    checked={checked}
                    disabled={locked}
                    index={i}
                    label={o.text}
                    onChange={() => {
                      if (question.multiple) onAnswer(checked ? answer.filter((a) => a !== o.id) : [...answer, o.id]);
                      else onAnswer([o.id]);
                    }}
                  />
                );
              })}
            </div>
          ))}

        {question.type === "user_input" && (
          <div className="space-y-2">
            <label htmlFor={`${uid}-input`} className="sr-only">
              {t("quiz.question.yourAnswer")}
            </label>
            <Input
              id={`${uid}-input`}
              value={textValue}
              onChange={(e) => onAnswer([e.target.value])}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  primary();
                }
              }}
              disabled={locked}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("quiz.question.typeAnswer")}
              className="h-11 text-base"
            />
            {check && (
              <Badge tone={check.isCorrect ? "success" : "danger"} size="md">
                {check.isCorrect ? <Icon.CheckCircle className="size-4" /> : <Icon.XCircle className="size-4" />}
                {check.isCorrect ? t("quiz.question.correct") : t("quiz.question.incorrect")}
              </Badge>
            )}
          </div>
        )}

        {question.type === "open_ended" && (
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-text`} className="sr-only">
              {t("quiz.question.yourAnswer")}
            </label>
            <Textarea
              id={`${uid}-text`}
              value={textValue}
              onChange={(e) => onAnswer([e.target.value])}
              disabled={busy}
              rows={7}
              maxLength={20000}
              placeholder={t("quiz.question.writePlaceholder")}
              className="min-h-32"
            />
            <p className="flex justify-between gap-2 text-xs text-ink-faint">
              <span>{t("quiz.question.openEndedHint")}</span>
              <span className="tabular-nums">
                {f.number(textValue.length)}/{f.number(20000)}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          {!showAnswers && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={reviewMarked} onChange={onToggleReview} className="size-4 accent-accent" />
              <Icon.Bookmark className="size-4" />
              {t("quiz.question.markForReview")}
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!showAnswers && !isFirst && (
            <Button variant="outline" onClick={onPrev} disabled={busy} leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />}>
              {t("quiz.question.previous")}
            </Button>
          )}
          {canCheck && (
            <Button variant="outline" onClick={onCheck} loading={checking} disabled={busy} leftIcon={<Icon.CheckCircle className="size-4" />}>
              {t("quiz.question.check")}
            </Button>
          )}
          {!isLast ? (
            <Button variant={canCheck ? "subtle" : "primary"} onClick={onNext} disabled={busy || checking} rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />}>
              {t("quiz.question.next")}
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={busy || checking} leftIcon={<Icon.Send className="size-4 rtl:-scale-x-100" />}>
              {t("quiz.submit.submit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
