"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn, formatDuration } from "@/lib/utils";
import { describeReleaseRule, lockExplanation, type LessonLock, type ReleaseRule } from "@/components/learn/drip-shared";
import { UnlockLabel, useRefreshWhenUnlocked } from "@/components/learn/unlock-time";
import { LessonKindIcon } from "./lesson-kind-icon";
import { plural } from "./format";
import type { OutlineChapterView, OutlineLessonView, OutlineMode } from "./types";

/** Outline row with the viewer's detailed lock and (for managers) the configured release rule. */
export interface ScheduledOutlineLessonView extends OutlineLessonView {
  lock?: LessonLock;
  /** Manager view: the lesson's own release rule. */
  rule?: ReleaseRule | null;
  /** Manager view: compact label of that rule ("Day 7 · Oct 4"). */
  ruleLabel?: string | null;
}

export interface ScheduledOutlineChapterView extends Omit<OutlineChapterView, "lessons"> {
  lessons: ScheduledOutlineLessonView[];
  /** Every lesson of the chapter is scheduled; the chapter opens at this instant (ISO). */
  unlocksAt?: string | null;
  rule?: ReleaseRule | null;
  ruleLabel?: string | null;
}

function lockedReason(mode: OutlineMode, lock: LessonLock | undefined): string {
  if (lock) return lockExplanation(lock);
  if (mode === "enrolled") return "Complete the previous lesson to unlock this one";
  if (mode === "guest") return "Log in and enroll to unlock this lesson";
  return "Enroll in the course to unlock this lesson";
}

