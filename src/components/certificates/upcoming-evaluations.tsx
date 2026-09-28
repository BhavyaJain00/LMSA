"use client";

import { useState, useTransition } from "react";
import type { EvaluationCard } from "@/lib/data/certificates";
import { cancelEvaluationAction } from "@/lib/actions/evaluations";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { LocalDateTime, useIsClient } from "@/components/assessments/client-time";
import { ScheduleEvaluationDialog, type ScheduleContext } from "./schedule-evaluation-dialog";
import { formatClock12, formatLongDate, weekdayName } from "./time";

export interface UpcomingEvaluationsProps {
  evaluations: EvaluationCard[];
  /** Show the "Schedule" button (not booked yet and deadline not passed). */
  canSchedule: boolean;
  deadline: { date: string; passed: boolean } | null;
  schedule: ScheduleContext | null;
  /** Home/dashboard variant: 4-column grid, no Schedule button, hidden when empty. */
  variant?: "default" | "home";
}

/** "Upcoming Evaluations" block with deadline alerts, evaluation cards and the scheduling dialog. */
export function UpcomingEvaluations({ evaluations, canSchedule, deadline, schedule, variant = "default" }: UpcomingEvaluationsProps) {
  const { toast } = useToast();
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<EvaluationCard | null>(null);
  const [pending, startTransition] = useTransition();
  const home = variant === "home";
  if (home && evaluations.length === 0) return null;
  const viewerZone = isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  return (
    <section aria-labelledby="upcoming-evaluations" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="upcoming-evaluations" className="text-lg font-semibold tracking-tight text-ink">
          Upcoming Evaluations
        </h2>
        {!home && canSchedule && schedule && !deadline?.passed && (
          <Button variant="outline" onClick={() => setOpen(true)} leftIcon={<Icon.Calendar className="size-4" />}>
            Schedule
          </Button>
        )}
      </div>

      {deadline && !deadline.passed && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-warning">The last day to schedule your evaluations is {formatLongDate(deadline.date)}.</p>
            <p className="text-ink-muted">Please make sure to schedule your evaluation before this date.</p>
          </div>
        </div>
      )}
      {deadline?.passed && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm">
          <Icon.XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">Scheduling closed</p>
            <p className="text-ink-muted">The deadline to schedule evaluations has passed. Please contact the Instructor for assistance.</p>
          </div>
        </div>
      )}

      {evaluations.length === 0 ? (
        !deadline?.passed && <p className="text-sm text-ink-muted">Schedule an evaluation to get certified.</p>
      ) : (
        <ul className={cn("grid gap-3", home ? "sm:grid-cols-2 xl:grid-cols-4" : "grid-cols-1")}>
          {evaluations.map((ev) => {
            const showLocal = !!viewerZone && viewerZone !== ev.timezone;
            return (
              <li key={ev.id} className="rounded-xl border border-border bg-surface-1 p-3.5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{ev.courseTitle}</p>
                  {ev.canCancel && (
                    <Dropdown
                      trigger={
                        <span className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2">
                          <Icon.MoreVertical className="size-4" />
                          <span className="sr-only">Options</span>
                        </span>
                      }
                      items={[{ label: "Cancel", icon: <Icon.XCircle />, destructive: true, onClick: () => setCancelling(ev) }]}
                    />
                  )}
                </div>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
                  <li className="flex items-center gap-2">
                    <Icon.Calendar className="size-4 shrink-0" />
                    {formatLongDate(ev.date)} · {weekdayName(ev.date)}
                  </li>
                  <li className="flex items-center gap-2">
                    <Icon.Clock className="size-4 shrink-0" />
                    {formatClock12(ev.startTime)} – {formatClock12(ev.endTime)}
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon.Globe className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {ev.timezoneLabel}
                      {showLocal && (
                        <span className="block text-xs text-ink-faint">
                          Your time: <LocalDateTime iso={ev.startsAt} mode="weekday-datetime" />
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Icon.GraduationCap className="size-4 shrink-0" />
                    {ev.evaluator.name}
                  </li>
                  {ev.batchTitle && (
                    <li className="flex items-center gap-2">
                      <Icon.Users className="size-4 shrink-0" />
                      {ev.batchTitle}
                    </li>
                  )}
                </ul>
                {ev.meetingLink && (
                  <ButtonLink href={ev.meetingLink} variant="outline" size="sm" className="mt-3 w-full" leftIcon={<Icon.Video className="size-4" />}>
                    Join Call
                  </ButtonLink>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {schedule && <ScheduleEvaluationDialog open={open} onClose={() => setOpen(false)} context={schedule} />}

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Confirm Cancellation?"
        description="Are you sure you want to cancel this evaluation? This action cannot be undone."
        confirmLabel="Cancel evaluation"
        cancelLabel="Keep it"
        destructive
        loading={pending}
        onConfirm={() => {
          const target = cancelling;
          if (!target) return;
          startTransition(async () => {
            const res = await cancelEvaluationAction(target.id);
            toast({ title: res.ok ? (res.message ?? "Evaluation cancelled successfully") : res.error, tone: res.ok ? "success" : "error" });
            if (res.ok) setCancelling(null);
          });
        }}
      />
    </section>
  );
}
