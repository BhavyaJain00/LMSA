"use client";

import type { TranscriptCue } from "@/lib/types";
import type { CueIssue } from "@/lib/transcripts/cues";
import { PAGE_SIZE } from "@/lib/transcripts/editor-state";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CueRow, type CueRowHandlers } from "./cue-row";

/** One page of the caption list with its pager. */
export function CueList({
  cues,
  pageIndices,
  activeIndex,
  selected,
  issueMap,
  handlers,
  page,
  pages,
  totalVisible,
  onPage,
}: {
  cues: readonly TranscriptCue[];
  pageIndices: readonly number[];
  activeIndex: number;
  selected: ReadonlySet<number>;
  issueMap: ReadonlyMap<number, CueIssue[]>;
  handlers: CueRowHandlers;
  page: number;
  pages: number;
  totalVisible: number;
  onPage: (page: number) => void;
}) {
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(totalVisible, (page + 1) * PAGE_SIZE);
  return (
    <>
      <ol aria-label="Captions" className="divide-y divide-border">
        {pageIndices.map((i) => (
          <CueRow
            key={i}
            index={i}
            cue={cues[i]!}
            isLast={i === cues.length - 1}
            selected={selected.has(i)}
            active={i === activeIndex}
            issues={issueMap.get(i)}
            handlers={handlers}
          />
        ))}
      </ol>
      {pages > 1 && (
        <nav aria-label="Caption pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-xs text-ink-muted">
          <span className="tabular-nums">
            {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")} of {totalVisible.toLocaleString("en-US")}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
              <Icon.ChevronLeft className="size-3.5 rtl:rotate-180" />
              <Icon.ChevronLeft className="-ms-2.5 size-3.5 rtl:rotate-180" />
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onPage(page - 1)} disabled={page === 0} leftIcon={<Icon.ChevronLeft className="size-3.5 rtl:rotate-180" />}>
              Previous
            </Button>
            <span className="px-1.5 tabular-nums" aria-current="page">
              Page {page + 1} of {pages}
            </span>
            <Button variant="ghost" size="xs" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} rightIcon={<Icon.ChevronRight className="size-3.5 rtl:rotate-180" />}>
              Next
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">
              <Icon.ChevronRight className="size-3.5 rtl:rotate-180" />
              <Icon.ChevronRight className="-ms-2.5 size-3.5 rtl:rotate-180" />
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