function LessonStatus({ lesson, mode }: { lesson: ScheduledOutlineLessonView; mode: OutlineMode }) {
  if (lesson.locked) {
    const reason = lockedReason(mode, lesson.lock);
    const scheduled = lesson.lock?.reason === "drip";
    return (
      <span className={cn("inline-flex shrink-0", scheduled ? "text-accent" : "text-ink-faint")} title={reason}>
        {scheduled ? <Icon.Clock className="size-4" aria-hidden="true" /> : <Icon.Lock className="size-4" aria-hidden="true" />}
        <span className="sr-only">
          {scheduled ? "Scheduled" : "Locked"}. {reason}
        </span>
      </span>
    );
  }
  if (mode !== "enrolled") return null;
  if (lesson.status === "complete") {
    return (
      <span className="inline-flex shrink-0 text-success" title="Completed">
        <Icon.CheckCircleFilled className="size-4" aria-hidden="true" />
        <span className="sr-only">Completed</span>
      </span>
    );
  }
  if (lesson.status === "partial") {
    return (
      <span className="inline-flex shrink-0 text-warning" title="In progress">
        <Icon.CircleDot className="size-4" aria-hidden="true" />
        <span className="sr-only">In progress</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 text-ink-faint/70" title="Not started">
      <Icon.Circle className="size-4" aria-hidden="true" />
      <span className="sr-only">Not started</span>
    </span>
  );
}

function RuleBadge({ label, rule, subject }: { label: string; rule: ReleaseRule | null | undefined; subject: "chapter" | "lesson" }) {
  return (
    <Badge tone="outline" size="xs" className="shrink-0" title={describeReleaseRule(rule, subject)}>
      <Icon.Clock className="size-3" aria-hidden="true" />
      <span className="sr-only">Release schedule: </span>
      {label}
    </Badge>
  );
}

function LessonRow({
  lesson,
  mode,
  highlight,
  chapterScheduled,
}: {
  lesson: ScheduledOutlineLessonView;
  mode: OutlineMode;
  highlight: boolean;
  /** The chapter header already shows the unlock time for every lesson. */
  chapterScheduled: boolean;
}) {
  const showPreview = lesson.preview && (mode === "guest" || mode === "visitor");
  const interactive = !!lesson.href && !lesson.locked;
  const dripAt = lesson.lock?.reason === "drip" ? lesson.lock.unlocksAt : undefined;
  const scheduled = !!dripAt;
  const content = (
    <>
      <LessonKindIcon kind={lesson.kind} className={cn(interactive ? "text-ink-muted group-hover/row:text-accent" : "text-ink-faint")} />
      <span className="min-w-0 flex-1">
        <span className="sr-only">
          Lesson {lesson.chapterNumber}.{lesson.lessonNumber}:{" "}
        </span>
        <span className={cn("block truncate", interactive && "group-hover/row:text-accent", lesson.status === "complete" && mode === "enrolled" && "text-ink-muted")}>
          {lesson.title}
        </span>
        {dripAt && !chapterScheduled && <UnlockLabel at={dripAt} className="mt-0.5 text-xs font-medium text-accent" />}
      </span>
      {mode === "manager" && lesson.ruleLabel && <RuleBadge label={lesson.ruleLabel} rule={lesson.rule} subject="lesson" />}
      {showPreview && (
        <Badge tone="accent" size="xs" className="shrink-0">
          <Icon.Eye className="size-3" aria-hidden="true" />
          Preview
        </Badge>
      )}
      {highlight && (
        <Badge tone="info" size="xs" className="hidden shrink-0 sm:inline-flex">
          Up next
        </Badge>
      )}
      {lesson.durationSeconds > 0 && (
        <span className="hidden shrink-0 text-xs tabular-nums text-ink-faint sm:inline">{formatDuration(lesson.durationSeconds)}</span>
      )}
      <LessonStatus lesson={lesson} mode={mode} />
    </>
  );

  const base = "group/row flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm";
  if (interactive) {
    return (
      <Link href={lesson.href!} className={cn(base, "text-ink transition-colors hover:bg-surface-2", highlight && "bg-accent/5 ring-1 ring-inset ring-accent/20")}>
        {content}
      </Link>
    );
  }
  return (
    <div className={cn(base, "cursor-not-allowed text-ink-muted", scheduled ? "opacity-80" : "opacity-60")} aria-disabled="true">
      {content}
    </div>
  );
}

/**
 * Read-only curriculum accordion for the course page: chapters expand to
 * list their lessons with a content-type icon, duration, preview badge,
 * lock state, (for enrolled learners) completion ticks, and the release
 * schedule of scheduled (drip) content in the viewer's local time.
 */
export function CourseOutlineAccordion({
  chapters,
  mode,
  defaultOpenIds,
  nextLessonId,
}: {
  chapters: ScheduledOutlineChapterView[];
  mode: OutlineMode;
  /** Chapters expanded on first render (defaults to the first one). */
  defaultOpenIds?: string[];
  /** Lesson highlighted as "Up next" for enrolled learners. */
  nextLessonId?: string | null;
}) {
  const baseId = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpenIds ?? (chapters[0] ? [chapters[0].id] : [])));
  const allOpen = chapters.length > 0 && chapters.every((c) => open.has(c.id));

  const unlockTimes = useMemo(
    () => chapters.flatMap((c) => c.lessons.flatMap((l) => (l.lock?.reason === "drip" && l.lock.unlocksAt ? [Date.parse(l.lock.unlocksAt)] : []))),
    [chapters],
  );
  useRefreshWhenUnlocked(unlockTimes);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      {chapters.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(chapters.map((c) => c.id)))}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
          >
            {allOpen ? <Icon.ChevronUp className="size-3.5" aria-hidden="true" /> : <Icon.ChevronDown className="size-3.5" aria-hidden="true" />}
            {allOpen ? "Collapse all sections" : "Expand all sections"}
          </button>
        </div>
      )}
      <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
        {chapters.map((chapter) => {
          const isOpen = open.has(chapter.id);
          const panelId = `${baseId}-panel-${chapter.id}`;
          const complete = mode === "enrolled" && chapter.lessons.length > 0 && chapter.completedCount === chapter.lessons.length;
          return (
            <li key={chapter.id}>
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(chapter.id)}
                  className="flex w-full items-center gap-3 bg-surface-1 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                >
                  <Icon.ChevronRight
                    className={cn("size-4 shrink-0 text-ink-muted transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-90")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink sm:text-base">
                      <span className="text-ink-faint">{chapter.number}.</span> {chapter.title}
                    </span>
                    {chapter.unlocksAt && <UnlockLabel at={chapter.unlocksAt} icon className="mt-0.5 text-xs font-medium text-accent" />}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                    {mode === "manager" && chapter.ruleLabel && <RuleBadge label={chapter.ruleLabel} rule={chapter.rule} subject="chapter" />}
                    {mode === "enrolled" && chapter.lessons.length > 0 && (
                      <span className={cn("tabular-nums", complete && "font-medium text-success")}>
                        {chapter.completedCount}/{chapter.lessons.length}
                        <span className="sr-only"> completed</span>
                      </span>
                    )}
                    <span className="hidden sm:inline">
                      {chapter.lessons.length} {plural(chapter.lessons.length, "lesson")}
                      {chapter.durationSeconds > 0 && ` · ${formatDuration(chapter.durationSeconds)}`}
                    </span>
                    {complete && <Icon.CheckCircleFilled className="size-4 text-success" aria-hidden="true" />}
                  </span>
                </button>
              </h3>
              <div id={panelId} hidden={!isOpen} className="border-t border-border bg-surface px-2 py-2 sm:px-3">
                {chapter.description && <p className="px-3 pb-2 pt-1 text-sm text-ink-muted">{chapter.description}</p>}
                {chapter.lessons.length ? (
                  <ol className="space-y-0.5">
                    {chapter.lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <LessonRow lesson={lesson} mode={mode} highlight={mode === "enrolled" && lesson.id === nextLessonId} chapterScheduled={!!chapter.unlocksAt} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-3 py-2 text-sm text-ink-faint">Lessons for this section are coming soon.</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
