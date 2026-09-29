"use client";

import { useState, useTransition } from "react";
import { setLessonReleaseAction } from "@/lib/actions/lessons";
import type { ReleaseRule } from "@/components/learn/drip-shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ReleaseScheduleFields, draftErrors, draftValues, releaseDraftFrom, serializeDraft, type ReleaseDraft } from "./release-schedule-fields";

export interface LessonReleaseTarget {
  lessonId: string;
  title: string;
  index: string;
  rule: ReleaseRule;
  chapter: { title: string; rule: ReleaseRule };
  /** Free preview lessons ignore day-based schedules. */
  preview: boolean;
}

/**
 * "Release schedule…" for one lesson, opened from the outline editor. Mount it
 * with a `key` per lesson so each opening starts from the saved schedule.
 */
export function LessonReleaseDialog({ target, enforceOrder, onClose }: { target: LessonReleaseTarget | null; enforceOrder?: boolean; onClose: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<ReleaseDraft>(() => releaseDraftFrom(target?.rule));
  const [baseline] = useState(() => serializeDraft(releaseDraftFrom(target?.rule)));
  const [serverErrors, setServerErrors] = useState<{ dripDays?: string; availableFrom?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = Object.keys(draftErrors(draft)).length > 0;
  const dirty = serializeDraft(draft) !== baseline;

  const save = () => {
    if (!target || invalid) return;
    setError(null);
    startTransition(async () => {
      const result = await setLessonReleaseAction(target.lessonId, draftValues(draft));
      if (result.ok) {
        toast.success(result.message ?? "Release schedule saved");
        onClose();
      } else {
        setServerErrors({ dripDays: result.fieldErrors?.dripDays, availableFrom: result.fieldErrors?.availableFrom });
        setError(result.error);
      }
    });
  };

  return (
    <Dialog
      open={target !== null}
      onClose={() => !pending && onClose()}
      title="Release schedule"
      description={target ? `Lesson ${target.index}: ${target.title}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending} disabled={invalid || !dirty} title={!dirty ? "No changes to save" : undefined}>
            Save schedule
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3">
          <FormError message={error} />
          <ReleaseScheduleFields
            idPrefix={`lesson-${target.lessonId}`}
            subject="lesson"
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setServerErrors({});
            }}
            errors={serverErrors}
            chapter={target.chapter}
            enforceOrder={enforceOrder}
            preview={target.preview}
            withInputs={false}
          />
        </div>
      )}
    </Dialog>
  );
}
