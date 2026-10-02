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
import { useT } from "@/i18n/client";

type GradeState = ActionResult<{ status: AssignmentStatus }> | null;

/** Grade select + markdown comments for a submission (Ctrl/Cmd+S saves). */
export function GradingFormView({
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
  const t = useT("learning");
  const tc = useT("common");
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
      toast({ title: t("assessAdmin.grading.saved"), tone: "success" });
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
          <h2 className="font-semibold text-ink">{t("assessAdmin.grading.title")}</h2>
          {dirty ? <NotSavedBadge /> : <AssignmentStatusBadge status={saved.status} />}
        </div>
        <Tooltip label={t("assessAdmin.grading.saveShortcut")}>
          <Button type="submit" loading={pending} disabled={!dirty} leftIcon={<Icon.Check className="size-4" />}>
            {tc("actions.save")}
          </Button>
        </Tooltip>
      </div>
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : null} />
      <Field label={t("assessAdmin.grading.grade")} htmlFor="grade-status" error={errors?.status}>
        <Select
          id="grade-status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
          options={ASSIGNMENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(`global.assess.status.${o.value}`) }))}
        />
      </Field>
      <div>
        <label htmlFor="grade-comments" className="mb-1.5 block text-sm font-medium text-ink">
          {t("assessAdmin.grading.comments")}
        </label>
        <MarkdownEditor
          id="grade-comments"
          name="comments"
          value={comments}
          onChange={setComments}
          rows={7}
          invalid={!!errors?.comments}
          placeholder={t("assessAdmin.grading.commentsPlaceholder")}
        />
        {errors?.comments && <p className="mt-1.5 text-xs text-danger">{errors.comments}</p>}
        <p className="mt-1.5 text-xs text-ink-muted">{t("assessAdmin.grading.notifyHint")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        {canDelete ? (
          <Button type="button" variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
            {t("assessAdmin.grading.deleteSubmission")}
          </Button>
        ) : (
          <span />
        )}
        {nextHref && (
          <Link href={nextHref} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            {t("assessAdmin.grading.next")} <Icon.ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        )}
      </div>
      {canDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={t("assessAdmin.exerciseSubmissions.confirmTitle", { count: 1 })}
          description={t("assessAdmin.grading.deleteBody")}
          confirmLabel={tc("actions.delete")}
          destructive
          loading={deleting}
          onConfirm={() =>
            startDelete(async () => {
              const res = await deleteAssignmentSubmissionsAction([submissionId]);
              if (!res.ok) {
                toast({ title: res.error, tone: "error" });
                return;
              }
              toast({ title: t("assessAdmin.grading.deleted"), tone: "success" });
              setConfirmDelete(false);
              router.push("/admin/assignments/submissions");
            })
          }
        />
      )}
    </form>
  );
}
