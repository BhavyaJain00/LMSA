import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { Markdown } from "@/lib/markdown";
import { getReviewerTask } from "@/lib/teaching/peer-review";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { LocalDateTime } from "@/components/assessments/client-time";
import { SubmissionAnswer } from "@/components/assessments/submission-answer";
import { ASSIGNMENT_TYPE_LABELS } from "@/components/assessments/shared";
import { PeerReviewForm } from "@/components/teaching/peer-review-form";

export const metadata: Metadata = { title: "Peer review" };

export default async function PeerReviewPage(props: PageProps<"/peer-reviews/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/peer-reviews/${id}`);
  const task = await getReviewerTask(id, user.id);
  if (!task) notFound();

  const { review, assignment, submission, rubric } = task;
  const submitted = review.status === "submitted";

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Peer reviews", href: "/peer-reviews" }, { label: assignment.title }]} />}
        title={`Review: ${assignment.title}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {task.courseTitle && <span>{task.courseTitle} ·</span>}
            {submitted ? (
              <Badge tone="success" dot>
                Submitted
              </Badge>
            ) : (
              <Badge tone={task.overdue ? "danger" : "warning"} dot>
                {task.overdue ? "Overdue" : "Due"} <LocalDateTime iso={task.dueAt} />
              </Badge>
            )}
            {task.config.anonymous && <Badge tone="outline">Anonymous</Badge>}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <h2 className="mb-3 flex flex-wrap items-center gap-2 font-semibold text-ink">
              Work by {task.authorLabel}
              <Badge tone="outline">{ASSIGNMENT_TYPE_LABELS[submission.type]}</Badge>
            </h2>
            <SubmissionAnswer type={submission.type} answer={submission.answer} attachmentUrl={submission.attachmentUrl} />
            <p className="mt-3 text-xs text-ink-muted">
              Submitted <LocalDateTime iso={submission.submittedAt} />
            </p>
          </Card>
          <Card className="p-5 sm:p-6">
            <details className="group">
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 font-semibold text-ink">
                The assignment
                <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-4">
                <Markdown content={assignment.question} />
              </div>
            </details>
          </Card>
        </div>
        <div className="min-w-0">
          <Card className="p-5 sm:p-6 lg:sticky lg:top-20">
            <PeerReviewForm
              reviewId={review.id}
              rubric={rubric}
              scores={review.scores}
              comment={review.comment}
              submitted={submitted}
              locked={task.locked}
              lockReason={task.lockReason}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
