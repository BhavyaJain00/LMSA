"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult, Settings } from "@/lib/types";
import {
  cancelTranscodeJobAction,
  retryTranscodeJobAction,
  saveStorageSettingsAction,
  testStorageConnectionAction,
} from "@/lib/actions/storage-settings";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Checkbox, Input, Switch } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

/** Rendition heights offered in the form (mirrors SUPPORTED_RENDITIONS on the server). */
const RENDITION_CHOICES: { height: number; hint: string }[] = [
  { height: 1080, hint: "Full HD · about 5 Mbit/s" },
  { height: 720, hint: "HD · about 2.8 Mbit/s" },
  { height: 480, hint: "SD · about 1.4 Mbit/s" },
  { height: 360, hint: "Data saver · about 0.8 Mbit/s" },
];

/** Settings → Storage & video: CDN, adaptive streaming, renditions and automatic captions. */
export function StorageSettingsForm({
  initial,
  remote,
  ffmpegAvailable,
  transcribeConfigured,
}: {
  initial: Settings["storage"];
  /** Files are stored in an S3-compatible bucket (the CDN URL applies to it). */
  remote: boolean;
  ffmpegAvailable: boolean;
  transcribeConfigured: boolean;
}) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveStorageSettingsAction);
  const [transcode, setTranscode] = useState(initial.transcodeToHls);
  const [heights, setHeights] = useState<number[]>(initial.renditions);

  const toggleHeight = (h: number, on: boolean) => setHeights((list) => (on ? Array.from(new Set([...list, h])) : list.filter((x) => x !== h)).sort((a, b) => b - a));

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Delivery" description="How stored files reach learners.">
        <SettingsRow
          label="CDN base URL"
          htmlFor="cdnBaseUrl"
          error={errors.cdnBaseUrl}
          description={
            remote
              ? "Public origin of your CDN in front of the bucket (for example a Cloudflare or CloudFront domain). Images and documents are served from it; protected lesson videos keep using signed links."
              : "Only used with S3-compatible storage. With local storage, put your CDN in front of the whole site instead."
          }
        >
          <Input id="cdnBaseUrl" name="cdnBaseUrl" type="url" inputMode="url" placeholder="https://cdn.example.com" defaultValue={initial.cdnBaseUrl ?? ""} invalid={!!errors.cdnBaseUrl} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Adaptive streaming" description="Convert uploaded lesson videos to HLS so the player can switch quality with the learner's connection.">
        <SettingsSwitchRow>
          <Switch
            name="transcodeToHls"
            checked={transcode}
            onChange={(e) => setTranscode(e.target.checked)}
            label="Convert uploaded videos to HLS"
            description={
              ffmpegAvailable
                ? "Each upload is converted in the background, one video at a time. Until a conversion finishes, and whenever it fails, learners get the original file."
                : "ffmpeg is not installed on this server, so videos keep playing as uploaded. Conversion starts automatically once ffmpeg is available."
            }
          />
        </SettingsSwitchRow>
        <fieldset className="px-4 py-4 sm:px-5" aria-describedby="renditions-hint">
          <legend className="text-sm font-medium text-ink">Qualities to produce</legend>
          <p id="renditions-hint" className="mt-0.5 text-xs text-ink-muted">
            Only qualities at or below the uploaded video&apos;s own resolution are made. More qualities take longer to convert and use more storage.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {RENDITION_CHOICES.map((r) => (
              <div key={r.height} className={cn("rounded-lg border px-3 py-2.5", heights.includes(r.height) ? "border-accent/40 bg-accent/5" : "border-border")}>
                <Checkbox
                  id={`rendition-${r.height}`}
                  name="renditions"
                  value={String(r.height)}
                  checked={heights.includes(r.height)}
                  onChange={(e) => toggleHeight(r.height, e.target.checked)}
                  disabled={!transcode}
                  label={`${r.height}p`}
                  description={r.hint}
                />
              </div>
            ))}
          </div>
          {/* Disabled checkboxes are not submitted: keep the choice while conversion is off. */}
          {!transcode && heights.map((h) => <input key={h} type="hidden" name="renditions" value={String(h)} />)}
          {errors.renditions && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {errors.renditions}
            </p>
          )}
        </fieldset>
      </SettingsSection>

      <SettingsSection title="Captions">
        <SettingsSwitchRow>
          <Switch
            name="autoTranscribe"
            defaultChecked={initial.autoTranscribe}
            label="Generate captions automatically"
            description={
              transcribeConfigured
                ? "When a video is ready, its audio is sent to your transcription service and the transcript becomes captions, a searchable transcript and context for the AI tutor."
                : "Needs TRANSCRIBE_API_URL and TRANSCRIBE_API_KEY in the server's .env (any OpenAI-compatible speech-to-text endpoint) and ffmpeg. Until then, instructors can still upload or type transcripts."
            }
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons running one admin action                                     */
/* ------------------------------------------------------------------ */

