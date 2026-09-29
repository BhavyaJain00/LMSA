"use client";

import { useState } from "react";
import { cn, pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DAY_MS,
  buildReleaseTimeline,
  describeReleaseRule,
  formatLocalDate,
  formatLocalTime,
  hasReleaseRule,
  shortRuleLabel,
  type TimelineEntry,
  type TimelineGroup,
} from "@/components/learn/drip-shared";
import { useNow } from "@/components/learn/unlock-time";
import type { OutlineChapter, OutlineLesson } from "./types";

/** YYYY-MM-DD of a local date. */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local midnight of a YYYY-MM-DD key (the simulated enrollment moment). */
function localMidnight(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const SOURCE_LABEL: Record<TimelineEntry["source"], string> = {
  immediate: "Immediately",
  days: "Days after enrollment",
  date: "Fixed date",
  both: "Days + date",
};

function GroupHeading({ group, anchor, now }: { group: TimelineGroup; anchor: number; now: number }) {
  const date = formatLocalDate(group.at, now);
  if (group.immediate) {
    return (
      <>
        <span className="font-semibold text-ink">At enrollment</span>
        <span className="text-ink-muted"> · {date}</span>
      </>
    );
  }
  const at = new Date(group.at);
  const midnight = at.getHours() === 0 && at.getMinutes() === 0;
  // Calendar days in local time (DST-safe), so a fixed 00:00 UTC date reads as the right day.
  const day = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - anchor) / DAY_MS);
  return (
    <>
      <span className="font-semibold text-ink">{date}</span>
      {!midnight && <span className="text-ink-muted"> · {formatLocalTime(group.at)}</span>}
      <span className="text-ink-muted"> · Day {day}</span>
    </>
  );
}

/**
 * "Schedule" view of the outline editor: when every lesson unlocks for a
 * learner who enrolls on a chosen day (default today), grouped by release
 * time, combining chapter and lesson rules the same way the lesson player
 * does. Fixed dates are 00:00 UTC, shown in the author's local time.
 */
