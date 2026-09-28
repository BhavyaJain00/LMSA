"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress";
import { cn, pluralize } from "@/lib/utils";

export function SubmitDialog({
  open,
  onClose,
  onConfirm,
  total,
  answered,
  review,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  total: number;
  answered: number;
  review: number;
  preview: boolean;
}) {
  const unanswered = Math.max(0, total - answered);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Are you sure you want to submit the quiz?"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Keep answering
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {preview ? "Submit preview" : "Submit"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          {unanswered > 0
            ? `You have ${pluralize(unanswered, "unattempted question")}. ${unanswered === 1 ? "It" : "They"} will be marked incorrect if you submit.`
            : "All questions have been attempted."}
        </p>
        <ProgressBar value={total ? (answered / total) * 100 : 0} tone="success" size="sm" label="Questions attempted" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="size-2 rounded-full bg-success" />
            {answered} attempted
          </span>
          <span className={cn("inline-flex items-center gap-1.5", unanswered > 0 ? "text-warning" : "text-ink-muted")}>
            <span className={cn("size-2 rounded-full", unanswered > 0 ? "bg-warning" : "bg-surface-3")} />
            {unanswered} unattempted
          </span>
          {review > 0 && (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <span className="size-2 rounded-full bg-warning/60" />
              {review} marked for review
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
