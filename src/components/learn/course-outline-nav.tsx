"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useFormatter, useT } from "@/i18n/client";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";
import { CircleHalfIcon, MonitorPlayIcon, NotebookPenIcon } from "./learn-icons";
import { lockOf, type LessonLock } from "./drip-shared";
import { UnlockLabel, useRefreshWhenUnlocked } from "./unlock-time";
import type { LessonKind, OutlineChapterItem, OutlineLessonItem } from "./types";

type LearnT = Translator<MessageKey<"learning">>;

const KIND_META: Record<LessonKind, { label: MessageKey<"learning">; icon: (props: { className?: string }) => ReactNode }> = {
  video: { label: "learn.kind.video", icon: (p) => <MonitorPlayIcon {...p} /> },
  quiz: { label: "learn.kind.quiz", icon: (p) => <Icon.Question {...p} /> },
  assignment: { label: "learn.kind.assignment", icon: (p) => <NotebookPenIcon {...p} /> },
  exercise: { label: "learn.kind.exercise", icon: (p) => <Icon.Code {...p} /> },
  text: { label: "learn.kind.text", icon: (p) => <Icon.FileText {...p} /> },
};

/** Why a lesson is locked, in the interface language (time is shown separately in local time). */
export function lockExplanationText(lock: LessonLock, t: LearnT): string {
  switch (lock.reason) {
    case "order":
      return t("learn.lock.order");
    case "prerequisite":
      return t("learn.lock.prerequisite");
    case "enroll":
      return t("learn.lock.enroll");
    case "drip":
      return lock.afterPrevious ? t("learn.lock.dripAfterPrevious") : t("learn.lock.drip");
  }
}

function lockTitle(lesson: OutlineLessonItem, t: LearnT): string {
  const lock = lockOf(lesson);
  if (lock) return lockExplanationText(lock, t);
  return lesson.lockReason === "sequential" ? t("learn.lock.order") : t("learn.lock.enroll");
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
  const t = useT("learning");
  if (lesson.locked) {
    const scheduled = lockOf(lesson)?.reason === "drip";
    return (
      <span className="flex shrink-0 text-ink-faint" title={lockTitle(lesson, t)}>
        {scheduled ? <Icon.Clock className="size-[18px]" /> : <Icon.Lock className="size-[18px]" />}
        <span className="sr-only">{scheduled ? t("learn.status.scheduled") : t("learn.status.locked")}</span>
      </span>
    );
  }
  if (!tracking) return null;
  if (lesson.status === "complete") {
    return (
      <span className="flex shrink-0 text-success" title={t("learn.completed")}>
        <Icon.CheckCircleFilled className="size-[18px]" />
        <span className="sr-only">{t("learn.completed")}</span>
      </span>
    );
  }
  if (lesson.status === "partial") {
    return (
      <span className="flex shrink-0 text-warning" title={t("learn.status.inProgress")}>
        <CircleHalfIcon className="size-[18px]" />
        <span className="sr-only">{t("learn.status.inProgress")}</span>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 text-ink-faint" title={t("learn.status.notStarted")}>
      <Icon.Circle className="size-[18px]" />
      <span className="sr-only">{t("learn.status.notStarted")}</span>
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
  const t = useT("learning");
  const f = useFormatter();
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
        {t("learn.outline.empty")}
      </div>
    );
  }

  return (
    <div ref={listRef} className={cn("space-y-1 px-3 py-3", className)}>
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
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-micro text-ink-faint">{t("learn.meta.chapter", { number: chapter.number })}</span>
                <span className="block truncate text-sm font-semibold text-ink">{chapter.title}</span>
                {chapterUnlock && <UnlockLabel at={chapterUnlock} icon className="mt-0.5 text-[11px] font-medium text-accent" />}
              </span>
              <span className="shrink-0 text-micro tabular-nums text-ink-faint">
                {tracking ? `${done}/${chapter.lessons.length}` : t("learn.outline.lessons", { count: chapter.lessons.length })}
              </span>
              <Icon.ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform duration-200", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <ul id={panelId} className="mb-2 mt-0.5 space-y-0.5">
                {chapter.lessons.map((lesson) => {
                  const current = lesson.id === currentLessonId;
                  const kind = KIND_META[lesson.kind];
                  const kindLabel = t(kind.label);
                  const lock = lockOf(lesson);
                  const inner = (
                    <>
                      <span className={cn("mt-px flex shrink-0", current ? "text-accent" : "text-ink-faint")} title={kindLabel}>
                        {kind.icon({ className: "size-4" })}
                        <span className="sr-only">{kindLabel}:</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("line-clamp-2 text-sm leading-snug", current ? "font-semibold text-ink" : "text-ink")}>{lesson.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                          <span className="tabular-nums">
                            {lesson.chapterNumber}.{lesson.lessonNumber}
                          </span>
                          {lesson.durationSeconds > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{f.duration(lesson.durationSeconds)}</span>
                            </>
                          )}
                          {showPreview && lesson.preview && <span className="rounded bg-info/12 px-1 font-medium text-info">{t("learn.outline.preview")}</span>}
                        </span>
                        {lock?.reason === "drip" && lock.unlocksAt && !chapterUnlock && (
                          <UnlockLabel at={lock.unlocksAt} className="mt-0.5 text-[11px] font-medium text-accent" />
                        )}
                      </span>
                      <StatusIcon lesson={lesson} tracking={tracking} />
                    </>
                  );
                  const rowClass = cn("relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors", current && "bg-accent/12 ring-1 ring-inset ring-accent/30");
                  return (
                    <li key={lesson.id}>
                      {lesson.locked ? (
                        <div className={cn(rowClass, "cursor-not-allowed opacity-60")} aria-disabled="true" title={lockTitle(lesson, t)}>
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
