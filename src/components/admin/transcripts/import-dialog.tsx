"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import type { TranscriptCue } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, RadioCard } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { MAX_IMPORT_CHARS, TranscriptParseError, parseCaptionFile } from "@/lib/transcripts/format";
import { formatTimeInput, parseOffsetInput, type ImportMode } from "@/lib/transcripts/editor-state";
import { cn } from "@/lib/utils";

interface Parsed {
  name: string;
  format: "vtt" | "srt";
  cues: TranscriptCue[];
  skipped: number[];
}

export interface ImportRequest {
  cues: TranscriptCue[];
  mode: ImportMode;
  offset: number;
  fileName: string;
}

/**
 * Import a WebVTT or SubRip file (chosen, dropped, or the video's own
 * caption file): parsed in the browser, summarized, then replacing or added
 * to the current captions, optionally moved in time.
 */
export function ImportDialog({
  open,
  onClose,
  currentCount,
  videoCaptionsUrl,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  currentCount: number;
  videoCaptionsUrl?: string;
  onImport: (request: ImportRequest) => void;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("replace");
  const [offsetText, setOffsetText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setParsed(null);
    setError(null);
    setMode("replace");
    setOffsetText("");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const close = () => {
    reset();
    onClose();
  };

  const readText = (text: string, name: string) => {
    try {
      const result = parseCaptionFile(text, name);
      setParsed({ name, format: result.format, cues: result.cues, skipped: result.skipped });
      setError(null);
    } catch (err) {
      setParsed(null);
      setError(err instanceof TranscriptParseError ? err.message : "This file could not be read as captions.");
    }
  };

  const readFile = async (file: File) => {
    // UTF-8 can take up to 4 bytes a character; refuse obviously oversized files before reading them.
    if (file.size > MAX_IMPORT_CHARS * 4) {
      setParsed(null);
      setError("The caption file is too large.");
      return;
    }
    setBusy(true);
    try {
      readText(await file.text(), file.name);
    } catch {
      setError("The file could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  const importVideoCaptions = async () => {
    if (!videoCaptionsUrl) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(videoCaptionsUrl, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const name = decodeURIComponent(new URL(videoCaptionsUrl, window.location.href).pathname.split("/").pop() || "captions.vtt");
      readText(await res.text(), name);
    } catch {
      setParsed(null);
      setError("The video's caption file could not be downloaded. Download it and choose it here instead.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  const offset = offsetText.trim() ? parseOffsetInput(offsetText) : 0;
  const offsetInvalid = offset === null;

  const submit = () => {
    if (!parsed || offset === null) return;
    onImport({ cues: parsed.cues, mode: currentCount ? mode : "replace", offset, fileName: parsed.name });
    reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Import captions"
      description="WebVTT (.vtt) or SubRip (.srt). Formatting tags are removed; speaker tags become “Name:”."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!parsed || offsetInvalid} leftIcon={<Icon.Upload className="size-4" />}>
            {parsed ? `Import ${parsed.cues.length.toLocaleString("en-US")} ${parsed.cues.length === 1 ? "caption" : "captions"}` : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:border-accent",
            dragging ? "border-accent bg-accent/5" : "border-border-strong hover:bg-surface-2",
          )}
        >
          {busy ? <Icon.Loader className="size-6 animate-spin text-ink-muted" /> : <Icon.FileText className="size-6 text-ink-muted" />}
          <span className="text-sm font-medium text-ink">{parsed ? parsed.name : "Choose a caption file or drop it here"}</span>
          <span className="text-xs text-ink-muted">.vtt or .srt, up to 4 MB</span>
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept=".vtt,.srt,text/vtt,application/x-subrip"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>

        {videoCaptionsUrl && !parsed && (
          <Button variant="outline" size="sm" onClick={() => void importVideoCaptions()} loading={busy} leftIcon={<Icon.Captions className="size-4" />}>
            Use the video&apos;s caption file
          </Button>
        )}

        <FormError message={error} />

        {parsed && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
              <p className="font-medium text-ink">
                {parsed.cues.length.toLocaleString("en-US")} {parsed.cues.length === 1 ? "caption" : "captions"} found ({parsed.format.toUpperCase()}), ending at{" "}
                <span className="font-mono tabular-nums">{formatTimeInput(parsed.cues[parsed.cues.length - 1]?.end ?? 0)}</span>.
              </p>
              {parsed.skipped.length > 0 && (
                <p className="mt-1 text-xs text-warning">
                  {parsed.skipped.length} {parsed.skipped.length === 1 ? "block" : "blocks"} could not be read and will be left out (line {parsed.skipped.slice(0, 5).join(", ")}
                  {parsed.skipped.length > 5 ? "…" : ""}).
                </p>
              )}
              <ol className="mt-2 space-y-1 text-xs text-ink-muted">
                {parsed.cues.slice(0, 3).map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 font-mono tabular-nums">{formatTimeInput(c.start)}</span>
                    <span className="min-w-0 truncate text-ink">{c.text.replace(/\n/g, " ")}</span>
                  </li>
                ))}
              </ol>
            </div>

            {currentCount > 0 && (
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-1.5 text-sm font-medium text-ink">The editor already has {currentCount.toLocaleString("en-US")} captions</legend>
                <RadioCard name="import-mode" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} title="Replace them" description="Start over from this file." />
                <RadioCard name="import-mode" value="append" checked={mode === "append"} onChange={() => setMode("append")} title="Add to them" description="Keep the current captions and sort the new ones in." />
              </fieldset>
            )}

            <Field label="Move the imported captions by" htmlFor={`${inputId}-offset`} hint="Optional. Seconds or m:ss, e.g. +2.5 or -0:01.200 (when the file was made for a cut with a different intro)." error={offsetInvalid ? "Enter a time such as +2.5 or -0:01.200." : undefined}>
              <Input id={`${inputId}-offset`} value={offsetText} onChange={(e) => setOffsetText(e.target.value)} placeholder="0" inputMode="decimal" invalid={offsetInvalid} className="max-w-40 font-mono" />
            </Field>
            <p className="text-xs text-ink-muted">Nothing is saved until you choose Save; you can undo the import.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
