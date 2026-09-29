import type { ReactNode } from "react";
import { Markdown } from "@/lib/markdown";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { QuizIcon } from "./icons";
import { formatScore, type OptionOutcome, type ResultDetail, type ResultOption } from "./types";

/**
 * Question-by-question breakdown of a graded attempt. Works in Server and
 * Client Components (no hooks). `renderMarks` lets the grading form put an
 * input in the marks column.
 */

const outcomeStyles: Record<OptionOutcome, { row: string; icon: ReactNode; label: string }> = {
  correct: {
    row: "border-success/40 bg-success/8",
    icon: <Icon.CheckCircle className="size-4.5 text-success" />,
    label: "Your answer · correct",
  },
  missed: {
    row: "border-success/30 bg-surface-1",
    icon: <QuizIcon.MinusCircle className="size-4.5 text-success" />,
    label: "Correct answer",
  },
  wrong: {
    row: "border-danger/35 bg-danger/8",
    icon: <Icon.XCircle className="size-4.5 text-danger" />,
    label: "Your answer · incorrect",
  },
  untouched: {
    row: "border-border bg-surface-1",
    icon: <Icon.Circle className="size-4.5 text-ink-faint" />,
    label: "",
  },
};

export function OptionOutcomeList({ options }: { options: ResultOption[] }) {
  return (
    <ul className="space-y-2">
      {options.map((o) => {
        const style = outcomeStyles[o.outcome];
        return (
          <li key={o.id} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5", style.row)}>
            <span className="mt-0.5 shrink-0">{style.icon}</span>
            <div className="min-w-0 flex-1">
              <Markdown content={o.text} className="text-sm [&_p]:m-0" />
              {style.label && <p className="mt-0.5 text-xs font-medium text-ink-muted">{style.label}</p>}
              {o.explanation && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{o.explanation}</p>}
            </div>
            <span className="sr-only">{o.isCorrect ? "Correct option" : "Incorrect option"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function StatusDot({ row }: { row: ResultDetail }) {
  if (!row.graded) return <span className="inline-block size-2 shrink-0 rounded-full bg-warning" title="Awaiting grading" aria-label="Awaiting grading" />;
  if (row.marks === undefined) return null;
  const full = row.marks >= row.marksOutOf && row.marksOutOf > 0;
  const partial = !full && row.marks > 0;
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", full ? "bg-success" : partial ? "bg-warning" : "bg-danger")}
      title={full ? "Full marks" : partial ? "Partial marks" : "No marks"}
      aria-label={full ? "Full marks" : partial ? "Partial marks" : "No marks"}
    />
  );
}

function AnswerBlock({ row }: { row: ResultDetail }) {
  if (row.type === "choices" && row.options) return <OptionOutcomeList options={row.options} />;

  if (!row.answered) {
    return <p className="text-sm italic text-ink-faint">Not answered</p>;
  }

  if (row.type === "open_ended") {
    return (
      <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
        <Markdown content={row.answerTexts.join("\n\n")} className="text-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {row.answerTexts.map((a, i) => (
          <li key={i} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-ink">
            {a}
          </li>
        ))}
      </ul>
      {row.possibilities && row.possibilities.length > 0 && row.isCorrect === false && (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">Accepted answers:</span> {row.possibilities.join(", ")}
        </p>
      )}
    </div>
  );
}

export function ResultBreakdown({
  rows,
  revealed,
  renderMarks,
  className,
}: {
  rows: ResultDetail[];
  revealed: boolean;
  renderMarks?: (row: ResultDetail) => ReactNode;
  className?: string;
}) {
  if (!rows.length) {
    return <p className={cn("px-5 py-6 text-sm text-ink-muted", className)}>No questions were attempted in this submission.</p>;
  }
  return (
    <ol className={cn("divide-y divide-border", className)}>
      {rows.map((row) => {
        const custom = renderMarks?.(row);
        return (
          <li key={row.questionId} className="px-4 py-4 sm:px-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-6">
              <div className="min-w-0 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-sm font-medium text-ink-faint">Q{row.index}:</span>
                  <div className="min-w-0 flex-1">
                    <Markdown content={row.text} className="text-sm font-medium [&_p]:m-0" />
                  </div>
                  <span className="mt-1.5">
                    <StatusDot row={row} />
                  </span>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    {row.type === "choices" && row.options ? (row.multiple ? "Options (select all that apply)" : "Options") : "Answer"}
                  </p>
                  <AnswerBlock row={row} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end lg:justify-start">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint lg:hidden">Marks:</span>
                {custom ?? (
                  <>
                    {!row.graded ? (
                      <Badge tone="warning">Awaiting grading</Badge>
                    ) : row.marks !== undefined && (revealed || row.type === "open_ended") ? (
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatScore(row.marks)} <span className="font-normal text-ink-muted">/ {formatScore(row.marksOutOf)}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-ink-muted">{formatScore(row.marksOutOf)} max</span>
                    )}
                    {revealed && row.graded && row.isCorrect !== undefined && row.type !== "open_ended" && (
                      <Badge tone={row.isCorrect ? "success" : "danger"}>
                        {row.isCorrect ? <Icon.CheckCircle className="size-3.5" /> : <Icon.XCircle className="size-3.5" />}
                        {row.isCorrect ? "Correct" : row.answered ? "Incorrect" : "Unanswered"}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
