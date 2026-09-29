"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { LessonBlock, LessonBlockType } from "@/lib/types";
import { cn, stripMarkdown, truncate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import type { AssessmentOptions } from "./types";
import { BLOCK_LABELS, BLOCK_TYPES, blockHasContent, createBlock, duplicateBlock } from "./blocks";
import { BlockIcon } from "./block-icon";
import { EditorIcon } from "./editor-icons";
import {
  AssessmentBlockEditor,
  AudioBlockEditor,
  CalloutBlockEditor,
  CodeBlockEditor,
  EmbedBlockEditor,
  FileBlockEditor,
  ImageBlockEditor,
  MarkdownBlockEditor,
  PdfBlockEditor,
  VideoBlockEditor,
} from "./block-fields";

export interface BlockEditorProps {
  blocks: LessonBlock[];
  onChange: (blocks: LessonBlock[]) => void;
  /** Validation errors keyed by block id. */
  errors: Record<string, string>;
  assessments: AssessmentOptions;
  courseId: string;
  onRefreshAssessments: () => void;
  refreshingAssessments: boolean;
}

/** One-line summary shown in a collapsed block header. */
function summarize(block: LessonBlock, assessments: AssessmentOptions): string {
  switch (block.type) {
    case "markdown":
    case "callout":
      return truncate(stripMarkdown(block.content).replace(/\s+/g, " "), 80) || "Empty";
    case "code":
      return `${block.language} · ${block.code ? block.code.split("\n").length : 0} lines`;
    case "video":
      return block.title || block.src.split("/").pop() || "No video yet";
    case "audio":
    case "pdf":
      return block.title || block.src.split("/").pop() || "No file yet";
    case "image":
      return block.alt || block.src.split("/").pop() || "No image yet";
    case "file":
      return block.title || "No file yet";
    case "embed":
      return block.title || block.src || "No URL yet";
    case "quiz":
      return assessments.quizzes.find((q) => q.id === block.quizId)?.title ?? "No quiz selected";
    case "assignment":
      return assessments.assignments.find((a) => a.id === block.assignmentId)?.title ?? "No assignment selected";
    case "exercise":
      return assessments.exercises.find((e) => e.id === block.exerciseId)?.title ?? "No exercise selected";
  }
}

function AddBlockMenu({ onPick, trigger, align = "start" }: { onPick: (type: LessonBlockType) => void; trigger: ReactNode; align?: "start" | "end" }) {
  return (
    <Dropdown
      align={align}
      trigger={trigger}
      menuClassName="w-72 max-h-[60vh] overflow-y-auto"
      items={BLOCK_TYPES.map((b) => ({
        label: b.label,
        description: b.description,
        icon: <BlockIcon type={b.type} />,
        onClick: () => onPick(b.type),
      }))}
    />
  );
}

/** Full-width "+ Add block" button that expands into a grid of block types. */
function BlockPalette({ onPick, startOpen }: { onPick: (type: LessonBlockType) => void; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="flex w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-border-strong px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Icon.Plus className="size-4" /> Add block
      </button>
    );
  }
  return (
    <div
      className="rounded-card border-2 border-dashed border-accent/50 bg-surface-1 p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-sm font-medium text-ink">Add a block</p>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-faint hover:bg-surface-2 hover:text-ink" aria-label="Close block menu">
          <Icon.X className="size-4" />
        </button>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {BLOCK_TYPES.map((b, i) => (
          <button
            key={b.type}
            type="button"
            autoFocus={i === 0 && !startOpen}
            onClick={() => {
              onPick(b.type);
              setOpen(false);
            }}
            className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
              <BlockIcon type={b.type} className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{b.label}</span>
              <span className="block text-xs text-ink-muted">{b.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Drag-and-drop wiring for one block card (mouse); the move buttons are the keyboard fallback. */
interface BlockDnd {
  dragging: boolean;
  indicator: "before" | "after" | null;
  onDragStart: (e: DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

/** Blocks in their new order after dropping `dragId` before or after `targetId`, or null when nothing moves. */
function reorderBlocks(blocks: LessonBlock[], dragId: string, targetId: string, after: boolean): LessonBlock[] | null {
  if (dragId === targetId) return null;
  const from = blocks.findIndex((b) => b.id === dragId);
  if (from === -1) return null;
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  const to = next.findIndex((b) => b.id === targetId);
  if (!moved || to === -1) return null;
  next.splice(to + (after ? 1 : 0), 0, moved);
  return next.every((b, i) => b.id === blocks[i]?.id) ? null : next;
}

function BlockCard({
  block,
  index,
  total,
  error,
  collapsed,
  focus,
  assessments,
  courseId,
  onRefreshAssessments,
  refreshingAssessments,
  onChange,
  onToggle,
  onMove,
  onDuplicate,
  onDelete,
  onInsertBelow,
  dnd,
}: {
  block: LessonBlock;
  index: number;
  total: number;
  error?: string;
  collapsed: boolean;
  focus: boolean;
  assessments: AssessmentOptions;
  courseId: string;
  onRefreshAssessments: () => void;
  refreshingAssessments: boolean;
  onChange: (block: LessonBlock) => void;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onInsertBelow: (type: LessonBlockType) => void;
  dnd: BlockDnd;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  let body: ReactNode;
  switch (block.type) {
    case "markdown":
      body = <MarkdownBlockEditor block={block} onChange={onChange} />;
      break;
    case "callout":
      body = <CalloutBlockEditor block={block} onChange={onChange} />;
      break;
    case "code":
      body = <CodeBlockEditor block={block} onChange={onChange} />;
      break;
    case "embed":
      body = <EmbedBlockEditor block={block} onChange={onChange} />;
      break;
    case "image":
      body = <ImageBlockEditor block={block} onChange={onChange} />;
      break;
    case "file":
      body = <FileBlockEditor block={block} onChange={onChange} />;
      break;
    case "pdf":
      body = <PdfBlockEditor block={block} onChange={onChange} />;
      break;
    case "audio":
      body = <AudioBlockEditor block={block} onChange={onChange} />;
      break;
    case "video":
      body = <VideoBlockEditor block={block} onChange={onChange} quizzes={assessments.quizzes} />;
      break;
    case "quiz":
      body = (
        <AssessmentBlockEditor
          kind="quiz"
          value={block.quizId}
          options={assessments.quizzes}
          courseId={courseId}
          onChange={(quizId) => onChange({ ...block, quizId })}
          onRefresh={onRefreshAssessments}
          refreshing={refreshingAssessments}
        />
      );
      break;
    case "assignment":
      body = (
        <AssessmentBlockEditor
          kind="assignment"
          value={block.assignmentId}
          options={assessments.assignments}
          courseId={courseId}
          onChange={(assignmentId) => onChange({ ...block, assignmentId })}
          onRefresh={onRefreshAssessments}
          refreshing={refreshingAssessments}
        />
      );
      break;
    case "exercise":
      body = (
        <AssessmentBlockEditor
          kind="exercise"
          value={block.exerciseId}
          options={assessments.exercises}
          courseId={courseId}
          onChange={(exerciseId) => onChange({ ...block, exerciseId })}
          onRefresh={onRefreshAssessments}
          refreshing={refreshingAssessments}
        />
      );
      break;
  }

  return (
    <section
      ref={ref}
      aria-label={`Block ${index + 1}: ${BLOCK_LABELS[block.type]}`}
      onDragOver={dnd.onDragOver}
      onDrop={dnd.onDrop}
      className={cn(
        "relative rounded-card border bg-surface-1 shadow-card transition-shadow",
        error ? "border-danger/60 ring-1 ring-danger/30" : "border-border",
        focus && "ring-2 ring-accent/40",
        dnd.dragging && "opacity-50",
      )}
    >
      {dnd.indicator && (
        <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-3 z-10 h-0.5 rounded-full bg-accent", dnd.indicator === "after" ? "-bottom-2" : "-top-2")} />
      )}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          draggable
          onDragStart={dnd.onDragStart}
          onDragEnd={dnd.onDragEnd}
          title="Drag to reorder (or use the move buttons)"
          aria-hidden="true"
          className="hidden shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-ink-faint hover:bg-surface-2 hover:text-ink active:cursor-grabbing sm:inline-flex"
        >
          <Icon.Grip className="size-4" />
        </span>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-muted">
            <BlockIcon type={block.type} className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">
              <span className="mr-1 font-mono text-xs text-ink-faint">{index + 1}.</span>
              {BLOCK_LABELS[block.type]}
            </span>
            {collapsed && <span className="block truncate text-xs text-ink-muted">{summarize(block, assessments)}</span>}
          </span>
          <Icon.ChevronDown className={cn("ml-auto size-4 shrink-0 text-ink-faint transition-transform", collapsed && "-rotate-90")} />
        </button>
        <div className="flex shrink-0 items-center">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded-md p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" aria-label="Move block up" title="Move up">
            <EditorIcon.ArrowUp className="size-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="rounded-md p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30" aria-label="Move block down" title="Move down">
            <EditorIcon.ArrowDown className="size-4" />
          </button>
          <button type="button" onClick={onDuplicate} className="hidden rounded-md p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink sm:inline-flex" aria-label="Duplicate block" title="Duplicate">
            <Icon.Copy className="size-4" />
          </button>
          <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger" aria-label="Delete block" title="Delete">
            <Icon.Trash className="size-4" />
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="flex items-start gap-2 border-b border-danger/20 bg-danger/5 px-4 py-2 text-sm text-danger">
          <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {!collapsed && <div className="p-4">{body}</div>}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        <AddBlockMenu
          onPick={onInsertBelow}
          trigger={
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink">
              <Icon.Plus className="size-3.5" /> Insert block below
            </span>
          }
        />
        <button type="button" onClick={onDuplicate} className="rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink sm:hidden">
          Duplicate
        </button>
      </footer>
    </section>
  );
}

/**
 * Ordered list of lesson content blocks with add / move / duplicate / delete
 * and per-type editing UI. Fully controlled: the parent owns `blocks`.
 */
export function BlockEditor({ blocks, onChange, errors, assessments, courseId, onRefreshAssessments, refreshingAssessments }: BlockEditorProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LessonBlock | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const insertAt = (index: number, type: LessonBlockType) => {
    const block = createBlock(type);
    const next = [...blocks];
    next.splice(index, 0, block);
    onChange(next);
    setFocusId(block.id);
  };
  const update = (block: LessonBlock) => onChange(blocks.map((b) => (b.id === block.id ? block : b)));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [b] = next.splice(index, 1);
    next.splice(target, 0, b!);
    onChange(next);
    setFocusId(b!.id);
  };
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const blockDnd = (block: LessonBlock): BlockDnd => ({
    dragging: dragId === block.id,
    indicator: dragId && dragId !== block.id && over?.id === block.id ? (over.after ? "after" : "before") : null,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", block.id);
      const card = e.currentTarget.closest("section");
      if (card) e.dataTransfer.setDragImage(card, 24, 20);
      setDragId(block.id);
    },
    onDragEnd: endDrag,
    onDragOver: (e) => {
      // Only block drags are handled here; file drops into upload fields pass through.
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (over?.id !== block.id || over.after !== after) setOver({ id: block.id, after });
    },
    onDrop: (e) => {
      if (!dragId) return;
      e.preventDefault();
      const target = over;
      const moving = dragId;
      endDrag();
      if (!target) return;
      const next = reorderBlocks(blocks, moving, target.id, target.after);
      if (next) {
        onChange(next);
        setFocusId(moving);
      }
    },
  });
  const allCollapsed = blocks.length > 0 && blocks.every((b) => collapsed.has(b.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Content</h2>
        {blocks.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(blocks.map((b) => b.id)))} leftIcon={<Icon.ChevronsUpDown className="size-4" />}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
          <p className="font-medium text-ink">This lesson has no content yet</p>
          <p className="mt-1 text-sm text-ink-muted">Add text, a video, a quiz or any other block to start building the lesson.</p>
        </div>
      ) : (
        blocks.map((block, i) => (
          <BlockCard
            key={block.id}
            block={block}
            index={i}
            total={blocks.length}
            error={errors[block.id]}
            collapsed={collapsed.has(block.id)}
            focus={focusId === block.id}
            assessments={assessments}
            courseId={courseId}
            onRefreshAssessments={onRefreshAssessments}
            refreshingAssessments={refreshingAssessments}
            onChange={update}
            onToggle={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(block.id)) next.delete(block.id);
                else next.add(block.id);
                return next;
              })
            }
            onMove={(delta) => move(i, delta)}
            onDuplicate={() => {
              const copy = duplicateBlock(block);
              const next = [...blocks];
              next.splice(i + 1, 0, copy);
              onChange(next);
              setFocusId(copy.id);
            }}
            onDelete={() => (blockHasContent(block) ? setPendingDelete(block) : remove(block.id))}
            onInsertBelow={(type) => insertAt(i + 1, type)}
            dnd={blockDnd(block)}
          />
        ))
      )}

      <BlockPalette onPick={(type) => insertAt(blocks.length, type)} startOpen={blocks.length === 0} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete.id);
          setPendingDelete(null);
        }}
        title="Delete this block?"
        description={pendingDelete ? `The ${BLOCK_LABELS[pendingDelete.type].toLowerCase()} block and its content will be removed from the lesson when you save.` : undefined}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