export function ReleaseTimeline({
  chapters,
  onEditLesson,
  onEditChapter,
}: {
  chapters: OutlineChapter[];
  onEditLesson: (lesson: OutlineLesson, chapter: OutlineChapter) => void;
  onEditChapter: (chapter: OutlineChapter) => void;
}) {
  const now = useNow("minute");
  const [enrollDate, setEnrollDate] = useState("");

  const lessonCount = chapters.reduce((n, c) => n + c.lessons.length, 0);
  const scheduledChapters = chapters.filter((c) => hasReleaseRule(c));
  const scheduledLessons = chapters.flatMap((c) => c.lessons).filter((l) => hasReleaseRule(l));

  if (!lessonCount) {
    return (
      <div className="rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
        <Icon.Calendar className="mx-auto size-7 text-ink-faint" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-ink">No lessons to schedule yet</p>
        <p className="mt-1 text-sm text-ink-muted">Add lessons in the Outline view, then drip them out by chapter or lesson.</p>
      </div>
    );
  }

  if (!scheduledChapters.length && !scheduledLessons.length) {
    return (
      <div className="rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
        <Icon.Clock className="mx-auto size-7 text-ink-faint" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-ink">Everything is available at enrollment</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
          To drip content, edit a chapter or choose <span className="font-medium text-ink">Release schedule…</span> on a lesson. Release lessons a number of days after
          enrollment, on a fixed date, or both.
        </p>
        {chapters[0] && (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => onEditChapter(chapters[0]!)} leftIcon={<Icon.Clock className="size-4" />}>
            Schedule chapter 1
          </Button>
        )}
      </div>
    );
  }

  if (now === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const todayKey = localDateKey(now);
  const anchor = localMidnight(enrollDate || todayKey) ?? localMidnight(todayKey)!;
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const lessonById = new Map(chapters.flatMap((c) => c.lessons.map((l) => [l.id, { lesson: l, chapter: c }] as const)));
  const groups = buildReleaseTimeline(
    chapters.map((c) => ({
      id: c.id,
      title: c.title,
      dripDays: c.dripDays,
      availableFrom: c.availableFrom,
      lessons: c.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        chapterNumber: l.chapterNumber,
        lessonNumber: l.lessonNumber,
        includeInPreview: l.includeInPreview,
        dripDays: l.dripDays,
        availableFrom: l.availableFrom,
      })),
    })),
    anchor,
  );
  const last = groups[groups.length - 1];
  const scheduledCount = groups.filter((g) => !g.immediate).reduce((n, g) => n + g.entries.length, 0);
  const spanDays = last && !last.immediate ? Math.ceil((last.at - anchor) / DAY_MS) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Release timeline</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {pluralize(scheduledCount, "lesson")} of {lessonCount} scheduled
            {spanDays > 0 && <> · the last one opens {pluralize(spanDays, "day")} after enrollment</>}. Batch learners count from the batch start.
          </p>
        </div>
        <div className="shrink-0">
          <label htmlFor="timeline-enroll-date" className="mb-1 block text-xs font-medium text-ink-muted">
            Learner enrolls on
          </label>
          <div className="flex items-center gap-2">
            <Input id="timeline-enroll-date" type="date" value={enrollDate || todayKey} onChange={(e) => setEnrollDate(e.target.value)} className="w-44" />
            {enrollDate && enrollDate !== todayKey && (
              <Button variant="ghost" size="sm" onClick={() => setEnrollDate("")}>
                Today
              </Button>
            )}
          </div>
        </div>
      </div>

      {scheduledChapters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>Chapter schedules:</span>
          {scheduledChapters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onEditChapter(c)}
              title={describeReleaseRule(c, "chapter")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 px-2 py-0.5 font-medium text-ink hover:border-border-strong hover:bg-surface-2"
            >
              <Icon.Clock className="size-3 text-accent" aria-hidden="true" />
              <span className="max-w-40 truncate">{c.title}</span>
              <span className="text-ink-muted">{shortRuleLabel(c)}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="relative space-y-4 border-l-2 border-border pl-5 sm:pl-6">
        {groups.map((group) => (
          <li key={group.at} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                "absolute -left-[calc(1.75rem+1px)] top-0.5 flex size-4 items-center justify-center rounded-full border-2 border-surface sm:-left-[calc(2rem+1px)]",
                group.immediate ? "bg-success" : group.at <= now ? "bg-info" : "bg-accent",
              )}
            />
            <p className="text-sm">
              <GroupHeading group={group} anchor={anchor} now={now} />
              <span className="text-ink-faint"> · {pluralize(group.entries.length, "lesson")}</span>
            </p>
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {group.entries.map((entry) => {
                const found = lessonById.get(entry.lessonId);
                const ownLabel = shortRuleLabel(entry.rule);
                const chapterLabel = shortRuleLabel(entry.chapterRule);
                return (
                  <li key={entry.lessonId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap">
                    <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-ink-faint">{entry.index}</span>
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block truncate text-sm font-medium text-ink">{entry.title}</span>
                      <span className="block truncate text-xs text-ink-muted">{entry.chapterTitle}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {!group.immediate && (
                        <Badge tone="accent" size="xs" title={describeReleaseRule(entry.rule, "lesson")}>
                          {SOURCE_LABEL[entry.source]}
                        </Badge>
                      )}
                      {ownLabel && (
                        <Badge tone="outline" size="xs" title="This lesson's own schedule">
                          Lesson: {ownLabel}
                        </Badge>
                      )}
                      {chapterLabel && (
                        <Badge tone="outline" size="xs" title="Inherited from the chapter">
                          Chapter: {chapterLabel}
                        </Badge>
                      )}
                      {entry.preview && (
                        <Badge tone="info" size="xs">
                          Preview
                        </Badge>
                      )}
                      {found && (
                        <button
                          type="button"
                          onClick={() => onEditLesson(found.lesson, chapterById.get(found.chapter.id) ?? found.chapter)}
                          className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
                          aria-label={`Edit the release schedule of ${entry.title}`}
                          title="Release schedule…"
                        >
                          <Icon.Edit className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-faint">
        Times are shown in your time zone; fixed dates open at 00:00 UTC. Free previews follow fixed dates only, day-based schedules apply to enrolled learners.
      </p>
    </div>
  );
}
