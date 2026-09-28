"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/types";
import { createChapterAction, updateChapterAction } from "@/lib/actions/chapters";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export type ChapterDialogState = { mode: "create" } | { mode: "edit"; chapterId: string; title: string; description?: string };

/** Add Chapter / Edit Chapter form in a dialog. Mount it with a `key` so each opening starts fresh. */
export function ChapterDialog({ courseId, state: dialog, onClose }: { courseId: string; state: ChapterDialogState | null; onClose: () => void }) {
  const toast = useToast();
  const editing = dialog?.mode === "edit";
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown> | null> => {
    const result = formData.get("chapterId") ? await updateChapterAction(null, formData) : await createChapterAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      toast.success(result.message ?? "Saved");
      onClose();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Dialog
      open={dialog !== null}
      onClose={() => !pending && onClose()}
      title={editing ? "Edit Chapter" : "Add Chapter"}
      description={editing ? undefined : "Chapters group related lessons. You can reorder them any time."}
    >
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="courseId" value={courseId} />
        {dialog?.mode === "edit" && <input type="hidden" name="chapterId" value={dialog.chapterId} />}
        <FormError message={state && !state.ok && !errors.title ? state.error : null} />
        <Field label="Title" htmlFor="chapter-title" required error={errors.title}>
          <Input
            id="chapter-title"
            name="title"
            defaultValue={dialog?.mode === "edit" ? dialog.title : ""}
            autoComplete="off"
            autoFocus
            maxLength={120}
            placeholder="e.g. Getting started"
            invalid={!!errors.title}
          />
        </Field>
        <Field label="Description" htmlFor="chapter-description" error={errors.description} hint="Optional. Shown under the chapter title in the course outline.">
          <Textarea
            id="chapter-description"
            name="description"
            rows={3}
            defaultValue={dialog?.mode === "edit" ? (dialog.description ?? "") : ""}
            maxLength={1000}
            placeholder="What learners will cover in this chapter"
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
