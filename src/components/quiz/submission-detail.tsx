import Link from "next/link";
import type { SubmissionDetailData } from "@/lib/data/quiz";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/utils";
import { GradingForm } from "./grading-form";
import { LocalTime } from "./local-time";
import { ProctoringLog } from "./proctoring-log";
import { ResultBreakdown } from "./result-breakdown";
import { Notice, Stat, SubmissionStatusBadge } from "./shared";
import { formatPercent, formatScore, submissionStatus } from "./types";

/**
 * One quiz attempt: summary sidebar (learner, score, percentage, violations,
 * proctoring log) and the question-by-question breakdown. Graders get the
 * marks inputs for open-ended answers.
 */
export function SubmissionDetailView({ data, context }: { data: SubmissionDetailData; context: "admin" | "learner" }) {
  const { submission: s, learner, quiz, course } = data;
  const status = submissionStatus(s);
  const hasOpenEnded = s.results.some((r) => r.questionType === "open_ended");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <aside className="space-y-4 lg:order-last">
        <div className="rounded-card border border-border bg-surface-1 shadow-card">
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar name={learner?.name ?? "Deleted user"} src={learner?.avatarUrl} size="lg" />
            <div className="min-w-0">
              {learner && context === "admin" ? (
                <Link href={`/user/${learner.username}`} className="block truncate font-semibold text-ink hover:underline">
                  {learner.name}
                </Link>
              ) : (
                <p className="truncate font-semibold text-ink">{learner?.name ?? "Deleted user"}</p>
              )}
              {context === "admin" && learner?.email && <p className="truncate text-xs text-ink-muted">{learner.email}</p>}
              <p className="text-xs text-ink-muted">
                <LocalTime iso={s.submittedAt} />
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border px-4 py-4">
            <Stat label="Score" value={s.pendingGrading ? "—" : `${formatScore(s.score)} / ${formatScore(s.scoreOutOf)}`} />
            <Stat label="Percentage" value={s.pendingGrading ? "—" : formatPercent(s.percentage)} />
            {s.violationCount > 0 ? <Stat label="Violations" value={s.violationCount} tone="danger" /> : <Stat label="Pass mark" value={`${formatScore(s.passingPercentage)}%`} />}
          </div>
          <dl className="space-y-2.5 border-t border-border px-4 py-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <SubmissionStatusBadge status={status} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Attempt</dt>
              <dd className="text-ink">
                {data.attemptNumber} of {data.attemptsUsed}
                {quiz && quiz.maxAttempts > 0 ? ` (max ${quiz.maxAttempts})` : ""}
              </dd>
            </div>
            {s.timeTakenSeconds > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Time taken</dt>
                <dd className="text-ink">{formatDuration(s.timeTakenSeconds)}</dd>
              </div>
            )}
            {s.submissionReason && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Submitted</dt>
                <dd className="text-right text-ink">{s.submissionReason}</dd>
              </div>
            )}
            {course && (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Course</dt>
                <dd className="min-w-0 text-right">
                  <Link href={`/courses/${course.slug}`} className="text-ink hover:underline">
                    {course.title}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
          {(data.lessonHref || (context === "admin" && quiz)) && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              {data.lessonHref && (
                <ButtonLink href={data.lessonHref} size="sm" variant="outline" leftIcon={<Icon.BookOpen className="size-4" />}>
                  Open lesson
                </ButtonLink>
              )}
              {context === "admin" && quiz && (
                <ButtonLink href={`/admin/quizzes/submissions?quiz=${quiz.id}`} size="sm" variant="ghost">
                  All submissions
                </ButtonLink>
              )}
              {context === "learner" && quiz && !data.lessonHref && (
                <ButtonLink href={`/quiz/${quiz.id}`} size="sm" variant="outline" leftIcon={<Icon.Refresh className="size-4" />}>
                  Back to quiz
                </ButtonLink>
              )}
            </div>
          )}
        </div>
        <ProctoringLog events={data.violations} violationCount={s.violationCount} />
      </aside>

      <div className="min-w-0 space-y-4">
        {data.isOwn && data.canManage && (
          <Notice tone="info" role="status">
            You cannot grade your own submission.
          </Notice>
        )}
        {!data.revealed && (
          <Notice tone="info">Correct answers and the marks for automatically graded questions are hidden for this quiz.</Notice>
        )}
        {s.pendingGrading && !data.canGrade && (
          <Notice tone="warning" title="Awaiting grading">
            Your instructor will review your written answers. You&apos;ll get a notification when your final score is ready.
          </Notice>
        )}
        <div className="overflow-clip rounded-card border border-border bg-surface-1 shadow-card">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold text-ink">{quiz?.title ?? s.quizTitle}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {s.results.length} {s.results.length === 1 ? "question" : "questions"}
              {hasOpenEnded ? " · includes written answers" : ""}
            </p>
          </div>
          {data.canGrade ? (
            <GradingForm submissionId={s.id} rows={data.breakdown} passingPercentage={s.passingPercentage} />
          ) : (
            <ResultBreakdown rows={data.breakdown} revealed={data.revealed} />
          )}
        </div>
      </div>
    </div>
  );
}
