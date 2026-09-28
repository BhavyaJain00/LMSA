"use client";

import { useState, useTransition } from "react";
import { deleteCourseAction } from "@/lib/actions/courses";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { pluralize } from "@/lib/utils";

export function DeleteCourseCard({
  courseId,
  title,
  counts,
}: {
  courseId: string;
  title: string;
  counts: { chapters: number; lessons: number; enrollments: number; reviews: number };
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toLowerCase() === title.trim().toLowerCase();

  const confirm = () => {
    startTransition(async () => {
      const res = await deleteCourseAction(courseId);
      // On success the action redirects to the course list.
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <section className="rounded-card border border-danger/40 bg-surface-1" aria-labelledby="danger-zone-title">
      <div className="border-b border-danger/30 px-5 py-4">
        <h3 id="danger-zone-title" className="text-base font-semibold text-danger">
          Danger zone
        </h3>
      </div>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-ink">Delete this course</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Removes {pluralize(counts.chapters, "chapter")}, {pluralize(counts.lessons, "lesson")}, {pluralize(counts.enrollments, "enrollment")} with their progress, and {pluralize(counts.reviews, "review")}. Quizzes, assignments and exercises are kept but unlinked.
          </p>
        </div>
        <Button variant="danger" onClick={() => setOpen(true)} leftIcon={<Icon.Trash className="size-4" />} className="shrink-0">
          Delete course
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          if (pending) return;
          setOpen(false);
          setTyped("");
        }}
        title="Delete Course"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={pending} disabled={!matches}>
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-ink-muted">Deleting the course will also delete all its chapters and lessons. Are you sure you want to delete this course?</p>
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-danger">This action cannot be undone.</p>
          <label className="block">
            <span className="mb-1.5 block text-ink">
              Type <strong className="font-semibold">{title}</strong> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Course title confirmation" />
          </label>
        </div>
      </Dialog>
    </section>
  );
}
