"use client";

import { useState, useTransition } from "react";
import type { CourseStatus } from "@/lib/types";
import { approveCourseAction, requestCourseChangesAction, setCoursePublishedAction, submitCourseForReviewAction } from "@/lib/actions/courses";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { WorkflowFlags } from "./types";

export interface CourseWorkflowProps {
  courseId: string;
  status: CourseStatus;
  published: boolean;
  publishedOn?: string;
  flags: WorkflowFlags;
  lessonCount: number;
  variant?: "card" | "inline";
}

const STEPS = ["In progress", "Under review", "Approved", "Published"] as const;

function stepIndex(status: CourseStatus, published: boolean): number {
  if (published) return 3;
  return status === "approved" ? 2 : status === "under_review" ? 1 : 0;
}

export function CourseWorkflow({ courseId, status, published, publishedOn, flags, lessonCount, variant = "card" }: CourseWorkflowProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [note, setNote] = useState("");

  const run = (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        after?.();
      } else {
        toast.error(res.error ?? "Something went wrong");
      }
    });
  };

  const buttons = (
    <>
      {flags.canSubmitForReview && (
        <Button
          size={variant === "inline" ? "sm" : "md"}
          variant="primary"
          loading={busy === "submit"}
          disabled={lessonCount === 0}
          title={lessonCount === 0 ? "Add at least one lesson first" : undefined}
          onClick={() => run("submit", () => submitCourseForReviewAction(courseId))}
          leftIcon={<Icon.Send className="size-4" />}
        >
          Submit for review
        </Button>
      )}
      {flags.canApprove && (
        <Button size={variant === "inline" ? "sm" : "md"} variant="primary" loading={busy === "approve"} onClick={() => run("approve", () => approveCourseAction(courseId))} leftIcon={<Icon.ShieldCheck className="size-4" />}>
          Approve
        </Button>
      )}
      {flags.canRequestChanges && (
        <Button size={variant === "inline" ? "sm" : "md"} variant="outline" onClick={() => setChangesOpen(true)} leftIcon={<Icon.MessageSquare className="size-4" />}>
          Request changes
        </Button>
      )}
      {flags.canPublish && (
        <Button size={variant === "inline" ? "sm" : "md"} variant={flags.canApprove ? "outline" : "secondary"} loading={busy === "publish"} onClick={() => setConfirm("publish")} leftIcon={<Icon.Globe className="size-4" />}>
          Publish
        </Button>
      )}
      {flags.canUnpublish && (
        <Button
          size={variant === "inline" ? "sm" : "md"}
          variant="subtle"
          className="text-danger"
          loading={busy === "unpublish"}
          onClick={() => setConfirm("unpublish")}
          leftIcon={<Icon.EyeOff className="size-4" />}
        >
          Unpublish
        </Button>
      )}
    </>
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run("publish", () => setCoursePublishedAction(courseId, true));
        }}
        title="Publish this course?"
        description={
          lessonCount === 0
            ? "This course has no lessons yet. Learners will see an empty outline until you add some. Publish anyway?"
            : "The course will appear in the catalog and learners can enroll right away. The first time a course is published, members are notified."
        }
        confirmLabel="Publish"
      />
      <ConfirmDialog
        open={confirm === "unpublish"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run("unpublish", () => setCoursePublishedAction(courseId, false));
        }}
        title="Unpublish this course?"
        description="It will be hidden from the catalog and new learners can't enroll. Enrolled learners keep their progress, and you can publish it again later."
        confirmLabel="Unpublish"
        destructive
      />
      <Dialog
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        title="Request changes"
        description="The course goes back to In progress and the instructors are notified with your note."
        footer={
          <>
            <Button variant="outline" onClick={() => setChangesOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === "changes"}
              onClick={() =>
                run(
                  "changes",
                  () => requestCourseChangesAction(courseId, note),
                  () => {
                    setChangesOpen(false);
                    setNote("");
                  },
                )
              }
            >
              Send to instructors
            </Button>
          </>
        }
      >
        <Field label="Note for the instructors" htmlFor="review-note" hint="Optional, but specific feedback speeds up the next review.">
          <Textarea id="review-note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="e.g. Chapter 2 needs a quiz, and the promo video is missing captions." />
        </Field>
      </Dialog>
    </>
  );

  if (variant === "inline") {
    return (
      <>
        {buttons}
        {dialogs}
      </>
    );
  }

  const current = stepIndex(status, published);
  let message: string;
  if (published) message = publishedOn ? `This course is live in the catalog since ${formatDate(publishedOn)}.` : "This course is live in the catalog.";
  else if (status === "approved") message = flags.canPublish ? "Approved by a moderator. You can publish it whenever you're ready." : "Approved by a moderator.";
  else if (status === "under_review")
    message = flags.isModerator ? "Review the content, then approve it or send it back with notes." : "A moderator is reviewing this course. You'll get a notification when it's approved.";
  else
    message = flags.isModerator
      ? "Moderators can publish directly once the content is ready."
      : "When the content is ready, submit it for review. Moderators will be notified and only approved courses can be published.";

  const hasActions = flags.canSubmitForReview || flags.canApprove || flags.canRequestChanges || flags.canPublish || flags.canUnpublish;

  return (
    <Card>
      <CardHeader title="Review & publishing" description={message} />
      <CardBody className="space-y-5">
        <ol className="grid grid-cols-4 gap-2" aria-label="Course status">
          {STEPS.map((label, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={label} className="min-w-0" aria-current={active ? "step" : undefined}>
                <div className={cn("h-1.5 rounded-full", done || active ? (active ? "bg-accent" : "bg-success") : "bg-surface-3")} />
                <p className={cn("mt-2 flex items-center gap-1 truncate text-xs font-medium", active ? "text-ink" : done ? "text-success" : "text-ink-faint")}>
                  {done && <Icon.Check className="size-3.5 shrink-0" />}
                  <span className="truncate">{label}</span>
                </p>
              </li>
            );
          })}
        </ol>
        {hasActions ? (
          <div className="flex flex-wrap gap-2">{buttons}</div>
        ) : (
          <p className="text-sm text-ink-muted">{status === "under_review" ? "Nothing to do until the review finishes." : "No actions available for your role."}</p>
        )}
        {flags.canSubmitForReview && lessonCount === 0 && <p className="text-xs text-ink-muted">Add at least one lesson in the Outline tab before submitting.</p>}
      </CardBody>
      {dialogs}
    </Card>
  );
}
