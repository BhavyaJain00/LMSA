"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { deleteChapterAction, moveChapterAction } from "@/lib/actions/chapters";
import { createLessonAction, deleteLessonAction, moveLessonAction, moveLessonToChapterAction, renameLessonAction, setLessonPreviewAction } from "@/lib/actions/lessons";
import { cn, formatDuration, pluralize, sum } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { OutlineChapter, OutlineLesson } from "./types";
import { BLOCK_LABELS } from "./blocks";
import { BlockIcon } from "./block-icon";
import { ChapterDialog, type ChapterDialogState } from "./chapter-dialog";
import { EditorIcon } from "./editor-icons";

type Result = { ok: boolean; message?: string; error?: string };

/* ------------------------------------------------------------------ */
/* Add lesson inline form                                              */
/* ------------------------------------------------------------------ */

function AddLessonForm({ courseId, chapterId, onCancel }: { courseId: string; chapterId: string; onCancel: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState(
    async (prev: ActionResult<{ lessonId: string; editHref: string }> | null, formData: FormData) => {
      const result = await createLessonAction(null, formData);
      if (!result) return prev;
      if (result.ok) {
        toast.success(result.message ?? "Lesson created successfully");
        router.push(result.data.editHref);
      }
      return result;
    },
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/50 p-2.5 sm:flex-row sm:items-start">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="chapterId" value={chapterId} />
      <div className="min-w-0 flex-1">
        <Input
          name="title"
          autoFocus
          maxLength={160}
          placeholder="Lesson title (leave empty for “Untitled lesson”)"
          aria-label="New lesson title"
          invalid={!!(state && !state.ok)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {state && !state.ok && <p className="mt-1 text-xs text-danger">{state.error}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="md" loading={pending} leftIcon={<Icon.Plus className="size-4" />}>
          Add lesson
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Lesson row                                                          */
/* ------------------------------------------------------------------ */

function LessonRow({
  lesson,
  isFirst,
  isLast,
  chapterCount,
  busy,
  onRun,
  onDelete,
  onMove,
}: {
  lesson: OutlineLesson;
  isFirst: boolean;
  isLast: boolean;
  chapterCount: number;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<Result>) => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(lesson.title);
  const rowBusy = busy?.endsWith(lesson.id);

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === lesson.title) {
      setDraft(lesson.title);
      return;
    }
    onRun(`rename:${lesson.id}`, () => renameLessonAction(lesson.id, next));
  };

  return (
    <li className={cn("group flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:px-4", rowBusy && "opacity-60")}>
      <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-ink-faint">
        {lesson.chapterNumber}.{lesson.lessonNumber}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        {renaming ? (
          <Input
            value={draft}
            autoFocus
            maxLength={160}
            aria-label="Lesson title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(lesson.title);
                setRenaming(false);
              }
            }}
            className="h-8"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Link href={lesson.editHref} className="truncate text-sm font-medium text-ink hover:text-accent hover:underline" title="Edit lesson content">
              {lesson.title}
            </Link>
            <button
              type="button"
              onClick={() => {
                setDraft(lesson.title);
                setRenaming(true);
              }}
              className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Rename ${lesson.title}`}
              title="Rename"
            >
              <Icon.Edit className="size-3.5" />
            </button>
          </div>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-ink-faint">
          {lesson.blockTypes.length ? (
            lesson.blockTypes.map((t) => (
              <span key={t} title={BLOCK_LABELS[t]} className="inline-flex">
                <BlockIcon type={t} className="size-3.5" />
                <span className="sr-only">{BLOCK_LABELS[t]}</span>
              </span>
            ))
          ) : (
            <span className="text-xs">No content yet</span>
          )}
          <span className="ml-1 text-xs">· {pluralize(lesson.blockCount, "block")}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          aria-pressed={lesson.includeInPreview}
          onClick={() => onRun(`preview:${lesson.id}`, () => setLessonPreviewAction(lesson.id, !lesson.includeInPreview))}
          disabled={rowBusy}
          title={lesson.includeInPreview ? "Free preview: anyone can open this lesson without enrolling" : "Only enrolled learners can open this lesson"}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
            lesson.includeInPreview ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-ink-muted hover:bg-surface-2",
          )}
        >
          {busy === `preview:${lesson.id}` ? <Spinner className="size-3" /> : lesson.includeInPreview ? <Icon.Eye className="size-3.5" /> : <Icon.Lock className="size-3.5" />}
          <span>{lesson.includeInPreview ? "Preview" : "Enrolled"}</span>
        </button>
        <span className="hidden w-14 text-right text-xs tabular-nums text-ink-muted sm:inline" title="Estimated duration">
          {lesson.durationSeconds > 0 ? formatDuration(lesson.durationSeconds) : "—"}
        </span>
        <ButtonLink href={lesson.editHref} size="xs" variant="outline" leftIcon={<Icon.Edit className="size-3.5" />}>
          Edit
        </ButtonLink>
        <a
          href={lesson.learnHref}
          target="_blank"
          rel="noopener"
          className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={`Preview ${lesson.title} as a student (opens in a new tab)`}
          title="Preview as student"
        >
          <Icon.ExternalLink className="size-4" />
        </a>
        <Dropdown
          trigger={
            <span className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink">
              {rowBusy && busy !== `preview:${lesson.id}` ? <Spinner className="size-4" /> : <Icon.MoreHorizontal className="size-4" />}
              <span className="sr-only">More actions for {lesson.title}</span>
            </span>
          }
          items={[
            {
              label: "Rename",
              icon: <Icon.Edit />,
              onClick: () => {
                setDraft(lesson.title);
                setRenaming(true);
              },
            },
            { label: "Move up", icon: <EditorIcon.ArrowUp />, disabled: isFirst, onClick: () => onRun(`move:${lesson.id}`, () => moveLessonAction(lesson.id, "up")) },
            { label: "Move down", icon: <EditorIcon.ArrowDown />, disabled: isLast, onClick: () => onRun(`move:${lesson.id}`, () => moveLessonAction(lesson.id, "down")) },
            { label: "Move to chapter…", icon: <EditorIcon.MoveTo />, disabled: chapterCount < 2, onClick: onMove },
            { label: "Delete lesson", icon: <Icon.Trash />, destructive: true, separator: true, onClick: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Outline editor                                                      */
/* ------------------------------------------------------------------ */

export function OutlineEditor({ courseId, chapters }: { courseId: string; chapters: OutlineChapter[] }) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [chapterDialog, setChapterDialog] = useState<ChapterDialogState | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "chapter" | "lesson"; id: string; title: string; lessons?: number } | null>(null);
  const [moving, setMoving] = useState<{ lesson: OutlineLesson; target: string } | null>(null);

  const allLessons = chapters.flatMap((c) => c.lessons);
  const totalDuration = sum(chapters.map((c) => c.durationSeconds));

  const run = (key: string, fn: () => Promise<Result>, after?: () => void) => {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        if (res.message) toast.success(res.message);
        after?.();
      } else {
        toast.error(res.error ?? "Something went wrong");
      }
    });
  };

  const openChapterDialog = (state: ChapterDialogState) => {
    setDialogKey((k) => k + 1);
    setChapterDialog(state);
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {pluralize(chapters.length, "chapter")} · {pluralize(allLessons.length, "lesson")}
          {totalDuration > 0 && <> · about {formatDuration(totalDuration)}</>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {chapters.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(collapsed.size === chapters.length ? new Set() : new Set(chapters.map((c) => c.id)))}
              leftIcon={<Icon.ChevronsUpDown className="size-4" />}
            >
              {collapsed.size === chapters.length ? "Expand all" : "Collapse all"}
            </Button>
          )}
          <Button size="sm" onClick={() => openChapterDialog({ mode: "create" })} leftIcon={<Icon.Plus className="size-4" />}>
            Add chapter
          </Button>
        </div>
      </div>

      {chapters.length === 0 ? (
        <EmptyState
          icon={<Icon.BookOpen />}
          title="No chapters yet"
          description="Chapters group your lessons. Create the first chapter, then add lessons to it."
          action={
            <Button onClick={() => openChapterDialog({ mode: "create" })} leftIcon={<Icon.Plus className="size-4" />}>
              Create chapter
            </Button>
          }
        />
      ) : (
        <ol className="space-y-3">
          {chapters.map((chapter, ci) => {
            const open = !collapsed.has(chapter.id);
            const chapterBusy = busy?.endsWith(chapter.id);
            return (
              <li key={chapter.id} className={cn("overflow-hidden rounded-card border border-border bg-surface-1 shadow-card", chapterBusy && "opacity-60")}>
                <div className="flex items-start gap-2 px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    onClick={() => toggle(chapter.id)}
                    aria-expanded={open}
                    aria-controls={`chapter-panel-${chapter.id}`}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left"
                  >
                    <Icon.ChevronRight className={cn("mt-0.5 size-5 shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">Chapter {ci + 1}</span>
                      <span className="block truncate text-base font-semibold text-ink">{chapter.title}</span>
                      {chapter.description && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{chapter.description}</span>}
                    </span>
                  </button>
                  <span className="mt-1 hidden shrink-0 text-xs text-ink-muted sm:block">
                    {pluralize(chapter.lessons.length, "lesson")}
                    {chapter.durationSeconds > 0 && <> · {formatDuration(chapter.durationSeconds)}</>}
                  </span>
                  <Dropdown
                    trigger={
                      <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                        {chapterBusy ? <Spinner className="size-4" /> : <Icon.MoreVertical className="size-4" />}
                        <span className="sr-only">Actions for chapter {chapter.title}</span>
                      </span>
                    }
                    items={[
                      { label: "Edit chapter", icon: <Icon.Edit />, onClick: () => openChapterDialog({ mode: "edit", chapterId: chapter.id, title: chapter.title, description: chapter.description }) },
                      {
                        label: "Add lesson",
                        icon: <Icon.Plus />,
                        onClick: () => {
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            next.delete(chapter.id);
                            return next;
                          });
                          setAddingTo(chapter.id);
                        },
                      },
                      { label: "Move up", icon: <EditorIcon.ArrowUp />, disabled: ci === 0, onClick: () => run(`move:${chapter.id}`, () => moveChapterAction(chapter.id, "up")) },
                      { label: "Move down", icon: <EditorIcon.ArrowDown />, disabled: ci === chapters.length - 1, onClick: () => run(`move:${chapter.id}`, () => moveChapterAction(chapter.id, "down")) },
                      {
                        label: "Delete chapter",
                        icon: <Icon.Trash />,
                        destructive: true,
                        separator: true,
                        onClick: () => setConfirmDelete({ kind: "chapter", id: chapter.id, title: chapter.title, lessons: chapter.lessons.length }),
                      },
                    ]}
                  />
                </div>
                {open && (
                  <div id={`chapter-panel-${chapter.id}`} className="border-t border-border">
                    {chapter.lessons.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-ink-muted">This chapter has no lessons yet.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {chapter.lessons.map((lesson, li) => (
                          <LessonRow
                            key={`${lesson.id}:${lesson.title}`}
                            lesson={lesson}
                            isFirst={ci === 0 && li === 0}
                            isLast={ci === chapters.length - 1 && li === chapter.lessons.length - 1}
                            chapterCount={chapters.length}
                            busy={busy}
                            onRun={run}
                            onDelete={() => setConfirmDelete({ kind: "lesson", id: lesson.id, title: lesson.title })}
                            onMove={() => setMoving({ lesson, target: chapters.find((c) => c.id !== lesson.chapterId)?.id ?? "" })}
                          />
                        ))}
                      </ul>
                    )}
                    <div className="border-t border-border bg-surface-2/30 px-3 py-2.5 sm:px-4">
                      {addingTo === chapter.id ? (
                        <AddLessonForm courseId={courseId} chapterId={chapter.id} onCancel={() => setAddingTo(null)} />
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setAddingTo(chapter.id)} leftIcon={<Icon.Plus className="size-4" />}>
                          Add Lesson
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <ChapterDialog key={dialogKey} courseId={courseId} state={chapterDialog} onClose={() => setChapterDialog(null)} />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        loading={!!busy?.startsWith("delete:")}
        onConfirm={() => {
          if (!confirmDelete) return;
          const target = confirmDelete;
          run(
            `delete:${target.id}`,
            () => (target.kind === "chapter" ? deleteChapterAction(target.id) : deleteLessonAction(target.id)),
            () => setConfirmDelete(null),
          );
        }}
        title={confirmDelete?.kind === "chapter" ? "Delete this chapter?" : "Delete this lesson?"}
        description={
          confirmDelete?.kind === "chapter"
            ? `Deleting “${confirmDelete.title}” will also delete its ${pluralize(confirmDelete.lessons ?? 0, "lesson")} and permanently remove it from the course. Learner progress on those lessons is removed too. This action cannot be undone. Are you sure you want to continue?`
            : `Deleting “${confirmDelete?.title ?? ""}” will permanently remove it from the course, along with learner progress and notes on it. This action cannot be undone. Are you sure you want to continue?`
        }
        confirmLabel="Delete"
        destructive
      />

      <Dialog
        open={moving !== null}
        onClose={() => setMoving(null)}
        title="Move lesson"
        description={moving ? `Move “${moving.lesson.title}” to the end of another chapter.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setMoving(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === `moveto:${moving?.lesson.id}`}
              disabled={!moving?.target}
              onClick={() => {
                if (!moving) return;
                const { lesson, target } = moving;
                run(`moveto:${lesson.id}`, () => moveLessonToChapterAction(lesson.id, target), () => setMoving(null));
              }}
            >
              Move
            </Button>
          </>
        }
      >
        {moving && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-ink">Chapter</span>
            <Select value={moving.target} onChange={(e) => setMoving({ ...moving, target: e.target.value })}>
              {chapters
                .filter((c) => c.id !== moving.lesson.chapterId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    Chapter {chapters.indexOf(c) + 1}: {c.title}
                  </option>
                ))}
            </Select>
          </label>
        )}
      </Dialog>
    </div>
  );
}
