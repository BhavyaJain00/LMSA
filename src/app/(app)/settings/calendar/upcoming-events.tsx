"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { CalendarEventKind } from "@/lib/calendar/events";
import { addDaysToKey, dateKeyInZone } from "@/lib/calendar/time";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { AddToCalendar } from "@/components/pwa/add-to-calendar";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/catalog";

export interface UpcomingEventView {
  uid: string;
  kind: CalendarEventKind;
  title: string;
  description: string;
  location?: string;
  timezone: string;
  allDay: boolean;
  start: number;
  end: number;
  startDate: string;
  /** Exclusive for all-day events. */
  endDate: string;
  path: string;
  /** Timetable item type label ("Quiz", "Lesson", …). */
  label?: string;
  batchTitle?: string;
  milestone: boolean;
  icsHref: string;
}

const kindLabel: Record<CalendarEventKind, MessageKey<"account">> = {
  live_class: "settings.calendar.kind.liveClass",
  evaluation: "settings.calendar.kind.evaluation",
  timetable: "settings.calendar.kind.timetable",
  batch_start: "settings.calendar.kind.batchStart",
  batch_end: "settings.calendar.kind.batchEnd",
};

const kindTone: Record<CalendarEventKind, BadgeTone> = {
  live_class: "accent",
  evaluation: "info",
  timetable: "neutral",
  batch_start: "success",
  batch_end: "warning",
};

const MINUTE = 60_000;

function subscribeMinute(onChange: () => void): () => void {
  const id = window.setInterval(onChange, MINUTE);
  return () => window.clearInterval(id);
}
const minuteSnapshot = (): number | null => Math.floor(Date.now() / MINUTE) * MINUTE;
const serverSnapshot = (): number | null => null;

/** Current minute on the client; null during the server render and hydration (keeps markup deterministic). */
function useNowMinute(): number | null {
  return useSyncExternalStore(subscribeMinute, minuteSnapshot, serverSnapshot);
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function fmtTime(tag: string, ms: number, timeZone: string, withZone = false): string {
  return new Intl.DateTimeFormat(tag, { timeZone, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(ms);
}

function fmtDayKey(tag: string, key: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...opts }).format(Date.UTC(y, m - 1, d));
}

interface Row {
  event: UpcomingEventView;
  dayKey: string;
  when: string;
}

/**
 * The next events of the member, grouped by day. Before hydration they are
 * shown in each event's own timezone; afterwards in the viewer's local time.
 */
export function UpcomingEvents({ events }: { events: UpcomingEventView[] }) {
  const now = useNowMinute();
  const t = useT("account");
  const tag = intlLocale(useLocale());
  const zone = now !== null ? localZone() : null;
  const todayKey = zone && now !== null ? dateKeyInZone(now, zone) : null;

  const rows: Row[] = events.map((event) => {
    if (event.allDay) {
      const lastDay = addDaysToKey(event.endDate, -1);
      const when = lastDay > event.startDate ? t("settings.calendar.allDayUntil", { date: fmtDayKey(tag, lastDay, { month: "short", day: "numeric" }) }) : t("settings.calendar.allDay");
      return { event, dayKey: event.startDate, when };
    }
    const tz = zone ?? event.timezone;
    const dayKey = dateKeyInZone(event.start, tz);
    const endDay = dateKeyInZone(event.end, tz);
    const endLabel = endDay !== dayKey ? `${fmtDayKey(tag, endDay, { month: "short", day: "numeric" })}, ${fmtTime(tag, event.end, tz, true)}` : fmtTime(tag, event.end, tz, true);
    const when = `${fmtTime(tag, event.start, tz)} – ${endLabel}${zone ? "" : ` · ${event.timezone.replace(/_/g, " ")}`}`;
    return { event, dayKey, when };
  });

  const groups: { dayKey: string; rows: Row[] }[] = [];
  for (const row of rows.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.event.start - b.event.start)) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === row.dayKey) last.rows.push(row);
    else groups.push({ dayKey: row.dayKey, rows: [row] });
  }

  const dayHeading = (key: string) => {
    if (todayKey && key === todayKey) return t("settings.calendar.today");
    if (todayKey && key === addDaysToKey(todayKey, 1)) return t("settings.calendar.tomorrow");
    return fmtDayKey(tag, key, { weekday: "long", month: "long", day: "numeric", year: todayKey && key.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric" });
  };

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.dayKey} aria-labelledby={`day-${group.dayKey}`}>
          <h3 id={`day-${group.dayKey}`} className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", todayKey === group.dayKey ? "text-accent" : "text-ink-faint")}>
            {dayHeading(group.dayKey)}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {group.rows.map(({ event, when }) => (
              <li key={event.uid} className="flex items-start gap-3 px-3 py-3">
                <div className="flex w-12 shrink-0 flex-col items-center rounded-md bg-surface-2 py-1 text-center" aria-hidden="true">
                  <span className="text-[10px] font-semibold uppercase text-ink-muted">{fmtDayKey(tag, group.dayKey, { month: "short" })}</span>
                  <span className="text-base leading-5 font-semibold text-ink">{Number(group.dayKey.slice(8, 10))}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={event.path} className="line-clamp-2 text-sm font-medium text-ink hover:text-accent hover:underline">
                    {event.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-muted">{when}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={kindTone[event.kind]} size="xs">
                      {event.kind === "timetable" && event.label ? event.label : t(kindLabel[event.kind])}
                    </Badge>
                    {event.milestone && (
                      <Badge tone="warning" size="xs">
                        {t("settings.calendar.milestone")}
                      </Badge>
                    )}
                    {event.batchTitle && <span className="truncate text-xs text-ink-faint">{event.batchTitle}</span>}
                  </div>
                </div>
                <AddToCalendar
                  size="xs"
                  className="shrink-0"
                  event={{
                    uid: event.uid,
                    title: event.title,
                    description: event.description,
                    location: event.location,
                    url: event.path,
                    start: event.start,
                    end: event.end,
                    allDay: event.allDay ? { startDate: event.startDate, endDate: event.endDate } : undefined,
                    icsHref: event.icsHref,
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
