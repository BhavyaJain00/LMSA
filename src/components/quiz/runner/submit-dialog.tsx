"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

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
  const t = useT("learning");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("quiz.submit.title")}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("quiz.submit.keepAnswering")}
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {preview ? t("quiz.submit.submitPreview") : t("quiz.submit.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          {unanswered > 0 ? t("quiz.submit.unanswered", { count: unanswered }) : t("quiz.submit.allAnswered")}
        </p>
        <ProgressBar value={total ? (answered / total) * 100 : 0} tone="success" size="sm" label={t("quiz.submit.progressLabel")} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-success">
            <span className="size-2 rounded-full bg-success" />
            {t("quiz.submit.attempted", { count: answered })}
          </span>
          <span className={cn("inline-flex items-center gap-1.5", unanswered > 0 ? "text-warning" : "text-ink-muted")}>
            <span className={cn("size-2 rounded-full", unanswered > 0 ? "bg-warning" : "bg-surface-3")} />
            {t("quiz.submit.unattempted", { count: unanswered })}
          </span>
          {review > 0 && (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <span className="size-2 rounded-full bg-warning/60" />
              {t("quiz.submit.markedForReview", { count: review })}
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
