"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import type { EvaluatorAvailability } from "@/lib/data/certificates";
import { bookEvaluationAction } from "@/lib/actions/evaluations";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { FormError, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/components/assessments/client-time";
import { formatClock12, formatLongDate } from "./time";

type BookState = ActionResult<{ id: string }> | null;

export interface ScheduleContext {
  courseId: string;
  courseTitle: string;
  batchId?: string | null;
  availability: EvaluatorAvailability[];
  timeZoneLabel: string;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** "Schedule your evaluation": pick an evaluator (when several) and a 30-minute slot in the next 14 days. */
export function ScheduleEvaluationDialog({ open, onClose, context }: { open: boolean; onClose: () => void; context: ScheduleContext }) {
  const { toast } = useToast();
  const isClient = useIsClient();
  const [evaluatorId, setEvaluatorId] = useState(context.availability[0]?.evaluator.id ?? "");
  const [slot, setSlot] = useState<{ date: string; startTime: string } | null>(null);
  const [state, formAction, pending] = useActionState<BookState, FormData>(async (prev, formData) => {
    if (!formData.get("date") || !formData.get("startTime")) {
      toast({ title: "Please select a slot for your evaluation.", tone: "warning", duration: 10000 });
      return prev;
    }
    const res = await bookEvaluationAction(prev, formData);
    if (res.ok) {
      toast({ title: res.message ?? "Your evaluation has been scheduled", tone: "success" });
      setSlot(null);
      onClose();
    } else {
      toast({ title: res.error, tone: "warning", duration: 20000 });
    }
    return res;
  }, null);

  const current = context.availability.find((a) => a.evaluator.id === evaluatorId) ?? context.availability[0];
  const viewerZone = isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const showLocal = !!viewerZone && !context.timeZoneLabel.startsWith(`${viewerZone} `);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Schedule your evaluation"
      description={context.courseTitle}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="schedule-evaluation-form" loading={pending} disabled={context.availability.length === 0}>
            Submit
          </Button>
        </>
      }
    >
      <form id="schedule-evaluation-form" action={formAction} className="space-y-4">
        <input type="hidden" name="courseId" value={context.courseId} />
        {context.batchId && <input type="hidden" name="batchId" value={context.batchId} />}
        <input type="hidden" name="evaluatorId" value={current?.evaluator.id ?? ""} />
        <input type="hidden" name="date" value={slot?.date ?? ""} />
        <input type="hidden" name="startTime" value={slot?.startTime ?? ""} />
        <FormError message={state && !state.ok ? state.error : null} />

        {context.availability.length === 0 ? (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            No slots available for the selected course. No evaluator has published availability yet — please check back later or contact the instructor.
          </p>
        ) : (
          <>
            {context.availability.length > 1 ? (
              <div>
                <label htmlFor="eval-evaluator" className="mb-1.5 block text-sm font-medium text-ink">
                  Evaluator
                </label>
                <Select
                  id="eval-evaluator"
                  value={evaluatorId}
                  onChange={(e) => {
                    setEvaluatorId(e.target.value);
                    setSlot(null);
                  }}
                >
                  {context.availability.map((a) => (
                    <option key={a.evaluator.id} value={a.evaluator.id}>
                      {a.evaluator.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : current ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
                <Avatar name={current.evaluator.name} src={current.evaluator.avatarUrl} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{current.evaluator.name}</p>
                  <p className="truncate text-xs text-ink-muted">{current.evaluator.headline ?? "Evaluator"}</p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-ink">Available Slots</p>
              <p className="text-xs text-ink-muted">All times in {context.timeZoneLabel}</p>
            </div>

            {!current || current.days.length === 0 ? (
              <p className="text-sm text-danger">No slots available for the selected course.</p>
            ) : (
              <div className="scrollbar-thin max-h-[50vh] space-y-4 overflow-y-auto pr-1">
                {current.days.map((day) => (
                  <section key={day.date} aria-label={`${formatLongDate(day.date)}, ${day.weekday}`}>
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
                      <Icon.Calendar className="size-4 text-ink-muted" />
                      {formatLongDate(day.date)}
                      <span className="text-ink-faint">·</span>
                      <span className="text-ink-muted">{day.weekday}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {day.slots.map((s) => {
                        const active = slot?.date === s.date && slot.startTime === s.startTime;
                        return (
                          <button
                            key={s.startTime}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setSlot({ date: s.date, startTime: s.startTime })}
                            className={cn(
                              "rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors sm:text-sm",
                              active ? "border-accent bg-accent/10 text-accent ring-1 ring-accent" : "border-border text-ink hover:border-border-strong hover:bg-surface-2",
                            )}
                          >
                            {formatClock12(s.startTime)} - {formatClock12(s.endTime)}
                            {showLocal && <span className="mt-0.5 block text-[10px] font-normal text-ink-muted">{localTime(s.startsAt)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {slot && (
              <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
                <Icon.CheckCircle className="size-4 text-success" />
                {formatLongDate(slot.date)} at {formatClock12(slot.startTime)} with {current?.evaluator.name}
              </p>
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}
