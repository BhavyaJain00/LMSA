"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react";
import { cn, formatBytes } from "@/lib/utils";
import { describeTimeLeft } from "@/lib/media/resumable-shared";
import {
  UploadTask,
  discardPendingUpload,
  listPendingUploads,
  pendingUploadsVersion,
  subscribePendingUploads,
  type PendingUpload,
  type UploadSnapshot,
} from "@/lib/media/resumable-client";
import { useMediaSource } from "@/components/player/use-media-source";
import { Icon } from "./icons";

export interface FileUploadProps {
  /** Hidden input name that carries the uploaded file URL in a form. */
  name?: string;
  /** Current URL (controlled). */
  value?: string;
  onChange?: (url: string, meta?: { name: string; size: number; type: string }) => void;
  kind?: "video" | "image" | "document" | "auto";
  accept?: string;
  label?: string;
  hint?: string;
  className?: string;
  /** Show a preview for images/videos. */
  preview?: boolean;
  disabled?: boolean;
}

const defaultAccept: Record<NonNullable<FileUploadProps["kind"]>, string> = {
  video: "video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.m4v,.webm,.ogv,.mov",
  image: "image/*",
  document: ".pdf,.txt,.md,.vtt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,audio/*",
  auto: "*/*",
};

/** Phases during which the task holds the uploader (no new file can be chosen). */
const BUSY_PHASES = new Set<UploadSnapshot["phase"]>(["starting", "uploading", "retrying", "finishing", "paused", "error"]);
const SENDING_PHASES = new Set<UploadSnapshot["phase"]>(["starting", "uploading", "retrying", "finishing"]);

/**
 * Drag-and-drop uploader. Small images and documents go up in one request;
 * videos and larger files are sent in chunks through the resumable protocol
 * (`/api/uploads`) with progress, speed and time left, pause/resume,
 * automatic retries with backoff, cancel, and — after a reload or a crash —
 * continuing where the upload stopped when the same file is chosen again.
 * The resulting URL is exposed through `onChange` and a hidden input.
 */
