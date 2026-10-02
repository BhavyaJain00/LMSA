"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteQuestionsAction, duplicateQuestionAction, saveQuestionAction } from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import { QuestionEditor, QuestionReadOnly } from "./question-editor";
import { Notice } from "./shared";
import { emptyQuestionInput, validateQuestionInput, type QuestionInput } from "./types";

/**
 * Full-page question editor (/admin/questions/new and /admin/questions/[id]):
 * save, duplicate and delete with an unsaved-changes guard.
 */
export function QuestionPageEditorView({
  initial,
  canEdit,
  usedIn,
  authorName,
}: {
  initial: QuestionInput | null;
  canEdit: boolean;
  usedIn: number;
  authorName?: string;
}) {
  const t = useT("learning");
  const tc = useT("common");
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState<QuestionInput>(() => initial ?? emptyQuestionInput());
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initial ?? emptyQuestionInput()));
  const [attempted, setAttempted] = useState(!!initial);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"duplicate" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isNew = !initial?.id;
  const validation = validateQuestionInput(value);
  const valid = Object.keys(validation).length === 0;
  const dirty = JSON.stringify(value) !== saved;

  useEffect(() => {
    if (!dirty || !canEdit) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, canEdit]);

  const save = async () => {
    setAttempted(true);
    if (!valid || saving) return;
    setSaving(true);
    setServerErrors({});
    try {
      const res = await saveQuestionAction(value);
      if (!res.ok) {
        setServerErrors(res.fieldErrors ?? {});
        toast({ title: res.error || t("quizAdmin.question.saveFailed"), tone: "error" });
        return;
      }
      toast({ title: isNew ? t("quizAdmin.question.created") : t("quizAdmin.question.updated"), tone: "success" });
      if (isNew) {
        setSaved(JSON.stringify(value));
        router.push(`/admin/questions/${res.data.question.id}`);
      } else {
        const next = { ...value, options: res.data.question.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, explanation: o.explanation ?? "" })), possibilities: [...res.data.question.possibilities] };
        setValue(next);
        setSaved(JSON.stringify(next));
        router.refresh();
      }
    } catch {
      toast({ title: t("quizAdmin.question.saveFailed"), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!initial?.id) return;
    setBusy("duplicate");
    try {
      const res = await duplicateQuestionAction(initial.id);
      if (res.ok) {
        toast({ title: t("quizAdmin.question.duplicated"), tone: "success" });
        router.push(`/admin/questions/${res.data.question.id}`);
      } else toast({ title: res.error, tone: "error" });
    } catch {
      toast({ title: t("quizAdmin.question.duplicateFailed"), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!initial?.id) return;
    setBusy("delete");
    try {
      const res = await deleteQuestionsAction([initial.id]);
      if (res.ok && res.data.deleted === 1) {
        toast({ title: t("quizAdmin.bank.deleted", { count: 1 }), tone: "success" });
        setSaved(JSON.stringify(value));
        router.push("/admin/questions");
      } else {
        const reason = res.ok ? res.data.failed[0]?.error : res.error;
        toast({ title: reason ? t("quizAdmin.bank.deleteError", { count: 1, error: reason }) : t("quizAdmin.question.deleteFailed"), tone: "error" });
        setConfirmDelete(false);
      }
    } catch {
      toast({ title: t("quizAdmin.question.deleteFailed"), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-card border border-border bg-surface-1 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{isNew ? t("quizAdmin.question.new") : canEdit ? t("quizAdmin.question.edit") : t("quizAdmin.editor.question")}</span>
          {!isNew && authorName && <span className="text-ink-muted">· {t("quizAdmin.question.by", { name: authorName })}</span>}
          {canEdit && dirty && (
            <Badge tone="warning" dot>
              {t("quizAdmin.grading.notSaved")}
            </Badge>
          )}
        </div>
        {!isNew && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void duplicate()} loading={busy === "duplicate"} leftIcon={<Icon.Copy className="size-4" />}>
              {t("quizAdmin.question.duplicate")}
            </Button>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:bg-danger/10"
                onClick={() => setConfirmDelete(true)}
                disabled={usedIn > 0}
                title={usedIn > 0 ? t("quizAdmin.question.inUseHint") : undefined}
                leftIcon={<Icon.Trash className="size-4" />}
              >
                {tc("actions.delete")}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-5">
        {canEdit ? (
          <QuestionEditor
            value={value}
            onChange={(next) => {
              setValue(next);
              if (Object.keys(serverErrors).length) setServerErrors({});
            }}
            errors={{ ...validation, ...serverErrors }}
            showErrors={attempted}
            usedIn={usedIn}
            autoFocus={isNew}
          />
        ) : (
          <div className="space-y-4">
            <Notice tone="info">{t("quizAdmin.question.readOnly")}</Notice>
            <QuestionReadOnly value={value} />
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-ink-muted">
            {usedIn > 0 ? t("quizAdmin.question.appliesEverywhere", { count: usedIn }) : t("quizAdmin.question.notUsed")}
          </p>
          <div className="flex items-center gap-2">
            <ButtonLink href="/admin/questions" variant="outline">
              {dirty ? tc("actions.cancel") : tc("actions.back")}
            </ButtonLink>
            <Button onClick={() => void save()} loading={saving} disabled={(attempted && !valid) || (!isNew && !dirty)} leftIcon={<Icon.Check className="size-4" />}>
              {isNew ? t("quizAdmin.question.create") : tc("actions.save")}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={busy === "delete"}
        destructive
        confirmLabel={tc("actions.delete")}
        title={t("quizAdmin.bank.confirmTitle", { count: 1 })}
        description={t("quizAdmin.question.confirmDeleteBody")}
      />
    </div>
  );
}
