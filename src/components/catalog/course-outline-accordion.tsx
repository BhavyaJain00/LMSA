"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";
import { describeReleaseRule, lockExplanation, type LessonLock, type ReleaseRule } from "@/components/learn/drip-shared";
import { UnlockLabel, useRefreshWhenUnlocked } from "@/components/learn/unlock-time";
import { LessonKindIcon } from "./lesson-kind-icon";
import type { OutlineChapterView, OutlineLessonView, OutlineMode } from "./types";

type PublicT = Translator<MessageKey<"public">>;

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

function lockedReason(t: PublicT, mode: OutlineMode, lock: LessonLock | undefined): string {
  if (lock) return lockExplanation(lock);
  if (mode === "enrolled") return t("outline.locked.enrolled");
  if (mode === "guest") return t("outline.locked.guest");
  return t("outline.locked.visitor");
}

function LessonStatus({ lesson, mode }: { lesson: ScheduledOutlineLessonView; mode: OutlineMode }) {
  const t = useT("public");
  if (lesson.locked) {
    const reason = lockedReason(t, mode, lesson.lock);
    const scheduled = lesson.lock?.reason === "drip";
    return (
      <span className={cn("inline-flex shrink-0", scheduled ? "text-accent" : "text-ink-faint")} title={reason}>
        {scheduled ? <Icon.Clock className="size-4" aria-hidden="true" /> : <Icon.Lock className="size-4" aria-hidden="true" />}
        <span className="sr-only">{scheduled ? t("outline.status.scheduled", { reason }) : t("outline.status.locked", { reason })}</span>
      </span>
    );
  }
  if (mode !== "enrolled") return null;
  if (lesson.status === "complete") {
    return (
      <span className="inline-flex shrink-0 text-success" title={t("outline.status.completed")}>
        <Icon.CheckCircleFilled className="size-4" aria-hidden="true" />
        <span className="sr-only">{t("outline.status.completed")}</span>
      </span>
    );
  }
  if (lesson.status === "partial") {
    return (
      <span className="inline-flex shrink-0 text-warning" title={t("outline.status.inProgress")}>
        <Icon.CircleDot className="size-4" aria-hidden="true" />
        <span className="sr-only">{t("outline.status.inProgress")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 text-ink-faint/70" title={t("outline.status.notStarted")}>
      <Icon.Circle className="size-4" aria-hidden="true" />
      <span className="sr-only">{t("outline.status.notStarted")}</span>
    </span>
  );
}

function RuleBadge({ label, rule, subject }: { label: string; rule: ReleaseRule | null | undefined; subject: "chapter" | "lesson" }) {
  const t = useT("public");
  return (
    <Badge tone="outline" size="xs" className="shrink-0" title={describeReleaseRule(rule, subject)}>
      <Icon.Clock className="size-3" aria-hidden="true" />
      <span className="sr-only">{t("outline.releaseSchedule")} </span>
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
  const t = useT("public");
  const f = useFormatter();
  const showPreview = lesson.preview && (mode === "guest" || mode === "visitor");
  const interactive = !!lesson.href && !lesson.locked;
  const dripAt = lesson.lock?.reason === "drip" ? lesson.lock.unlocksAt : undefined;
  const scheduled = !!dripAt;
  const content = (
    <>
      <LessonKindIcon kind={lesson.kind} className={cn(interactive ? "text-ink-muted group-hover/row:text-accent" : "text-ink-faint")} />
      <span className="min-w-0 flex-1">
        <span className="sr-only">{t("outline.lessonNumber", { chapter: lesson.chapterNumber, lesson: lesson.lessonNumber })} </span>
        <span className={cn("block truncate", interactive && "group-hover/row:text-accent", lesson.status === "complete" && mode === "enrolled" && "text-ink-muted")}>
          {lesson.title}
        </span>
        {dripAt && !chapterScheduled && <UnlockLabel at={dripAt} className="mt-0.5 text-xs font-medium text-accent" />}
      </span>
      {mode === "manager" && lesson.ruleLabel && <RuleBadge label={lesson.ruleLabel} rule={lesson.rule} subject="lesson" />}
      {showPreview && (
        <Badge tone="accent" size="xs" className="shrink-0">
          <Icon.Eye className="size-3" aria-hidden="true" />
          {t("outline.preview")}
        </Badge>
      )}
      {highlight && (
        <Badge tone="info" size="xs" className="hidden shrink-0 sm:inline-flex">
          {t("outline.upNext")}
        </Badge>
      )}
      {lesson.durationSeconds > 0 && (
        <span className="hidden shrink-0 text-xs tabular-nums text-ink-faint sm:inline">{f.duration(lesson.durationSeconds)}</span>
      )}
      <LessonStatus lesson={lesson} mode={mode} />
    </>
  );

  const base = "group/row flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-sm sm:px-3";
  if (interactive) {
    return (
      <Link href={lesson.href!} className={cn(base, "text-ink transition-colors hover:bg-surface-2", highlight && "bg-accent/10 ring-1 ring-inset ring-accent/25")}>
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
 * Read-only curriculum accordion for the course page: each chapter is a rounded box whose header shows a number
 * badge, the title, "N lessons · duration" and a chevron; it expands to list its lessons with a content-type
 * icon, duration, preview badge, lock state, (for enrolled learners) completion ticks, and the release schedule
 * of scheduled (drip) content in the viewer's local time. `header` (the section title) is laid out next to the
 * "Expand all" toggle.
 */
export function CourseOutlineAccordion({
  chapters,
  mode,
  defaultOpenIds,
  nextLessonId,
  header,
}: {
  chapters: ScheduledOutlineChapterView[];
  mode: OutlineMode;
  /** Chapters expanded on first render (defaults to the first one). */
  defaultOpenIds?: string[];
  /** Lesson highlighted as "Up next" for enrolled learners. */
  nextLessonId?: string | null;
  /** Section title rendered on the left of the "Expand all" toggle. */
  header?: ReactNode;
}) {
  const t = useT("public");
  const f = useFormatter();
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

  const toggleAll =
    chapters.length > 1 ? (
      <button
        type="button"
        onClick={() => setOpen(allOpen ? new Set() : new Set(chapters.map((c) => c.id)))}
        className="tap-target inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-meta font-semibold text-accent hover:bg-accent/10"
      >
        {allOpen ? <Icon.ChevronUp className="size-3.5" aria-hidden="true" /> : <Icon.ChevronDown className="size-3.5" aria-hidden="true" />}
        {allOpen ? t("outline.collapseAll") : t("outline.expandAll")}
      </button>
    ) : null;

  return (
    <div>
      {(header || toggleAll) && (
        <div className={cn("mb-4 flex flex-wrap items-start gap-x-4 gap-y-2", header ? "justify-between" : "justify-end")}>
          {header && <div className="min-w-0">{header}</div>}
          {toggleAll}
        </div>
      )}
      <ol className="space-y-3">
        {chapters.map((chapter) => {
          const isOpen = open.has(chapter.id);
          const panelId = `${baseId}-panel-${chapter.id}`;
          const complete = mode === "enrolled" && chapter.lessons.length > 0 && chapter.completedCount === chapter.lessons.length;
          const chapterMeta =
            chapter.durationSeconds > 0
              ? t("course.hero.lessonsWithDuration", { count: chapter.lessons.length, duration: f.duration(chapter.durationSeconds) })
              : t("catalog.lessonCount", { count: chapter.lessons.length });
          return (
            <li key={chapter.id} className={cn("overflow-hidden rounded-xl border", isOpen ? "border-border-strong" : "border-border")}>
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(chapter.id)}
                  className="flex w-full items-center gap-3 bg-surface-2/50 px-3 py-3 text-start transition-colors hover:bg-surface-2 sm:px-4"
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
                      complete ? "bg-success/15 text-success" : "bg-accent text-accent-fg",
                    )}
                    aria-hidden="true"
                  >
                    {complete ? <Icon.Check className="size-4" /> : chapter.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink sm:text-base">
                      <span className="sr-only">{chapter.number}. </span>
                      {chapter.title}
                    </span>
                    <span className="mt-0.5 block text-meta text-ink-faint sm:hidden">{chapterMeta}</span>
                    {chapter.unlocksAt && <UnlockLabel at={chapter.unlocksAt} icon className="mt-0.5 text-xs font-medium text-accent" />}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-meta text-ink-faint">
                    {mode === "manager" && chapter.ruleLabel && <RuleBadge label={chapter.ruleLabel} rule={chapter.rule} subject="chapter" />}
                    {mode === "enrolled" && chapter.lessons.length > 0 && (
                      <span className={cn("tabular-nums", complete ? "font-semibold text-success" : "text-ink-muted")}>
                        <span aria-hidden="true">
                          {chapter.completedCount}/{chapter.lessons.length}
                        </span>
                        <span className="sr-only">{t("outline.chapterCompleted", { done: chapter.completedCount, total: chapter.lessons.length })}</span>
                      </span>
                    )}
                    <span className="hidden sm:inline">{chapterMeta}</span>
                    <Icon.ChevronDown
                      className={cn("size-4 text-ink-muted transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </h3>
              <div id={panelId} hidden={!isOpen} className="border-t border-border bg-surface-1 p-1.5 sm:p-2">
                {chapter.description && <p className="px-3 pb-2 pt-1.5 text-sm text-ink-muted">{chapter.description}</p>}
                {chapter.lessons.length ? (
                  <ol>
                    {chapter.lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <LessonRow lesson={lesson} mode={mode} highlight={mode === "enrolled" && lesson.id === nextLessonId} chapterScheduled={!!chapter.unlocksAt} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="px-3 py-2 text-sm text-ink-faint">{t("outline.emptyChapter")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
