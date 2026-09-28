"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ActionResult, NoteColor } from "@/lib/types";
import { createNoteAction, deleteNoteAction, updateNoteAction } from "@/lib/actions/notes";
import { Markdown } from "@/lib/markdown";
import { cn, formatTime, relativeTime, truncate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Checkbox, FormError, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useLessonRuntime } from "./lesson-runtime";
import { NOTE_COLORS, noteColorStyle } from "./note-colors";
import type { NoteItem } from "./types";

type NoteState = ActionResult<NoteItem> | null;

/** Notes tab of the lesson sidebar: composer + the learner's notes for this lesson. */
export function NotesPanel() {
  const rt = useLessonRuntime();
  const [sort, setSort] = useState<"newest" | "time">("newest");
  const hasTimestamps = rt.notes.some((n) => n.timestampSeconds !== undefined);
  const sorted = useMemo(() => {
    if (sort === "newest" || !hasTimestamps) return rt.notes;
    return [...rt.notes].sort((a, b) => (a.timestampSeconds ?? Number.MAX_SAFE_INTEGER) - (b.timestampSeconds ?? Number.MAX_SAFE_INTEGER));
  }, [rt.notes, sort, hasTimestamps]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">My notes</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Private to you. Select text in the lesson to highlight it{rt.hasVideo ? ", or attach the current video time to a note" : ""}.
        </p>
      </div>

      <NoteComposer />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          {rt.notes.length} {rt.notes.length === 1 ? "note" : "notes"}
        </p>
        {hasTimestamps && rt.notes.length > 1 && (
          <SegmentedControl
            size="xs"
            value={sort}
            onChange={setSort}
            options={[
              { value: "newest", label: "Newest" },
              { value: "time", label: "Video time" },
            ]}
          />
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon.Note />}
          title="No notes yet"
          description="Write a note above or select text in the lesson to save it here for quick revision."
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColorPicker({ name, value, onChange, disabled }: { name: string; value: NoteColor; onChange: (c: NoteColor) => void; disabled?: boolean }) {
  return (
    <fieldset className="flex items-center gap-1.5" disabled={disabled}>
      <legend className="sr-only">Note color</legend>
      {NOTE_COLORS.map((c) => (
        <label key={c.value} className="relative flex cursor-pointer items-center justify-center p-0.5" title={c.label}>
          <input type="radio" name={name} value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} className="peer sr-only" />
          <span
            className={cn(
              "block size-5 rounded-full ring-offset-2 ring-offset-surface-1 transition-shadow peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
              c.swatch,
            )}
          />
          <span className="sr-only">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function NoteComposer() {
  const rt = useLessonRuntime();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [color, setColor] = useState<NoteColor>("yellow");
  const [text, setText] = useState("");
  const [attachTime, setAttachTime] = useState(false);
  const currentTime = useSyncExternalStore(rt.time.subscribe, rt.time.get, () => 0);
  const { pendingQuote, clearQuote } = rt;

  const [state, formAction, pending] = useActionState<NoteState, FormData>(async (prev, formData) => {
    const res = await createNoteAction(prev, formData);
    if (res.ok) {
      setText("");
      setAttachTime(false);
      clearQuote();
      toast.success("Note saved");
    }
    return res;
  }, null);

  // Focus the composer when a quote arrives from the lesson content.
  useEffect(() => {
    if (pendingQuote) formRef.current?.querySelector<HTMLTextAreaElement>("textarea[name=note]")?.focus();
  }, [pendingQuote]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const generalError = state && !state.ok && !state.fieldErrors ? state.error : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-2.5 rounded-xl border border-border bg-surface-2/50 p-3" aria-label="Add a note">
      <input type="hidden" name="lessonId" value={rt.lessonId} />
      {pendingQuote && <input type="hidden" name="highlightedText" value={pendingQuote} />}
      {attachTime && <input type="hidden" name="timestampSeconds" value={Math.floor(currentTime)} />}
      <FormError message={generalError} />

      {pendingQuote && (
        <div className={cn("relative rounded-md border-l-2 border-l-accent py-1.5 pl-2.5 pr-8 text-sm italic text-ink-muted", noteColorStyle(color).soft)}>
          “{truncate(pendingQuote, 240)}”
          <button type="button" onClick={clearQuote} className="absolute right-1 top-1 rounded p-1 text-ink-faint hover:bg-surface-3 hover:text-ink" aria-label="Remove quote">
            <Icon.X className="size-3.5" />
          </button>
        </div>
      )}

      <label htmlFor="note-text" className="sr-only">
        Note
      </label>
      <Textarea
        id="note-text"
        name="note"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={pendingQuote ? "Add your thoughts about this passage…" : "Write a note… (Markdown supported)"}
        invalid={!!errors.note}
        aria-describedby={errors.note ? "note-text-error" : undefined}
        maxLength={5000}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        className="bg-surface-1"
      />
      {errors.note && (
        <p id="note-text-error" className="text-xs text-danger">
          {errors.note}
        </p>
      )}
      {errors.timestampSeconds && <p className="text-xs text-danger">{errors.timestampSeconds}</p>}

      {rt.hasVideo && (
        <Checkbox
          id="note-attach-time"
          name="attachTime"
          checked={attachTime}
          onChange={(e) => setAttachTime(e.target.checked)}
          label={
            <span className="font-normal text-ink-muted">
              Attach current video time <span className="font-mono tabular-nums text-ink">{formatTime(currentTime)}</span>
            </span>
          }
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ColorPicker name="color" value={color} onChange={setColor} disabled={pending} />
        <Button type="submit" size="sm" loading={pending} disabled={!text.trim() && !pendingQuote}>
          Save note
        </Button>
      </div>
      <p className="text-[11px] text-ink-faint">Press Ctrl + Enter to save.</p>
    </form>
  );
}

function NoteCard({ note }: { note: NoteItem }) {
  const rt = useLessonRuntime();
  const toast = useToast();
  const style = noteColorStyle(note.color);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, startDelete] = useTransition();
  const onlyHighlight = !!note.highlightedText && !note.note;

  const remove = () => {
    startDelete(async () => {
      const res = await deleteNoteAction(note.id);
      if (!res.ok) {
        toast.error("Could not delete the note", res.error);
        return;
      }
      setConfirmOpen(false);
      toast.success(res.message ?? "Note deleted");
    });
  };

  return (
    <article className={cn("rounded-lg border border-l-4 border-border bg-surface-1 p-3 shadow-sm", style.border)} aria-label={onlyHighlight ? "Highlight" : "Note"}>
      <header className="flex items-center gap-2 text-xs text-ink-muted">
        <span className={cn("size-2.5 shrink-0 rounded-full", style.swatch)} aria-hidden="true" />
        {note.timestampSeconds !== undefined &&
          (rt.hasVideo ? (
            <button
              type="button"
              onClick={() => rt.seekPrimary(note.timestampSeconds!)}
              className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono font-medium tabular-nums text-accent transition-colors hover:bg-accent/20"
              aria-label={`Play video from ${formatTime(note.timestampSeconds)}`}
            >
              <Icon.Play className="size-3" />
              {formatTime(note.timestampSeconds)}
            </button>
          ) : (
            <span className="font-mono tabular-nums">{formatTime(note.timestampSeconds)}</span>
          ))}
        {onlyHighlight && <span className="font-medium text-ink-muted">Highlight</span>}
        <time dateTime={note.updatedAt} className="ml-auto shrink-0" suppressHydrationWarning>
          {relativeTime(note.updatedAt)}
        </time>
        <Dropdown
          trigger={
            <span className="flex size-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink">
              <Icon.MoreHorizontal className="size-4" />
              <span className="sr-only">Note actions</span>
            </span>
          }
          items={[
            { label: "Edit", icon: <Icon.Edit />, onClick: () => setEditing(true) },
            { label: onlyHighlight ? "Remove highlight" : "Delete", icon: <Icon.Trash />, destructive: true, onClick: () => setConfirmOpen(true) },
          ]}
        />
      </header>

      {note.highlightedText && (
        <button
          type="button"
          onClick={() => rt.focusQuote(note.highlightedText!)}
          className={cn("mt-2 block w-full rounded-md px-2.5 py-1.5 text-left text-sm italic text-ink transition-opacity hover:opacity-80", style.soft)}
          title="Show in lesson"
        >
          “{truncate(note.highlightedText, 280)}”
        </button>
      )}

      {editing ? (
        <NoteEditForm note={note} onDone={() => setEditing(false)} />
      ) : (
        note.note && (
          <div className="mt-2 break-words">
            <Markdown content={note.note} />
          </div>
        )
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
        title={onlyHighlight ? "Remove this highlight?" : "Delete this note?"}
        description={
          note.highlightedText
            ? "The note and its highlight in the lesson will be removed. This cannot be undone."
            : "The note will be removed permanently. This cannot be undone."
        }
        confirmLabel={onlyHighlight ? "Remove" : "Delete"}
        destructive
        loading={deleting}
      />
    </article>
  );
}

function NoteEditForm({ note, onDone }: { note: NoteItem; onDone: () => void }) {
  const toast = useToast();
  const [color, setColor] = useState<NoteColor>(note.color);
  const [text, setText] = useState(note.note);
  const [state, formAction, pending] = useActionState<NoteState, FormData>(async (prev, formData) => {
    const res = await updateNoteAction(prev, formData);
    if (res.ok) {
      toast.success("Note updated");
      onDone();
    }
    return res;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const fieldId = `note-edit-${note.id}`;

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="noteId" value={note.id} />
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : null} />
      <label htmlFor={fieldId} className="sr-only">
        Edit note
      </label>
      <Textarea
        id={fieldId}
        name="note"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        invalid={!!errors.note}
        maxLength={5000}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
      />
      {errors.note && <p className="text-xs text-danger">{errors.note}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ColorPicker name="color" value={color} onChange={setColor} disabled={pending} />
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="xs" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="xs" loading={pending}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
