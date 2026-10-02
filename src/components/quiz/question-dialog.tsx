"use client";

import { useState } from "react";
import type { Question } from "@/lib/types";
import { duplicateQuestionAction, saveQuestionAction } from "@/lib/actions/questions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import { QuestionEditor, QuestionReadOnly } from "./question-editor";
import { Notice } from "./shared";
import { emptyQuestionInput, validateQuestionInput, type QuestionInput, type UiQuestionType } from "./types";

export interface QuestionDialogProps {
  open: boolean;
  onClose: () => void;
  /** The question to edit, or null to create a new one. */
  initial: QuestionInput | null;
  canEdit: boolean;
  authorName?: string;
  usedIn?: number;
  allowedTypes?: UiQuestionType[];
  onSaved?: (question: Question, created: boolean) => void;
}

/** "New question" / "Edit question" dialog around the QuestionEditor. Mount with a `key` per question. */
export function QuestionDialog({ open, onClose, initial, canEdit, authorName, usedIn, allowedTypes, onSaved }: QuestionDialogProps) {
  const t = useT("learning");
  const tc = useT("common");
  const { toast } = useToast();
  const [value, setValue] = useState<QuestionInput>(() => initial ?? emptyQuestionInput(allowedTypes?.[0] ?? "single"));
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const errors = { ...validateQuestionInput(value), ...serverErrors };
  const valid = Object.keys(validateQuestionInput(value)).length === 0;
  const isNew = !initial?.id;

  const save = async () => {
    setAttempted(true);
    if (!valid || saving) return;
    setSaving(true);
    setServerErrors({});
    try {
      const res = await saveQuestionAction(value);
      if (res.ok) {
        toast({ title: isNew ? t("quizAdmin.question.created") : t("quizAdmin.question.updated"), tone: "success" });
        onSaved?.(res.data.question, isNew);
        onClose();
      } else {
        setServerErrors(res.fieldErrors ?? {});
        toast({ title: res.error || t("quizAdmin.question.saveFailed"), tone: "error" });
      }
    } catch {
      toast({ title: t("quizAdmin.question.saveFailed"), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!initial?.id || duplicating) return;
    setDuplicating(true);
    try {
      const res = await duplicateQuestionAction(initial.id);
      if (res.ok) {
        toast({ title: t("quizAdmin.question.duplicated"), description: t("quizAdmin.question.duplicatedHint"), tone: "success" });
        onSaved?.(res.data.question, true);
        onClose();
      } else toast({ title: res.error, tone: "error" });
    } catch {
      toast({ title: t("quizAdmin.question.duplicateFailed"), tone: "error" });
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => (saving ? undefined : onClose())}
      size="xl"
      title={isNew ? t("quizAdmin.question.new") : canEdit ? t("quizAdmin.question.edit") : t("quizAdmin.question.view")}
      description={!isNew && authorName ? t("quizAdmin.question.writtenBy", { name: authorName }) : undefined}
      footer={
        canEdit ? (
          <>
            {!isNew && (
              <Button variant="ghost" className="me-auto" onClick={() => void duplicate()} loading={duplicating} leftIcon={<Icon.Copy className="size-4" />}>
                {t("quizAdmin.question.duplicate")}
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={attempted && !valid} leftIcon={<Icon.Check className="size-4" />}>
              {tc("actions.save")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {tc("actions.close")}
            </Button>
            <Button onClick={() => void duplicate()} loading={duplicating} leftIcon={<Icon.Copy className="size-4" />}>
              {t("quizAdmin.question.duplicateToEdit")}
            </Button>
          </>
        )
      }
    >
      <div className="md:min-h-[min(60vh,32rem)]">
        {canEdit ? (
          <QuestionEditor
            value={value}
            onChange={(next) => {
              setValue(next);
              if (Object.keys(serverErrors).length) setServerErrors({});
            }}
            errors={errors}
            showErrors={attempted}
            allowedTypes={allowedTypes}
            usedIn={usedIn}
            autoFocus
          />
        ) : (
          <div className="space-y-4">
            <Notice tone="info">{t("quizAdmin.question.readOnly")}</Notice>
            <QuestionReadOnly value={value} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
