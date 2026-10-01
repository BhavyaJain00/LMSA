"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { COMMON_LANGUAGES, languageLabel } from "@/lib/transcripts/editor-shared";
import { jobProgress, jobStageLabel, type JobStateLike } from "@/lib/transcripts/editor-state";
import { relativeTime } from "@/lib/utils";

export interface GenerationAvailability {
  available: boolean;
  reason: string | null;
  autoEnabled: boolean;
  model: string;
}

export interface GenerationJob extends JobStateLike {
  queuedAt: string;
  startedAt?: string;
}

/**
 * "Generate transcript" card: the language hint, the button (disabled with
 * the reason when the API keys or ffmpeg are missing), progress of a queued
 * or running job with a cancel button, and the last failure.
 */
export function GeneratePanel({
  availability,
  job,
  lastError,
  hasCues,
  dirty,
  defaultLanguage,
  settingsHref,
  pending,
  onGenerate,
  onCancel,
}: {
  availability: GenerationAvailability;
  job: GenerationJob | null;
  lastError: string | null;
  hasCues: boolean;
  dirty: boolean;
  defaultLanguage: string;
  settingsHref: string | null;
  pending: "start" | "cancel" | null;
  onGenerate: (language: string | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [language, setLanguage] = useState(defaultLanguage);
  const [confirming, setConfirming] = useState(false);
  const known = COMMON_LANGUAGES.some((l) => l.code === language);

  const start = () => {
    if (hasCues || dirty) setConfirming(true);
    else onGenerate(language || null);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-card border border-border bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon.Sparkles className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
            Automatic transcript
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">Speech to text from the video&apos;s audio{availability.model ? ` (${availability.model})` : ""}. Review the result before learners rely on it.</p>
        </div>
      </div>

      {job ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <ProgressBar value={jobProgress(job) * 100} size="sm" label={jobStageLabel(job)} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{job.startedAt ? `Started ${relativeTime(job.startedAt)}` : `Queued ${relativeTime(job.queuedAt)}`}. You can leave this page; you&apos;ll be notified.</span>
            <Button variant="outline" size="xs" onClick={onCancel} loading={pending === "cancel"} leftIcon={<Icon.X className="size-3.5" />}>
              Cancel
            </Button>
          </div>
        </div>
      ) : availability.available ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-lang`} className="mb-1 block text-xs font-medium text-ink-muted">
              Spoken language
            </label>
            <Select id={`${id}-lang`} value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Detect automatically</option>
              {!known && language && <option value={language}>{languageLabel(language)}</option>}
              {COMMON_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={start} loading={pending === "start"} leftIcon={<Icon.Sparkles className="size-4" />}>
            {hasCues ? "Generate again" : "Generate transcript"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <Button disabled leftIcon={<Icon.Sparkles className="size-4" />} aria-describedby={`${id}-reason`}>
            Generate transcript
          </Button>
          <p id={`${id}-reason`} className="flex gap-1.5 text-xs text-ink-muted">
            <Icon.Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{availability.reason}</span>
          </p>
        </div>
      )}

      {lastError && !job && (
        <p role="status" className="mt-3 flex gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            <span className="font-medium">Last generation: </span>
            {lastError}
          </span>
        </p>
      )}

      <p className="mt-3 border-t border-border pt-3 text-xs text-ink-muted">
        {availability.autoEnabled ? "New video uploads are transcribed automatically." : "New video uploads are not transcribed automatically."}{" "}
        {settingsHref && (
          <Link href={settingsHref} className="font-medium text-accent hover:underline">
            Storage &amp; video settings
          </Link>
        )}
      </p>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onGenerate(language || null);
        }}
        title="Replace the current captions?"
        description={
          dirty
            ? "When generation finishes, its captions replace the saved transcript. Your unsaved edits stay in the editor, but saving is paused until it finishes or you cancel it."
            : "When generation finishes, its captions replace the current transcript. Until then learners keep seeing the current one."
        }
        confirmLabel="Generate"
      />
    </section>
  );
}
