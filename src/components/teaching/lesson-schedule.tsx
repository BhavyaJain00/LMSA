"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getLessonScheduleAction, scheduleLessonPublishAction } from "@/lib/actions/course-tools";
import type { LessonScheduleInfo } from "@/lib/teaching/schedule-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { LocalDateTime } from "@/components/assessments/client-time";
import { pluralize } from "@/lib/utils";
import { PublishAtPicker, isoToPicker, pickerToIso } from "./publish-at-picker";

/**
 * "Publishing" card of the lesson editor: hide a lesson from learners until a
 * date and time (picked in local time, stored as UTC), change that time, or
 * publish it right away. The schedule is saved on its own, independent of the
 * lesson's Save button. The card lives inside the editor's form, so it only
 * uses plain buttons (no nested form).
 */

type Load = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: LessonScheduleInfo };

export function LessonScheduleCard({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getLessonScheduleAction(lessonId)
      .then((res) => !cancelled && setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error", error: res.error }))
      .catch(() => !cancelled && setLoad({ status: "error", error: "The publish schedule could not be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [lessonId, attempt]);

  const save = (publishAt: string | null) =>
    start(async () => {
      setError(null);
      const res = await scheduleLessonPublishAction(lessonId, publishAt);
      setConfirmHide(null);
      if (!res.ok) {
        setError(res.fieldErrors?.publishAt ?? res.error);
        return;
      }
      setLoad({ status: "ready", data: res.data });
      setEditing(false);
      setValue(null);
      toast.success(res.message ?? "Saved");
      router.refresh();
    });

  let body;
  if (load.status === "loading") {
    body = (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  } else if (load.status === "error") {
    body = (
      <div className="space-y-2">
        <FormError message={load.error} />
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            setLoad({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          leftIcon={<Icon.Refresh className="size-3.5" />}
        >
          Try again
        </Button>
      </div>
    );
  } else {
    const info = load.data;
    const picker = value ?? isoToPicker(info.publishAt);
    const submit = () => {
      const iso = pickerToIso(picker);
      if (!iso) {
        setError("Pick a date and time.");
        return;
      }
      // Hiding a lesson learners already opened takes it away from them: confirm first.
      if (!info.hidden && info.openedCount > 0) setConfirmHide(iso);
      else save(iso);
    };
    body = (
      <div className="space-y-3">
        {info.hidden && info.publishAt ? (
          <div className="space-y-1">
            <Badge tone="info" dot>
              Scheduled
            </Badge>
            <p className="text-xs text-ink-muted">
              Hidden from learners until <LocalDateTime iso={info.publishAt} className="font-medium text-ink" />.
              {info.courseLive && info.learnerCount > 0 ? ` ${pluralize(info.learnerCount, "learner")} will be notified then.` : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Badge tone="success" dot>
              Visible
            </Badge>
            <p className="text-xs text-ink-muted">Learners see this lesson{info.courseLive ? "" : " once the course is published"}.</p>
          </div>
        )}
        <FormError message={!editing ? error : null} />
        {editing ? (
          <div className="space-y-3">
            <PublishAtPicker id={`lesson-publish-at-${lessonId}`} value={picker} onChange={setValue} error={error} label={info.hidden ? "New publish time" : "Hide until"} />
            <div className="flex flex-wrap gap-2">
              <Button size="xs" onClick={submit} loading={pending} disabled={!picker}>
                {info.hidden ? "Save time" : "Schedule"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setValue(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setEditing(true)} leftIcon={<Icon.Calendar className="size-3.5" />} disabled={pending}>
              {info.hidden ? "Change time" : "Schedule for later"}
            </Button>
            {info.hidden && (
              <Button size="xs" variant="ghost" onClick={() => save(null)} loading={pending}>
                Publish now
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={confirmHide !== null}
          onClose={() => !pending && setConfirmHide(null)}
          onConfirm={() => {
            if (confirmHide) save(confirmHide);
          }}
          loading={pending}
          title="Hide this lesson for now?"
          description={`${pluralize(info.openedCount, "learner has", "learners have")} already opened it. They will not see it again until the publish time.`}
          confirmLabel="Hide until then"
        />
      </div>
    );
  }

  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-semibold text-ink">Publishing</p>
      {body}
    </Card>
  );
}
