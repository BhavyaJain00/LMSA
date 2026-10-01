"use client";

import { Fragment } from "react";
import type { BlockDiff, FieldChange, LessonDiff } from "@/lib/teaching/version-shared";
import { describeChange } from "@/lib/teaching/version-shared";
import type { DiffCell, DiffRow, TextDiff } from "@/lib/teaching/text-diff";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn, pluralize } from "@/lib/utils";

/**
 * Side-by-side rendering of a lesson comparison: title and notes, then every
 * block with its status (added, removed, edited, moved) and a line diff of
 * its text. Each side is labelled for screen readers; on phones the two sides
 * stack (old line above new line).
 */

const STATUS: Record<BlockDiff["status"], { label: string; tone: BadgeTone }> = {
  added: { label: "Added", tone: "success" },
  removed: { label: "Removed", tone: "danger" },
  changed: { label: "Edited", tone: "warning" },
  unchanged: { label: "Unchanged", tone: "neutral" },
};

function Cell({ cell, side, changed }: { cell: DiffCell | null; side: "old" | "new"; changed: boolean }) {
  const border = side === "new" ? "sm:border-l sm:border-border" : "";
  if (!cell) return <div className={cn("hidden bg-surface-2/60 sm:block", border)} aria-hidden="true" />;
  const tint = changed ? (side === "old" ? "bg-danger/8" : "bg-success/8") : "";
  const mark = changed ? (side === "old" ? "bg-danger/25 rounded-sm" : "bg-success/25 rounded-sm") : "";
  return (
    // On phones an unchanged line is shown once (the new side).
    <div className={cn("min-w-0", !changed && side === "old" ? "hidden sm:flex" : "flex", tint, border)}>
      <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-ink-faint" aria-hidden="true">
        {cell.line}
      </span>
      <span className="sr-only">{changed ? (side === "old" ? "Removed line" : "Added line") : "Line"} {cell.line}: </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word px-2">
        {cell.segments
          ? cell.segments.map((segment, i) =>
              segment.changed ? (
                <mark key={i} className={cn("text-ink", mark)}>
                  {segment.text}
                </mark>
              ) : (
                <Fragment key={i}>{segment.text}</Fragment>
              ),
            )
          : cell.text || " "}
      </span>
    </div>
  );
}

function Row({ row }: { row: DiffRow }) {
  if (row.kind === "skip") {
    return (
      <div className="col-span-full border-y border-border bg-surface-2/60 px-3 py-1 text-center text-[11px] text-ink-muted">
        {pluralize(row.count, "unchanged line")}
      </div>
    );
  }
  const left = row.kind === "add" ? null : row.left;
  const right = row.kind === "remove" ? null : row.right;
  const changed = row.kind !== "equal";
  return (
    <>
      <Cell cell={left} side="old" changed={changed} />
      <Cell cell={right} side="new" changed={changed} />
    </>
  );
}

/** Line diff of one text (markdown, code, notes) as two columns. */
export function TextDiffView({ diff, oldLabel = "Before", newLabel = "After" }: { diff: TextDiff; oldLabel?: string; newLabel?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border font-mono text-xs leading-5">
      <div className="hidden grid-cols-2 border-b border-border bg-surface-2 text-[11px] font-sans font-medium text-ink-muted sm:grid">
        <span className="px-3 py-1">{oldLabel}</span>
        <span className="border-l border-border px-3 py-1">{newLabel}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {diff.rows.map((row, i) => (
          <Row key={i} row={row} />
        ))}
      </div>
      <p className="border-t border-border bg-surface-2/60 px-3 py-1 font-sans text-[11px] text-ink-muted">
        <span className="text-success">+{diff.added}</span> <span className="text-danger">−{diff.removed}</span> lines
        {diff.coarse && " · This text is too long to match line by line, so it is shown as replaced."}
      </p>
    </div>
  );
}

