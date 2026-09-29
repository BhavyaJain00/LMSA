"use client";

import { useState, useTransition } from "react";
import type { EvaluatorSlot } from "@/lib/types";
import { addEvaluatorSlotAction, deleteEvaluatorSlotAction, setEvaluatorUnavailabilityAction, updateEvaluatorSlotAction } from "@/lib/actions/evaluations";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { WEEKDAYS, WEEKDAY_ORDER, clockToMinutes, formatClock12, formatLongDate, isValidDateKey, unavailabilityOf } from "./time";

const DAY_OPTIONS = WEEKDAY_ORDER.map((d) => ({ value: String(d), label: WEEKDAYS[d] }));

interface Draft {
  day: string;
  startTime: string;
  endTime: string;
}

function SlotRow({ slot, editable, onDelete }: { slot: EvaluatorSlot; editable: boolean; onDelete: (slot: EvaluatorSlot) => void }) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<Draft>({ day: String(slot.day), startTime: slot.startTime, endTime: slot.endTime });
  const [draft, setDraft] = useState<Draft>(saved);
  const [pending, startTransition] = useTransition();

  const commit = (next: Draft) => {
    if (next.day === saved.day && next.startTime === saved.startTime && next.endTime === saved.endTime) return;
    const missing = !next.startTime ? "Start Time" : !next.endTime ? "End Time" : null;
    if (missing) {
      toast({ title: `Please enter a value for ${missing}`, tone: "warning" });
      setDraft(saved);
      return;
    }
    startTransition(async () => {
      const res = await updateEvaluatorSlotAction(slot.id, { day: Number(next.day), startTime: next.startTime, endTime: next.endTime });
      if (res.ok) {
        setSaved(next);
        toast({ title: res.message ?? "Availability updated successfully", tone: "success" });
      } else {
        setDraft(saved);
        toast({ title: res.error, tone: "error" });
      }
    });
  };

  const label = `${WEEKDAYS[Number(draft.day)]} ${formatClock12(draft.startTime)} to ${formatClock12(draft.endTime)}`;
  return (
    <li className={cn("group grid grid-cols-2 items-center gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:border-0 sm:p-0", pending && "opacity-70")}>
      <div className="col-span-2 sm:col-span-1">
        <Select
          aria-label="Day"
          value={draft.day}
          disabled={!editable || pending}
          options={DAY_OPTIONS}
          onChange={(e) => {
            const next = { ...draft, day: e.target.value };
            setDraft(next);
            commit(next);
          }}
        />
      </div>
      <Input
        type="time"
        aria-label={`Start Time for ${label}`}
        value={draft.startTime}
        step={1800}
        disabled={!editable || pending}
        onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
        onBlur={() => commit(draft)}
      />
      <Input
        type="time"
        aria-label={`End Time for ${label}`}
        value={draft.endTime}
        step={1800}
        disabled={!editable || pending}
        onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
        onBlur={() => commit(draft)}
      />
      {editable ? (
        <button
          type="button"
          aria-label="Delete slot"
          title="Delete slot"
          onClick={() => onDelete(slot)}
          className="col-span-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm text-danger transition-opacity hover:bg-danger/10 sm:col-span-1 sm:size-9 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:pointer-coarse:opacity-100"
        >
          <Icon.X className="size-4" />
          <span className="sm:hidden">Delete slot</span>
        </button>
      ) : (
        <span className="hidden sm:block sm:size-9" />
      )}
    </li>
  );
}

interface Range {
  from: string;
  to: string;
}

/**
 * Commit a date input only once it holds a plausible full date: typing the
 * year digit by digit briefly produces values like "0002-10-01".
 */
function isCommittableDate(value: string): boolean {
  return value === "" || (isValidDateKey(value) && Number(value.slice(0, 4)) >= 2000);
}

