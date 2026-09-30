import Link from "next/link";
import type { SubmissionPeerPanel } from "@/lib/teaching/peer-review";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { LocalDateTime } from "@/components/assessments/client-time";
import { formatPoints, rubricMaxPoints } from "@/lib/teaching/rubric-shared";
import { RubricView } from "./rubric-view";
import { AddReviewerForm, PeerReviewRowActions, PeerReviewStatusBadge } from "./peer-review-admin";

/**
 * Instructor view of the peer reviews of one submission (on the grading
 * page): who reviews it, their scores and comments, with override, reassign,
 * remove and add-reviewer controls.
 */
export function SubmissionPeerReviews({ panel, submissionId, assignmentId }: { panel: SubmissionPeerPanel; submissionId: string; assignmentId: string }) {
  const { reviews, rubric, config } = panel;
  const submitted = reviews.filter((r) => r.status === "submitted").length;
  const max = rubric ? rubricMaxPoints(rubric) : 0;
  return (
    <Card>
      <CardHeader
        title="Peer reviews"
        description={`${submitted} of ${reviews.length} submitted · ${config.anonymous ? "anonymous to learners" : "names visible to learners"}`}
        actions={
          <Link href={`/peer-reviews/manage/${assignmentId}`} className="text-sm font-medium text-accent hover:underline">
            All reviews
          </Link>
        }
      />
      <CardBody className="space-y-4">
        {reviews.length === 0 ? (
          <p className="text-sm text-ink-muted">No classmate has been assigned to review this submission yet. Reviews are handed out once at least two learners have submitted.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start gap-3">
                  <Avatar name={r.reviewer.name} src={r.reviewer.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">{r.reviewer.name}</p>
                      <PeerReviewStatusBadge status={r.status} overdue={r.overdue} overridden={!!r.overriddenBy} />
                      {r.total !== null && rubric && (
                        <span className="text-xs tabular-nums text-ink-muted">
                          {formatPoints(r.total)} / {formatPoints(max)} pts
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {r.status === "submitted" && r.submittedAt ? (
                        <>
                          Submitted <LocalDateTime iso={r.submittedAt} />
                        </>
                      ) : (
                        <>
                          Due <LocalDateTime iso={r.dueAt} />
                        </>
                      )}
                      {r.overriddenBy && ` · edited by ${r.overriddenBy}`}
                    </p>
                  </div>
                  <PeerReviewRowActions review={r} rubric={rubric} reviewerOptions={panel.reviewerOptions} authorId={panel.authorId} />
                </div>
                {r.status === "submitted" && (
                  <details className="group mt-2">
                    <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-accent">
                      Show review <Icon.ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="mt-3 space-y-3">
                      {rubric && r.scores.length > 0 && <RubricView rubric={rubric} scores={r.scores} headingLevel={4} />}
                      {r.comment && <p className="whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">{r.comment}</p>}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        <AddReviewerForm submissionId={submissionId} options={panel.reviewerOptions} exclude={[panel.authorId, ...reviews.map((r) => r.reviewer.id)]} />
      </CardBody>
    </Card>
  );
}
