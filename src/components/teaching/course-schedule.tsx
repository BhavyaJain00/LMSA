"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getCourseScheduleAction, scheduleCoursePublishAction, scheduleLessonPublishAction } from "@/lib/actions/course-tools";
import { publishStateLabel, type CourseScheduleInfo } from "@/lib/teaching/schedule-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { LocalDateTime } from "@/components/assessments/client-time";
import { PublishAtPicker, isoToPicker, pickerToIso } from "./publish-at-picker";

/**
 * Scheduled publishing of a course: pick when it goes live (local time,
 * stored as UTC), change or cancel the schedule, and see the lessons that are
 * still hidden until their own publish time. Used as a card in the course
 * settings and as a dialog from the course list.
 */

type Load = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: CourseScheduleInfo };

function useCourseSchedule(courseId: string) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getCourseScheduleAction(courseId)
      .then((res) => !cancelled && setLoad(res.ok ? { status: "ready", data: res.data } : { status: "error", error: res.error }))
      .catch(() => !cancelled && setLoad({ status: "error", error: "The schedule could not be loaded. Check your connection and try again." }));
    return () => {
      cancelled = true;
    };
  }, [courseId, attempt]);
  return {
    load,
    set: (data: CourseScheduleInfo) => setLoad({ status: "ready", data }),
    retry: () => {
      setLoad({ status: "loading" });
      setAttempt((n) => n + 1);
    },
  };
}

function StateLine({ info }: { info: CourseScheduleInfo }) {
  const { state, publishAt } = info;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={state === "live" ? "success" : state === "held" ? "warning" : state === "draft" ? "neutral" : "info"} dot>
        {publishStateLabel(state)}
      </Badge>
      <span className="text-ink-muted">
        {state === "live" && "Learners can find and enroll in this course."}
        {state === "draft" && "Not published. Pick a time to publish it automatically."}
        {state === "due" && "The publish time has passed; the course is going live now."}
        {state === "scheduled" && publishAt && (
          <>
            Goes live on <LocalDateTime iso={publishAt} className="font-medium text-ink" />.
          </>
        )}
        {state === "held" && publishAt && (
          <>
            Planned for <LocalDateTime iso={publishAt} className="font-medium text-ink" />, but on hold until a moderator approves the course again.
          </>
        )}
      </span>
    </div>
  );
}

function ScheduledLessons({ info, onChanged }: { info: CourseScheduleInfo; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  if (!info.scheduledLessons.length) return null;
  const publishNow = (lessonId: string) =>
    start(async () => {
      setBusy(lessonId);
      const res = await scheduleLessonPublishAction(lessonId, null);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Lesson published");
      onChanged();
    });
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-ink">Lessons hidden until a set time</h3>
      <p className="mt-0.5 text-xs text-ink-muted">Schedule a lesson from its editor. Learners of a published course are notified when it appears.</p>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {info.scheduledLessons.map((row) => (
          <li key={row.lessonId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
            <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">{row.index}</span>
            <Link href={row.editHref} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
              {row.title}
            </Link>
            <LocalDateTime iso={row.publishAt} className="text-xs text-ink-muted" />
            <Button variant="ghost" size="xs" loading={busy === row.lessonId} disabled={!!busy} onClick={() => publishNow(row.lessonId)}>
              Publish now
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CourseSchedulePanel({ courseId }: { courseId: string }) {
  const router = useRouter();
  const toast = useToast();
  const { load, set, retry } = useCourseSchedule(courseId);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, start] = useTransition();

  if (load.status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-9 w-64" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div className="space-y-3">
        <FormError message={load.error} />
        <Button variant="outline" size="sm" onClick={retry} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
      </div>
    );
  }

  const info = load.data;
  const picker = value ?? isoToPicker(info.publishAt);
  const editable = info.canSchedule || (!!info.publishAt && info.state !== "live");

  const save = (publishAt: string | null) =>
    start(async () => {
      setError(null);
      const res = await scheduleCoursePublishAction(courseId, publishAt);
      if (!res.ok) {
        setError(res.fieldErrors?.publishAt ?? res.error);
        return;
      }
      set(res.data);
      setValue(null);
      setConfirmCancel(false);
      toast.success(res.message ?? "Schedule saved");
      router.refresh();
    });

  const submit = () => {
    const iso = pickerToIso(picker);
    if (!iso) {
      setError("Pick a date and time.");
      return;
    }
    save(iso);
  };

  return (
    <div className="space-y-4">
      <StateLine info={info} />
      {editable ? (
        <div className="space-y-3">
          <PublishAtPicker id={`publish-at-${courseId}`} value={picker} onChange={setValue} error={error} disabled={!info.canSchedule} />
          {!info.canSchedule && info.reason && <p className="text-xs text-ink-muted">{info.reason}</p>}
          <div className="flex flex-wrap gap-2">
            {info.canSchedule && (
              <Button size="sm" onClick={submit} loading={pending && !confirmCancel} disabled={!picker || (info.publishAt !== null && value === null)} leftIcon={<Icon.Calendar className="size-4" />}>
                {info.publishAt ? "Change publish time" : "Schedule publish"}
              </Button>
            )}
            {info.publishAt && (
              <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)} disabled={pending}>
                Cancel schedule
              </Button>
            )}
          </div>
        </div>
      ) : (
        info.reason && info.state !== "live" && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">{info.reason}</p>
      )}
      {info.canSchedule && (
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Icon.Info className="mt-px size-4 shrink-0" />
          <span>
            At that time the course is published exactly as if you pressed Publish
            {info.firstPublish && info.notifiesMembers ? ": members are told about the new course and search engines are pinged." : "."} If an instructor edits it after approval, it waits for a new approval.
          </span>
        </p>
      )}
      <ScheduledLessons info={info} onChanged={retry} />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => !pending && setConfirmCancel(false)}
        onConfirm={() => save(null)}
        loading={pending}
        title="Cancel the publish schedule?"
        description="The course stays unpublished until you publish it or schedule it again."
        confirmLabel="Cancel schedule"
        cancelLabel="Keep schedule"
        destructive
      />
    </div>
  );
}

/** Card for the course settings page. */
export function CourseScheduleCard({ courseId }: { courseId: string }) {
  return (
    <Card>
      <CardHeader title="Scheduled publishing" description="Publish the course automatically at a date and time you choose." />
      <CardBody>
        <CourseSchedulePanel courseId={courseId} />
      </CardBody>
    </Card>
  );
}

/** The schedule panel in a dialog (course list row menu). */
export function CourseScheduleDialog({ courseId, title, open, onClose }: { courseId: string; title: string; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title="Scheduled publishing" description={title} size="md">
      <CourseSchedulePanel courseId={courseId} />
    </Dialog>
  );
}

