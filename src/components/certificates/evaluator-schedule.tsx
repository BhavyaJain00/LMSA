"use client";

import { useState } from "react";
import type { ScheduleEvent } from "@/lib/data/certificates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { EvaluateDialog } from "./evaluate-dialog";
import { addDaysToKey, formatClock12, formatLongDate, formatMonthYear, startOfWeekKey, WEEKDAYS, weekdayOfDateKey } from "./time";

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
}: {
  events: ScheduleEvent[];
  today: string;
  /** The assigned evaluator (or a moderator) can record results. */
  viewer: { id: string; moderator: boolean };
  emptyAction?: React.ReactNode;
}) {
  const canEdit = (ev: ScheduleEvent) => viewer.moderator || ev.evaluator.id === viewer.id;
  const [weekStart, setWeekStart] = useState(() => startOfWeekKey(today));
  const [active, setActive] = useState<ScheduleEvent | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
  const weekEnd = days[6]!;
  const inWeek = events.filter((e) => e.date >= weekStart && e.date <= weekEnd);
  const awaiting = events.filter((e) => e.awaitingResult && !e.evaluation);
  const nextWeekWithEvents = events.find((e) => e.date > weekEnd)?.date;

  return (
    <div className="space-y-6">
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
            return (
              <section key={day} aria-label={formatLongDate(day)} className={cn("min-h-0 p-3 lg:min-h-64", isToday && "bg-accent/5")}>
                <p className={cn("mb-2 flex items-baseline gap-1.5 text-sm lg:flex-col lg:items-start lg:gap-0", isToday ? "text-accent" : "text-ink-muted")}>
                  <span className="text-xs font-medium uppercase tracking-wide">{WEEKDAYS[weekdayOfDateKey(day)]?.slice(0, 3)}</span>
                  <span className={cn("font-semibold lg:text-xl", isToday ? "text-accent" : "text-ink")}>{Number(day.slice(8, 10))}</span>
                </p>
                {dayEvents.length === 0 ? (
                  <p className="text-xs text-ink-faint lg:hidden">No evaluations</p>
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
