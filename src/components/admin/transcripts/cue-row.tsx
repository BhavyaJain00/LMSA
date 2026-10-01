"use client";

import { memo, type KeyboardEvent } from "react";
import type { TranscriptCue } from "@/lib/types";
import type { CueIssue } from "@/lib/transcripts/cues";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { TimeField } from "./time-field";

export interface CueRowHandlers {
  onSelect: (index: number, selected: boolean, range: boolean) => void;
  onText: (index: number, text: string) => void;
  onTimes: (index: number, times: { start?: number; end?: number }) => string | null;
  onPlay: (index: number) => void;
  onSplit: (index: number, textOffset?: number) => void;
  onMerge: (index: number) => void;
  onInsertAfter: (index: number) => void;
  onDelete: (index: number) => void;
  onStamp: (index: number, edge: "start" | "end") => void;
  onFocusMove: (index: number) => void;
}

export interface CueRowProps {
  index: number;
  cue: TranscriptCue;
  isLast: boolean;
  selected: boolean;
  active: boolean;
  issues: readonly CueIssue[] | undefined;
  handlers: CueRowHandlers;
}

/** One caption of the transcript editor: times, text and its actions. */
export const CueRow = memo(function CueRow({ index, cue, isLast, selected, active, issues, handlers }: CueRowProps) {
  const n = index + 1;
  const empty = !cue.text.trim();

  const onTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const caret = e.currentTarget.selectionStart;
      handlers.onSplit(index, caret > 0 && caret < cue.text.length ? caret : undefined);
    } else if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      handlers.onFocusMove(index + (e.key === "ArrowDown" ? 1 : -1));
    }
  };

  return (
    <li
      data-cue-row={index}
      className={cn(
        "group relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-2 px-3 py-3 transition-colors sm:grid-cols-[auto_6.75rem_6.75rem_minmax(0,1fr)_auto] sm:items-start",
        active && "bg-accent/8",
        selected && "bg-info/8",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.75 bg-accent" />}
      <div className="flex flex-col items-center gap-1 pt-1.5 sm:row-span-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => handlers.onSelect(index, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
          aria-label={`Select caption ${n}`}
          className="size-4 cursor-pointer rounded border-border-strong accent-(--accent)"
        />
        <span className="text-[11px] font-medium tabular-nums text-ink-faint" aria-hidden>
          {n}
        </span>
      </div>

      {/* Times: one line on small screens, two columns from sm up. */}
      <div className="col-span-1 grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-subgrid">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[11px] font-medium text-ink-faint sm:sr-only">Start</span>
          <TimeField value={cue.start} label={`Start of caption ${n}`} onCommit={(start) => handlers.onTimes(index, { start })} />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[11px] font-medium text-ink-faint sm:sr-only">End</span>
          <TimeField value={cue.end} label={`End of caption ${n}`} onCommit={(end) => handlers.onTimes(index, { end })} />
        </label>
      </div>

      <div className="row-start-1 col-start-3 flex items-start gap-0.5 sm:col-start-5">
        <button
          type="button"
          onClick={() => handlers.onPlay(index)}
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`Play from caption ${n}`}
          title="Play from here"
        >
          <Icon.Play className="size-4" />
        </button>
        <Dropdown
          trigger={
            <span className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <Icon.MoreHorizontal className="size-4" />
              <span className="sr-only">More actions for caption {n}</span>
            </span>
          }
          items={[
            { label: "Split in two", icon: <Icon.Layers className="size-4" />, onClick: () => handlers.onSplit(index), description: "Ctrl+Enter in the text splits at the cursor" },
            { label: "Merge with next", icon: <Icon.ChevronsUpDown className="size-4" />, onClick: () => handlers.onMerge(index), disabled: isLast },
            { label: "Insert caption after", icon: <Icon.Plus className="size-4" />, onClick: () => handlers.onInsertAfter(index) },
            { label: "Start at the playhead", icon: <Icon.Timer className="size-4" />, onClick: () => handlers.onStamp(index, "start"), separator: true },
            { label: "End at the playhead", icon: <Icon.Clock className="size-4" />, onClick: () => handlers.onStamp(index, "end") },
            { label: "Delete caption", icon: <Icon.Trash className="size-4" />, onClick: () => handlers.onDelete(index), destructive: true, separator: true },
          ]}
        />
      </div>

      <div className="col-span-3 min-w-0 sm:col-span-1 sm:col-start-4 sm:row-start-1">
        <textarea
          data-cue-text={index}
          value={cue.text}
          onChange={(e) => handlers.onText(index, e.target.value)}
          onKeyDown={onTextKeyDown}
          rows={2}
          aria-label={`Text of caption ${n}`}
          aria-invalid={empty || undefined}
          placeholder="Caption text"
          className={cn(
            "field-sizing-content block min-h-14 w-full resize-y rounded-md border bg-surface px-2.5 py-1.5 text-sm leading-snug text-ink outline-none transition-colors",
            "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
            empty ? "border-danger/60" : "border-border hover:border-border-strong",
          )}
        />
        {(empty || issues?.length) && (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {empty && (
              <li className="inline-flex items-center gap-1 text-danger">
                <Icon.AlertCircle className="size-3" /> Empty: removed when you save.
              </li>
            )}
            {issues?.map((issue, i) => (
              <li key={`${issue.kind}-${i}`} className="inline-flex items-center gap-1 text-warning">
                <Icon.AlertTriangle className="size-3" /> {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
});
