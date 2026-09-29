"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cn, formatBytes, pluralize } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormError } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

interface Preview {
  title: string;
  chapters: number;
  lessons: number;
  quizzes: number;
  assignments: number;
  exercises: number;
  exportedAt?: string;
}

/** Must match MAX_IMPORT_BYTES in src/lib/actions/course-import.ts. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Route handler that performs the import (Server Actions are limited to 1 MB bodies). */
const UPLOAD_URL = "/admin/courses/import/upload";

type UploadResponse = { ok: true; redirectTo: string; message: string; tone: "success" | "warning" } | { ok: false; error: string };

async function inspect(file: File): Promise<{ preview: Preview } | { error: string }> {
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") return { error: "Please upload a valid JSON export (.json)." };
  if (file.size > MAX_BYTES) return { error: `This file is too large (${formatBytes(file.size)}; max 5 MB).` };
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { error: "This file is not valid JSON." };
  }
  if (!data || typeof data !== "object") return { error: "This is not a course export file." };
  const d = data as Record<string, unknown>;
  if (d.format !== "learnloop-course") return { error: "This is not a course export file. Export a course from its Export tab first." };
  if (d.version !== 1) return { error: `Unsupported export version: ${String(d.version)}.` };
  const course = d.course as Record<string, unknown> | undefined;
  if (!course || typeof course.title !== "string" || !course.title.trim()) return { error: "The export has no course title." };
  const count = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : 0);
  return {
    preview: {
      title: course.title,
      chapters: count("chapters"),
      lessons: count("lessons"),
      quizzes: count("quizzes"),
      assignments: count("assignments"),
      exercises: count("exercises"),
      exportedAt: typeof d.exportedAt === "string" ? d.exportedAt.slice(0, 10) : undefined,
    },
  };
}

export function ImportCourseForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file || !preview || pending) return;
    setPending(true);
    setSubmitError(null);
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch(UPLOAD_URL, { method: "POST", body });
      let data: UploadResponse | null = null;
      try {
        data = (await res.json()) as UploadResponse;
      } catch {
        data = null;
      }
      if (!data) {
        setSubmitError(res.status === 413 ? "This file is too large (max 5 MB)." : "Error importing course. Please try again.");
        setPending(false);
        return;
      }
      if (!data.ok) {
        setSubmitError(data.error);
        setPending(false);
        return;
      }
      toast.toast({ title: data.message, tone: data.tone });
      // Keep the button busy while the new course loads.
      router.push(data.redirectTo);
    } catch {
      setSubmitError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  };

  const choose = async (next: File | null) => {
    setPreview(null);
    setError(null);
    setSubmitError(null);
    setFile(next);
    if (!next) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const result = await inspect(next);
    if ("error" in result) setError(result.error);
    else setPreview(result.preview);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(dropped);
    inputRef.current.files = dt.files;
    void choose(dropped);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5">
      <FormError message={submitError} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-40 flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-border-strong bg-surface-2/50",
        )}
      >
        <input
          ref={inputRef}
          id="import-file"
          type="file"
          name="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-left">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted">
              <Icon.FileText className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{file.name}</span>
              <span className="block text-xs text-ink-muted">{formatBytes(file.size)}</span>
            </span>
            <button type="button" onClick={() => void choose(null)} className="rounded-md p-1.5 text-ink-faint hover:bg-danger/10 hover:text-danger" aria-label="Remove file" disabled={pending}>
              <Icon.Trash className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <Icon.Upload className="mb-3 size-8 text-ink-faint" />
            <p className="text-sm text-ink-muted">
              Drag and drop a course JSON file, or upload from your{" "}
              <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-accent hover:underline">
                Device
              </button>
            </p>
            <p className="mt-1 text-xs text-ink-faint">Files exported from any course&apos;s Export tab (max 5 MB).</p>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Ready to import</p>
          <p className="mt-1 text-lg font-semibold text-ink">{preview.title}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {pluralize(preview.chapters, "chapter")} · {pluralize(preview.lessons, "lesson")} · {pluralize(preview.quizzes, "quiz", "quizzes")} · {pluralize(preview.assignments, "assignment")} ·{" "}
            {pluralize(preview.exercises, "exercise")}
            {preview.exportedAt && <> · exported {preview.exportedAt}</>}
          </p>
          <ul className="mt-3 space-y-1 text-xs text-ink-muted">
            <li className="flex items-center gap-1.5">
              <Icon.Check className="size-3.5 text-success" /> New ids are generated, so the original course is untouched.
            </li>
            <li className="flex items-center gap-1.5">
              <Icon.Check className="size-3.5 text-success" /> The copy is created unpublished and In progress, with you as the creator.
            </li>
            <li className="flex items-center gap-1.5">
              <Icon.Check className="size-3.5 text-success" /> Quizzes, questions, assignments and exercises are copied with the course.
            </li>
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <ButtonLink href="/admin/courses" variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={pending} disabled={!preview || !!error} leftIcon={<Icon.Upload className="size-4" />}>
          Import course
        </Button>
      </div>
    </form>
  );
}
