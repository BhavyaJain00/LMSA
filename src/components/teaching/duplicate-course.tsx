"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { duplicateCourseAction, getDuplicatePreviewAction, type DuplicatePreview } from "@/lib/actions/course-tools";
import { COURSE_TITLE_MAX } from "@/lib/teaching/course-copy";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { pluralize } from "@/lib/utils";

/**
 * "Duplicate course": a confirmation dialog listing what the copy contains,
 * with an editable title. The copy opens in the editor once it is made.
 */

type Preview = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: DuplicatePreview };

export function DuplicateCourseDialog({ courseId, open, onClose }: { courseId: string; open: boolean; onClose: () => void }) {
  return open ? <DuplicateCourseDialogBody courseId={courseId} onClose={onClose} /> : null;
}

function DuplicateCourseDialogBody({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDuplicatePreviewAction(courseId)
      .then((res) => {
        if (cancelled) return;
        setPreview(res.ok ? { status: "ready", data: res.data } : { status: "error", error: res.error });
      })
      .catch(() => !cancelled && setPreview({ status: "error", error: "The course could not be loaded. Check your connection and try again." }));
    return () => {
      cancelled = true;
    };
  }, [courseId, attempt]);

  const value = title ?? (preview.status === "ready" ? preview.data.suggestedTitle : "");

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await duplicateCourseAction(courseId, { title: value });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(res.message ?? "Course duplicated");
      onClose();
      router.push(res.data.editHref);
    });

  let body;
  if (preview.status === "loading") {
    body = (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  } else if (preview.status === "error") {
    body = (
      <div className="space-y-3">
        <FormError message={preview.error} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPreview({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
          leftIcon={<Icon.Refresh className="size-4" />}
        >
          Try again
        </Button>
      </div>
    );
  } else {
    const { counts, enrollments, hasSalesPage } = preview.data;
    const copied = [
      pluralize(counts.chapters, "chapter"),
      pluralize(counts.lessons, "lesson"),
      counts.quizzes ? pluralize(counts.quizzes, "quiz", "quizzes") + (counts.questions ? ` (${pluralize(counts.questions, "question")})` : "") : null,
      counts.assignments ? pluralize(counts.assignments, "assignment") : null,
      counts.exercises ? pluralize(counts.exercises, "exercise") : null,
      counts.transcripts ? pluralize(counts.transcripts, "transcript") : null,
    ].filter(Boolean);
    body = (
      <form
        id="duplicate-course-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError message={error} />
        <Field label="Title of the copy" htmlFor="duplicate-title" hint="You can change it later in the course details.">
          <Input id="duplicate-title" value={value} maxLength={COURSE_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </Field>
        <div className="rounded-xl border border-border bg-surface-2/50 p-3 text-sm">
          <p className="font-medium text-ink">Copied</p>
          <p className="mt-0.5 text-ink-muted">
            Details, settings, prices{hasSalesPage ? ", sales page" : ""} and {copied.join(", ")}. Quizzes, assignments and exercises are copied too, so editing them never changes the original.
          </p>
          <p className="mt-3 font-medium text-ink">Not copied</p>
          <p className="mt-0.5 text-ink-muted">
            {enrollments ? `${pluralize(enrollments, "enrolled learner")}, their` : "Learners,"} progress, submissions, reviews, discussions, announcements and certificates.
          </p>
        </div>
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Icon.Info className="mt-px size-4 shrink-0" />
          The copy starts as an unpublished draft with its own address. Submit it for review or publish it when it is ready.
        </p>
      </form>
    );
  }

  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      title="Duplicate course"
      description={preview.status === "ready" ? `Make an editable copy of “${preview.data.title}”.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="duplicate-course-form" loading={pending} disabled={preview.status !== "ready" || !value.trim()} leftIcon={<Icon.Copy className="size-4" />}>
            Duplicate
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

/** Card for the course settings: explains duplication and opens the dialog. */
export function DuplicateCourseCard({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Duplicate course" description="Start a new course from this one, for a new run, a translation or a variant." />
      <CardBody>
        <Button variant="outline" onClick={() => setOpen(true)} leftIcon={<Icon.Copy className="size-4" />} aria-haspopup="dialog">
          Duplicate course…
        </Button>
        <DuplicateCourseDialog courseId={courseId} open={open} onClose={() => setOpen(false)} />
      </CardBody>
    </Card>
  );
}
