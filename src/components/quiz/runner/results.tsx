"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { QuizIcon } from "../icons";
import { LocalTime } from "../local-time";
import { ResultBreakdown } from "../result-breakdown";
import { SubmissionStatusBadge } from "../shared";
import {
  formatPercent,
  formatScore,
  submissionReasonLabels,
  submissionStatus,
  type AttemptSummary,
  type RunnerMode,
  type RunnerQuiz,
  type SubmitResult,
} from "../types";

export function AttemptHistory({ attempts, highlightId, linkable = true }: { attempts: AttemptSummary[]; highlightId?: string; linkable?: boolean }) {
  const total = attempts.length;
  const t = useT("learning");
  return (
    <section aria-labelledby="attempt-history" className="rounded-card border border-border bg-surface-1 shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 id="attempt-history" className="text-sm font-semibold text-ink">
          {t("quiz.history.title")}
        </h3>
        <span className="text-xs text-ink-muted">{t("quiz.count.attempts", { count: total })}</span>
      </div>
      {total === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-ink-muted">{t("quiz.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("quiz.history.number")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("quiz.history.date")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("quiz.history.score")}</th>
                <th className="hidden px-4 py-2 text-end font-medium sm:table-cell">{t("quiz.history.scoreOutOf")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("quiz.history.percentage")}</th>
                <th className="hidden px-4 py-2 text-start font-medium md:table-cell">{t("quiz.history.status")}</th>
                {linkable && (
                  <th className="px-4 py-2">
                    <span className="sr-only">{t("quiz.history.details")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attempts.map((a, i) => (
                <tr key={a.id} className={cn(a.id === highlightId && "bg-accent/5")}>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{total - i}</td>
                  <td className="px-4 py-2.5 text-ink">
                    <LocalTime iso={a.submittedAt} format="relative" />
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-ink">{a.pendingGrading ? "—" : formatScore(a.score)}</td>
                  <td className="hidden px-4 py-2.5 text-end tabular-nums text-ink-muted sm:table-cell">{formatScore(a.scoreOutOf)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-ink">{a.pendingGrading ? "—" : formatPercent(a.percentage)}</td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <SubmissionStatusBadge status={submissionStatus(a)} />
                  </td>
                  {linkable && (
                    <td className="px-4 py-2.5 text-end">
                      <Link href={`/quiz/submissions/${a.id}`} className="text-xs font-medium text-accent hover:underline">
                        {t("quiz.history.view")}
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export interface QuizResultsProps {
  quiz: RunnerQuiz;
  mode: RunnerMode;
  result: SubmitResult;
  attempts: AttemptSummary[];
  canRetake: boolean;
  onRetake: () => void;
  backHref?: string | null;
  backLabel?: string;
}

export function QuizResults({ quiz, mode, result, attempts, canRetake, onRetake, backHref, backLabel }: QuizResultsProps) {
  const [showBreakdown, setShowBreakdown] = useState(result.revealed);
  const s = result.submission;
  const maxViolations = s.submissionReason === submissionReasonLabels.max_violations;
  const timedOut = s.submissionReason === submissionReasonLabels.timer_expired;
  const tone = s.pendingGrading ? "warning" : s.passed ? "success" : "danger";
  const t = useT("learning");
  const f = useFormatter();

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        {maxViolations && (
          <div className="flex items-start gap-3 border-b border-danger/30 bg-danger/8 px-5 py-3" role="alert">
            <QuizIcon.ShieldX className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="text-sm">
              <p className="font-medium text-ink">{t("quiz.reason.max_violations")}</p>
              <p className="text-ink-muted">{t("quiz.results.maxViolationsBody", { count: quiz.maxViolations })}</p>
            </div>
          </div>
        )}
        {timedOut && (
          <div className="flex items-start gap-3 border-b border-warning/30 bg-warning/10 px-5 py-3" role="status">
            <Icon.Timer className="mt-0.5 size-5 shrink-0 text-warning" />
            <p className="text-sm text-ink">{t("quiz.results.timedOut")}</p>
          </div>
        )}
        {result.preview && (
          <div className="flex items-center gap-2 border-b border-border bg-accent/6 px-5 py-2.5 text-sm text-accent">
            <Icon.Eye className="size-4" />
            {t("quiz.results.previewBanner")}
          </div>
        )}

        <div className="flex flex-col items-center px-5 py-8 text-center sm:px-10">
          <h2 className="text-lg font-semibold text-ink">{t("quiz.results.title")}</h2>
          {s.pendingGrading ? (
            <>
              <span className="mt-5 flex size-16 items-center justify-center rounded-full bg-warning/15 text-warning">
                <Icon.Clock className="size-8" />
              </span>
              <p className="mt-4 max-w-md text-sm text-ink-muted">{t("quiz.results.pendingBody")}</p>
            </>
          ) : (
            <>
              <ProgressRing value={s.percentage} size={112} stroke={9} tone={s.passed ? "success" : "accent"} className="mt-5">
                <span className="text-2xl font-semibold tabular-nums">{formatPercent(s.percentage)}</span>
              </ProgressRing>
              <p className="mt-4 max-w-md text-sm text-ink-muted">
                {t.rich("quiz.results.scoreSummary", {
                  percent: Math.ceil(s.percentage),
                  score: formatScore(s.score),
                  total: formatScore(s.scoreOutOf),
                  b: (text) => <span className="font-semibold text-ink">{text}</span>,
                })}
              </p>
            </>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge tone={tone} size="md" dot>
              {s.pendingGrading ? t("quiz.results.pending") : s.passed ? t("quiz.results.passed") : t("quiz.results.notPassed")}
            </Badge>
            <Badge tone="neutral" size="md">
              {t("quiz.results.passMark", { percent: formatScore(quiz.passingPercentage) })}
            </Badge>
            {s.timeTakenSeconds > 0 && (
              <Badge tone="neutral" size="md">
                <Icon.Clock className="size-3.5" />
                {f.duration(s.timeTakenSeconds)}
              </Badge>
            )}
            {s.violationCount > 0 && (
              <Badge tone="danger" size="md">
                {t("quiz.count.violations", { count: s.violationCount })}
              </Badge>
            )}
          </div>
          {result.lessonCompleted && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <Icon.CheckCircleFilled className="size-4" />
              {t("quiz.results.lessonComplete")}
            </p>
          )}
          {!s.pendingGrading && !s.passed && !result.preview && (
            <p className="mt-3 text-xs text-ink-muted">{t("quiz.results.needToPass", { percent: formatScore(quiz.passingPercentage) })}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {canRetake && (
              <Button onClick={onRetake} leftIcon={<Icon.Refresh className="size-4" />}>
                {mode === "preview" ? t("quiz.results.restartPreview") : t("quiz.results.retake")}
              </Button>
            )}
            {backHref && (
              <ButtonLink href={backHref} variant={canRetake ? "outline" : "primary"} leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                {backLabel ?? t("quiz.results.backToLesson")}
              </ButtonLink>
            )}
            {!result.preview && (
              <ButtonLink href={`/quiz/submissions/${s.id}`} variant="ghost" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                {t("quiz.results.viewSubmission")}
              </ButtonLink>
            )}
          </div>
          {!canRetake && mode === "live" && quiz.maxAttempts > 0 && (
            <p className="mt-3 text-xs text-ink-muted">{t("quiz.results.usedAll", { count: quiz.maxAttempts })}</p>
          )}
        </div>
      </div>

      <section className="rounded-card border border-border bg-surface-1 shadow-card">
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-start"
        >
          <span>
            <span className="block text-sm font-semibold text-ink">{result.revealed ? t("quiz.results.answersExplained") : t("quiz.results.yourAnswers")}</span>
            {!result.revealed && <span className="block text-xs text-ink-muted">{t("quiz.results.answersHidden")}</span>}
          </span>
          <Icon.ChevronDown className={cn("size-4 text-ink-muted transition-transform", showBreakdown && "rotate-180")} />
        </button>
        {showBreakdown && (
          <div className="border-t border-border">
            <ResultBreakdown rows={result.breakdown} revealed={result.revealed} />
          </div>
        )}
      </section>

      {mode === "live" && quiz.showSubmissionHistory && <AttemptHistory attempts={attempts} highlightId={s.id} />}
    </div>
  );
}
