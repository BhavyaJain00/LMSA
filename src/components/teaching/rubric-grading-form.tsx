"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult, AssignmentStatus, Rubric, RubricScore } from "@/lib/types";
import { deleteAssignmentSubmissionsAction } from "@/lib/actions/assignments";
import { gradeWithRubricAction, type RubricGradeResult } from "@/lib/actions/rubrics";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { MarkdownEditor } from "@/components/assessments/markdown-editor";
import { AssignmentStatusBadge, NotSavedBadge } from "@/components/assessments/status-badges";
import { formatPoints, nearestLevelIndex, scoreRubric, type ScoreAverage } from "@/lib/teaching/rubric-shared";
import { RubricScorer, selectionList, selectionsFromScores, type RubricSelections } from "./rubric-scorer";

type GradeState = ActionResult<RubricGradeResult> | null;

/**
 * Grade a submission by clicking a level per criterion. The total and the
 * Pass/Fail outcome (from the rubric's pass mark) are computed live; a partly
 * scored rubric saves as a draft. Ctrl/Cmd+S saves.
 */
export function RubricGradingForm({
  submissionId,
  rubric,
  scores,
  comments: initialComments,
  status: initialStatus,
  graded,
  peerAverage,
  canDelete,
  nextHref,
}: {
  submissionId: string;
  rubric: Rubric;
  scores: RubricScore[] | undefined;
  comments: string;
  status: AssignmentStatus;
  /** The assignment is graded Pass/Fail (otherwise scores are feedback only). */
  graded: boolean;
  peerAverage: ScoreAverage | null;
  /** Moderators may delete the submission (with its scores and peer reviews). */
  canDelete: boolean;
  nextHref: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [selections, setSelections] = useState<RubricSelections>(() => selectionsFromScores(scores));
  const [comments, setComments] = useState(initialComments);
  const [saved, setSaved] = useState(() => ({ selections: JSON.stringify(selectionList(selectionsFromScores(scores))), comments: initialComments, status: initialStatus }));

  const [state, formAction, pending] = useActionState<GradeState, FormData>(async (prev, formData) => {
    const res = await gradeWithRubricAction(prev, formData);
    if (res.ok) {
      setSaved({ selections: String(formData.get("selections") ?? ""), comments: String(formData.get("comments") ?? "").trim(), status: res.data.status });
      toast({ title: res.message ?? "Saved", tone: "success" });
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const result = scoreRubric(rubric, selectionList(selections));
  const dirty = JSON.stringify(selectionList(selections)) !== saved.selections || comments.trim() !== saved.comments.trim();
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const hints: Record<string, string> = {};
  if (peerAverage) {
    for (const c of peerAverage.criteria) if (c.count) hints[c.criterionId] = `Peer average ${formatPoints(c.average)} pts (${c.count} ${c.count === 1 ? "review" : "reviews"})`;
  }
  const usePeerAverage = () => {
    if (!peerAverage) return;
    const next: RubricSelections = { ...selections };
    for (const c of peerAverage.criteria) {
      const criterion = rubric.criteria.find((x) => x.id === c.criterionId);
      if (!criterion || !c.count) continue;
      const li = nearestLevelIndex(criterion, c.average);
      if (li >= 0) next[criterion.id] = { levelIndex: li, comment: next[criterion.id]?.comment ?? "" };
    }
    setSelections(next);
  };

  const outcome = !result.complete ? null : graded ? (result.passed ? "pass" : "fail") : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-ink">Grade with rubric</h2>
          {dirty ? <NotSavedBadge /> : <AssignmentStatusBadge status={saved.status} />}
        </div>
        <Tooltip label="Save (Ctrl/⌘ + S)">
          <Button type="submit" loading={pending} disabled={!dirty} leftIcon={<Icon.Check className="size-4" />}>
            {result.complete ? "Save grade" : "Save draft"}
          </Button>
        </Tooltip>
      </div>
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : null} />
      {peerAverage && peerAverage.count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm">
          <p className="text-ink">
            Peer average: <span className="font-semibold">{formatPoints(peerAverage.total)}</span> / {formatPoints(peerAverage.max)} pts ({peerAverage.percent}%) from{" "}
            {peerAverage.count} {peerAverage.count === 1 ? "review" : "reviews"}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={usePeerAverage}>
            Start from peer average
          </Button>
        </div>
      )}
      <RubricScorer rubric={rubric} value={selections} onChange={setSelections} hints={hints} error={errors?.rubric} outcomeLabels={{ pass: "Pass", fail: "Fail" }} />
      <p className="text-xs text-ink-muted" aria-live="polite">
        {!result.complete
          ? `Score every criterion to grade. Saving now keeps a private draft (${rubric.criteria.length - result.missing.length} of ${rubric.criteria.length} scored).`
          : outcome
            ? `Saving grades this submission ${outcome === "pass" ? "Pass" : "Fail"} and notifies the learner.`
            : "This assignment is ungraded: the learner sees the scores as feedback."}
      </p>
      <div>
        <label htmlFor="rubric-comments" className="mb-1.5 block text-sm font-medium text-ink">
          Overall comments
        </label>
        <MarkdownEditor
          id="rubric-comments"
          name="comments"
          value={comments}
          onChange={setComments}
          rows={5}
          invalid={!!errors?.comments}
          placeholder="Summarize the strengths and the next steps…"
        />
        {errors?.comments && <p className="mt-1.5 text-xs text-danger">{errors.comments}</p>}
      </div>
      {(canDelete || nextHref) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {canDelete ? (
            <Button type="button" variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
              Delete submission
            </Button>
          ) : (
            <span />
          )}
          {nextHref && (
            <Link href={nextHref} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              Next to grade <Icon.ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          )}
        </div>
      )}
      {canDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this submission?"
          description="The learner's submission, its rubric scores, comments and any peer reviews of it will be permanently removed. They will be able to submit again."
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={() =>
            startDelete(async () => {
              const res = await deleteAssignmentSubmissionsAction([submissionId]);
              if (!res.ok) {
                toast({ title: res.error, tone: "error" });
                return;
              }
              toast({ title: "Submission deleted", tone: "success" });
              setConfirmDelete(false);
              router.push("/admin/assignments/submissions");
            })
          }
        />
      )}
    </form>
  );
}
