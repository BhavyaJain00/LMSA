"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { createChapterAction, updateChapterAction } from "@/lib/actions/chapters";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { shortRuleLabel } from "@/components/learn/drip-shared";
import { ReleaseScheduleFields, draftErrors, draftRule, releaseDraftFrom, type ReleaseDraft } from "./release-schedule-fields";

export type ChapterDialogState =
  | { mode: "create" }
  | {
      mode: "edit";
      chapterId: string;
      title: string;
      description?: string;
      /** Current release schedule (drip). */
      dripDays?: number;
      availableFrom?: string;
    };

/** Add Chapter / Edit Chapter form in a dialog. Mount it with a `key` so each opening starts fresh. */
export function ChapterDialog({ courseId, state: dialog, onClose }: { courseId: string; state: ChapterDialogState | null; onClose: () => void }) {
  const toast = useToast();
  const editing = dialog?.mode === "edit";
  // Controlled fields so typed values survive a failed submission (React resets uncontrolled form fields after an action).
  const [title, setTitle] = useState(dialog?.mode === "edit" ? dialog.title : "");
  const [description, setDescription] = useState(dialog?.mode === "edit" ? (dialog.description ?? "") : "");
  const [release, setRelease] = useState<ReleaseDraft>(() =>
    releaseDraftFrom(dialog?.mode === "edit" ? { dripDays: dialog.dripDays, availableFrom: dialog.availableFrom } : null),
  );
  const [releaseOpen, setReleaseOpen] = useState(() => release.scheduled);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown> | null> => {
    const result = formData.get("chapterId") ? await updateChapterAction(null, formData) : await createChapterAction(null, formData);
    if (!result) return prev;
    if (result.ok) {
      toast.success(result.message ?? "Saved");
      onClose();
    } else if (result.fieldErrors?.dripDays || result.fieldErrors?.availableFrom) {
      setReleaseOpen(true);
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const releaseInvalid = Object.keys(draftErrors(release)).length > 0;
  const releaseLabel = release.scheduled ? shortRuleLabel(draftRule(release)) : null;

  return (
    <Dialog
      open={dialog !== null}
      onClose={() => !pending && onClose()}
      title={editing ? "Edit Chapter" : "Add Chapter"}
      description={editing ? undefined : "Chapters group related lessons. You can reorder them any time."}
    >
      <form
        action={formAction}
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          if (releaseInvalid) {
            e.preventDefault();
            setReleaseOpen(true);
            toast.error("Check the release schedule");
          }
        }}
      >
        <input type="hidden" name="courseId" value={courseId} />
        {dialog?.mode === "edit" && <input type="hidden" name="chapterId" value={dialog.chapterId} />}
        <FormError message={state && !state.ok && !errors.title && !errors.dripDays && !errors.availableFrom ? state.error : null} />
        <Field label="Title" htmlFor="chapter-title" required error={errors.title}>
          <Input
            id="chapter-title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="What learners will cover in this chapter"
            invalid={!!errors.description}
          />
        </Field>

        <details
          className="group rounded-xl border border-border"
          open={releaseOpen}
          onToggle={(e) => setReleaseOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Icon.Clock className="size-4 text-ink-muted" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">Release schedule</span>
            <Badge tone={releaseLabel ? "accent" : "neutral"} size="xs">
              {releaseLabel ?? "Immediately"}
            </Badge>
            <Icon.ChevronRight className="ms-auto size-4 text-ink-faint transition-transform group-open:rotate-90 rtl:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-border p-3 sm:p-4">
            <p className="mb-3 text-xs text-ink-muted">Drip this chapter: every lesson in it waits until the chapter is released. Lessons can add their own, later schedule.</p>
            <ReleaseScheduleFields
              idPrefix="chapter"
              subject="chapter"
              value={release}
              onChange={setRelease}
              errors={{ dripDays: errors.dripDays, availableFrom: errors.availableFrom }}
            />
          </div>
        </details>

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
