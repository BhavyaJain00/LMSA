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
import { AddToCalendar, type AddToCalendarEvent } from "@/components/pwa/add-to-calendar";
import { zonedRange } from "@/lib/calendar/ics";
import { addDaysToKey, isClock, isValidTimeZone, tzOffsetMinutes, zonedTimeToUtc } from "@/lib/calendar/time";
import { useViewerTimeZone } from "./hooks";
import { scheduleRows, type RowSchedule } from "./timetable-schedule";
import { formatClockRange, formatDayKey, formatGmtOffset } from "./tz";
import type { TimetableEntry } from "./types";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";

// `global.` keys throughout: the timetable is also shown in the admin timetable builder.
type PublicT = Translator<MessageKey<"public">>;

/** Item type in the interface language. */
function typeLabel(type: TimetableItemType, t: PublicT): string {
  return t(`global.timetable.type.${type}`);
}

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
  const t = useT("public");
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0 text-warning", className)} aria-label={t("global.timetable.milestone")} role="img">
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

function zoneName(tz: string): string {
  return tz.replace(/_/g, " ");
}

/** A class's start in the viewer's own timezone, when its clock differs from the one shown (client only). */
function ViewerTime({ at, shownZone }: { at: number; shownZone: string }) {
  const t = useT("public");
  const locale = useLocale();
  const viewerZone = useViewerTimeZone();
  if (!viewerZone || !isValidTimeZone(viewerZone) || tzOffsetMinutes(viewerZone, at) === tzOffsetMinutes(shownZone, at)) return null;
  const local = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: viewerZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return (
    <span className="mt-0.5 block text-xs text-ink-faint" title={t("global.localTime.convertedTo", { zone: zoneName(viewerZone) })}>
      {t("global.timetable.yourTime", { time: local, zone: zoneName(viewerZone) })}
    </span>
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

/**
 * Calendar export for a timetable row, matching the row's server .ics: rows
 * backed by a live class use the class's own start and end (their clock times
 * are in the class timezone, not the batch's); other rows are timed in the
 * batch timezone, or all-day.
 */
function calendarEvent(entry: TimetableEntry, timezone: string, t: PublicT): AddToCalendarEvent | null {
  const fromClass = entry.source === "live_class" && entry.refId;
  const icsHref = fromClass
    ? `/api/calendar/event?type=live_class&id=${encodeURIComponent(entry.refId!)}`
    : entry.itemId
      ? `/api/calendar/event?type=timetable&id=${encodeURIComponent(entry.itemId)}`
      : undefined;
  const base = {
    uid: fromClass ? `live-class-${entry.refId}` : `timetable-${entry.itemId ?? entry.id}`,
    title: entry.milestone ? `★ ${entry.title}` : entry.title,
    description: [typeLabel(entry.type, t), entry.legendLabel && entry.legendLabel !== timetableTypeLabel[entry.type] ? entry.legendLabel : ""]
      .filter(Boolean)
      .join(" · "),
    url: entry.href ?? undefined,
    icsHref,
  };
  if (entry.classRange) return { ...base, start: entry.classRange.start, end: entry.classRange.end };
  if (entry.startTime && isClock(entry.startTime)) {
    // Same conversion as the server export (crossing midnight, DST gaps).
    const range = zonedRange(entry.date, entry.startTime, entry.endTime, timezone, 60);
    if (!range || range.start.kind !== "utc") return null;
    const start = range.start.epochMs;
    const end = range.end?.kind === "utc" && range.end.epochMs > start ? range.end.epochMs : start + 3_600_000;
    return { ...base, start, end };
  }
  const endDate = addDaysToKey(entry.date, 1);
  const start = zonedTimeToUtc(entry.date, "00:00", timezone);
  const end = zonedTimeToUtc(endDate, "00:00", timezone);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { ...base, start, end, allDay: { startDate: entry.date, endDate } };
}

function EntryRow({ entry, schedule, timezone, showCalendar }: { entry: TimetableEntry; schedule: RowSchedule; timezone: string; showCalendar: boolean }) {
  const t = useT("public");
  const locale = useLocale();
  const calendar = showCalendar ? calendarEvent(entry, timezone, t) : null;
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
              <MilestoneMark className="size-2.5" /> {t("global.timetable.milestone")}
            </Badge>
          )}
          {entry.completed && (
            <Badge tone="success" size="xs">
              <Icon.Check className="size-3" /> {t("global.timetable.done")}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {typeLabel(entry.type, t)}
          {entry.legendLabel && entry.legendLabel !== timetableTypeLabel[entry.type] && <> · {entry.legendLabel}</>}
          {schedule.startTime && <> · {formatClockRange(schedule.startTime, schedule.endTime, locale)}</>}
          {schedule.zone && schedule.startsAt !== null && (
            <span className="text-ink-faint">
              {" "}
              ({zoneName(schedule.zone)}, {formatGmtOffset(schedule.zone, schedule.startsAt)})
            </span>
          )}
        </p>
        {schedule.startsAt !== null && <ViewerTime at={schedule.startsAt} shownZone={schedule.zone ?? timezone} />}
      </div>
      {calendar && <AddToCalendar event={calendar} size="xs" className="mt-1 shrink-0" />}
      {entry.href && <Icon.ChevronRight className="mt-2 size-4 shrink-0 text-ink-faint rtl:rotate-180" />}
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
  showAddToCalendar = true,
}: {
  entries: TimetableEntry[];
  legends: TimetableLegend[];
  startDate: string;
  endDate: string;
  todayKey: string;
  timezone: string;
  /** Per-entry "Add to calendar" menus in the list and day views. */
  showAddToCalendar?: boolean;
}) {
  const t = useT("public");
  const locale = useLocale();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  // Where and when each row is shown (live classes at their real time, see rowSchedule).
  const rows = useMemo(() => scheduleRows(entries, timezone), [entries, timezone]);
  const initial = todayKey >= startDate && todayKey <= endDate ? todayKey : rows.find((r) => r.schedule.date >= todayKey)?.schedule.date ?? startDate;
  const [month, setMonth] = useState<Month>(() => monthOf(initial));
  const [selected, setSelected] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.schedule.date) ?? [];
      list.push(row);
      map.set(row.schedule.date, list);
    }
    return map;
  }, [rows]);

  if (!entries.length) {
    return (
      <EmptyState
        icon={<Icon.Calendar />}
        title={t("global.timetable.emptyTitle")}
        description={t("global.timetable.emptyDescription")}
      />
    );
  }

  const cells = monthCells(month);
  const hasLiveMerged = entries.some((e) => e.source === "live_class" || (e.type === "live_class" && !e.color));
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : [];
  const grouped = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  const firstMonth = monthOf(rows.reduce((min, r) => (r.schedule.date < min ? r.schedule.date : min), startDate));
  const lastMonth = monthOf(rows.reduce((max, r) => (r.schedule.date > max ? r.schedule.date : max), endDate));
  // Rows are in the batch timezone except live classes scheduled in a zone whose clock differs.
  const timesNote = rows.some((r) => r.schedule.zone)
    ? t("global.timetable.timesNoteMixed", { zone: zoneName(timezone) })
    : t("global.timetable.timesNote", { zone: zoneName(timezone) });
  const tag = intlLocale(locale);
  const monthTitle = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(month.y, month.m - 1, 1));
  // 2023-01-01 was a Sunday: the calendar grid starts on Sunday.
  const weekdays = Array.from({ length: 7 }, (_, i) => ({
    short: new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + i)),
    narrow: new Intl.DateTimeFormat(tag, { weekday: "narrow", timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + i)),
  }));
  const canPrev = month.y * 12 + month.m > firstMonth.y * 12 + firstMonth.m - 1;
  const canNext = month.y * 12 + month.m < lastMonth.y * 12 + lastMonth.m + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted" aria-label={t("global.timetable.legend")}>
          {legends.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1.5">
              <Dot color={l.color} className="size-2.5" /> {l.label}
            </span>
          ))}
          {hasLiveMerged && (
            <span className="inline-flex items-center gap-1.5">
              <Dot color={null} className="size-2.5" /> {legends.length ? t("global.timetable.other") : t("global.timetable.scheduledItem")}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <MilestoneMark /> {t("global.timetable.milestone")}
          </span>
        </div>
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: "calendar", label: t("global.timetable.calendar"), icon: <Icon.Calendar className="size-3.5" /> },
            { value: "list", label: t("global.timetable.list"), icon: <Icon.Menu className="size-3.5" /> },
          ]}
        />
      </div>

      {view === "calendar" ? (
        <div className="rounded-card border border-border bg-surface-1 shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
            <IconButton label={t("global.timetable.previousMonth")} size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} disabled={!canPrev}>
              <Icon.ChevronLeft className="size-4 rtl:rotate-180" />
            </IconButton>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink" aria-live="polite">
                {monthTitle}
              </h3>
              <Button size="xs" variant="ghost" onClick={() => setMonth(monthOf(todayKey))}>
                {t("global.timetable.today")}
              </Button>
            </div>
            <IconButton label={t("global.timetable.nextMonth")} size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={!canNext}>
              <Icon.ChevronRight className="size-4 rtl:rotate-180" />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {weekdays.map((d, i) => (
              <div key={i} className="py-2">
                <span className="sm:hidden">{d.narrow}</span>
                <span className="hidden sm:inline">{d.short}</span>
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
                    aria-label={dayEntries.length ? t("global.timetable.dayWithItems", { date: formatDayKey(cell.key, "weekday", locale), count: dayEntries.length }) : formatDayKey(cell.key, "weekday", locale)}
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
                        {dayEntries.slice(0, 4).map(({ entry: e }) => (e.milestone ? <MilestoneMark key={e.id} className="size-2.5" /> : <Dot key={e.id} color={e.color} />))}
                      </div>
                      <ul className="mt-1 hidden space-y-1 sm:block">
                        {dayEntries.slice(0, 3).map(({ entry: e, schedule: s }) => {
                          const offset = s.zone && s.startsAt !== null ? formatGmtOffset(s.zone, s.startsAt) : null;
                          return (
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
                                <span
                                  className="truncate"
                                  title={`${e.title}${s.startTime ? ` · ${formatClockRange(s.startTime, s.endTime, locale)}` : ""}${s.zone && offset ? ` (${zoneName(s.zone)}, ${offset})` : ""}`}
                                >
                                  {s.startTime && (
                                    <span className="text-ink-muted">
                                      {s.startTime}
                                      {offset && ` ${offset}`}{" "}
                                    </span>
                                  )}
                                  {e.title}
                                </span>
                              </EntryLink>
                            </li>
                          );
                        })}
                        {dayEntries.length > 3 && (
                          <li>
                            <button type="button" onClick={() => setSelected(cell.key)} className="px-1.5 text-[11px] font-medium text-accent hover:underline">
                              {t("global.timetable.more", { count: dayEntries.length - 3 })}
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
                <h4 className="text-sm font-semibold text-ink">{formatDayKey(selected, "weekday", locale)}</h4>
                <IconButton label={t("global.timetable.closeDay")} size="icon-sm" onClick={() => setSelected(null)}>
                  <Icon.X className="size-4" />
                </IconButton>
              </div>
              {selectedEntries.length ? (
                <ul className="divide-y divide-border">
                  {selectedEntries.map(({ entry, schedule }) => (
                    <EntryRow key={entry.id} entry={entry} schedule={schedule} timezone={timezone} showCalendar={showAddToCalendar} />
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-sm text-ink-muted">{t("global.timetable.nothingThatDay")}</p>
              )}
            </div>
          )}
          <p className="border-t border-border px-4 py-2 text-xs text-ink-faint">{timesNote}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, list]) => (
            <section key={date} aria-labelledby={`tt-${date}`}>
              <h3 id={`tt-${date}`} className={cn("mb-1 text-sm font-semibold", date === todayKey ? "text-accent" : "text-ink")}>
                {formatDayKey(date, "weekday", locale)}
                {date === todayKey && <span className="ms-2 text-xs font-medium">{t("global.timetable.today")}</span>}
              </h3>
              <ul className="divide-y divide-border rounded-card border border-border bg-surface-1 px-4 shadow-card">
                {list.map(({ entry, schedule }) => (
                  <EntryRow key={entry.id} entry={entry} schedule={schedule} timezone={timezone} showCalendar={showAddToCalendar} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-ink-faint">{timesNote}</p>
        </div>
      )}
    </div>
  );
}