/** "I am unavailable" From / To dates (Frappe: unavailable_from / unavailable_to). Each date saves on change. */
function UnavailabilitySection({ evaluatorId, initial, editable, hasSlots }: { evaluatorId: string; initial: Range; editable: boolean; hasSlots: boolean }) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<Range>(initial);
  const [draft, setDraft] = useState<Range>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = !editable || !hasSlots || pending;

  const commit = (next: Range) => {
    if (next.from === saved.from && next.to === saved.to) return;
    if (!isCommittableDate(next.from) || !isCommittableDate(next.to)) return;
    if (next.from && next.to && next.from > next.to) {
      setError("Unavailable From Date cannot be greater than Unavailable To Date");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setEvaluatorUnavailabilityAction(evaluatorId, next);
      if (res.ok) {
        setSaved(next);
        setDraft(next);
        toast({ title: res.message ?? "Unavailability updated successfully", tone: "success" });
      } else {
        setDraft(saved);
        setError(res.error);
        toast({ title: res.error, tone: "error" });
      }
    });
  };

  const commitOnBlur = () => {
    if (!isCommittableDate(draft.from) || !isCommittableDate(draft.to)) setDraft(saved);
    else commit(draft);
  };

  const active = saved.from && saved.to && saved.from <= saved.to ? saved : null;
  const partial = !active && (saved.from || saved.to);

  return (
    <section className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5" aria-labelledby="unavailability-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="unavailability-heading" className="font-semibold text-ink">
            I am unavailable
          </h3>
          <p className="text-sm text-ink-muted">Block a date range, for example a holiday. Learners can&apos;t book evaluations on these days.</p>
        </div>
        {editable && (saved.from || saved.to) && (
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            disabled={pending}
            leftIcon={<Icon.X className="size-4" />}
            onClick={() => {
              setDraft({ from: "", to: "" });
              commit({ from: "", to: "" });
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className={cn("mt-4 grid gap-3 sm:grid-cols-2", pending && "opacity-70")}>
        <Field label="From" htmlFor="unavailable-from">
          <Input
            id="unavailable-from"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            disabled={disabled}
            invalid={!!error}
            onChange={(e) => {
              const next = { ...draft, from: e.target.value };
              setDraft(next);
              commit(next);
            }}
            onBlur={commitOnBlur}
          />
        </Field>
        <Field label="To" htmlFor="unavailable-to">
          <Input
            id="unavailable-to"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            disabled={disabled}
            invalid={!!error}
            onChange={(e) => {
              const next = { ...draft, to: e.target.value };
              setDraft(next);
              commit(next);
            }}
            onBlur={commitOnBlur}
          />
        </Field>
      </div>

      <div aria-live="polite" className="mt-3 text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-danger">
            <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : !hasSlots ? (
          <p className="text-ink-muted">{editable ? "Add a weekly slot first, then you can block dates." : "No availability set up yet."}</p>
        ) : active ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-warning">
            <Icon.Calendar className="mt-0.5 size-4 shrink-0" />
            <span>
              Unavailable from <strong className="font-semibold">{formatLongDate(active.from)}</strong> to <strong className="font-semibold">{formatLongDate(active.to)}</strong>. No
              evaluations can be booked on these dates.
            </span>
          </p>
        ) : partial ? (
          <p className="text-ink-muted">Set both dates to block bookings.</p>
        ) : (
          <p className="text-ink-muted">No dates blocked. Learners can book any of your weekly slots.</p>
        )}
      </div>
    </section>
  );
}

/** Weekly availability editor: one row per slot, edits save automatically. */
export function SlotsEditor({
  evaluatorId,
  slots,
  editable,
  timeZoneLabel,
  heading,
}: {
  evaluatorId: string;
  slots: EvaluatorSlot[];
  editable: boolean;
  timeZoneLabel: string;
  heading: string;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ day: "", startTime: "", endTime: "" });
  const [deleting, setDeleting] = useState<EvaluatorSlot | null>(null);
  const [pending, startTransition] = useTransition();

  const tryAdd = (next: Draft) => {
    setDraft(next);
    if (!next.day || !next.startTime || !next.endTime) return;
    if (clockToMinutes(next.endTime) <= clockToMinutes(next.startTime)) {
      toast({ title: "Start Time cannot be greater than End Time", tone: "warning" });
      return;
    }
    startTransition(async () => {
      const res = await addEvaluatorSlotAction(evaluatorId, { day: Number(next.day), startTime: next.startTime, endTime: next.endTime });
      if (res.ok) {
        toast({ title: res.message ?? "Slot added successfully", tone: "success" });
        setDraft({ day: "", startTime: "", endTime: "" });
        setAdding(false);
      } else {
        toast({ title: res.error, tone: "error" });
      }
    });
  };

  const initialRange = unavailabilityOf(slots);
  const totalMinutes = slots.reduce((sum, s) => sum + Math.max(0, clockToMinutes(s.endTime) - clockToMinutes(s.startTime)), 0);

  return (
    <section className="space-y-5" aria-labelledby="availability-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="availability-heading" className="text-lg font-semibold tracking-tight text-ink">
            {heading}
          </h2>
          <p className="text-sm text-ink-muted">Times are in {timeZoneLabel}</p>
        </div>
        {slots.length > 0 && (
          <p className="text-sm text-ink-muted">
            {Math.floor(totalMinutes / 30)} bookable 30-minute slot{Math.floor(totalMinutes / 30) === 1 ? "" : "s"} per week
          </p>
        )}
      </div>

      {!editable && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
          Only the evaluator can change this availability.
        </p>
      )}

      <div className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
        <div className="mb-2 hidden grid-cols-[1.3fr_1fr_1fr_auto] gap-2 px-0.5 text-xs font-medium uppercase tracking-wide text-ink-muted sm:grid">
          <span>Day</span>
          <span>Start Time</span>
          <span>End Time</span>
          <span className="w-9" />
        </div>
        {slots.length === 0 && !adding ? (
          <div className="py-8 text-center">
            <Icon.Calendar className="mx-auto size-8 text-ink-faint" />
            <p className="mt-2 font-medium text-ink">No availability yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
              {editable ? "Add the weekly time windows when learners can book 30-minute evaluations with you." : "This evaluator hasn't published any weekly slots."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} editable={editable} onDelete={setDeleting} />
            ))}
            {adding && (
              <li className={cn("grid grid-cols-2 items-center gap-2 rounded-xl border border-dashed border-accent/50 bg-accent/5 p-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]", pending && "opacity-70")}>
                <div className="col-span-2 sm:col-span-1">
                  <Select aria-label="Day for new slot" value={draft.day} disabled={pending} onChange={(e) => tryAdd({ ...draft, day: e.target.value })}>
                    <option value="" disabled>
                      Select day
                    </option>
                    {DAY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  type="time"
                  aria-label="Start Time for new slot"
                  value={draft.startTime}
                  step={1800}
                  disabled={pending}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                  onBlur={() => tryAdd(draft)}
                />
                <Input
                  type="time"
                  aria-label="End Time for new slot"
                  value={draft.endTime}
                  step={1800}
                  disabled={pending}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                  onBlur={() => tryAdd(draft)}
                />
                <button
                  type="button"
                  aria-label="Discard new slot"
                  onClick={() => {
                    setAdding(false);
                    setDraft({ day: "", startTime: "", endTime: "" });
                  }}
                  className="col-span-2 inline-flex h-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 sm:col-span-1 sm:size-9"
                >
                  <Icon.X className="size-4" />
                </button>
              </li>
            )}
          </ul>
        )}
        {editable && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={adding} leftIcon={<Icon.Plus className="size-4" />}>
              Add Slot
            </Button>
            {adding && <p className="text-xs text-ink-muted">Pick a day, start and end time — the slot saves automatically.</p>}
          </div>
        )}
      </div>

      <UnavailabilitySection
        key={`${initialRange.from}|${initialRange.to}|${slots.length > 0}`}
        evaluatorId={evaluatorId}
        initial={initialRange}
        editable={editable}
        hasSlots={slots.length > 0}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this slot?"
        description={
          deleting
            ? `${WEEKDAYS[deleting.day]} ${formatClock12(deleting.startTime)} – ${formatClock12(deleting.endTime)} will no longer be bookable. Evaluations already booked in this window are kept.`
            : undefined
        }
        confirmLabel="Delete slot"
        destructive
        loading={pending}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          startTransition(async () => {
            const res = await deleteEvaluatorSlotAction(target.id);
            toast({ title: res.ok ? (res.message ?? "Slot deleted successfully") : res.error, tone: res.ok ? "success" : "error" });
            if (res.ok) setDeleting(null);
          });
        }}
      />
    </section>
  );
}
