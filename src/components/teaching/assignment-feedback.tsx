import Link from "next/link";
import { after } from "next/server";
import { getDb } from "@/lib/db/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { LocalDateTime } from "@/components/assessments/client-time";
import { activePeerConfig } from "@/lib/teaching/peer-shared";
import { getPeerFeedback, runPeerReviewSweep, syncPeerAssignments } from "@/lib/teaching/peer-review";
import { formatPoints, rubricMaxPoints } from "@/lib/teaching/rubric-shared";
import { RubricView } from "./rubric-view";

/**
 * Shown under an assignment (lesson block and assignment page): the rubric
 * the work is graded with — scored once graded — and, when peer review is on,
 * the reviews the learner owes and the feedback classmates gave them.
 */
export async function AssignmentFeedback({ assignmentId, userId, privileged = false }: { assignmentId: string; userId: string | null; privileged?: boolean }) {
  const db = await getDb();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return null;
  const rubric = assignment.rubricId ? (db.rubrics.find((r) => r.id === assignment.rubricId) ?? null) : null;
  const peer = activePeerConfig(assignment);
  if (!rubric && !peer) return null;

  const submission = userId ? (db.assignmentSubmissions.find((s) => s.assignmentId === assignment.id && s.userId === userId) ?? null) : null;
  if (peer) {
    // A fresh submission joins peer review straight away; the throttled sweep (deadlines, reminders) runs after the response.
    if (submission) await syncPeerAssignments({ assignmentIds: [assignment.id] });
    after(() => runPeerReviewSweep());
  }

  const graded = submission && (submission.status === "pass" || submission.status === "fail");
  const scoresFinal =
    !!submission?.rubricScores?.length && (graded || (!assignment.gradeAssignment && rubric?.criteria.every((c) => submission.rubricScores!.some((s) => s.criterionId === c.id))));
  const feedback = peer && userId && !privileged ? await getPeerFeedback(userId, assignment.id, rubric) : null;

  return (
    <div className="space-y-4">
      {rubric &&
        (scoresFinal ? (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
              <Icon.ListChecks className="size-4 text-accent" aria-hidden="true" />
              Your rubric scores
            </h2>
            <RubricView rubric={rubric} scores={submission!.rubricScores} />
          </Card>
        ) : (
          <Card className="p-4 sm:p-5">
            <details className="group" open={privileged || undefined}>
              <summary className="flex cursor-pointer select-none items-center justify-between gap-2 font-semibold text-ink">
                <span className="flex items-center gap-2">
                  <Icon.ListChecks className="size-4 text-accent" aria-hidden="true" />
                  How this is graded
                  <Badge tone="outline">{formatPoints(rubricMaxPoints(rubric))} pts</Badge>
                </span>
                <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-4">
                <RubricView rubric={rubric} />
              </div>
            </details>
          </Card>
        ))}

      {peer && privileged && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <p className="flex items-center gap-2 text-ink">
            <Icon.Users className="size-4 text-accent" aria-hidden="true" />
            Peer review is on: {peer.reviewsPerSubmission} {peer.reviewsPerSubmission === 1 ? "review" : "reviews"} per submission
            {peer.anonymous ? ", anonymous" : ""}.
          </p>
          <ButtonLink href={`/peer-reviews/manage/${assignment.id}`} variant="outline" size="sm">
            Manage peer reviews
          </ButtonLink>
        </Card>
      )}

      {peer && !privileged && userId && feedback && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
            <Icon.Users className="size-4 text-accent" aria-hidden="true" />
            Peer review
          </h2>
          {!feedback.submitted ? (
            <p className="text-sm text-ink-muted">
              After you submit, you&apos;ll review {peer.reviewsPerSubmission} {peer.reviewsPerSubmission === 1 ? "classmate's" : "classmates'"} work
              {rubric ? " with this rubric" : ""} and receive feedback from classmates in return.
              {peer.anonymous ? " Reviews are anonymous." : ""}
              {peer.requiredForCompletion ? " The lesson counts as complete once your reviews are in." : ""}
              {feedback.deadline ? (
                <>
                  {" "}
                  Reviews are handed out when submissions close on <LocalDateTime iso={feedback.deadline} />.
                </>
              ) : null}
            </p>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-surface-2/40 p-3 text-sm">
                {feedback.toGive.pending > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-ink">
                      <span className="font-medium">
                        {feedback.toGive.pending} {feedback.toGive.pending === 1 ? "review" : "reviews"} to write
                      </span>
                      {feedback.toGive.nextDueAt && (
                        <span className="text-ink-muted">
                          {" "}
                          · next due <LocalDateTime iso={feedback.toGive.nextDueAt} />
                        </span>
                      )}
                    </p>
                    <ButtonLink href={feedback.toGive.nextReviewId ? `/peer-reviews/${feedback.toGive.nextReviewId}` : "/peer-reviews"} size="sm">
                      Start reviewing
                    </ButtonLink>
                  </div>
                ) : feedback.toGive.done > 0 ? (
                  <p className="flex items-center gap-2 text-ink">
                    <Icon.CheckCircle className="size-4 text-success" aria-hidden="true" />
                    You&apos;ve submitted all {feedback.toGive.done} of your reviews. Thank you!
                    <Link href="/peer-reviews" className="ml-auto text-accent hover:underline">
                      View
                    </Link>
                  </p>
                ) : !feedback.open && feedback.deadline ? (
                  <p className="text-ink-muted">
                    Your reviews will be handed out when submissions close on <LocalDateTime iso={feedback.deadline} />.
                  </p>
                ) : (
                  <p className="text-ink-muted">Your reviews will appear here as soon as classmates submit their work.</p>
                )}
                {peer.requiredForCompletion && feedback.toGive.pending > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                    <Icon.Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    This lesson is marked complete once you&apos;ve submitted your reviews.
                  </p>
                )}
              </div>

              <section aria-label="Feedback from classmates" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">Feedback from classmates</h3>
                  <span className="text-xs text-ink-muted">
                    {feedback.received.length} of {Math.max(feedback.assignedOnMine, feedback.received.length)} received
                  </span>
                </div>
                {feedback.average && (
                  <p className="rounded-xl bg-info/10 px-4 py-3 text-sm text-ink">
                    Peer average{" "}
                    <span className="font-semibold tabular-nums">
                      {formatPoints(feedback.average.total)} / {formatPoints(feedback.average.max)} pts
                    </span>{" "}
                    <span className="text-ink-muted">
                      ({feedback.average.percent}%) across {feedback.average.count} {feedback.average.count === 1 ? "review" : "reviews"}. Your instructor&apos;s grade may differ.
                    </span>
                  </p>
                )}
                {feedback.received.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    {feedback.assignedOnMine > 0
                      ? "Your reviewers are working on it. You'll get a notification when feedback arrives."
                      : "Reviewers haven't been assigned to your work yet."}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {feedback.received.map((r) => (
                      <li key={r.id} className="rounded-xl border border-border p-3 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-ink">{r.label}</p>
                          <p className="flex items-center gap-2 text-xs text-ink-muted">
                            {r.total !== null && rubric && (
                              <Badge tone="accent">
                                {formatPoints(r.total)} / {formatPoints(rubricMaxPoints(rubric))} pts
                              </Badge>
                            )}
                            <LocalDateTime iso={r.submittedAt} mode="date" />
                          </p>
                        </div>
                        {r.comment && <p className="mt-2 whitespace-pre-line break-words text-sm text-ink">{r.comment}</p>}
                        {rubric && r.scores.length > 0 && (
                          <details className="group mt-2">
                            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-accent">
                              Rubric scores <Icon.ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <RubricView rubric={rubric} scores={r.scores} showTotal={false} className="mt-3" headingLevel={4} />
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
