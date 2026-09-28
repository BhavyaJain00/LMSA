import Link from "next/link";
import type { ExerciseSubmissionDetail } from "@/lib/data/assessments";
import { toExerciseSubmissionView, toRunnerExercise } from "@/lib/data/assessments";
import { Card, PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { ExerciseStatusBadge } from "./status-badges";
import { LocalDateTime } from "./client-time";
import { SubmissionReplay } from "./submission-replay";
import { LANGUAGE_LABELS } from "./shared";

/** Shared body of the learner and staff exercise-submission pages. */
export function ExerciseSubmissionDetailView({ detail, staff, owner, crumbs }: { detail: ExerciseSubmissionDetail; staff: boolean; owner: boolean; crumbs: Crumb[] }) {
  const { submission, exercise } = detail;
  const view = toExerciseSubmissionView(submission, exercise, { revealHidden: staff });
  const runner = exercise ? toRunnerExercise(exercise, { revealHidden: staff }) : null;
  const title = exercise?.title ?? submission.exerciseTitle;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={owner ? `Your submission: ${title}` : `${detail.user.name}'s submission`}
        description={exercise ? `${LANGUAGE_LABELS[exercise.language]} · ${exercise.testCases.length} test cases` : "This exercise has been deleted."}
        actions={
          <>
            {detail.lessonHref && (
              <ButtonLink href={detail.lessonHref} variant="outline" leftIcon={<Icon.BookOpen className="size-4" />}>
                Open lesson
              </ButtonLink>
            )}
            {owner && exercise && (
              <ButtonLink href={`/exercises/${exercise.id}`} leftIcon={<Icon.Code className="size-4" />}>
                Open in editor
              </ButtonLink>
            )}
            {staff && !owner && exercise && (
              <ButtonLink href={`/admin/exercises/${exercise.id}`} variant="ghost" leftIcon={<Icon.Edit className="size-4" />}>
                Edit exercise
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <Avatar name={detail.user.name} src={detail.user.avatarUrl} />
            <div className="min-w-0">
              {detail.user.username ? (
                <Link href={`/user/${detail.user.username}`} className="block truncate font-medium text-ink hover:underline">
                  {detail.user.name}
                </Link>
              ) : (
                <p className="truncate font-medium text-ink">{detail.user.name}</p>
              )}
              {staff && <p className="truncate text-xs text-ink-muted">{detail.user.email}</p>}
            </div>
          </div>
          <dl className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <ExerciseStatusBadge status={view.status} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Tests passed</dt>
              <dd className="font-medium text-ink">
                {view.passedCount} / {view.totalCount}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Submitted</dt>
              <dd className="text-right text-ink">
                <LocalDateTime iso={submission.submittedAt} />
              </dd>
            </div>
            {detail.course && (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Course</dt>
                <dd className="text-right">
                  <Link href={`/courses/${detail.course.slug}`} className="text-accent hover:underline">
                    {detail.course.title}
                  </Link>
                </dd>
              </div>
            )}
            {detail.lessonTitle && (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-ink-muted">Lesson</dt>
                <dd className="text-right text-ink">{detail.lessonTitle}</dd>
              </div>
            )}
          </dl>
          {staff && exercise && (
            <div className="p-4">
              <ButtonLink href={`/admin/exercises/submissions?exercise=${exercise.id}`} variant="ghost" size="sm" className="w-full" leftIcon={<Icon.ClipboardList className="size-4" />}>
                All submissions for this exercise
              </ButtonLink>
            </div>
          )}
        </Card>

        <Card className="min-w-0 p-5 sm:p-6">
          <SubmissionReplay
            code={submission.code}
            language={exercise?.language ?? "javascript"}
            storedResults={view.results}
            tests={runner?.tests ?? []}
            revealHidden={staff}
            allowRerun={!!runner && (staff || owner)}
          />
        </Card>
      </div>
    </div>
  );
}
