"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, formatDuration } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { CircleHalfIcon, MonitorPlayIcon, NotebookPenIcon } from "./learn-icons";
import { lockExplanation, lockOf } from "./drip-shared";
import { UnlockLabel, useRefreshWhenUnlocked } from "./unlock-time";
import type { LessonKind, OutlineChapterItem, OutlineLessonItem } from "./types";

const KIND_META: Record<LessonKind, { label: string; icon: (props: { className?: string }) => ReactNode }> = {
  video: { label: "Video", icon: (p) => <MonitorPlayIcon {...p} /> },
  quiz: { label: "Quiz", icon: (p) => <Icon.Question {...p} /> },
  assignment: { label: "Assignment", icon: (p) => <NotebookPenIcon {...p} /> },
  exercise: { label: "Programming exercise", icon: (p) => <Icon.Code {...p} /> },
  text: { label: "Reading", icon: (p) => <Icon.FileText {...p} /> },
};

function lockTitle(lesson: OutlineLessonItem): string {
  const lock = lockOf(lesson);
  if (lock) return lockExplanation(lock);
  return lesson.lockReason === "sequential" ? "Complete the previous lesson to unlock this one" : "Enroll in the course to unlock this lesson";
}

/** Earliest drip unlock among the chapter's lessons when every lesson of it is still scheduled. */
function chapterUnlocksAt(chapter: OutlineChapterItem): string | null {
  if (!chapter.lessons.length) return null;
  let earliest: string | null = null;
  for (const lesson of chapter.lessons) {
    const lock = lockOf(lesson);
    if (lock?.reason !== "drip" || !lock.unlocksAt) return null;
    if (!earliest || Date.parse(lock.unlocksAt) < Date.parse(earliest)) earliest = lock.unlocksAt;
  }
  return earliest;
}

