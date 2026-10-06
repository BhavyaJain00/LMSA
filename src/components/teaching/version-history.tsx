"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import {
  loadLessonHistoryAction,
  loadLessonVersionDiffAction,
  restoreLessonVersionAction,
  setLessonVersionNoteAction,
  type RestoreResult,
} from "@/lib/actions/versions";
import { CURRENT_VERSION_ID, describeChange, VERSION_LIMITS, type LessonDiff, type VersionCompareMode, type VersionTimelineRow, type VersionTimelineView } from "@/lib/teaching/version-shared";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { LocalDateTime } from "@/components/assessments/client-time";
import { cn } from "@/lib/utils";
import { LessonDiffView } from "./version-diff";

/**
 * "History" button of the lesson editor and the version panel it opens: the
 * kept versions of the lesson (author, time, note, what changed), a
 * side-by-side comparison with the previous version or with the current
 * lesson, notes on versions, and restore (the current content is kept as a
 * new version first, so a restore can be undone the same way).
 */

type Load<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

export interface LessonHistoryButtonProps {
  lessonId: string;
  /** The editor has unsaved changes (a restore replaces them). */
  dirty: boolean;
  /** Called with the restored lesson so the editor can show it without reloading. */
  onRestored: (lesson: RestoreResult) => void;
}

export function LessonHistoryButton({ lessonId, dirty, onRestored }: LessonHistoryButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} leftIcon={<Icon.Clock className="size-4" />} title="Version history" aria-haspopup="dialog">
        <span className="hidden sm:inline">History</span>
        <span className="sr-only sm:hidden">Version history</span>
      </Button>
      {open && <LessonHistoryDialog lessonId={lessonId} dirty={dirty} onRestored={onRestored} onClose={() => setOpen(false)} />}
    </>
  );
}

function entryLabel(entry: VersionTimelineRow): string {
  if (entry.current) return "Current version";
  return entry.note ?? (entry.change ? describeChange(entry.change) : "Oldest kept version");
}

function AuthorLine({ entry }: { entry: VersionTimelineRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      {entry.author ? <Avatar name={entry.author.name} src={entry.author.avatarUrl} size="xs" /> : <Icon.User className="size-4 shrink-0 text-ink-faint" />}
      <span className="truncate">{entry.author?.name ?? (entry.savedById ? "Former member" : "Earlier edit")}</span>
      {entry.savedAt && (
        <>
          <span aria-hidden="true">·</span>
          <LocalDateTime iso={entry.savedAt} className="shrink-0" />
        </>
      )}
    </span>
  );
}

