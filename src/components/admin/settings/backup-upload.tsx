"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { BackupInfo } from "@/lib/db/backup";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatBytes } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { BACKUP_FILE_EXTENSIONS, isBackupFileName } from "./data-labels";

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string; sizeBytes: number; percent: number }
  /** Every byte was sent; the server is checking the file (integrity check, schema, JSON shape). */
  | { status: "checking"; fileName: string; sizeBytes: number }
  | { status: "error"; fileName: string | null; error: string };

const UPLOAD_URL = "/api/admin/backup/upload";

function parseResponse(text: string): { ok: true; backup: BackupInfo } | { ok: false; error: string } | null {
  try {
    const body = JSON.parse(text) as { ok?: boolean; backup?: BackupInfo; error?: string };
    if (body.ok && body.backup) return { ok: true, backup: body.backup };
    if (typeof body.error === "string") return { ok: false, error: body.error };
  } catch {
    // Not JSON: a proxy error page, for instance.
  }
  return null;
}

/**
 * "Restore from a file": sends a `.sqlite` backup or JSON export to the
 * server as the raw request body (streamed to disk there), with progress and
 * cancel. Nothing is restored by the upload: `onUploaded` opens the restore
 * confirmation for the stored file.
 */
export function BackupUpload({ maxBytes, onUploaded, disabled }: { maxBytes: number; onUploaded: (backup: BackupInfo) => void; disabled?: boolean }) {
  const t = useT("admin");
  const tc = useT("common");
  const f = useFormatter();
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);

  // Leaving the page stops an upload in progress.
  useEffect(() => () => request.current?.abort(), []);

  const upload = useCallback(
    (file: File) => {
      const problem = !isBackupFileName(file.name)
        ? t("backups.upload.wrongType", { types: BACKUP_FILE_EXTENSIONS.join(", ") })
        : file.size === 0
          ? t("backups.upload.empty")
          : file.size > maxBytes
            ? t("backups.upload.tooLarge", { limit: f.number(Math.round(maxBytes / (1024 * 1024))) })
            : null;
      if (problem) {
        setState({ status: "error", fileName: file.name, error: problem });
        return;
      }
      request.current?.abort();
      const xhr = new XMLHttpRequest();
      request.current = xhr;
      const finish = (next: UploadState) => {
        if (request.current !== xhr) return;
        request.current = null;
        setState(next);
      };
      xhr.open("POST", UPLOAD_URL);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.upload.onprogress = (event) => {
        if (request.current !== xhr || !event.lengthComputable) return;
        setState({ status: "uploading", fileName: file.name, sizeBytes: file.size, percent: (event.loaded / event.total) * 100 });
      };
      xhr.upload.onload = () => {
        if (request.current === xhr) setState({ status: "checking", fileName: file.name, sizeBytes: file.size });
      };
      xhr.onload = () => {
        const result = parseResponse(xhr.responseText);
        if (result?.ok) {
          finish({ status: "idle" });
          onUploaded(result.backup);
          return;
        }
        finish({ status: "error", fileName: file.name, error: result?.error ?? t("backups.upload.serverError", { status: xhr.status }) });
      };
      xhr.onerror = () => finish({ status: "error", fileName: file.name, error: t("backups.upload.connectionLost") });
      xhr.onabort = () => finish({ status: "idle" });
      setState({ status: "uploading", fileName: file.name, sizeBytes: file.size, percent: 0 });
      xhr.send(file);
    },
    [maxBytes, onUploaded, t, f],
  );

  const busy = state.status === "uploading" || state.status === "checking";

  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow choosing the same file again after an error.
    event.target.value = "";
    if (file) upload(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn("rounded-lg border border-dashed px-4 py-4 transition-colors", dragging ? "border-accent bg-accent/5" : "border-border-strong bg-surface-2/40")}
    >
      <input ref={input} type="file" accept={BACKUP_FILE_EXTENSIONS.join(",")} onChange={onChoose} className="sr-only" tabIndex={-1} aria-hidden="true" disabled={disabled || busy} />

      {!busy && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{t("backups.upload.title")}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {t.rich("backups.upload.hint", {
                ext: ".sqlite",
                size: formatBytes(maxBytes),
                mono: (chunks) => (
                  <span dir="ltr" className="font-mono">
                    {chunks}
                  </span>
                ),
              })}
            </p>
          </div>
          <Button variant="outline" leftIcon={<Icon.Upload className="size-4" />} onClick={() => input.current?.click()} disabled={disabled} className="self-start sm:self-auto">
            {t("backups.upload.choose")}
          </Button>
        </div>
      )}

      {busy && (
        <div aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-ink">{state.fileName}</p>
            <Button variant="ghost" size="sm" onClick={() => request.current?.abort()}>
              {tc("actions.cancel")}
            </Button>
          </div>
          <ProgressBar
            className="mt-2"
            size="sm"
            value={state.status === "uploading" ? state.percent : 100}
            label={state.status === "uploading" ? t("backups.upload.uploading", { size: formatBytes(state.sizeBytes) }) : t("backups.upload.checking")}
            showLabel={state.status === "uploading"}
          />
        </div>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            {state.fileName ? t.rich("backups.upload.errorWithFile", { file: state.fileName, error: state.error, b: (chunks) => <span className="break-all font-medium">{chunks}</span> }) : state.error}
          </span>
        </p>
      )}
    </div>
  );
}
