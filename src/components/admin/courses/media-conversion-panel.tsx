"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";
import { POLL_IDLE_MS, describeMediaStatus, formatBitrate, type MediaPanelSubject, type MediaStatusCore } from "@/lib/media/transcode/status-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";

/** How long a typed media URL must stay unchanged before its status is fetched again. */
export const MEDIA_URL_SETTLE_MS = 600;

/** The value, once it has stopped changing for `ms` milliseconds. */
export function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const PROGRESS_TONES = { info: "accent", success: "success", warning: "warning", danger: "danger", neutral: "accent" } as const;

export interface MediaConversionPanelProps<S extends MediaStatusCore> {
  /** Unique id prefix for the heading (`aria-labelledby`). */
  id: string;
  /** Query string of `GET /api/media/status` (e.g. `courseId=…` or `lessonId=…&blockId=…`). */
  query: string;
  /** The current (possibly unsaved) video URL. */
  src: string;
  subject: MediaPanelSubject;
  /** One line under the heading. */
  description: string;
  /** Extra content next to the heading (e.g. a transcript link), given the latest status. */
  aside?: (status: S | null) => ReactNode;
  /** "Convert now" / "Convert again" / "Retry". */
  convert: () => Promise<ActionResult<S>>;
  /** "Cancel conversion". */
  cancel: () => Promise<ActionResult<S>>;
  /** Called with every fresh status (e.g. to show a generated poster). */
  onStatus?: (status: S | null) => void;
}

/**
 * Adaptive-streaming state of an uploaded video: polls `GET /api/media/status`
 * while a conversion is queued or running ("Processing 42% (1080p/720p/480p)"),
 * then shows "Ready" with the renditions, "Failed" with Retry, or that the
 * converter is not installed (the original file plays). Used under lesson
 * video blocks and under a course's preview video.
 */
export function MediaConversionPanel<S extends MediaStatusCore>({ id, query, src, subject, description, aside, convert, cancel, onStatus }: MediaConversionPanelProps<S>) {
  const toast = useToast();
  const [status, setStatus] = useState<S | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [askCancel, setAskCancel] = useState(false);
  const [pending, startTransition] = useTransition();
  const settledSrc = useSettledValue(src, MEDIA_URL_SETTLE_MS);
  const srcRef = useRef(src);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    srcRef.current = src;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const schedule = (ms: number | null) => {
      if (!stopped && ms !== null) timer = window.setTimeout(load, ms);
    };
    async function load() {
      if (document.visibilityState === "hidden") return schedule(POLL_IDLE_MS);
      controller = new AbortController();
      let next: number | null = POLL_IDLE_MS;
      try {
        const res = await fetch(`/api/media/status?${query}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => null)) as { ok: true; status: S } | { ok: false; error?: string } | null;
        if (stopped) return;
        if (res.ok && body?.ok) {
          setStatus(body.status);
          onStatusRef.current?.(body.status);
          setLoadError(null);
          next = describeMediaStatus(body.status, srcRef.current, subject).pollMs;
        } else if (res.status === 404) {
          // Not saved yet (a new block, or the lesson id is unknown outside a lesson page).
          setStatus(null);
          onStatusRef.current?.(null);
          setLoadError(null);
        } else {
          setLoadError((body && !body.ok && body.error) || "Couldn't load the conversion status.");
          if (res.status === 401 || res.status === 403) next = null;
        }
      } catch {
        if (stopped) return;
        setLoadError("Couldn't reach the server. Trying again shortly.");
      }
      setLoaded(true);
      schedule(next);
    }
    void load();
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [query, subject, settledSrc, reload]);

  const view = describeMediaStatus(status, src, subject);
  const titleId = `conversion-${id}`;
  const viewers = subject === "course" ? "Visitors" : "Learners";

  const run = (kind: "convert" | "cancel") => {
    if (!status) return;
    startTransition(async () => {
      const result = kind === "cancel" ? await cancel() : await convert();
      setAskCancel(false);
      if (result.ok) {
        setStatus(result.data);
        onStatusRef.current?.(result.data);
        toast.success(result.message ?? "Done");
      } else {
        toast.error(result.error);
      }
      setReload((r) => r + 1);
    });
  };

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={titleId} className="text-sm font-semibold text-ink">
            Adaptive streaming
          </h4>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
        {aside?.(status)}
      </div>

      <div className="mt-3 space-y-2" aria-live="polite" aria-busy={!loaded}>
        {!loaded ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
            <Icon.Loader className="size-4 animate-spin" aria-hidden="true" /> Checking conversion status…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={view.tone} dot>
                {view.title}
              </Badge>
              {view.detail && <p className="min-w-0 flex-1 text-xs text-ink-muted">{view.detail}</p>}
            </div>
            {view.progress !== null && <ProgressBar value={view.progress} size="sm" tone={PROGRESS_TONES[view.tone]} label={view.title} />}
            {view.renditions.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Available qualities">
                {view.renditions.map((r) => (
                  <li key={r.height} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                    <span className="font-medium text-ink">{r.label}</span>
                    {r.bandwidth > 0 && <span> · {formatBitrate(r.bandwidth)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {loadError && <p className="text-xs text-danger">{loadError}</p>}
          </>
        )}
      </div>

      {status && (view.convert || view.cancel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {view.convert && (
            <Button
              variant={view.convert === "retry" ? "primary" : "outline"}
              size="sm"
              loading={pending}
              disabled={pending}
              onClick={() => run("convert")}
              leftIcon={<Icon.Refresh className="size-4" />}
            >
              {view.convert === "retry" ? "Retry" : view.convert === "again" ? "Convert again" : "Convert now"}
            </Button>
          )}
          {view.cancel && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setAskCancel(true)} leftIcon={<Icon.X className="size-4" />}>
              Cancel conversion
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={askCancel}
        onClose={() => setAskCancel(false)}
        onConfirm={() => run("cancel")}
        title="Cancel this conversion?"
        description={`${viewers} keep getting the original file (or the previous stream). You can convert the video again later.`}
        confirmLabel="Cancel conversion"
        destructive
        loading={pending}
      />
    </section>
  );
}
