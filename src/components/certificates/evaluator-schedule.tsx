"use client";

import { useState } from "react";
import type { ScheduleEvent } from "@/lib/data/certificates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { EvaluateDialog } from "./evaluate-dialog";
import { addDaysToKey, formatClock12, formatLongDate, formatMonthYear, isDateInRange, startOfWeekKey, WEEKDAYS, weekdayOfDateKey, type UnavailabilityRange } from "./time";

function eventTone(ev: ScheduleEvent): { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" } {
  if (ev.evaluation?.status === "pass") return { label: "Passed", tone: "success" };
  if (ev.evaluation?.status === "fail") return { label: "Failed", tone: "danger" };
  if (ev.status === "completed") return { label: "Completed", tone: "neutral" };
  if (ev.awaitingResult) return { label: "Awaiting result", tone: "warning" };
  return { label: "Upcoming", tone: "info" };
}

function EventButton({ ev, onOpen, compact }: { ev: ScheduleEvent; onOpen: (ev: ScheduleEvent) => void; compact?: boolean }) {
  const t = eventTone(ev);
  return (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      className={cn(
        "w-full rounded-lg border border-success/30 bg-success/10 text-left transition-colors hover:border-success/60 hover:bg-success/15 focus-visible:outline-2 focus-visible:outline-success",
        compact ? "px-2 py-1.5" : "px-3 py-2.5",
      )}
    >
      <p className={cn("font-medium text-ink", compact ? "truncate text-xs" : "text-sm")}>{ev.learner.name}&apos;s Evaluation</p>
      <p className={cn("text-ink-muted", compact ? "text-[11px]" : "text-xs")}>
        {formatClock12(ev.startTime)} – {formatClock12(ev.endTime)}
      </p>
      {!compact && <p className="mt-0.5 truncate text-xs text-ink-muted">{ev.courseTitle}</p>}
      <Badge tone={t.tone} size="xs" className="mt-1">
        {t.label}
      </Badge>
    </button>
  );
}

/** Week calendar of an evaluator's booked evaluations; clicking an event opens the Evaluate dialog. */
export function EvaluatorSchedule({
  events,
  today,
  viewer,
  emptyAction,
  unavailable,
}: {
  events: ScheduleEvent[];
  today: string;
  /** The assigned evaluator (or a moderator) can record results. */
  viewer: { id: string; moderator: boolean };
  emptyAction?: React.ReactNode;
  /** The evaluator's blocked date range (no bookings accepted); marked on the calendar. */
  unavailable?: UnavailabilityRange | null;
}) {
  const canEdit = (ev: ScheduleEvent) => viewer.moderator || ev.evaluator.id === viewer.id;
  const [weekStart, setWeekStart] = useState(() => startOfWeekKey(today));
  const [active, setActive] = useState<ScheduleEvent | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
  const weekEnd = days[6]!;
  const inWeek = events.filter((e) => e.date >= weekStart && e.date <= weekEnd);
  const awaiting = events.filter((e) => e.awaitingResult && !e.evaluation);
  const nextWeekWithEvents = events.find((e) => e.date > weekEnd)?.date;
  const upcomingBlock = unavailable && unavailable.to >= today ? unavailable : null;
  const bookedWhileAway = upcomingBlock ? events.filter((e) => e.status === "upcoming" && isDateInRange(e.date, upcomingBlock)).length : 0;

  return (
    <div className="space-y-6">
      {upcomingBlock && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-ink-muted">
            <Icon.Calendar className="mt-0.5 size-4 shrink-0 text-ink" />
            <span>
              Unavailable from <strong className="font-semibold text-ink">{formatLongDate(upcomingBlock.from)}</strong> to{" "}
              <strong className="font-semibold text-ink">{formatLongDate(upcomingBlock.to)}</strong>. Learners can&apos;t book evaluations on these dates.
              {bookedWhileAway > 0 && (
                <span className="mt-1 block text-warning">
                  {bookedWhileAway} evaluation{bookedWhileAway === 1 ? " was" : "s were"} booked in this range before it was blocked.
                </span>
              )}
            </span>
          </p>
          {upcomingBlock.from > weekEnd && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setWeekStart(startOfWeekKey(upcomingBlock.from))}>
              Show week
            </Button>
          )}
        </div>
      )}

      {awaiting.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <Icon.AlertTriangle className="size-4" />
            {awaiting.length} evaluation{awaiting.length === 1 ? "" : "s"} waiting for a result
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {awaiting.map((ev) => (
              <li key={ev.id}>
                <EventButton ev={ev} onOpen={setActive} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-lg font-semibold text-ink" aria-live="polite">
            {formatMonthYear(weekStart)}
            {formatMonthYear(weekEnd) !== formatMonthYear(weekStart) && <span className="text-ink-muted"> – {formatMonthYear(weekEnd)}</span>}
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous" title="Previous week" onClick={() => setWeekStart(addDaysToKey(weekStart, -7))}>
              <Icon.ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeekKey(today))} disabled={weekStart === startOfWeekKey(today)}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next" title="Next week" onClick={() => setWeekStart(addDaysToKey(weekStart, 7))}>
              <Icon.ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid divide-y divide-border lg:grid-cols-7 lg:divide-x lg:divide-y-0">
          {days.map((day) => {
            const dayEvents = inWeek.filter((e) => e.date === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const isToday = day === today;
            const away = isDateInRange(day, unavailable);
            return (
              <section
                key={day}
                aria-label={away ? `${formatLongDate(day)}, unavailable` : formatLongDate(day)}
                className={cn(
                  "min-h-0 p-3 lg:min-h-64",
                  isToday && "bg-accent/5",
                  away && "bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,transparent_6px_12px)]",
                )}
              >
                <p className={cn("mb-2 flex items-baseline gap-1.5 text-sm lg:flex-col lg:items-start lg:gap-0", isToday ? "text-accent" : "text-ink-muted")}>
                  <span className="text-xs font-medium uppercase tracking-wide">{WEEKDAYS[weekdayOfDateKey(day)]?.slice(0, 3)}</span>
                  <span className={cn("font-semibold lg:text-xl", isToday ? "text-accent" : "text-ink")}>{Number(day.slice(8, 10))}</span>
                </p>
                {away && (
                  <Badge tone="neutral" size="xs" className="mb-2">
                    Unavailable
                  </Badge>
                )}
                {dayEvents.length === 0 ? (
                  !away && <p className="text-xs text-ink-faint lg:hidden">No evaluations</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dayEvents.map((ev) => (
                      <li key={ev.id}>
                        <EventButton ev={ev} onOpen={setActive} compact />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        {inWeek.length === 0 && (
          <div className="border-t border-border px-4 py-5 text-center text-sm text-ink-muted">
            No evaluations this week.
            {nextWeekWithEvents && (
              <Button variant="link" size="sm" className="ml-1" onClick={() => setWeekStart(startOfWeekKey(nextWeekWithEvents))}>
                Jump to the next one ({formatLongDate(nextWeekWithEvents)})
              </Button>
            )}
            {!nextWeekWithEvents && events.length === 0 && emptyAction && <div className="mt-3 flex justify-center">{emptyAction}</div>}
          </div>
        )}
      </div>

      {active && <EvaluateDialog key={active.id} event={active} open={!!active} onClose={() => setActive(null)} canEdit={canEdit(active)} today={today} />}
    </div>
  );
}
