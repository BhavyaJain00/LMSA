"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react";
import { cn, formatBytes } from "@/lib/utils";
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
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";
import type { UploadErrorCode } from "@/lib/media/resumable-shared";

type CommonT = Translator<MessageKey<"common">>;

/** Catalog message for each machine-readable upload error (the English text from the server is the fallback). */
const ERROR_KEYS: Record<UploadErrorCode, MessageKey<"common">> = {
  "session-gone": "upload.error.sessionGone",
  network: "upload.error.network",
  "rate-limited": "upload.error.rateLimited",
  "too-many-uploads": "upload.error.tooManyUploads",
  quota: "upload.error.quota",
  "disk-full": "upload.error.diskFull",
  "sign-in": "upload.error.signIn",
  "not-video": "upload.error.notVideo",
};

/** The error of an upload in the viewer's language when it has a code, else as the server sent it. */
function errorText(s: UploadSnapshot, t: CommonT): string | null {
  return s.errorCode ? t(ERROR_KEYS[s.errorCode]) : s.error;
}

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
  const t = useT("common");
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
      setNotice(t("upload.empty"));
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
                {value ? t("upload.replace") : t("upload.choose")}
              </button>{" "}
              {t("upload.dragHint")}
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
            className="absolute inset-e-2 top-2 rounded-md p-1 text-ink-faint hover:bg-surface-3 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={t("upload.remove")}
          >
            <Icon.X className="size-4" />
          </button>
        )}
      </div>

      {!snapshot && pending.length > 0 && (
        <ul className="space-y-1.5" aria-label={t("upload.unfinished")}>
          {pending.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs text-ink-muted">
              <Icon.Clock className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1">
                {t.rich("upload.stoppedAt", {
                  name: item.fileName,
                  percent: Math.floor((item.offset / item.size) * 100),
                  loaded: formatBytes(item.offset),
                  total: formatBytes(item.size),
                  file: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                })}
              </span>
              <button type="button" onClick={() => discard(item)} className="rounded font-medium text-ink-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent">
                {t("upload.discard")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice ? <p className="text-xs text-danger">{notice}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** "about 3 min left", in the interface language (null while the speed is unknown). */
function timeLeft(seconds: number | null, t: CommonT): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) return t("upload.timeLeftFew");
  if (seconds < 60) return t("upload.timeLeftSeconds", { seconds: Math.ceil(seconds / 5) * 5 });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("upload.timeLeftMinutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t("upload.timeLeftHoursMinutes", { hours, minutes: rest }) : t("upload.timeLeftHours", { hours });
}

function statusLine(s: UploadSnapshot, t: CommonT): string {
  switch (s.phase) {
    case "starting":
      return t("upload.preparing");
    case "uploading": {
      const parts = [s.resumed ? t("upload.resumed") : t("upload.uploading"), t("upload.amount", { loaded: formatBytes(s.loaded), total: formatBytes(s.total) })];
      if (s.bytesPerSecond > 0) parts.push(t("upload.speed", { amount: formatBytes(s.bytesPerSecond) }));
      const left = timeLeft(s.secondsLeft, t);
      if (left) parts.push(left);
      return parts.join(" · ");
    }
    case "retrying":
      return s.offline ? t("upload.offline") : t("upload.retrying", { attempt: s.attempt });
    case "paused":
      return t("upload.pausedAt", { loaded: formatBytes(s.loaded), total: formatBytes(s.total) });
    case "finishing":
      return t("upload.finishing");
    case "error":
      return errorText(s, t) ?? t("upload.failed");
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
  const t = useT("common");
  const percent = s.total > 0 ? Math.min(100, Math.floor((s.loaded / s.total) * 100)) : 0;
  const tone = s.phase === "error" ? "bg-danger" : s.phase === "paused" || s.phase === "retrying" ? "bg-warning" : "bg-accent";
  const canPause = s.chunked && (s.phase === "uploading" || s.phase === "retrying");
  // Phase changes are announced; the moving numbers are not (they would flood screen readers).
  const announcement =
    s.phase === "error"
      ? t("upload.failedWith", { error: errorText(s, t) ?? "" })
      : s.phase === "paused"
        ? t("upload.announcePaused")
        : s.phase === "finishing"
          ? t("upload.announceFinishing")
          : s.phase === "retrying"
            ? t("upload.announceRetrying")
            : "";

  return (
    <div className="mx-auto w-full max-w-md text-start">
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
        aria-label={t("upload.progressLabel", { name: s.fileName })}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone, s.phase === "finishing" && "animate-pulse")} style={{ width: `${percent}%` }} />
      </div>
      <p id={statusId} className={cn("mt-1.5 flex items-start gap-1.5 text-xs", s.phase === "error" ? "text-danger" : "text-ink-muted")}>
        {(s.phase === "starting" || s.phase === "finishing" || s.phase === "retrying") && <Icon.Loader className="mt-px size-3.5 shrink-0 animate-spin" aria-hidden />}
        {s.phase === "error" && <Icon.AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 wrap-break-word">{statusLine(s, t)}</span>
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canPause && (
          <ControlButton onClick={onPause} icon={<Icon.Pause className="size-3.5" aria-hidden />}>
            {t("upload.pause")}
          </ControlButton>
        )}
        {(s.phase === "paused" || (s.phase === "error" && s.canResume)) && (
          <ControlButton onClick={onResume} icon={<Icon.Play className="size-3.5" aria-hidden />} primary>
            {s.phase === "paused" ? t("upload.resume") : t("actions.tryAgain")}
          </ControlButton>
        )}
        {s.phase === "error" && !s.canResume ? (
          <ControlButton onClick={onDismiss} icon={<Icon.X className="size-3.5" aria-hidden />}>
            {t("upload.chooseAnother")}
          </ControlButton>
        ) : (
          s.phase !== "finishing" && (
            <ControlButton onClick={onCancel} icon={<Icon.X className="size-3.5" aria-hidden />} danger>
              {t("actions.cancel")}
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
  const t = useT("common");
  if (!media.url) {
    return (
      <div className="flex h-32 items-center justify-center gap-2 text-sm text-white/70">
        {media.status === "resolving" ? <Icon.Loader className="size-4 animate-spin" /> : <Icon.Video className="size-4" />}
        <span>{media.status === "resolving" ? t("upload.loadingPreview") : (media.message ?? t("upload.previewUnavailable"))}</span>
      </div>
    );
  }
  return <video src={media.url} className="mx-auto max-h-48" controls={false} muted playsInline preload="metadata" />;
}
