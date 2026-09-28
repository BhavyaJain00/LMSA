"use client";

import { useState } from "react";
import type { BatchFeedback } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { submitBatchFeedbackAction } from "@/lib/actions/batch-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useActionForm } from "./hooks";
import { Stars } from "./stars";
import type { FeedbackAverages, FeedbackView } from "./types";

const labels = ["Poor", "Fair", "Good", "Very good", "Excellent"];

/** Keyboard-accessible 1–5 star input (radio group) that submits with the form. */
export function StarRatingInput({ name, label, error }: { name: string; label: string; error?: string }) {
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">
        {label} <span className="text-danger">*</span>
      </legend>
      <input type="hidden" name={name} value={value || ""} />
      <div role="radiogroup" aria-label={label} className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {Array.from({ length: 5 }).map((_, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n > 1 ? "s" : ""} – ${labels[i]}`}
              tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
              onClick={() => setValue(n)}
              onMouseEnter={() => setHover(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setValue(Math.min(5, (value || 0) + 1));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  setValue(Math.max(1, (value || 2) - 1));
                }
              }}
              className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {n <= shown ? <Icon.StarFilled className="size-6 text-warning" /> : <Icon.Star className="size-6 text-ink-faint" />}
            </button>
          );
        })}
        <span className="ml-2 text-xs text-ink-muted">{shown ? labels[shown - 1] : "Not rated"}</span>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function ReadOnlyFeedback({ feedback }: { feedback: Pick<BatchFeedback, "contentRating" | "instructorsRating" | "valueRating" | "feedback" | "createdAt"> }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4">
      {(
        [
          ["Content", feedback.contentRating],
          ["Instructors", feedback.instructorsRating],
          ["Value", feedback.valueRating],
        ] as const
      ).map(([label, v]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-muted">{label}</span>
          <Stars value={v} />
        </div>
      ))}
      {feedback.feedback && <p className="whitespace-pre-line border-t border-border pt-3 text-sm text-ink">{feedback.feedback}</p>}
      <p className="text-xs text-ink-faint">Submitted {formatDate(feedback.createdAt)}</p>
    </div>
  );
}

/** Student feedback block: the form after the batch ends, or the learner's own feedback. */
export function BatchFeedbackForm({ batchId, existing }: { batchId: string; existing: BatchFeedback | null }) {
  const [showOwn, setShowOwn] = useState(false);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(submitBatchFeedbackAction);

  if (existing) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-ink">
          <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Thank you for providing your feedback.{" "}
            <button type="button" onClick={() => setShowOwn((v) => !v)} className="font-medium text-accent hover:underline" aria-expanded={showOwn}>
              {showOwn ? "Hide your feedback." : "Click here to view your feedback."}
            </button>
          </span>
        </p>
        {showOwn && <ReadOnlyFeedback feedback={existing} />}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-sm text-ink-muted">Help us improve by providing your feedback.</p>
      <FormError message={error} />
      <div className="grid gap-5 sm:grid-cols-3">
        <StarRatingInput name="contentRating" label="Content" error={fieldErrors.contentRating} />
        <StarRatingInput name="instructorsRating" label="Instructors" error={fieldErrors.instructorsRating} />
        <StarRatingInput name="valueRating" label="Value" error={fieldErrors.valueRating} />
      </div>
      <Field label="Feedback" htmlFor="batch-feedback" error={fieldErrors.feedback} hint="What worked well? What should we change for the next cohort?">
        <Textarea id="batch-feedback" name="feedback" rows={6} maxLength={5000} invalid={!!fieldErrors.feedback} />
      </Field>
      <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
        Submit Feedback
      </Button>
    </form>
  );
}

/** Admin summary: average ratings and a dialog listing every submission. */
export function FeedbackSummaryCard({ averages, feedback, className }: { averages: FeedbackAverages; feedback: FeedbackView[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={className}>
      <CardHeader
        title="Feedback"
        description={averages.count ? `Average Feedback Received · ${averages.count} response${averages.count > 1 ? "s" : ""}` : undefined}
        actions={
          averages.count > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              View all feedback
            </Button>
          ) : null
        }
      />
      <CardBody>
        {averages.count === 0 ? (
          <p className="text-sm text-ink-muted">No feedback received yet.</p>
        ) : (
          <div className="space-y-3">
            {(
              [
                ["Content", averages.content],
                ["Instructors", averages.instructors],
                ["Value", averages.value],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-muted">{label}</span>
                <span className="flex items-center gap-2">
                  <Stars value={v} />
                  <span className="w-8 text-right font-medium tabular-nums text-ink">{v?.toFixed(1)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
      <Dialog open={open} onClose={() => setOpen(false)} title="Training Feedback" size="xl">
        <Table>
          <THead>
            <tr>
              <TH>Member</TH>
              <TH>Feedback</TH>
              <TH>Content</TH>
              <TH>Instructors</TH>
              <TH>Value</TH>
            </tr>
          </THead>
          <TBody>
            {feedback.map((f) => (
              <TR key={f.id}>
                <TD>
                  <span className="flex min-w-36 items-center gap-2">
                    <Avatar name={f.user?.name ?? "Former student"} src={f.user?.avatarUrl} size="xs" />
                    <span className="truncate">{f.user?.name ?? "Former student"}</span>
                  </span>
                </TD>
                <TD className={cn("min-w-56 text-sm", !f.feedback && "text-ink-faint")}>{f.feedback || "—"}</TD>
                <TD>
                  <Stars value={f.contentRating} size="xs" />
                </TD>
                <TD>
                  <Stars value={f.instructorsRating} size="xs" />
                </TD>
                <TD>
                  <Stars value={f.valueRating} size="xs" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Dialog>
    </Card>
  );
}
