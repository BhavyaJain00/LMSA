"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult, AssignmentStatus } from "@/lib/types";
import { deleteAssignmentSubmissionsAction, gradeAssignmentAction } from "@/lib/actions/assignments";
import { Button } from "@/components/ui/button";
import { Field, FormError, Select } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { MarkdownEditor } from "./markdown-editor";
import { AssignmentStatusBadge, NotSavedBadge } from "./status-badges";
import { ASSIGNMENT_STATUS_OPTIONS } from "./shared";

type GradeState = ActionResult<{ status: AssignmentStatus }> | null;

/** Grade select + markdown comments for a submission (Ctrl/Cmd+S saves). */
export function GradingForm({
  submissionId,
  status: initialStatus,
  comments: initialComments,
  canDelete,
  nextHref,
}: {
  submissionId: string;
  status: AssignmentStatus;
  comments: string;
  canDelete: boolean;
  nextHref: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState({ status: initialStatus, comments: initialComments });
  const [status, setStatus] = useState<AssignmentStatus>(initialStatus);
  const [comments, setComments] = useState(initialComments);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  const [state, formAction, pending] = useActionState<GradeState, FormData>(async (prev, formData) => {
    const res = await gradeAssignmentAction(prev, formData);
    if (res.ok) {
      setSaved({ status: res.data.status, comments: String(formData.get("comments") ?? "").trim() });
      toast({ title: res.message ?? "Changes saved successfully", tone: "success" });
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);

  const dirty = status !== saved.status || comments.trim() !== saved.comments.trim();

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

  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-ink">Grading</h2>
          {dirty ? <NotSavedBadge /> : <AssignmentStatusBadge status={saved.status} />}
        </div>
        <Tooltip label="Save (Ctrl/⌘ + S)">
          <Button type="submit" loading={pending} disabled={!dirty} leftIcon={<Icon.Check className="size-4" />}>
            Save
          </Button>
        </Tooltip>
      </div>
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : null} />
      <Field label="Grade" htmlFor="grade-status" error={errors?.status}>
        <Select id="grade-status" name="status" value={status} onChange={(e) => setStatus(e.target.value as AssignmentStatus)} options={ASSIGNMENT_STATUS_OPTIONS} />
      </Field>
      <div>
        <label htmlFor="grade-comments" className="mb-1.5 block text-sm font-medium text-ink">
          Comments
        </label>
        <MarkdownEditor
          id="grade-comments"
          name="comments"
          value={comments}
          onChange={setComments}
          rows={7}
          invalid={!!errors?.comments}
          placeholder="What worked well, what to improve next time…"
        />
        {errors?.comments && <p className="mt-1.5 text-xs text-danger">{errors.comments}</p>}
        <p className="mt-1.5 text-xs text-ink-muted">The learner is notified when the grade or comments change.</p>
      </div>
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
            Next to grade <Icon.ArrowRight className="size-4" />
          </Link>
        )}
      </div>
      {canDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this submission?"
          description="The learner's submission, grade and comments will be permanently removed. They will be able to submit again."
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
