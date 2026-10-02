import Link from "next/link";
import type { SubmissionDetailData } from "@/lib/data/quiz";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { LearningI18n } from "@/components/learn/learning-i18n";
import { getFormatter, getT } from "@/i18n/server";
import { GradingForm } from "./grading-form";
import { LocalTime } from "./local-time";
import { ProctoringLog } from "./proctoring-log";
import { ResultBreakdown } from "./result-breakdown";
import { Notice, Stat, SubmissionStatusBadge } from "./shared";
import { formatPercent, formatScore, submissionReasonLabels, submissionStatus } from "./types";

/**
 * One quiz attempt: summary sidebar (learner, score, percentage, violations,
 * proctoring log) and the question-by-question breakdown. Graders get the
 * marks inputs for open-ended answers. Server component: it provides the
 * `learning` messages its client parts need, on the learner and admin pages.
 */
export async function SubmissionDetailView({ data, context }: { data: SubmissionDetailData; context: "admin" | "learner" }) {
  const { submission: s, learner, quiz, course } = data;
  const status = submissionStatus(s);
  const hasOpenEnded = s.results.some((r) => r.questionType === "open_ended");
  const [t, f] = await Promise.all([getT("learning"), getFormatter()]);
  // Stored reasons are the English labels of `submissionReasonLabels`.
  const reasonKey = (Object.keys(submissionReasonLabels) as (keyof typeof submissionReasonLabels)[]).find((k) => submissionReasonLabels[k] === s.submissionReason);
  const reason = reasonKey ? t(`quiz.reason.${reasonKey}`) : s.submissionReason;
  const deletedUser = t("quiz.detail.deletedUser");

  return (
    <LearningI18n slices={["quiz.", "quizAdmin.grading."]}>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <aside className="space-y-4 lg:order-last">
        <div className="rounded-card border border-border bg-surface-1 shadow-card">
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar name={learner?.name ?? deletedUser} src={learner?.avatarUrl} size="lg" />
            <div className="min-w-0">
              {learner && context === "admin" ? (
                <Link href={`/user/${learner.username}`} className="block truncate font-semibold text-ink hover:underline">
                  {learner.name}
                </Link>
              ) : (
                <p className="truncate font-semibold text-ink">{learner?.name ?? deletedUser}</p>
              )}
              {context === "admin" && learner?.email && <p className="truncate text-xs text-ink-muted">{learner.email}</p>}
              <p className="text-xs text-ink-muted">
                <LocalTime iso={s.submittedAt} />
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border px-4 py-4">
            <Stat label={t("quiz.detail.score")} value={s.pendingGrading ? "—" : `${formatScore(s.score)} / ${formatScore(s.scoreOutOf)}`} />
            <Stat label={t("quiz.detail.percentage")} value={s.pendingGrading ? "—" : formatPercent(s.percentage)} />
            {s.violationCount > 0 ? (
              <Stat label={t("quiz.detail.violations")} value={s.violationCount} tone="danger" />
            ) : (
              <Stat label={t("quiz.detail.passMark")} value={`${formatScore(s.passingPercentage)}%`} />
            )}
          </div>
          <dl className="space-y-2.5 border-t border-border px-4 py-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t("quiz.detail.status")}</dt>
              <dd>
                <SubmissionStatusBadge status={status} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t("quiz.detail.attempt")}</dt>
              <dd className="text-ink">
                {quiz && quiz.maxAttempts > 0
                  ? t("quiz.detail.attemptOfMax", { number: data.attemptNumber, used: data.attemptsUsed, max: quiz.maxAttempts })
                  : t("quiz.detail.attemptOf", { number: data.attemptNumber, used: data.attemptsUsed })}
              </dd>
            </div>
            {s.timeTakenSeconds > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t("quiz.detail.timeTaken")}</dt>
                <dd className="text-ink">{f.duration(s.timeTakenSeconds)}</dd>
              </div>
            )}
            {s.submissionReason && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">{t("quiz.detail.submitted")}</dt>
                <dd className="text-end text-ink">{reason}</dd>
              </div>
            )}
            {course && (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">{t("quiz.detail.course")}</dt>
                <dd className="min-w-0 text-end">
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
                  {t("quiz.detail.openLesson")}
                </ButtonLink>
              )}
              {context === "admin" && quiz && (
                <ButtonLink href={`/admin/quizzes/submissions?quiz=${quiz.id}`} size="sm" variant="ghost">
                  {t("quiz.detail.allSubmissions")}
                </ButtonLink>
              )}
              {context === "learner" && quiz && !data.lessonHref && (
                <ButtonLink href={`/quiz/${quiz.id}`} size="sm" variant="outline" leftIcon={<Icon.Refresh className="size-4" />}>
                  {t("quiz.detail.backToQuiz")}
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
            {t("quiz.detail.ownSubmission")}
          </Notice>
        )}
        {!data.revealed && <Notice tone="info">{t("quiz.detail.hidden")}</Notice>}
        {s.pendingGrading && !data.canGrade && (
          <Notice tone="warning" title={t("quiz.breakdown.awaiting")}>
            {t("quiz.detail.pendingBody")}
          </Notice>
        )}
        <div className="overflow-clip rounded-card border border-border bg-surface-1 shadow-card">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold text-ink">{quiz?.title ?? s.quizTitle}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {t("quiz.count.questions", { count: s.results.length })}
              {hasOpenEnded ? ` · ${t("quiz.detail.includesWritten")}` : ""}
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
    </LearningI18n>
  );
}