function Timeline({
  entries,
  selectedId,
  onSelect,
}: {
  entries: VersionTimelineRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-entry]") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)));
    buttons[next]?.focus();
    const id = buttons[next]?.dataset.entry;
    if (id) onSelect(id);
  };
  return (
    <ol ref={listRef} className="space-y-1.5" aria-label="Versions, newest first" onKeyDown={onKeyDown}>
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              type="button"
              data-entry={entry.id}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(entry.id)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                selected ? "border-accent bg-accent/8" : "border-border hover:bg-surface-2",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{entryLabel(entry)}</span>
                {entry.current ? (
                  <Badge tone="accent" size="xs">
                    Live
                  </Badge>
                ) : (
                  entry.sameAsCurrent && (
                    <Badge tone="neutral" size="xs">
                      Same as live
                    </Badge>
                  )
                )}
              </span>
              {entry.note && entry.change && <span className="mt-0.5 block truncate text-xs text-ink-muted">{describeChange(entry.change)}</span>}
              <span className="mt-1 block">
                <AuthorLine entry={entry} />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function NoteEditor({ lessonId, entry, onSaved }: { lessonId: string; entry: VersionTimelineRow; onSaved: (note: string | null) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.note ?? "");
  const [pending, start] = useTransition();
  if (!entry.metaId) return null;
  const metaId = entry.metaId;

  const save = () =>
    start(async () => {
      const res = await setLessonVersionNoteAction(lessonId, metaId, value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Note saved");
      onSaved(res.data.note);
      setEditing(false);
    });

  if (!editing) {
    return (
      <Button variant="link" size="xs" onClick={() => setEditing(true)} leftIcon={<Icon.Edit className="size-3.5" />}>
        {entry.note ? "Edit note" : "Add a note"}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor="version-note" className="sr-only">
        Note for this version
      </label>
      <Input
        id="version-note"
        value={value}
        maxLength={VERSION_LIMITS.noteMax}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            // Close the note field only, not the whole panel.
            e.preventDefault();
            setEditing(false);
          }
        }}
        placeholder="What changed, e.g. “Rewrote the introduction”"
        autoFocus
      />
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={save} loading={pending}>
          Save note
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DiffSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function LessonHistoryDialog({ lessonId, dirty, onRestored, onClose }: LessonHistoryButtonProps & { onClose: () => void }) {
  const toast = useToast();
  const [timeline, setTimeline] = useState<Load<VersionTimelineView>>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<VersionCompareMode>("changes");
  const [diffs, setDiffs] = useState<Record<string, Load<LessonDiff | null>>>({});
  const [mobileDetail, setMobileDetail] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, startRestore] = useTransition();
  const [attempt, setAttempt] = useState(0);
  const [diffAttempt, setDiffAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadLessonHistoryAction(lessonId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setTimeline({ status: "error", error: res.error });
          return;
        }
        setTimeline({ status: "ready", data: res.data });
        // Comparisons are recomputed against the reloaded history.
        setDiffs({});
        setDiffAttempt((n) => n + 1);
        setSelectedId((current) => (current && res.data.entries.some((e) => e.id === current) ? current : (res.data.entries[0]?.id ?? null)));
      })
      .catch(() => !cancelled && setTimeline({ status: "error", error: "The history could not be loaded. Check your connection and try again." }));
    return () => {
      cancelled = true;
    };
  }, [lessonId, attempt]);

  const entries = timeline.status === "ready" ? timeline.data.entries : [];
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const effectiveMode: VersionCompareMode = selected?.current ? "changes" : mode;
  const diffKey = selected ? `${selected.id}:${effectiveMode}` : "";
  const diff = diffKey ? diffs[diffKey] : undefined;

  useEffect(() => {
    if (!selected || diffs[diffKey]) return;
    // A key without an entry renders as loading until the answer arrives.
    let cancelled = false;
    const key = diffKey;
    loadLessonVersionDiffAction(lessonId, selected.id, effectiveMode)
      .then((res) => {
        if (!cancelled) setDiffs((all) => ({ ...all, [key]: res.ok ? { status: "ready", data: res.data } : { status: "error", error: res.error } }));
      })
      .catch(() => !cancelled && setDiffs((all) => ({ ...all, [key]: { status: "error", error: "The comparison could not be loaded. Try again." } })));
    return () => {
      cancelled = true;
    };
    // `diffs` is read only to skip work already done; listing it would restart the request it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, diffKey, diffAttempt]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
  }, []);

  const retryDiff = () => {
    setDiffs((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== diffKey)));
    setDiffAttempt((n) => n + 1);
  };

  const restore = () =>
    startRestore(async () => {
      if (!selected) return;
      const res = await restoreLessonVersionAction(lessonId, selected.id);
      setConfirmRestore(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Version restored");
      onRestored(res.data);
      setSelectedId(CURRENT_VERSION_ID);
      setMobileDetail(false);
      setAttempt((n) => n + 1);
    });

  const updateNote = (entryId: string, note: string | null) =>
    setTimeline((t) => (t.status === "ready" ? { status: "ready", data: { ...t.data, entries: t.data.entries.map((e) => (e.id === entryId ? { ...e, note } : e)) } } : t));

  const labels =
    effectiveMode === "current"
      ? { old: "This version", new: "Current lesson" }
      : { old: "Before this save", new: selected?.current ? "Current lesson" : "This version" };

  let body;
  if (timeline.status === "loading") {
    body = (
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]" aria-busy="true">
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <DiffSkeleton />
      </div>
    );
  } else if (timeline.status === "error") {
    body = (
      <EmptyState
        compact
        icon={<Icon.AlertTriangle />}
        title="History unavailable"
        description={timeline.error}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTimeline({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            leftIcon={<Icon.Refresh className="size-4" />}
          >
            Try again
          </Button>
        }
      />
    );
  } else if (entries.length <= 1) {
    body = (
      <EmptyState
        compact
        icon={<Icon.Clock />}
        title="No earlier versions yet"
        description={`Each time the lesson is saved, the version it replaces is kept here (the last ${timeline.data.limit}). Save a change to start the history.`}
      />
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className={cn("min-w-0", mobileDetail && "hidden lg:block")}>
          <p className="mb-2 text-xs text-ink-muted">
            {entries.length - 1} of the last {timeline.data.limit} versions are kept. Use the arrow keys to move through them.
          </p>
          <Timeline entries={entries} selectedId={selectedId} onSelect={select} />
        </div>
        <section className={cn("min-w-0", !mobileDetail && "hidden lg:block")} aria-label="Selected version" aria-live="polite">
          {selected && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobileDetail(false)} leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
                All versions
              </Button>
              <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-semibold text-ink">{selected.title || "Untitled lesson"}</p>
                  <AuthorLine entry={selected} />
                  <p className="text-xs text-ink-muted">
                    {selected.blockCount} {selected.blockCount === 1 ? "block" : "blocks"}
                    {selected.note && ` · “${selected.note}”`}
                  </p>
                  <NoteEditor key={selected.id} lessonId={lessonId} entry={selected} onSaved={(note) => updateNote(selected.id, note)} />
                </div>
                {!selected.current && (
                  <Button
                    size="sm"
                    onClick={() => setConfirmRestore(true)}
                    disabled={selected.sameAsCurrent}
                    title={selected.sameAsCurrent ? "The lesson already has this content" : "Make this version the current lesson"}
                    leftIcon={<Icon.Replay className="size-4" />}
                  >
                    Restore
                  </Button>
                )}
              </div>

              {!selected.current && (
                <div role="radiogroup" aria-label="Compare" className="inline-flex rounded-lg border border-border bg-surface-1 p-0.5 text-xs font-medium">
                  {(
                    [
                      ["changes", "Changes in this version"],
                      ["current", "Compare with current"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      onClick={() => setMode(value)}
                      className={cn("rounded-md px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent", mode === value ? "bg-accent text-accent-fg" : "text-ink-muted hover:text-ink")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {!diff || diff.status === "loading" ? (
                <DiffSkeleton />
              ) : diff.status === "error" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger" role="alert">
                  {diff.error}
                  <Button variant="outline" size="xs" onClick={retryDiff}>
                    Try again
                  </Button>
                </div>
              ) : diff.data === null ? (
                <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">This is the oldest version kept, so there is no earlier version to compare it with. Choose “Compare with current” to see how it differs from the lesson now.</p>
              ) : (
                <LessonDiffView diff={diff.data} oldLabel={labels.old} newLabel={labels.new} />
              )}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <>
      <Dialog open onClose={onClose} size="xl" title="Version history" description="Versions are kept automatically each time the lesson is saved.">
        {body}
      </Dialog>
      <ConfirmDialog
        open={confirmRestore}
        onClose={() => !restoring && setConfirmRestore(false)}
        onConfirm={restore}
        loading={restoring}
        title="Restore this version?"
        description={
          <>
            The lesson will get the title, notes and blocks of this version. The current content is kept in the history first, so you can switch back at any time.
            {dirty && <strong className="mt-2 block text-ink">Your unsaved changes in the editor will be replaced.</strong>}
          </>
        }
        confirmLabel="Restore version"
      />
    </>
  );
}
