"use client";

import { useState } from "react";
import type { Question } from "@/lib/types";
import { duplicateQuestionAction, saveQuestionAction } from "@/lib/actions/questions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
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
        toast({ title: res.message ?? (isNew ? "Question created successfully" : "Question updated successfully"), tone: "success" });
        onSaved?.(res.data.question, isNew);
        onClose();
      } else {
        setServerErrors(res.fieldErrors ?? {});
        toast({ title: res.error || "Error saving question", tone: "error" });
      }
    } catch {
      toast({ title: "Error saving question", tone: "error" });
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
        toast({ title: "Question duplicated", description: "The copy is yours to edit.", tone: "success" });
        onSaved?.(res.data.question, true);
        onClose();
      } else toast({ title: res.error, tone: "error" });
    } catch {
      toast({ title: "Could not duplicate the question.", tone: "error" });
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => (saving ? undefined : onClose())}
      size="xl"
      title={isNew ? "New question" : canEdit ? "Edit question" : "View question"}
      description={!isNew && authorName ? `Written by ${authorName}` : undefined}
      footer={
        canEdit ? (
          <>
            {!isNew && (
              <Button variant="ghost" className="mr-auto" onClick={() => void duplicate()} loading={duplicating} leftIcon={<Icon.Copy className="size-4" />}>
                Duplicate
              </Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={attempted && !valid} leftIcon={<Icon.Check className="size-4" />}>
              Save
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => void duplicate()} loading={duplicating} leftIcon={<Icon.Copy className="size-4" />}>
              Duplicate to edit
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
            <Notice tone="info">Only the author or a moderator can edit this question. Duplicate it to make your own copy.</Notice>
            <QuestionReadOnly value={value} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