function FieldTable({ fields, status }: { fields: FieldChange[]; status: BlockDiff["status"] }) {
  if (!fields.length) return null;
  return (
    <dl className="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
      {fields.map((field) => (
        <Fragment key={field.label}>
          <dt className="font-medium text-ink-muted">{field.label}</dt>
          <dd className="min-w-0 wrap-break-word">
            {status === "changed" ? (
              <span className="flex flex-col gap-0.5">
                <span className="whitespace-pre-wrap text-danger line-through decoration-danger/60">
                  <span className="sr-only">Before: </span>
                  {field.before ?? "(empty)"}
                </span>
                <span className="whitespace-pre-wrap text-success">
                  <span className="sr-only">After: </span>
                  {field.after ?? "(empty)"}
                </span>
              </span>
            ) : (
              <span className="whitespace-pre-wrap text-ink">{field.after ?? field.before}</span>
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function position(block: BlockDiff): string {
  if (block.status === "added") return `New block ${block.afterPosition}`;
  if (block.status === "removed") return `Was block ${block.beforePosition}`;
  if (block.moved) return `Moved from ${block.beforePosition} to ${block.afterPosition}`;
  return `Block ${block.afterPosition}`;
}

function BlockCard({ block, labels }: { block: BlockDiff; labels: { old: string; new: string } }) {
  const status = STATUS[block.status];
  return (
    <li className={cn("rounded-xl border bg-surface-1 p-3", block.status === "removed" ? "border-danger/30" : block.status === "added" ? "border-success/30" : "border-border")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        {block.moved && block.status !== "added" && block.status !== "removed" && <Badge tone="info">Moved</Badge>}
        <span className="min-w-0 truncate text-sm font-medium text-ink">{block.label}</span>
        <span className="ml-auto text-[11px] text-ink-faint">{position(block)}</span>
      </div>
      <div className="space-y-3">
        <FieldTable fields={block.fields} status={block.status} />
        {block.text && <TextDiffView diff={block.text} oldLabel={labels.old} newLabel={labels.new} />}
        {block.status === "unchanged" && block.moved && <p className="text-xs text-ink-muted">Only its position changed.</p>}
      </div>
    </li>
  );
}

/** Consecutive unchanged blocks fold into one line. */
function groupBlocks(blocks: BlockDiff[]): (BlockDiff | { unchanged: number; key: string })[] {
  const out: (BlockDiff | { unchanged: number; key: string })[] = [];
  for (const block of blocks) {
    if (block.status === "unchanged" && !block.moved) {
      const last = out[out.length - 1];
      if (last && "unchanged" in last) last.unchanged++;
      else out.push({ unchanged: 1, key: `same-${block.id}` });
    } else out.push(block);
  }
  return out;
}

export function LessonDiffView({ diff, oldLabel, newLabel }: { diff: LessonDiff; oldLabel: string; newLabel: string }) {
  if (diff.identical) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
        <Icon.CheckCircle className="size-4 shrink-0" /> The two versions have the same content.
      </p>
    );
  }
  const labels = { old: oldLabel, new: newLabel };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{describeChange(diff.summary)}</p>
      {diff.title && (
        <section aria-label="Title" className="rounded-xl border border-border p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Title</h4>
          <FieldTable fields={[diff.title]} status="changed" />
        </section>
      )}
      {diff.notes && (
        <section aria-label="Instructor notes" className="rounded-xl border border-border p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Instructor notes</h4>
          <TextDiffView diff={diff.notes} oldLabel={oldLabel} newLabel={newLabel} />
        </section>
      )}
      <ul className="space-y-3" aria-label="Blocks">
        {groupBlocks(diff.blocks).map((item) =>
          "unchanged" in item ? (
            <li key={item.key} className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-ink-muted">
              {pluralize(item.unchanged, "unchanged block")}
            </li>
          ) : (
            <BlockCard key={item.id} block={item} labels={labels} />
          ),
        )}
      </ul>
    </div>
  );
}
