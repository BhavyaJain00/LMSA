"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult, Rubric } from "@/lib/types";
import type { ReviewerOption, StaffReviewRow } from "@/lib/teaching/peer-review";
import {
  addPeerReviewerAction,
  allocatePeerReviewsNowAction,
  overridePeerReviewAction,
  reassignPeerReviewAction,
  remindPendingReviewersAction,
  removePeerReviewAction,
} from "@/lib/actions/peer-reviews";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Field, FormError, Select, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { submitWithoutReset } from "@/components/assessments/form-submit";
import { PEER_LIMITS } from "@/lib/teaching/peer-shared";
import { RubricScorer, selectionsFromScores, type RubricSelections } from "./rubric-scorer";
import { RubricView } from "./rubric-view";

export function PeerReviewStatusBadge({ status, overdue, overridden }: { status: "assigned" | "submitted"; overdue?: boolean; overridden?: boolean }) {
  if (status === "submitted") {
    return (
      <Badge tone={overridden ? "info" : "success"} dot>
        {overridden ? "Edited by instructor" : "Submitted"}
      </Badge>
    );
  }
  return (
    <Badge tone={overdue ? "danger" : "warning"} dot>
      {overdue ? "Overdue" : "Waiting"}
    </Badge>
  );
}

/** Read a submitted review: rubric scores and written feedback. */
function ViewDialog({ review, rubric, open, onClose, onEdit }: { review: StaffReviewRow; rubric: Rubric | null; open: boolean; onClose: () => void; onEdit: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Review by ${review.reviewer.name}`}
      description={`Of the submission by ${review.author.name}${review.overriddenBy ? ` · edited by ${review.overriddenBy}` : ""}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit} leftIcon={<Icon.Edit className="size-4" />}>
            Edit review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {rubric && review.scores.length > 0 && <RubricView rubric={rubric} scores={review.scores} headingLevel={4} />}
        {review.comment ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Feedback</p>
            <p className="whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">{review.comment}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No written feedback.</p>
        )}
      </div>
    </Dialog>
  );
}

