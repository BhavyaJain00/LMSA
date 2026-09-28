"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { TimetableItemType, TimetableLegend } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { IconButton, Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { MONTHS_LONG, WEEKDAYS_SHORT, formatClockRange, formatDayKey } from "./tz";
import type { TimetableEntry } from "./types";

export const timetableTypeLabel: Record<TimetableItemType, string> = {
  course: "Course",
  lesson: "Lesson",
  live_class: "Live class",
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Exercise",
  custom: "Event",
};

export const timetableTypeIcon: Record<TimetableItemType, ReactNode> = {
  course: <Icon.BookOpen />,
  lesson: <Icon.FileText />,
  live_class: <Icon.Video />,
  quiz: <Icon.ListChecks />,
  assignment: <Icon.ClipboardList />,
  exercise: <Icon.Code />,
  custom: <Icon.Calendar />,
};

/** Legend color as inline style (colors are user-defined data); accent when none. */
function swatch(color: string | null): CSSProperties | undefined {
  return color ? { backgroundColor: color } : undefined;
}

function chipStyle(color: string | null): CSSProperties | undefined {
  return color ? { borderLeftColor: color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined;
}

function Dot({ color, className }: { color: string | null; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", !color && "bg-accent", className)} style={swatch(color)} aria-hidden="true" />;
}

function MilestoneMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0 text-warning", className)} aria-label="Milestone" role="img">
      <path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill="currentColor" />
    </svg>
  );
}

function EntryLink({ entry, children, className, style }: { entry: TimetableEntry; children: ReactNode; className?: string; style?: CSSProperties }) {
  if (!entry.href)
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  return (
    <Link href={entry.href} className={className} style={style}>
      {children}
    </Link>
  );
}

type Month = { y: number; m: number };

function monthOf(key: string): Month {
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) };
}

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthCells(month: Month): { key: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(month.y, month.m - 1, 1));
  const startOffset = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells: { key: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(month.y, month.m - 1, 1 - startOffset + i));
    cells.push({ key: keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month.m - 1 });
  }
  return cells;
}

