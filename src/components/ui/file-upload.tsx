"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { cn, formatBytes } from "@/lib/utils";
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
  video: "video/mp4,video/webm,video/ogg,video/quicktime",
  image: "image/*",
  document: ".pdf,.txt,.md,.vtt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,audio/*",
  auto: "*/*",
};

/**
 * Drag-and-drop uploader that POSTs to /api/upload with progress, then
 * exposes the resulting URL through `onChange` and a hidden input.
 */
export function FileUpload({ name, value, onChange, kind = "auto", accept, label, hint, className, preview = true, disabled }: FileUploadProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [meta, setMeta] = useState<{ name: string; size: number; type: string } | null>(null);

  const upload = (file: File) => {
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      try {
        const res = JSON.parse(xhr.responseText) as { ok: boolean; url?: string; error?: string; name?: string; size?: number; type?: string };
        if (!res.ok || !res.url) {
          setError(res.error ?? "Upload failed");
          return;
        }
        const m = { name: res.name ?? file.name, size: res.size ?? file.size, type: res.type ?? file.type };
        setMeta(m);
        onChange?.(res.url, m);
      } catch {
        setError("Upload failed");
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Network error during upload");
    };
    xhr.send(form);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const isImage = value && /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(value);
  const isVideo = value && /\.(mp4|webm|ogv|mov)(\?|$)/i.test(value);

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
          if (!disabled) setDragging(true);
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
          disabled={disabled || progress !== null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        {value && preview && (isImage || isVideo) ? (
          <div className="mb-3 overflow-hidden rounded-lg bg-black">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt="" className="mx-auto max-h-48 object-contain" />
            ) : (
              <video src={value} className="mx-auto max-h-48" controls={false} muted playsInline preload="metadata" />
            )}
          </div>
        ) : null}
        {value ? (
          <p className="mb-2 flex items-center justify-center gap-2 text-sm text-ink">
            <Icon.CheckCircle className="size-4 text-success" />
            <span className="max-w-xs truncate">{meta?.name ?? value.split("/").pop()}</span>
            {meta && <span className="text-xs text-ink-faint">({formatBytes(meta.size)})</span>}
          </p>
        ) : (
          <Icon.Upload className="mx-auto mb-2 size-6 text-ink-faint" />
        )}
        {progress !== null ? (
          <div className="mx-auto max-w-xs">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-muted">Uploading… {progress}%</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            <button type="button" onClick={() => inputRef.current?.click()} className="font-medium text-accent hover:underline" disabled={disabled}>
              {value ? "Replace file" : "Choose a file"}
            </button>{" "}
            or drag it here
          </p>
        )}
        {value && !disabled && progress === null && (
          <button
            type="button"
            onClick={() => {
              setMeta(null);
              onChange?.("", undefined);
            }}
            className="absolute right-2 top-2 rounded-md p-1 text-ink-faint hover:bg-surface-3 hover:text-danger"
            aria-label="Remove file"
          >
            <Icon.X className="size-4" />
          </button>
        )}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
