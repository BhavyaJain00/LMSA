"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn, formatTime, pluralize } from "@/lib/utils";
import { LocalTime } from "../local-time";
import { violationLabels, type RunnerQuestion, type ViolationEvent } from "../types";

/** Timer pill: neutral, amber at ≤25% of the time, red in the last minute (or ≤10%). */
export function TimerPill({ remaining, total }: { remaining: number; total: number }) {
  const ratio = total > 0 ? remaining / total : 1;
  const critical = remaining <= 60 || ratio <= 0.1;
  const warning = !critical && ratio <= 0.25;
  return (
    <span
      role="timer"
      aria-label={`Time remaining ${formatTime(remaining)}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums transition-colors",
        critical ? "bg-danger/12 text-danger" : warning ? "bg-warning/15 text-warning" : "bg-surface-2 text-ink",
        critical && remaining > 0 && "animate-pulse",
      )}
    >
      <Icon.Timer className="size-4" />
      {formatTime(remaining)}
    </span>
  );
}

export function ViolationPill({ count, max }: { count: number; max: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium tabular-nums",
        count === 0 ? "bg-success/12 text-success" : "bg-danger/12 text-danger",
      )}
    >
      <Icon.ShieldCheck className="size-4" />
      {count} / {max} {max === 1 ? "violation" : "violations"}
    </span>
  );
}

export function ViolationBanner({
  events,
  max,
  fullscreen,
  canFullscreen,
  onReturnToFullscreen,
}: {
  events: ViolationEvent[];
  max: number;
  fullscreen: boolean;
  canFullscreen: boolean;
  onReturnToFullscreen: () => void;
}) {
  const last = events[events.length - 1];
  if (!last) return null;
  const remaining = Math.max(0, max - events.length);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center">
      <Icon.AlertTriangle className="size-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">
          {violationLabels[last.eventType]} recorded · {events.length} of {max}
        </p>
        <p className="text-ink-muted">
          {remaining > 0 ? `${pluralize(remaining, "more violation")} and the quiz will be submitted automatically.` : "The quiz is being submitted."}
        </p>
      </div>
      {canFullscreen && !fullscreen && (
        <Button size="sm" variant="outline" onClick={onReturnToFullscreen} leftIcon={<Icon.Fullscreen className="size-4" />}>
          Return to fullscreen
        </Button>
      )}
    </div>
  );
}

export function QuestionNavigator({
  questions,
  current,
  answered,
  review,
  onJump,
  disabled,
}: {
  questions: RunnerQuestion[];
  current: number;
  answered: (id: string) => boolean;
  review: string[];
  onJump: (index: number) => void;
  disabled: boolean;
}) {
  const reviewIndexes = questions.map((q, i) => (review.includes(q.id) ? i : -1)).filter((i) => i >= 0);
  const answeredCount = questions.filter((q) => answered(q.id)).length;
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Questions</h3>
          <span className="text-xs text-ink-muted">
            {answeredCount} of {questions.length} answered
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => {
            const isCurrent = i === current;
            const isAnswered = answered(q.id);
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onJump(i)}
                disabled={disabled}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Question ${i + 1}${isAnswered ? ", answered" : ", not answered"}${review.includes(q.id) ? ", marked for review" : ""}`}
                className={cn(
                  "relative flex size-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                  isCurrent ? "bg-ink text-surface-1" : isAnswered ? "bg-accent/15 text-accent hover:bg-accent/25" : "bg-surface-2 text-ink-muted hover:bg-surface-3",
                )}
              >
                {i + 1}
                {review.includes(q.id) && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-1 bg-warning" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-ink" /> Current
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-accent/40" /> Answered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-surface-3" /> Not answered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-warning" /> Marked for review
          </span>
        </div>
      </div>
      {reviewIndexes.length > 0 && (
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Questions marked for review</h3>
          <div className="flex flex-wrap gap-1.5">
            {reviewIndexes.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => onJump(i)}
                disabled={disabled}
                className="flex size-8 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning hover:bg-warning/25"
                aria-label={`Go to question ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ActivityLog({ events }: { events: ViolationEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
        <h3 className="text-sm font-semibold text-ink">Activity</h3>
        <span className="text-xs text-ink-muted">{pluralize(events.length, "event")}</span>
      </div>
      <ul className="scrollbar-thin max-h-64 divide-y divide-border overflow-y-auto">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", e.severity === "violation" ? "bg-danger" : "bg-warning")} />
            <span className="min-w-0 flex-1 truncate text-ink">{violationLabels[e.eventType]}</span>
            <LocalTime iso={e.timestamp} format="time" className="text-xs tabular-nums text-ink-muted" />
            <span className={cn("text-[10px] font-semibold uppercase tracking-wide", e.severity === "violation" ? "text-danger" : "text-warning")}>
              {e.severity}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