/**
 * Runs a server action without arguments, toasts its message and refreshes
 * the page. With `confirm`, asks first.
 */
export function StorageActionButton<T>({
  action,
  label,
  icon,
  variant = "outline",
  confirm,
  disabled,
  className,
}: {
  action: () => Promise<ActionResult<T>>;
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  confirm?: { title: string; description: string; confirmLabel: string; destructive?: boolean };
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);

  const run = () =>
    startTransition(async () => {
      const result = await action();
      setAsking(false);
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
      router.refresh();
    });

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => (confirm ? setAsking(true) : run())} loading={pending} disabled={disabled || pending} leftIcon={icon} className={className}>
        {label}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={asking}
          onClose={() => setAsking(false)}
          onConfirm={run}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          loading={pending}
        />
      )}
    </>
  );
}

const STEP_LABELS: Record<string, string> = {
  write: "Write a test file",
  read: "Read it back",
  "signed-url": "Download through a signed URL",
  delete: "Delete it",
};

type TestResult = Awaited<ReturnType<typeof testStorageConnectionAction>>;

/** "Test connection": writes, reads, (signs) and deletes a probe file and lists each step. */
export function StorageConnectionTest() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        leftIcon={<Icon.Zap className="size-4" />}
        onClick={() => startTransition(async () => setResult(await testStorageConnectionAction()))}
      >
        Test connection
      </Button>
      <div aria-live="polite">
        {result && (
          <div className={cn("rounded-lg border px-3 py-2.5 text-sm", result.ok ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5")}>
            {result.ok ? (
              <>
                <p className="font-medium text-ink">{result.message}</p>
                <ul className="mt-2 space-y-1">
                  {result.data.steps.map((s) => (
                    <li key={s.step} className="flex items-center gap-2 text-xs text-ink-muted">
                      <Icon.CheckCircle className="size-3.5 shrink-0 text-success" />
                      <span className="flex-1">{STEP_LABELS[s.step] ?? s.step}</span>
                      <span className="tabular-nums">{s.ms} ms</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-start gap-2 text-danger">
                <Icon.XCircle className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{result.error}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Conversion queue                                                     */
/* ------------------------------------------------------------------ */

/** Retry / cancel buttons of one queue row. */
export function TranscodeJobActions({ jobId, status }: { jobId: string; status: "queued" | "running" | "done" | "failed" }) {
  if (status === "queued" || status === "running") {
    return (
      <StorageActionButton
        action={() => cancelTranscodeJobAction(jobId)}
        label="Cancel"
        variant="ghost"
        icon={<Icon.X className="size-4" />}
        confirm={{
          title: "Cancel this conversion?",
          description: "Learners keep getting the original file (or the previous converted version). You can start the conversion again later.",
          confirmLabel: "Cancel conversion",
          destructive: true,
        }}
      />
    );
  }
  return <StorageActionButton action={() => retryTranscodeJobAction(jobId)} label={status === "failed" ? "Retry" : "Convert again"} variant="ghost" icon={<Icon.Refresh className="size-4" />} />;
}

/** Refreshes the page every few seconds while conversions are queued or running, so progress stays current. */
export function QueueAutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <Icon.Loader className="size-3.5 animate-spin" aria-hidden="true" />
      Updating live
    </span>
  );
}