/** Staff edit a review's scores and comment in place of the reviewer. */
function OverrideDialog({ review, rubric, open, onClose }: { review: StaffReviewRow; rubric: Rubric | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selections, setSelections] = useState<RubricSelections>(() => selectionsFromScores(review.scores));
  const [comment, setComment] = useState(review.comment);
  const [state, action, pending] = useActionState<ActionResult<{ status: "submitted" }> | null, FormData>(async (prev, formData) => {
    const res = await overridePeerReviewAction(prev, formData);
    if (res.ok) {
      toast({ title: res.message ?? "Review updated", tone: "success" });
      onClose();
      router.refresh();
    }
    return res;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const formId = `override-${review.id}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={review.status === "submitted" ? "Edit this peer review" : "Write this review as instructor"}
      description={`${review.reviewer.name} → ${review.author.name}. The learner sees the edited review; the reviewer can no longer change it.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending} leftIcon={<Icon.Check className="size-4" />}>
            Save review
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submitWithoutReset(action)} className="space-y-4" noValidate>
        <input type="hidden" name="reviewId" value={review.id} />
        <FormError message={state && !state.ok && !errors ? state.error : null} />
        {rubric && <RubricScorer rubric={rubric} value={selections} onChange={setSelections} error={errors?.rubric} outcomeLabels={{ pass: "Meets pass mark", fail: "Below pass mark" }} />}
        <Field label="Feedback" htmlFor={`${formId}-comment`} error={errors?.comment}>
          <Textarea id={`${formId}-comment`} name="comment" rows={5} maxLength={PEER_LIMITS.commentMax} value={comment} onChange={(e) => setComment(e.target.value)} invalid={!!errors?.comment} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Give an open review to another learner (chosen, or the lightest load automatically). */
function ReassignDialog({ review, options, authorId, open, onClose }: { review: StaffReviewRow; options: ReviewerOption[]; authorId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reviewerId, setReviewerId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choices = options.filter((o) => o.value !== authorId && o.value !== review.reviewer.id);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reassign review"
      description={`Currently with ${review.reviewer.name}. The new reviewer is notified and gets a fresh due date.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await reassignPeerReviewAction({ reviewId: review.id, reviewerId });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                toast({ title: res.message ?? "Review reassigned", tone: "success" });
                onClose();
                router.refresh();
              })
            }
          >
            Reassign
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="New reviewer" htmlFor={`reassign-${review.id}`} hint="Only learners who submitted this assignment can review it.">
          <Select id={`reassign-${review.id}`} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">Automatic: classmate with the fewest reviews</option>
            {choices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** Menu of instructor actions for one review. */
export function PeerReviewRowActions({ review, rubric, reviewerOptions, authorId }: { review: StaffReviewRow; rubric: Rubric | null; reviewerOptions: ReviewerOption[]; authorId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<"view" | "override" | "reassign" | "remove" | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Dropdown
        trigger={
          <span className={buttonClasses({ variant: "ghost", size: "icon-sm" })}>
            <Icon.MoreHorizontal className="size-4" aria-hidden="true" />
            <span className="sr-only">
              Actions for the review by {review.reviewer.name} of {review.author.name}
            </span>
          </span>
        }
        items={[
          ...(review.status === "submitted" ? [{ label: "View review", icon: <Icon.Eye />, onClick: () => setDialog("view") }] : []),
          { label: review.status === "submitted" ? "Edit review" : "Write review as instructor", icon: <Icon.Edit />, onClick: () => setDialog("override") },
          { label: "Reassign", icon: <Icon.Refresh />, onClick: () => setDialog("reassign"), disabled: review.status !== "assigned", description: review.status !== "assigned" ? "Only open reviews" : undefined },
          { label: "Remove", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setDialog("remove") },
        ]}
      />
      {dialog === "view" && <ViewDialog review={review} rubric={rubric} open onClose={() => setDialog(null)} onEdit={() => setDialog("override")} />}
      {dialog === "override" && <OverrideDialog review={review} rubric={rubric} open onClose={() => setDialog(null)} />}
      {dialog === "reassign" && <ReassignDialog review={review} options={reviewerOptions} authorId={authorId} open onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "remove"}
        onClose={() => setDialog(null)}
        title="Remove this review?"
        description={
          review.status === "submitted"
            ? "The review and its scores are deleted and the learner no longer sees them. Another classmate is assigned in its place when one is available; this reviewer is not paired with this work again."
            : "The reviewer no longer has to write it and is not paired with this work again. Another classmate is assigned in its place when one is available."
        }
        confirmLabel="Remove"
        destructive
        loading={pending}
        onConfirm={() =>
          start(async () => {
            const res = await removePeerReviewAction(review.id);
            toast({ title: res.ok ? (res.message ?? "Review removed") : res.error, tone: res.ok ? "success" : "error" });
            if (res.ok) {
              setDialog(null);
              router.refresh();
            }
          })
        }
      />
    </>
  );
}

/** Add one more reviewer to a submission. */
export function AddReviewerForm({ submissionId, options, exclude, onAdded }: { submissionId: string; options: ReviewerOption[]; exclude: string[]; onAdded?: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reviewerId, setReviewerId] = useState("");
  const [pending, start] = useTransition();
  const skip = new Set(exclude);
  const choices = options.filter((o) => !skip.has(o.value));
  if (!choices.length) return <p className="text-xs text-ink-muted">Every classmate who submitted is already reviewing this work.</p>;
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reviewerId) return;
        start(async () => {
          const res = await addPeerReviewerAction({ submissionId, reviewerId });
          toast({ title: res.ok ? (res.message ?? "Reviewer added") : res.error, tone: res.ok ? "success" : "error" });
          if (res.ok) {
            setReviewerId("");
            onAdded?.();
            router.refresh();
          }
        });
      }}
    >
      <label htmlFor={`add-reviewer-${submissionId}`} className="sr-only">
        Add a reviewer
      </label>
      <Select id={`add-reviewer-${submissionId}`} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className="sm:min-w-64">
        <option value="">Add a reviewer…</option>
        {choices.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline" disabled={!reviewerId} loading={pending} leftIcon={<Icon.UserPlus className="size-4" />}>
        Add
      </Button>
    </form>
  );
}

/** Allocate now / remind / export actions for one assignment. */
export function PeerAssignmentToolbar({ assignmentId, open, openReviews }: { assignmentId: string; open: boolean; openReviews: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmAllocate, setConfirmAllocate] = useState(false);
  const [pending, start] = useTransition();
  const [reminding, startRemind] = useTransition();
  const allocate = () =>
    start(async () => {
      const res = await allocatePeerReviewsNowAction(assignmentId);
      toast({ title: res.ok ? (res.message ?? "Done") : res.error, tone: res.ok ? "success" : "error" });
      setConfirmAllocate(false);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => (open ? allocate() : setConfirmAllocate(true))} loading={pending} leftIcon={<Icon.Users className="size-4" />}>
        {open ? "Assign missing reviews" : "Hand out reviews now"}
      </Button>
      <Button
        variant="outline"
        disabled={!openReviews}
        loading={reminding}
        onClick={() =>
          startRemind(async () => {
            const res = await remindPendingReviewersAction(assignmentId);
            toast({ title: res.ok ? (res.message ?? "Reminders sent") : res.error, tone: res.ok ? "success" : "error" });
            router.refresh();
          })
        }
        leftIcon={<Icon.Bell className="size-4" />}
      >
        Remind reviewers
      </Button>
      <a href={`/peer-reviews/manage/${assignmentId}/export`} download className={buttonClasses({ variant: "ghost" })}>
        <Icon.Download className="size-4" aria-hidden="true" />
        Export CSV
      </a>
      <ConfirmDialog
        open={confirmAllocate}
        onClose={() => setConfirmAllocate(false)}
        title="Hand out reviews before the deadline?"
        description="Reviews are normally handed out once the submission deadline passes. Handing them out now only includes learners who have already submitted; later submissions are added after the deadline."
        confirmLabel="Hand out now"
        loading={pending}
        onConfirm={allocate}
      />
    </div>
  );
}
