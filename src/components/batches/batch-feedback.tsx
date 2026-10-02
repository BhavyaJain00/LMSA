"use client";

import { useRef, useState } from "react";
import type { BatchFeedback } from "@/lib/types";
import { cn } from "@/lib/utils";
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
import { useFormatter, useT } from "@/i18n/client";

// `global.` keys throughout: the feedback summary is also shown on the admin batch page.
const LABEL_KEYS = ["shared.rating.label1", "shared.rating.label2", "shared.rating.label3", "shared.rating.label4", "shared.rating.label5"] as const;

/** Keyboard-accessible 1–5 star input (radio group) that submits with the form. */
export function StarRatingInput({ name, label, error }: { name: string; label: string; error?: string }) {
  const t = useT("public");
  const labels = LABEL_KEYS.map((key) => t(key));
  const [value, setValue] = useState(0);
  const [hover, setHover] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover || value;
  const choose = (n: number) => {
    setValue(n);
    buttons.current[n - 1]?.focus();
  };
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
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={t("shared.rating.starsOption", { count: n, label: labels[i] })}
              tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
              onClick={() => setValue(n)}
              onMouseEnter={() => setHover(n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  choose(Math.min(5, (value || 0) + 1));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  choose(Math.max(1, (value || 2) - 1));
                } else if (e.key === "Home") {
                  e.preventDefault();
                  choose(1);
                } else if (e.key === "End") {
                  e.preventDefault();
                  choose(5);
                }
              }}
              className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {n <= shown ? <Icon.StarFilled className="size-6 text-warning" /> : <Icon.Star className="size-6 text-ink-faint" />}
            </button>
          );
        })}
        <span className="ms-2 text-xs text-ink-muted">{shown ? labels[shown - 1] : t("certificates.stars.notRated")}</span>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function ReadOnlyFeedback({ feedback }: { feedback: Pick<BatchFeedback, "contentRating" | "instructorsRating" | "valueRating" | "feedback" | "createdAt"> }) {
  const t = useT("public");
  const f = useFormatter();
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4">
      {(
        [
          [t("global.batchFeedback.content"), feedback.contentRating],
          [t("global.batchFeedback.instructors"), feedback.instructorsRating],
          [t("global.batchFeedback.value"), feedback.valueRating],
        ] as const
      ).map(([label, v]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-muted">{label}</span>
          <Stars value={v} />
        </div>
      ))}
      {feedback.feedback && <p className="whitespace-pre-line border-t border-border pt-3 text-sm text-ink">{feedback.feedback}</p>}
      <p className="text-xs text-ink-faint">{t("global.batchFeedback.submittedOn", { date: f.date(feedback.createdAt) })}</p>
    </div>
  );
}

/** Student feedback block: the form after the batch ends, or the learner's own feedback. */
export function BatchFeedbackForm({ batchId, existing }: { batchId: string; existing: BatchFeedback | null }) {
  const t = useT("public");
  const [showOwn, setShowOwn] = useState(false);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(submitBatchFeedbackAction);

  if (existing) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-ink">
          <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            {t("global.batchFeedback.thanks")}{" "}
            <button type="button" onClick={() => setShowOwn((v) => !v)} className="font-medium text-accent hover:underline" aria-expanded={showOwn}>
              {showOwn ? t("global.batchFeedback.hideOwn") : t("global.batchFeedback.showOwn")}
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
      <p className="text-sm text-ink-muted">{t("global.batchFeedback.intro")}</p>
      <FormError message={error} />
      <div className="grid gap-5 sm:grid-cols-3">
        <StarRatingInput name="contentRating" label={t("global.batchFeedback.content")} error={fieldErrors.contentRating} />
        <StarRatingInput name="instructorsRating" label={t("global.batchFeedback.instructors")} error={fieldErrors.instructorsRating} />
        <StarRatingInput name="valueRating" label={t("global.batchFeedback.value")} error={fieldErrors.valueRating} />
      </div>
      <Field label={t("global.batchFeedback.title")} htmlFor="batch-feedback" error={fieldErrors.feedback} hint={t("global.batchFeedback.hint")}>
        <Textarea id="batch-feedback" name="feedback" rows={6} maxLength={5000} invalid={!!fieldErrors.feedback} />
      </Field>
      <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
        {t("global.batchFeedback.submit")}
      </Button>
    </form>
  );
}

/** Admin summary: average ratings and a dialog listing every submission. */
export function FeedbackSummaryCard({ averages, feedback, className }: { averages: FeedbackAverages; feedback: FeedbackView[]; className?: string }) {
  const t = useT("public");
  const f = useFormatter();
  const [open, setOpen] = useState(false);
  return (
    <Card className={className}>
      <CardHeader
        title={t("global.batchFeedback.title")}
        description={averages.count ? t("global.batchFeedback.average", { count: averages.count }) : undefined}
        actions={
          averages.count > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              {t("global.batchFeedback.viewAll")}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {averages.count === 0 ? (
          <p className="text-sm text-ink-muted">{t("global.batchFeedback.empty")}</p>
        ) : (
          <div className="space-y-3">
            {(
              [
                [t("global.batchFeedback.content"), averages.content],
                [t("global.batchFeedback.instructors"), averages.instructors],
                [t("global.batchFeedback.value"), averages.value],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-muted">{label}</span>
                <span className="flex items-center gap-2">
                  <Stars value={v} />
                  <span className="w-8 text-end font-medium tabular-nums text-ink">{v === null ? "" : f.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("global.batchFeedback.dialogTitle")} size="xl">
        <Table>
          <THead>
            <tr>
              <TH>{t("global.batchFeedback.member")}</TH>
              <TH>{t("global.batchFeedback.title")}</TH>
              <TH>{t("global.batchFeedback.content")}</TH>
              <TH>{t("global.batchFeedback.instructors")}</TH>
              <TH>{t("global.batchFeedback.value")}</TH>
            </tr>
          </THead>
          <TBody>
            {feedback.map((entry) => (
              <TR key={entry.id}>
                <TD>
                  <span className="flex min-w-36 items-center gap-2">
                    <Avatar name={entry.user?.name ?? t("global.batchFeedback.formerStudent")} src={entry.user?.avatarUrl} size="xs" />
                    <span className="truncate">{entry.user?.name ?? t("global.batchFeedback.formerStudent")}</span>
                  </span>
                </TD>
                <TD className={cn("min-w-56 text-sm", !entry.feedback && "text-ink-faint")}>{entry.feedback || "—"}</TD>
                <TD>
                  <Stars value={entry.contentRating} size="xs" />
                </TD>
                <TD>
                  <Stars value={entry.instructorsRating} size="xs" />
                </TD>
                <TD>
                  <Stars value={entry.valueRating} size="xs" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Dialog>
    </Card>
  );
}
