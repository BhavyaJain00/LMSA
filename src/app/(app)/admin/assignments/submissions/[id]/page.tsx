import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isModerator, requireUser } from "@/lib/auth/session";
import { canManageAssessments, getAssignmentSubmissionDetail, listAssignmentSubmissions } from "@/lib/data/assessments";
import { Markdown } from "@/lib/markdown";
import { Card, PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { GradingForm } from "@/components/assessments/grading-form";
import { SubmissionAnswer } from "@/components/assessments/submission-answer";
import { LocalDateTime } from "@/components/assessments/client-time";
import { ASSIGNMENT_TYPE_LABELS } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Grade submission" };

export default async function GradeSubmissionPage(props: PageProps<"/admin/assignments/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/assignments/submissions/${id}`);
  if (!canManageAssessments(user)) redirect("/courses");
  const detail = await getAssignmentSubmissionDetail(id);
  if (!detail) notFound();

  const { submission, assignment } = detail;
  const title = assignment?.title ?? submission.assignmentTitle;
  const queue = await listAssignmentSubmissions({ status: "not_graded" });
  const next = queue.filter((s) => s.id !== submission.id).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Assignments", href: "/admin/assignments" },
              { label: "Submissions", href: `/admin/assignments/submissions?assignment=${submission.assignmentId}` },
              { label: title },
            ]}
          />
        }
        title={`Submission by ${detail.user.name}`}
        description={`Assignment: ${title}`}
        actions={
          <>
            {detail.lessonHref && (
              <ButtonLink href={detail.lessonHref} variant="outline" leftIcon={<Icon.BookOpen className="size-4" />}>
                Open lesson
              </ButtonLink>
            )}
            {assignment && (
              <ButtonLink href={`/admin/assignments/${assignment.id}`} variant="ghost" leftIcon={<Icon.Edit className="size-4" />}>
                Edit assignment
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-3 flex flex-wrap items-center gap-2 font-semibold text-ink">
              Answer
              <Badge tone="outline">{ASSIGNMENT_TYPE_LABELS[submission.type]}</Badge>
            </h2>
            <SubmissionAnswer type={submission.type} answer={submission.answer} attachmentUrl={submission.attachmentUrl} />
          </Card>
          <Card className="p-5 sm:p-6">
            <details open className="group">
              <summary className="flex cursor-pointer select-none items-center justify-between font-semibold text-ink">
                Assignment: {title}
                <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4">
                {assignment ? <Markdown content={assignment.question} /> : <p className="text-sm italic text-ink-muted">This assignment has been deleted.</p>}
              </div>
            </details>
            {assignment?.showAnswer && assignment.answer && (
              <div className="mt-5 rounded-xl border border-success/30 bg-success/5 p-4">
                <p className="mb-2 text-sm font-semibold text-ink">Model answer</p>
                <Markdown content={assignment.answer} className="text-sm" />
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="divide-y divide-border">
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
                <p className="truncate text-xs text-ink-muted">{detail.user.email}</p>
              </div>
            </div>
            <dl className="space-y-2.5 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Submitted</dt>
                <dd className="text-right text-ink">
                  <LocalDateTime iso={submission.submittedAt} />
                </dd>
              </div>
              {submission.updatedAt !== submission.submittedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Last updated</dt>
                  <dd className="text-right text-ink">
                    <LocalDateTime iso={submission.updatedAt} />
                  </dd>
                </div>
              )}
              {detail.evaluator && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Evaluator</dt>
                  <dd className="text-right text-ink">{detail.evaluator.name}</dd>
                </div>
              )}
              {submission.gradedAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Graded</dt>
                  <dd className="text-right text-ink">
                    <LocalDateTime iso={submission.gradedAt} />
                  </dd>
                </div>
              )}
              {detail.course && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Course</dt>
                  <dd className="text-right">
                    <Link href={`/courses/${detail.course.slug}`} className="text-accent hover:underline">
                      {detail.course.title}
                    </Link>
                  </dd>
                </div>
              )}
              {detail.lessonTitle && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Lesson</dt>
                  <dd className="text-right text-ink">{detail.lessonTitle}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card className="p-5 sm:p-6">
            {submission.userId === user.id && (
              <p className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
                <Icon.Info className="mt-0.5 size-3.5 shrink-0" />
                This is your own submission. Grading it will not set you as the evaluator.
              </p>
            )}
            <GradingForm
              submissionId={submission.id}
              status={submission.status}
              comments={submission.comments ?? ""}
              canDelete={isModerator(user)}
              nextHref={next ? `/admin/assignments/submissions/${next.id}` : null}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