export function FileUpload({ name, value, onChange, kind = "auto", accept, label, hint, className, preview = true, disabled }: FileUploadProps) {
  const id = useId();
  const statusId = `${id}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<UploadTask | null>(null);
  const onChangeRef = useRef(onChange);
  const [snapshot, setSnapshot] = useState<UploadSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [meta, setMeta] = useState<{ name: string; size: number; type: string } | null>(null);
  const scope = `${kind}:${name ?? label ?? ""}`;
  // Unfinished uploads remembered in this browser (none during server rendering).
  const recordsVersion = useSyncExternalStore(subscribePendingUploads, pendingUploadsVersion, () => -1);
  const pending = useMemo(() => (recordsVersion < 0 ? [] : listPendingUploads(kind, scope)), [recordsVersion, kind, scope]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Leaving the component stops the transfer; the server keeps what arrived for a day.
  useEffect(() => () => taskRef.current?.pause(), []);

  const phase = snapshot?.phase ?? null;
  const sending = phase !== null && SENDING_PHASES.has(phase);

  // Warn before closing the tab mid-upload (resuming needs the file chosen again).
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);

  const upload = (file: File) => {
    if (disabled || (taskRef.current && BUSY_PHASES.has(taskRef.current.snapshot.phase))) return;
    setNotice(null);
    if (file.size === 0) {
      setNotice("This file is empty.");
      return;
    }
    const task = new UploadTask({
      file,
      kind,
      scope,
      onUpdate: (snap) => {
        if (taskRef.current !== task) return;
        setSnapshot(snap);
        if (snap.phase === "cancelled") {
          taskRef.current = null;
          setSnapshot(null);
        }
      },
      onComplete: (result) => {
        if (taskRef.current !== task) return;
        taskRef.current = null;
        setSnapshot(null);
        const m = { name: result.name, size: result.size, type: result.type };
        setMeta(m);
        setNotice(null);
        onChangeRef.current?.(result.url, m);
      },
    });
    taskRef.current = task;
    setSnapshot(task.snapshot);
    task.start();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || snapshot) return;
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const dismissTask = () => {
    const task = taskRef.current;
    taskRef.current = null;
    setSnapshot(null);
    // A refused file has nothing to resume: clear what the server may still hold.
    if (task && task.snapshot.phase !== "done") task.cancel();
  };

  const discard = (item: PendingUpload) => {
    void discardPendingUpload(item);
  };

  const isImage = value && /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(value);
  const isVideo = value && /\.(mp4|m4v|webm|ogv|mov)(\?|$)/i.test(value);
  const pickDisabled = disabled || snapshot !== null;

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
      )}
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!pickDisabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-border-strong bg-surface-2/50",
          disabled && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept ?? defaultAccept[kind]}
          className="sr-only"
          disabled={pickDisabled}
          aria-describedby={snapshot ? statusId : undefined}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        {value && preview && (isImage || isVideo) && !snapshot ? (
          <div className="mb-3 overflow-hidden rounded-lg bg-black">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt="" className="mx-auto max-h-48 object-contain" />
            ) : (
              <VideoPreview src={value} />
            )}
          </div>
        ) : null}

        {snapshot ? (
          <UploadProgress
            snapshot={snapshot}
            statusId={statusId}
            onPause={() => taskRef.current?.pause()}
            onResume={() => taskRef.current?.resume()}
            onCancel={() => taskRef.current?.cancel()}
            onDismiss={dismissTask}
          />
        ) : (
          <>
            {value ? (
              <p className="mb-2 flex items-center justify-center gap-2 text-sm text-ink">
                <Icon.CheckCircle className="size-4 shrink-0 text-success" />
                <span className="min-w-0 max-w-xs truncate">{meta?.name ?? value.split("/").pop()}</span>
                {meta && <span className="shrink-0 text-xs text-ink-faint">({formatBytes(meta.size)})</span>}
              </p>
            ) : (
              <Icon.Upload className="mx-auto mb-2 size-6 text-ink-faint" aria-hidden />
            )}
            <p className="text-sm text-ink-muted">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                disabled={pickDisabled}
              >
                {value ? "Replace file" : "Choose a file"}
              </button>{" "}
              or drag it here
            </p>
          </>
        )}

        {value && !disabled && !snapshot && (
          <button
            type="button"
            onClick={() => {
              setMeta(null);
              onChange?.("", undefined);
            }}
            className="absolute right-2 top-2 rounded-md p-1 text-ink-faint hover:bg-surface-3 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Remove file"
          >
            <Icon.X className="size-4" />
          </button>
        )}
      </div>

      {!snapshot && pending.length > 0 && (
        <ul className="space-y-1.5" aria-label="Unfinished uploads">
          {pending.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
              <Icon.Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{item.fileName}</span> stopped at {Math.floor((item.offset / item.size) * 100)}% ({formatBytes(item.offset)} of{" "}
                {formatBytes(item.size)}). Choose the same file to continue.
              </span>
              <button type="button" onClick={() => discard(item)} className="rounded font-medium text-ink-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent">
                Discard
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice ? <p className="text-xs text-danger">{notice}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function statusLine(s: UploadSnapshot): string {
  switch (s.phase) {
    case "starting":
      return "Preparing upload…";
    case "uploading": {
      const parts = [s.resumed ? "Resumed" : "Uploading", `${formatBytes(s.loaded)} of ${formatBytes(s.total)}`];
      if (s.bytesPerSecond > 0) parts.push(`${formatBytes(s.bytesPerSecond)}/s`);
      const left = describeTimeLeft(s.secondsLeft);
      if (left) parts.push(left);
      return parts.join(" · ");
    }
    case "retrying":
      return s.offline ? "You are offline. The upload continues when the connection is back." : `Connection problem. Retrying (attempt ${s.attempt})…`;
    case "paused":
      return `Paused at ${formatBytes(s.loaded)} of ${formatBytes(s.total)}`;
    case "finishing":
      return "Checking and saving the file…";
    case "error":
      return s.error ?? "Upload failed.";
    default:
      return "";
  }
}

/** Progress, status text and controls of the upload in flight. */
function UploadProgress({
  snapshot: s,
  statusId,
  onPause,
  onResume,
  onCancel,
  onDismiss,
}: {
  snapshot: UploadSnapshot;
  statusId: string;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const percent = s.total > 0 ? Math.min(100, Math.floor((s.loaded / s.total) * 100)) : 0;
  const tone = s.phase === "error" ? "bg-danger" : s.phase === "paused" || s.phase === "retrying" ? "bg-warning" : "bg-accent";
  const canPause = s.chunked && (s.phase === "uploading" || s.phase === "retrying");
  // Phase changes are announced; the moving numbers are not (they would flood screen readers).
  const announcement = s.phase === "error" ? `Upload failed: ${s.error ?? ""}` : s.phase === "paused" ? "Upload paused" : s.phase === "finishing" ? "Saving the file" : s.phase === "retrying" ? "Upload interrupted, retrying" : "";

  return (
    <div className="mx-auto w-full max-w-md text-left">
      <div className="mb-1.5 flex items-center gap-2 text-sm">
        <Icon.File className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-ink" title={s.fileName}>
          {s.fileName}
        </span>
        <span className="shrink-0 tabular-nums text-xs font-medium text-ink">{percent}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Uploading ${s.fileName}`}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone, s.phase === "finishing" && "animate-pulse")} style={{ width: `${percent}%` }} />
      </div>
      <p id={statusId} className={cn("mt-1.5 flex items-start gap-1.5 text-xs", s.phase === "error" ? "text-danger" : "text-ink-muted")}>
        {(s.phase === "starting" || s.phase === "finishing" || s.phase === "retrying") && <Icon.Loader className="mt-px size-3.5 shrink-0 animate-spin" aria-hidden />}
        {s.phase === "error" && <Icon.AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 wrap-break-word">{statusLine(s)}</span>
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canPause && (
          <ControlButton onClick={onPause} icon={<Icon.Pause className="size-3.5" aria-hidden />}>
            Pause
          </ControlButton>
        )}
        {(s.phase === "paused" || (s.phase === "error" && s.canResume)) && (
          <ControlButton onClick={onResume} icon={<Icon.Play className="size-3.5" aria-hidden />} primary>
            {s.phase === "paused" ? "Resume" : "Try again"}
          </ControlButton>
        )}
        {s.phase === "error" && !s.canResume ? (
          <ControlButton onClick={onDismiss} icon={<Icon.X className="size-3.5" aria-hidden />}>
            Choose another file
          </ControlButton>
        ) : (
          s.phase !== "finishing" && (
            <ControlButton onClick={onCancel} icon={<Icon.X className="size-3.5" aria-hidden />} danger>
              Cancel
            </ControlButton>
          )
        )}
      </div>
    </div>
  );
}

function ControlButton({ onClick, icon, children, primary, danger }: { onClick: () => void; icon: ReactNode; children: ReactNode; primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        primary ? "bg-accent text-accent-fg hover:brightness-110" : "border border-border-strong bg-surface-1 text-ink hover:bg-surface-2",
        danger && "hover:border-danger/50 hover:text-danger",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Preview of an uploaded video. Protected uploads under /uploads/videos/ need
 * a signed, expiring URL, so the src is resolved through useMediaSource.
 */
function VideoPreview({ src }: { src: string }) {
  const media = useMediaSource(src);
  if (!media.url) {
    return (
      <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/70">
        {media.status === "resolving" ? <Icon.Loader className="size-4 animate-spin" /> : <Icon.Video className="size-4" />}
        <span>{media.status === "resolving" ? "Loading preview…" : (media.message ?? "Preview unavailable")}</span>
      </div>
    );
  }
  return <video src={media.url} className="mx-auto max-h-48" controls={false} muted playsInline preload="metadata" />;
}
