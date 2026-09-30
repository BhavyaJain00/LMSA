"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { ActionResult, Rubric, RubricScore } from "@/lib/types";
import { submitPeerReviewAction } from "@/lib/actions/peer-reviews";
import { Button } from "@/components/ui/button";
import { FormError, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { submitWithoutReset } from "@/components/assessments/form-submit";
import { NotSavedBadge } from "@/components/assessments/status-badges";
import { PEER_LIMITS } from "@/lib/teaching/peer-shared";
import { RubricScorer, selectionsFromScores, type RubricSelections } from "./rubric-scorer";
import { RubricView } from "./rubric-view";

/**
 * A learner's review of a classmate's submission: the rubric (when the
 * assignment has one) plus written feedback. Read-only once locked.
 */
export function PeerReviewForm({
  reviewId,
  rubric,
  scores,
  comment: initialComment,
  submitted,
  locked,
  lockReason,
}: {
  reviewId: string;
  rubric: Rubric | null;
  scores: RubricScore[] | undefined;
  comment: string;
  submitted: boolean;
  locked: boolean;
  lockReason: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selections, setSelections] = useState<RubricSelections>(() => selectionsFromScores(scores));
  const [comment, setComment] = useState(initialComment);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<ActionResult<{ status: "submitted" }> | null, FormData>(async (prev, formData) => {
    const res = await submitPeerReviewAction(prev, formData);
    if (res.ok) {
      setDirty(false);
      toast({ title: res.message ?? "Review submitted", tone: "success" });
      if (!submitted) router.push("/peer-reviews");
      else router.refresh();
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (locked) {
    return (
      <div className="space-y-4">
        {lockReason && (
          <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
            <Icon.Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {lockReason}
          </p>
        )}
        {rubric && scores?.length ? <RubricView rubric={rubric} scores={scores} /> : null}
        {initialComment && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Your feedback</p>
            <p className="whitespace-pre-line break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">{initialComment}</p>
          </div>
        )}
      </div>
    );
  }

  const length = comment.trim().length;
  const left = rubric ? rubric.criteria.filter((c) => !selections[c.id]).length : 0;
  return (
    <form onSubmit={submitWithoutReset(action)} className="space-y-5" noValidate>
      <input type="hidden" name="reviewId" value={reviewId} />
      <FormError message={state && !state.ok && !errors ? state.error : null} />
      {rubric && (
        <section aria-labelledby="peer-rubric-heading" className="space-y-3">
          <h2 id="peer-rubric-heading" className="font-semibold text-ink">
            Score with the rubric
          </h2>
          <RubricScorer
            rubric={rubric}
            value={selections}
            onChange={(next) => {
              setSelections(next);
              setDirty(true);
            }}
            error={errors?.rubric}
            outcomeLabels={{ pass: "Meets the pass mark", fail: "Below the pass mark" }}
          />
        </section>
      )}
      <div>
        <label htmlFor="peer-comment" className="mb-1.5 block font-semibold text-ink">
          Your feedback
        </label>
        <p id="peer-comment-hint" className="mb-2 text-sm text-ink-muted">
          Name one thing that works well and one concrete way to improve. Be kind and specific.
        </p>
        <Textarea
          id="peer-comment"
          name="comment"
          rows={7}
          maxLength={PEER_LIMITS.commentMax}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setDirty(true);
          }}
          aria-describedby="peer-comment-hint peer-comment-count"
          invalid={!!errors?.comment}
          placeholder="What stood out? What would make it even better?"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-danger">{errors?.comment}</span>
          <span id="peer-comment-count" className={length < PEER_LIMITS.commentMin ? "text-ink-muted" : "text-success"}>
            {length < PEER_LIMITS.commentMin ? `${PEER_LIMITS.commentMin - length} more characters needed` : `${length} characters`}
          </span>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted">
          {left > 0 && `${left} ${left === 1 ? "criterion" : "criteria"} left to rate · `}
          {submitted ? "You can update your review until the instructor grades this work." : "Your classmate is notified when you submit."}
        </p>
        <div className="flex items-center gap-2">
          {dirty && <NotSavedBadge />}
          <Button type="submit" loading={pending} disabled={submitted && !dirty} leftIcon={<Icon.Send className="size-4" />}>
            {submitted ? "Update review" : "Submit review"}
          </Button>
        </div>
      </div>
    </form>
  );
}
