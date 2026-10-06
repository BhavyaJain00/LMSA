"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Rubric } from "@/lib/types";
import type { ReviewerOption, StaffReviewRow, SubmissionCoverageRow } from "@/lib/teaching/peer-review";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { LocalDateTime } from "@/components/assessments/client-time";
import { AssignmentStatusBadge } from "@/components/assessments/status-badges";
import { formatPoints, rubricMaxPoints } from "@/lib/teaching/rubric-shared";
import { AddReviewerForm, PeerReviewRowActions, PeerReviewStatusBadge } from "./peer-review-admin";

const LIST_CLASS = "divide-y divide-border rounded-card border border-border bg-surface-1";

/** Every review of an assignment (instructor view): who reviews whom, state, score and the row actions. */
export function PeerReviewList({ rows, rubric, reviewerOptions }: { rows: StaffReviewRow[]; rubric: Rubric | null; reviewerOptions: ReviewerOption[] }) {
  const max = rubric ? rubricMaxPoints(rubric) : 0;
  return (
    <ul className={LIST_CLASS} aria-label="Peer reviews">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
              <span className="font-medium text-ink">{r.reviewer.name}</span>
              <Icon.ArrowRight className="size-3.5 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
              <span className="sr-only">reviews the work of</span>
              <Link href={`/admin/assignments/submissions/${r.submissionId}`} className="font-medium text-ink hover:underline">
                {r.author.name}
              </Link>
            </p>
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
            {r.status === "submitted" && r.comment && <p className="mt-1.5 line-clamp-2 break-words text-sm text-ink-muted">{r.comment}</p>}
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              {r.total !== null && rubric && (
                <span className="text-xs tabular-nums text-ink-muted">
                  {formatPoints(r.total)} / {formatPoints(max)} pts
                </span>
              )}
              <PeerReviewStatusBadge status={r.status} overdue={r.overdue} overridden={!!r.overriddenBy} />
            </div>
            <PeerReviewRowActions review={r} rubric={rubric} reviewerOptions={reviewerOptions} authorId={r.author.id} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Ratio({ label, done, total, children }: { label: string; done: number; total: number; children?: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-medium tabular-nums text-ink">
        {total === 0 ? <span className="font-normal text-ink-faint">None yet</span> : `${done} of ${total}`}
        {total > 0 && done === total && <Icon.CheckCircle className="size-3.5 text-success" aria-label="All done" />}
        {children}
      </dd>
    </div>
  );
}

/**
 * Learners who submitted (instructor view): the reviews each one received
 * and the reviews they owe, with a shortcut to add a reviewer.
 */
export function PeerCoverageList({ rows, reviewerOptions }: { rows: SubmissionCoverageRow[]; reviewerOptions: ReviewerOption[] }) {
  const [adding, setAdding] = useState<SubmissionCoverageRow | null>(null);
  return (
    <>
      <ul className={LIST_CLASS} aria-label="Learners who submitted">
        {rows.map((c) => (
          <li key={c.submissionId} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={c.author.name} src={c.author.avatarUrl} size="sm" />
              <div className="min-w-0">
                <Link href={`/admin/assignments/submissions/${c.submissionId}`} className="block truncate text-sm font-medium text-ink hover:underline">
                  {c.author.name}
                </Link>
                <p className="truncate text-xs text-ink-muted">
                  Submitted <LocalDateTime iso={c.submittedAt} mode="date" />
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 lg:w-80">
              <Ratio label="Reviews received" done={c.received.submitted} total={c.received.assigned} />
              <Ratio label="Reviews written" done={c.given.submitted} total={c.given.assigned}>
                {c.given.overdue > 0 && (
                  <Badge tone="danger" size="xs">
                    {c.given.overdue} overdue
                  </Badge>
                )}
              </Ratio>
            </dl>
            <div className="flex items-center justify-between gap-2 lg:w-64 lg:justify-end">
              <AssignmentStatusBadge status={c.grade} />
              <Button variant="outline" size="sm" onClick={() => setAdding(c)} leftIcon={<Icon.UserPlus className="size-4" />}>
                Add reviewer
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {adding && (
        <Dialog
          open
          onClose={() => setAdding(null)}
          title="Add a reviewer"
          description={`One more classmate reviews the submission by ${adding.author.name}. They are notified and get the usual time to review.`}
        >
          <AddReviewerForm submissionId={adding.submissionId} options={reviewerOptions} exclude={[adding.author.id, ...adding.reviewerIds]} onAdded={() => setAdding(null)} />
        </Dialog>
      )}
    </>
  );
}