function shiftMonth(month: Month, delta: number): Month {
  const d = new Date(Date.UTC(month.y, month.m - 1 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

function EntryRow({ entry }: { entry: TimetableEntry }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-white [&>svg]:size-4", !entry.color && "bg-accent")}
        style={swatch(entry.color)}
        aria-hidden="true"
      >
        {timetableTypeIcon[entry.type]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <EntryLink entry={entry} className={cn("font-medium text-ink", entry.href && "hover:text-accent hover:underline")}>
            {entry.title}
          </EntryLink>
          {entry.milestone && (
            <Badge tone="warning" size="xs">
              <MilestoneMark className="size-2.5" /> Milestone
            </Badge>
          )}
          {entry.completed && (
            <Badge tone="success" size="xs">
              <Icon.Check className="size-3" /> Done
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {timetableTypeLabel[entry.type]}
          {entry.legendLabel && entry.legendLabel !== timetableTypeLabel[entry.type] && <> · {entry.legendLabel}</>}
          {entry.startTime && <> · {formatClockRange(entry.startTime, entry.endTime)}</>}
        </p>
      </div>
      {entry.href && <Icon.ChevronRight className="mt-2 size-4 shrink-0 text-ink-faint" />}
    </li>
  );
}

/**
 * Batch timetable as a month calendar (legend-colored entries, milestone
 * markers) or a chronological list. Entries link to their targets.
 */
export function TimetableView({
  entries,
  legends,
  startDate,
  endDate,
  todayKey,
  timezone,
}: {
  entries: TimetableEntry[];
  legends: TimetableLegend[];
  startDate: string;
  endDate: string;
  todayKey: string;
  timezone: string;
}) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const initial = todayKey >= startDate && todayKey <= endDate ? todayKey : entries.find((e) => e.date >= todayKey)?.date ?? startDate;
  const [month, setMonth] = useState<Month>(() => monthOf(initial));
  const [selected, setSelected] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    for (const e of entries) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [entries]);

  if (!entries.length) {
    return (
      <EmptyState
        icon={<Icon.Calendar />}
        title="No timetable yet"
        description="The instructors haven't published a schedule for this batch. Sessions, deadlines and milestones will appear here."
      />
    );
  }

  const cells = monthCells(month);
  const hasLiveMerged = entries.some((e) => e.source === "live_class" || (e.type === "live_class" && !e.color));
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : [];
  const grouped = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  const firstMonth = monthOf(startDate);
  const lastMonth = monthOf(entries.reduce((max, e) => (e.date > max ? e.date : max), endDate));
  const canPrev = month.y * 12 + month.m > firstMonth.y * 12 + firstMonth.m - 1;
  const canNext = month.y * 12 + month.m < lastMonth.y * 12 + lastMonth.m + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted" aria-label="Legend">
          {legends.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1.5">
              <Dot color={l.color} className="size-2.5" /> {l.label}
            </span>
          ))}
          {hasLiveMerged && (
            <span className="inline-flex items-center gap-1.5">
              <Dot color={null} className="size-2.5" /> {legends.length ? "Other" : "Scheduled item"}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <MilestoneMark /> Milestone
          </span>
        </div>
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: "calendar", label: "Calendar", icon: <Icon.Calendar className="size-3.5" /> },
            { value: "list", label: "List", icon: <Icon.Menu className="size-3.5" /> },
          ]}
        />
      </div>

      {view === "calendar" ? (
        <div className="rounded-card border border-border bg-surface-1 shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
            <IconButton label="Previous month" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} disabled={!canPrev}>
              <Icon.ChevronLeft className="size-4" />
            </IconButton>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink" aria-live="polite">
                {MONTHS_LONG[month.m - 1]} {month.y}
              </h3>
              <Button size="xs" variant="ghost" onClick={() => setMonth(monthOf(todayKey))}>
                Today
              </Button>
            </div>
            <IconButton label="Next month" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={!canNext}>
              <Icon.ChevronRight className="size-4" />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {WEEKDAYS_SHORT.map((d) => (
              <div key={d} className="py-2">
                <span className="sm:hidden">{d.slice(0, 1)}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const dayEntries = byDate.get(cell.key) ?? [];
              const inBatch = cell.key >= startDate && cell.key <= endDate;
              const isToday = cell.key === todayKey;
              const isSelected = selected === cell.key;
              return (
                <div
                  key={cell.key}
                  className={cn(
                    "min-h-16 border-border p-1 sm:min-h-28 sm:p-1.5",
                    i % 7 !== 6 && "border-r",
                    i < cells.length - 7 && "border-b",
                    !cell.inMonth && "bg-surface-2/60",
                    cell.inMonth && !inBatch && "bg-surface-2/30",
                    isSelected && "ring-2 ring-inset ring-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(isSelected ? null : cell.key)}
                    aria-label={`${formatDayKey(cell.key, "weekday")}${dayEntries.length ? `, ${dayEntries.length} item${dayEntries.length > 1 ? "s" : ""}` : ""}`}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs transition-colors hover:bg-surface-3",
                      isToday ? "bg-accent font-semibold text-accent-fg hover:bg-accent" : cell.inMonth ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {cell.day}
                  </button>
                  {dayEntries.length > 0 && (
                    <>
                      <div className="mt-1 flex flex-wrap gap-1 sm:hidden" aria-hidden="true">
                        {dayEntries.slice(0, 4).map((e) => (e.milestone ? <MilestoneMark key={e.id} className="size-2.5" /> : <Dot key={e.id} color={e.color} />))}
                      </div>
                      <ul className="mt-1 hidden space-y-1 sm:block">
                        {dayEntries.slice(0, 3).map((e) => (
                          <li key={e.id}>
                            <EntryLink
                              entry={e}
                              style={chipStyle(e.color)}
                              className={cn(
                                "flex items-center gap-1 truncate rounded border-l-2 px-1.5 py-0.5 text-[11px] leading-4 text-ink",
                                !e.color && "border-accent bg-accent/10",
                                e.href && "hover:brightness-95 hover:underline",
                              )}
                            >
                              {e.milestone && <MilestoneMark className="size-2.5" />}
                              <span className="truncate" title={`${e.title}${e.startTime ? ` · ${formatClockRange(e.startTime, e.endTime)}` : ""}`}>
                                {e.startTime && <span className="text-ink-muted">{e.startTime} </span>}
                                {e.title}
                              </span>
                            </EntryLink>
                          </li>
                        ))}
                        {dayEntries.length > 3 && (
                          <li>
                            <button type="button" onClick={() => setSelected(cell.key)} className="px-1.5 text-[11px] font-medium text-accent hover:underline">
                              +{dayEntries.length - 3} more
                            </button>
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {selected && (
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">{formatDayKey(selected, "weekday")}</h4>
                <IconButton label="Close day" size="icon-sm" onClick={() => setSelected(null)}>
                  <Icon.X className="size-4" />
                </IconButton>
              </div>
              {selectedEntries.length ? (
                <ul className="divide-y divide-border">
                  {selectedEntries.map((e) => (
                    <EntryRow key={e.id} entry={e} />
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-sm text-ink-muted">Nothing scheduled on this day.</p>
              )}
            </div>
          )}
          <p className="border-t border-border px-4 py-2 text-xs text-ink-faint">Times are shown in the batch timezone ({timezone.replace(/_/g, " ")}).</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, list]) => (
            <section key={date} aria-labelledby={`tt-${date}`}>
              <h3 id={`tt-${date}`} className={cn("mb-1 text-sm font-semibold", date === todayKey ? "text-accent" : "text-ink")}>
                {formatDayKey(date, "weekday")}
                {date === todayKey && <span className="ml-2 text-xs font-medium">Today</span>}
              </h3>
              <ul className="divide-y divide-border rounded-card border border-border bg-surface-1 px-4 shadow-card">
                {list.map((e) => (
                  <EntryRow key={e.id} entry={e} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-ink-faint">Times are shown in the batch timezone ({timezone.replace(/_/g, " ")}).</p>
        </div>
      )}
    </div>
  );
}
