"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveAnswersAction, correctAnswerAction, reopenAnswerAction } from "@/lib/actions/ai";
import { MAX_CORRECTION_CHARS } from "@/lib/ai/prompt";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { MarkdownField } from "@/components/admin/settings/markdown-field";

export interface ReviewActionsProps {
  messageId: string;
  question: string;
  answer: string;
  reviewStatus?: "pending" | "approved" | "corrected";
  instructorNote?: string;
  size?: "xs" | "sm";
}

/** Approve / Correct / Reopen buttons for one tutor answer in the review queue. */
export function ReviewActions({ messageId, question, answer, reviewStatus, instructorNote, size = "sm" }: ReviewActionsProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(instructorNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const reviewed = reviewStatus === "approved" || reviewStatus === "corrected";

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(result.message ?? "Saved");
      after?.();
      router.refresh();
    });
  };

  const saveCorrection = () => {
    const text = note.trim();
    if (!text) {
      setError("Write the correction first.");
      return;
    }
    if (text.length > MAX_CORRECTION_CHARS) {
      setError(`Keep the correction under ${MAX_CORRECTION_CHARS.toLocaleString("en-US")} characters.`);
      return;
    }
    setError(null);
    run(
      () => correctAnswerAction(messageId, text),
      () => setOpen(false),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {reviewStatus !== "approved" && (
        <Button type="button" size={size} variant="outline" loading={pending && !open} onClick={() => run(() => approveAnswersAction([messageId]))} leftIcon={<Icon.Check className="size-4" />}>
          Approve
        </Button>
      )}
      <Button type="button" size={size} variant="outline" disabled={pending} onClick={() => setOpen(true)} leftIcon={<Icon.Edit className="size-4" />}>
        {reviewStatus === "corrected" ? "Edit correction" : "Correct"}
      </Button>
      {reviewed && (
        <Button type="button" size={size} variant="ghost" disabled={pending} onClick={() => run(() => reopenAnswerAction(messageId))} leftIcon={<Icon.Refresh className="size-4" />}>
          Reopen
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Write a correction"
        description="The learner sees your correction under the answer and gets a notification. The tutor also uses it as a trusted instructor clarification for future questions about this topic."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveCorrection} loading={pending} leftIcon={<Icon.Send className="size-4" />}>
              Save and share
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Question</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-ink">{question || "—"}</p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-faint">Tutor&apos;s answer</p>
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-ink-muted">{answer}</p>
          </div>
          <div>
            <label htmlFor={`correction-${messageId}`} className="mb-1.5 block text-sm font-medium text-ink">
              Correction
            </label>
            <MarkdownField
              id={`correction-${messageId}`}
              name="note"
              rows={7}
              defaultValue={instructorNote ?? ""}
              onChange={(value) => {
                setNote(value);
                if (error) setError(null);
              }}
              invalid={!!error}
              placeholder="Explain what the answer got wrong and give the right explanation, in words that also make sense to other learners."
            />
            <p className="mt-1 flex justify-between gap-3 text-xs">
              <span className="text-danger" role="alert">
                {error}
              </span>
              <span className={note.length > MAX_CORRECTION_CHARS ? "tabular-nums text-danger" : "tabular-nums text-ink-faint"}>
                {note.length.toLocaleString()}/{MAX_CORRECTION_CHARS.toLocaleString()}
              </span>
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