function StatusIcon({ lesson, tracking }: { lesson: OutlineLessonItem; tracking: boolean }) {
  if (lesson.locked) {
    const scheduled = lockOf(lesson)?.reason === "drip";
    return (
      <span className="flex shrink-0 text-ink-faint" title={lockTitle(lesson)}>
        {scheduled ? <Icon.Clock className="size-4" /> : <Icon.Lock className="size-4" />}
        <span className="sr-only">{scheduled ? "Scheduled" : "Locked"}</span>
      </span>
    );
  }
  if (!tracking) return null;
  if (lesson.status === "complete") {
    return (
      <span className="flex shrink-0 text-success" title="Completed">
        <Icon.CheckCircleFilled className="size-4" />
        <span className="sr-only">Completed</span>
      </span>
    );
  }
  if (lesson.status === "partial") {
    return (
      <span className="flex shrink-0 text-warning" title="In progress">
        <CircleHalfIcon className="size-4" />
        <span className="sr-only">In progress</span>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 text-ink-faint" title="Not started">
      <Icon.Circle className="size-4" />
      <span className="sr-only">Not started</span>
    </span>
  );
}

export interface CourseOutlineNavProps {
  outline: OutlineChapterItem[];
  currentLessonId: string | null;
  /** Show completion state (enrolled learners). */
  tracking: boolean;
  /** Show "Preview" labels (visitors who are not enrolled). */
  showPreview: boolean;
  onNavigate?: () => void;
  className?: string;
}

/** Chapters accordion with lesson rows (type icon, title, duration, status, lock). */
export function CourseOutlineNav({ outline, currentLessonId, tracking, showPreview, onNavigate, className }: CourseOutlineNavProps) {
  const currentChapterId = outline.find((c) => c.lessons.some((l) => l.id === currentLessonId))?.id ?? outline[0]?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentChapterId ? [currentChapterId] : []));
  const listRef = useRef<HTMLDivElement>(null);

  // Scheduled lessons open on time: refresh the route when the next one is released.
  const unlockTimes = useMemo(
    () =>
      outline.flatMap((c) =>
        c.lessons.flatMap((l) => {
          const lock = lockOf(l);
          return lock?.reason === "drip" && lock.unlocksAt ? [Date.parse(lock.unlocksAt)] : [];
        }),
      ),
    [outline],
  );
  useRefreshWhenUnlocked(unlockTimes);

  // Keep the current lesson visible inside the scrollable list (without scrolling the page).
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>("[aria-current='page']");
    if (!list || !row) return;
    const scroller = list.closest<HTMLElement>("[data-sidebar-scroll]") ?? list;
    const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (rowTop < scroller.scrollTop || rowTop > scroller.scrollTop + scroller.clientHeight - 48) {
      scroller.scrollTop = Math.max(0, rowTop - scroller.clientHeight / 3);
    }
  }, [currentLessonId]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!outline.length || outline.every((c) => !c.lessons.length)) {
    return (
      <div className={cn("px-4 py-8 text-center text-sm text-ink-muted", className)}>
        <Icon.BookOpen className="mx-auto mb-2 size-6 text-ink-faint" />
        Course content coming soon!
      </div>
    );
  }

  return (
    <div ref={listRef} className={cn("space-y-1 p-2", className)}>
      {outline.map((chapter) => {
        const isOpen = open.has(chapter.id);
        const done = chapter.lessons.filter((l) => l.status === "complete").length;
        const panelId = `outline-chapter-${chapter.id}`;
        const chapterUnlock = chapterUnlocksAt(chapter);
        return (
          <div key={chapter.id}>
            <button
              type="button"
              onClick={() => toggle(chapter.id)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <Icon.ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform duration-200", !isOpen && "-rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-faint">Chapter {chapter.number}</span>
                <span className="block truncate text-sm font-semibold text-ink">{chapter.title}</span>
                {chapterUnlock && <UnlockLabel at={chapterUnlock} icon className="mt-0.5 text-[11px] font-medium text-accent" />}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                {tracking ? `${done}/${chapter.lessons.length}` : `${chapter.lessons.length} ${chapter.lessons.length === 1 ? "lesson" : "lessons"}`}
              </span>
            </button>
            {isOpen && (
              <ul id={panelId} className="mt-0.5 space-y-0.5 pb-1">
                {chapter.lessons.map((lesson) => {
                  const current = lesson.id === currentLessonId;
                  const kind = KIND_META[lesson.kind];
                  const lock = lockOf(lesson);
                  const inner = (
                    <>
                      <span className={cn("flex shrink-0", current ? "text-accent" : "text-ink-faint")} title={kind.label}>
                        {kind.icon({ className: "size-4" })}
                        <span className="sr-only">{kind.label}:</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("line-clamp-2 text-sm", current ? "font-medium text-ink" : "text-ink-muted")}>{lesson.title}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                          <span className="tabular-nums">
                            {lesson.chapterNumber}.{lesson.lessonNumber}
                          </span>
                          {lesson.durationSeconds > 0 && <span>{formatDuration(lesson.durationSeconds)}</span>}
                          {showPreview && lesson.preview && <span className="rounded bg-info/12 px-1 font-medium text-info">Preview</span>}
                        </span>
                        {lock?.reason === "drip" && lock.unlocksAt && !chapterUnlock && (
                          <UnlockLabel at={lock.unlocksAt} className="mt-0.5 text-[11px] font-medium text-accent" />
                        )}
                      </span>
                      <StatusIcon lesson={lesson} tracking={tracking} />
                    </>
                  );
                  const rowClass = cn(
                    "relative flex items-start gap-2.5 rounded-lg py-2 pl-9 pr-2.5 transition-colors",
                    current && "bg-surface-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent",
                  );
                  return (
                    <li key={lesson.id}>
                      {lesson.locked ? (
                        <div className={cn(rowClass, "cursor-not-allowed opacity-60")} aria-disabled="true" title={lockTitle(lesson)}>
                          {inner}
                        </div>
                      ) : (
                        <Link
                          href={lesson.href}
                          aria-current={current ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(rowClass, !current && "hover:bg-surface-2")}
                          prefetch={false}
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
