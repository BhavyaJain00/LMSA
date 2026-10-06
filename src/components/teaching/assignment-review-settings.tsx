"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { saveAssignmentReviewSettingsAction, type ReviewSettingsResult } from "@/lib/actions/peer-reviews";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { submitWithoutReset } from "@/components/assessments/form-submit";
import { NotSavedBadge } from "@/components/assessments/status-badges";
import { LocalDateTime } from "@/components/assessments/client-time";
import { PEER_LIMITS, isAnonymityLocked, type PeerConfig } from "@/lib/teaching/peer-shared";

/**
 * "Rubric & peer review" card on the assignment edit page: pick the rubric
 * used for grading and configure peer review (how many classmates review
 * each submission, how long they have, anonymity, completion rule).
 */
export function AssignmentReviewSettings({
  assignmentId,
  rubricOptions,
  rubricId: initialRubricId,
  peer,
  deadline,
  gradeAssignment,
  stats,
}: {
  assignmentId: string;
  rubricOptions: { value: string; label: string }[];
  rubricId: string | null;
  peer: PeerConfig;
  /** Submission deadline when scheduling is on (reviews are handed out after it). */
  deadline: string | null;
  gradeAssignment: boolean;
  stats: { assigned: number; completed: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rubricId, setRubricId] = useState(initialRubricId ?? "");
  const [enabled, setEnabled] = useState(peer.enabled);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<ActionResult<ReviewSettingsResult> | null, FormData>(async (prev, formData) => {
    const res = await saveAssignmentReviewSettingsAction(prev, formData);
    if (res.ok) {
      setDirty(false);
      toast({ title: res.message ?? "Review settings saved", tone: "success" });
      router.refresh();
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const anonymityLocked = isAnonymityLocked(peer, stats.assigned);

  return (
    <form onSubmit={submitWithoutReset(action)} onChange={() => setDirty(true)} noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Card>
        <CardHeader
          title="Rubric & peer review"
          description="Score submissions criterion by criterion and let classmates give each other feedback."
          actions={dirty ? <NotSavedBadge /> : undefined}
        />
        <CardBody className="space-y-5">
          <FormError message={state && !state.ok && !errors ? state.error : null} />
          <Field
            label="Rubric"
            htmlFor="review-rubric"
            error={errors?.rubricId}
            hint={
              rubricId
                ? gradeAssignment
                  ? "Graders click a level per criterion; Pass/Fail follows the rubric's pass mark. Learners see the rubric before submitting."
                  : "This assignment is ungraded: rubric scores are shared as feedback only."
                : "Without a rubric, graders choose Pass or Fail directly."
            }
          >
            <Select id="review-rubric" name="rubricId" value={rubricId} onChange={(e) => setRubricId(e.target.value)} invalid={!!errors?.rubricId}>
              <option value="">No rubric</option>
              {rubricOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {rubricId && (
              <Link href={`/admin/rubrics/${rubricId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                <Icon.Eye className="size-3.5" aria-hidden="true" /> View rubric
              </Link>
            )}
            <Link href="/admin/rubrics/new" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <Icon.Plus className="size-3.5" aria-hidden="true" /> New rubric
            </Link>
            <Link href="/admin/rubrics" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <Icon.ListChecks className="size-3.5" aria-hidden="true" /> All rubrics
            </Link>
          </div>

          <div className="space-y-4 border-t border-border pt-5">
            <Switch
              id="review-peer"
              name="peerEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              label="Peer review"
              description="Each learner who submits reviews classmates' work, using the rubric when there is one."
            />
            {enabled && (
              <div className="space-y-4 rounded-xl border border-border bg-surface-2/40 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Reviews per submission" htmlFor="review-count" error={errors?.reviewsPerSubmission} hint="Each learner also writes this many reviews.">
                    <Select id="review-count" name="reviewsPerSubmission" defaultValue={String(peer.reviewsPerSubmission)} invalid={!!errors?.reviewsPerSubmission}>
                      {Array.from({ length: PEER_LIMITS.reviewsMax - PEER_LIMITS.reviewsMin + 1 }, (_, i) => PEER_LIMITS.reviewsMin + i).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? "review" : "reviews"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Days to review" htmlFor="review-days" error={errors?.dueDays} hint="Counted from when a review is handed out.">
                    <Input
                      id="review-days"
                      name="dueDays"
                      type="number"
                      inputMode="numeric"
                      min={PEER_LIMITS.dueDaysMin}
                      max={PEER_LIMITS.dueDaysMax}
                      defaultValue={peer.dueDays}
                      invalid={!!errors?.dueDays}
                    />
                  </Field>
                </div>
                {anonymityLocked ? (
                  <>
                    {/* A disabled checkbox is not submitted: send the locked value explicitly. */}
                    <input type="hidden" name="anonymous" value="on" />
                    <Switch
                      id="review-anonymous"
                      checked
                      disabled
                      readOnly
                      label="Anonymous"
                      description="Reviewers and authors don't see each other's names. Instructors always do. Reviews were already handed out anonymously, so this stays on to keep that promise."
                    />
                  </>
                ) : (
                  <Switch
                    id="review-anonymous"
                    name="anonymous"
                    defaultChecked={peer.anonymous}
                    label="Anonymous"
                    description="Reviewers and authors don't see each other's names. Instructors always do."
                  />
                )}
                {errors?.anonymous && (
                  <p className="text-xs text-danger" role="alert">
                    {errors.anonymous}
                  </p>
                )}
                <Switch
                  id="review-required"
                  name="requiredForCompletion"
                  defaultChecked={peer.requiredForCompletion}
                  label="Count reviews toward lesson completion"
                  description="The lesson with this assignment is complete only after the learner submits their assigned reviews."
                />
                <p className="flex items-start gap-2 text-xs text-ink-muted">
                  <Icon.Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {deadline ? (
                    <span>
                      Reviews are handed out when submissions close on <LocalDateTime iso={deadline} />, so everyone who submitted is included.
                    </span>
                  ) : (
                    <span>Reviews are handed out as learners submit, spread evenly so nobody reviews much more than others. Set a schedule end above to hand them all out at once instead.</span>
                  )}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            {peer.enabled ? (
              <Link href={`/peer-reviews/manage/${assignmentId}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                Manage peer reviews ({stats.completed} of {stats.assigned} done) <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
            <Button type="submit" loading={pending} disabled={!dirty} leftIcon={<Icon.Check className="size-4" />}>
              Save review settings
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
