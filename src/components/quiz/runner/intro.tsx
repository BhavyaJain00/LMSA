"use client";

import type { ReactNode } from "react";
import { Markdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/icons";
import { cn, formatDuration, pluralize } from "@/lib/utils";
import { QuizIcon } from "../icons";
import { LocalTime } from "../local-time";
import { formatScore, type RunnerMode, type RunnerQuiz, type ScheduleState } from "../types";

function Chip({ icon, children, tone = "neutral" }: { icon: ReactNode; children: ReactNode; tone?: "neutral" | "info" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "info" && "bg-info/12 text-info",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "neutral" && "bg-surface-2 text-ink-muted",
      )}
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {children}
    </span>
  );
}

function Tip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm text-ink-muted">
      <span className="mt-0.5 shrink-0 text-ink-faint [&>svg]:size-4">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Rule({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted [&>svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-muted">{description}</span>
      </span>
    </li>
  );
}

export interface QuizIntroProps {
  quiz: RunnerQuiz;
  mode: RunnerMode;
  inVideo?: boolean;
  schedule: ScheduleState;
  attemptsUsed: number;
  canManage: boolean;
  loadingQuestions: boolean;
  latestPending: boolean;
  startError?: string | null;
  onStart: () => void;
}

export function QuizIntro({ quiz, mode, inVideo, schedule, attemptsUsed, canManage, loadingQuestions, latestPending, startError, onStart }: QuizIntroProps) {
  const live = mode === "live";
  const exhausted = live && quiz.maxAttempts > 0 && attemptsUsed >= quiz.maxAttempts;
  const scheduleClosed = schedule.state !== "open";
  const scheduleBlocked = live && scheduleClosed && !canManage;
  const noQuestions = quiz.poolSize === 0;
  const proctored = live && quiz.enableProctoring;
  const canStart = !exhausted && !scheduleBlocked && !noQuestions && !loadingQuestions;
  const remaining = quiz.maxAttempts > 0 ? Math.max(0, quiz.maxAttempts - attemptsUsed) : null;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="px-5 pb-5 pt-6 text-center sm:px-8">
          {mode === "preview" && (
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-2.5 py-1 text-xs font-medium text-accent">
              <Icon.Eye className="size-3.5" />
              Preview · attempts are not saved
            </span>
          )}
          <h2 className="text-xl font-semibold tracking-tight text-ink">{quiz.title}</h2>
          {quiz.courseTitle && <p className="mt-1 text-sm text-ink-muted">{quiz.courseTitle}</p>}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Chip icon={<Icon.ListChecks />}>{pluralize(quiz.questionCount, "question")}</Chip>
            <Chip icon={<Icon.Hash />}>{pluralize(quiz.totalMarks, "mark")}</Chip>
            <Chip icon={<Icon.Target />}>Passing score: {formatScore(quiz.passingPercentage)}%</Chip>
            {quiz.maxAttempts > 0 && <Chip icon={<Icon.Refresh />}>{pluralize(quiz.maxAttempts, "attempt")}</Chip>}
            {quiz.durationSeconds > 0 && (
              <Chip icon={<Icon.Timer />} tone="info">
                {formatDuration(quiz.durationSeconds)}
              </Chip>
            )}
            {quiz.enableProctoring && (
              <Chip icon={<Icon.ShieldCheck />} tone="warning">
                Proctored
              </Chip>
            )}
            {quiz.enableScheduling && quiz.scheduleStart && (
              <Chip icon={<Icon.Calendar />}>
                Opens: <LocalTime iso={quiz.scheduleStart} />
              </Chip>
            )}
            {quiz.enableScheduling && quiz.scheduleEnd && (
              <Chip icon={<QuizIcon.CalendarX />}>
                Closes: <LocalTime iso={quiz.scheduleEnd} />
              </Chip>
            )}
          </div>
        </div>

        {quiz.description && (
          <div className="border-t border-border px-5 py-4 sm:px-8">
            <Markdown content={quiz.description} className="text-sm" />
          </div>
        )}

        {canStart && !proctored && (
          <ul className="divide-y divide-border border-t border-border px-5 sm:px-8">
            {inVideo && <Tip icon={<Icon.Play />}>Complete the quiz to continue the video.</Tip>}
            {quiz.showAnswers ? (
              <Tip icon={<Icon.CheckCircle />}>Use &ldquo;Check&rdquo; to see whether each answer is right before moving on.</Tip>
            ) : (
              <>
                <Tip icon={<Icon.Bookmark />}>Use &ldquo;Mark for review&rdquo; to flag questions you want to revisit before submitting.</Tip>
                <Tip icon={<Icon.Send />}>Answer all questions before you submit. You can navigate freely between them.</Tip>
              </>
            )}
            {live && <Tip icon={<Icon.AlertTriangle />}>Closing or refreshing the page will submit your quiz automatically.</Tip>}
            {live && quiz.durationSeconds > 0 && <Tip icon={<Icon.Timer />}>The quiz will be submitted automatically when the timer runs out.</Tip>}
            {quiz.enableNegativeMarking && quiz.marksToCut > 0 && (
              <Tip icon={<QuizIcon.MinusCircle />}>Wrong answers deduct {pluralize(quiz.marksToCut, "mark")}.</Tip>
            )}
            {quiz.hasOpenEnded && <Tip icon={<QuizIcon.AlignLeft />}>Written answers are graded by your instructor after you submit.</Tip>}
          </ul>
        )}

        {canStart && proctored && (
          <div className="space-y-1 border-t border-border px-5 py-3 text-center text-sm text-ink-muted sm:px-8">
            {inVideo && (
              <p className="flex items-center justify-center gap-2">
                <Icon.Play className="size-4 text-ink-faint" />
                Complete the quiz to continue the video.
              </p>
            )}
            <p className="flex items-center justify-center gap-2">
              <Icon.AlertTriangle className="size-4 text-ink-faint" />
              Closing or refreshing the page will submit your quiz automatically.
            </p>
            {quiz.durationSeconds > 0 && (
              <p className="flex items-center justify-center gap-2">
                <Icon.Timer className="size-4 text-ink-faint" />
                The quiz will be submitted automatically when the timer runs out.
              </p>
            )}
            {quiz.enableNegativeMarking && quiz.marksToCut > 0 && (
              <p className="flex items-center justify-center gap-2">
                <QuizIcon.MinusCircle className="size-4 text-ink-faint" />
                Wrong answers deduct {pluralize(quiz.marksToCut, "mark")}.
              </p>
            )}
          </div>
        )}

        <div className="border-t border-border px-5 py-4 sm:px-8">
          {latestPending && !exhausted && (
            <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-center text-xs text-ink-muted">
              Your latest attempt is waiting for your instructor to grade it.
            </p>
          )}
          {scheduleClosed && (scheduleBlocked || canManage) && (
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-center text-sm",
                scheduleBlocked ? "border-warning/35 bg-warning/10 text-ink" : "border-border bg-surface-2 text-ink-muted",
              )}
              role="status"
            >
              {schedule.state === "not_started" ? (
                <>
                  This quiz opens on <LocalTime iso={schedule.opensAt} className="font-medium" />.
                </>
              ) : (
                "The schedule for this quiz has ended."
              )}
              {!scheduleBlocked && <span className="mt-1 block text-xs">Learners can&apos;t start it right now. You can, because you manage this quiz.</span>}
            </div>
          )}
          {noQuestions ? (
            <p className="text-center text-sm text-ink-muted">This quiz has no questions available yet.</p>
          ) : exhausted ? (
            <div className="rounded-lg border border-danger/30 bg-danger/8 px-4 py-3 text-center text-sm text-ink" role="status">
              You&apos;ve used all {pluralize(quiz.maxAttempts, "attempt")} for this quiz. Reach out to your instructor if you need to try again.
            </div>
          ) : scheduleBlocked ? null : (
            <div className={cn("flex flex-col items-center gap-2", scheduleClosed && "mt-3")}>
              {startError && (
                <p role="alert" className="text-center text-sm text-danger">
                  {startError}
                </p>
              )}
              <Button size="lg" onClick={onStart} disabled={!canStart} leftIcon={loadingQuestions ? <Spinner className="size-4" /> : <Icon.Play className="size-4" />}>
                {mode === "preview" ? "Start preview" : attemptsUsed > 0 ? "Start new attempt" : "Start Quiz"}
              </Button>
              <p className="text-xs text-ink-muted">
                {mode === "preview"
                  ? "Nothing is recorded in preview. The timer and proctoring are off."
                  : remaining !== null
                    ? `${attemptsUsed} of ${pluralize(quiz.maxAttempts, "attempt")} used · ${remaining} remaining`
                    : attemptsUsed > 0
                      ? `Unlimited attempts · ${attemptsUsed} used`
                      : "Unlimited attempts"}
                {proctored && " · The quiz opens in fullscreen"}
              </p>
            </div>
          )}
        </div>
      </div>

      {canStart && proctored && (
        <div className="rounded-card border border-border bg-surface-1 shadow-card">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold text-ink">Proctoring rules</h3>
            <p className="text-xs text-ink-muted">Your activity is monitored while the quiz is open.</p>
          </div>
          <ul className="divide-y divide-border px-5">
            <Rule icon={<QuizIcon.MonitorX />} title="Stay on this tab" description="Switching tabs or minimizing the window is flagged immediately." />
            <Rule icon={<Icon.Fullscreen />} title="Stay in fullscreen" description="The quiz opens in fullscreen. Leaving fullscreen is flagged." />
            <Rule icon={<Icon.EyeOff />} title="Keep the quiz focused" description="Clicking into other windows or apps is flagged." />
            <Rule icon={<Icon.Copy />} title="No copying or pasting" description="Copy, cut and paste are disabled and flagged." />
          </ul>
          <p className="flex items-start gap-2 rounded-b-card border-t border-warning/30 bg-warning/10 px-5 py-3 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            After {pluralize(quiz.maxViolations, "violation")}, the quiz will be automatically submitted.
          </p>
        </div>
      )}
    </div>
  );
}
