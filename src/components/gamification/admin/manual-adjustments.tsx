"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ManualAdjustmentRow } from "@/lib/services/points";
import { adjustPointsAction, removeManualAdjustmentAction } from "@/lib/actions/gamification";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Field, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { MemberPicker, type PickerMember } from "@/components/admin/settings/member-picker";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { cn } from "@/lib/utils";
import { LocalTime } from "@/components/quiz/local-time";
import { formatPoints, formatSignedPoints } from "../levels";
import { MAX_MANUAL_POINTS } from "../reasons";

type Direction = "add" | "deduct";

/** Manual adjustment form (member + points ± + note) and the recent adjustments with undo. */
export function ManualAdjustments({ members, recent, enabled }: { members: PickerMember[]; recent: ManualAdjustmentRow[]; enabled: boolean }) {
  const toast = useToast();
  const [formKey, setFormKey] = useState(0);
  const [direction, setDirection] = useState<Direction>("add");
  const [toUndo, setToUndo] = useState<ManualAdjustmentRow | null>(null);
  const [undoing, startUndo] = useTransition();
  const { onSubmit, pending, errors, formError } = useFormAction(adjustPointsAction, {
    onSuccess: () => {
      setFormKey((k) => k + 1);
      setDirection("add");
    },
  });

  const confirmUndo = () => {
    const target = toUndo;
    if (!target) return;
    startUndo(async () => {
      const res = await removeManualAdjustmentAction(target.id);
      if (res.ok) {
        toast.success(res.message ?? "Adjustment removed");
        setToUndo(null);
      } else toast.error(res.error);
    });
  };

  return (
    <section id="adjust" className="scroll-mt-24 rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="adjust-title">
      <div className="border-b border-border px-4 py-3.5 sm:px-5">
        <h3 id="adjust-title" className="text-base font-semibold text-ink">
          Adjust a member&apos;s points
        </h3>
        <p className="mt-0.5 text-sm text-ink-muted">Add bonus points or correct a mistake. The member is notified with your note, and it appears in their points history.</p>
      </div>

      <form key={formKey} onSubmit={onSubmit} noValidate className="space-y-4 px-4 py-4 sm:px-5">
        <input type="hidden" name="direction" value={direction} />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Field label="Member" htmlFor="adjust-member" error={errors.userId} required>
            <MemberPicker id="adjust-member" name="userId" members={members} invalid={!!errors.userId} />
          </Field>
          <Field label="Points" htmlFor="adjust-amount" error={errors.amount} required hint={`Up to ${formatPoints(MAX_MANUAL_POINTS)} per adjustment.`}>
            <div className="flex gap-2">
              <SegmentedControl<Direction>
                size="md"
                className="shrink-0 self-center"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "add", label: "Add", icon: <Icon.Plus className="size-3.5" /> },
                  { value: "deduct", label: "Deduct", icon: <Icon.Minus className="size-3.5" /> },
                ]}
              />
              <Input
                id="adjust-amount"
                name="amount"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_MANUAL_POINTS}
                step={1}
                placeholder="50"
                invalid={!!errors.amount}
                aria-describedby="adjust-direction-note"
              />
            </div>
            <p id="adjust-direction-note" className="sr-only">
              {direction === "add" ? "Points will be added." : "Points will be deducted."}
            </p>
          </Field>
        </div>
        <Field label="Note" htmlFor="adjust-note" error={errors.note} required hint="Shown to the member, e.g. “Winner of the June project challenge”.">
          <Input id="adjust-note" name="note" maxLength={200} placeholder="Why are you adjusting these points?" invalid={!!errors.note} />
        </Field>
        {formError && !Object.keys(errors).length && <p className="text-sm text-danger">{formError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!enabled ? <p className="text-xs text-warning">Turn on points and save before adjusting.</p> : <span />}
          <Button type="submit" loading={pending} disabled={!enabled} variant={direction === "deduct" ? "danger" : "primary"}>
            {direction === "deduct" ? "Deduct points" : "Add points"}
          </Button>
        </div>
      </form>

      <div className="border-t border-border px-4 py-4 sm:px-5">
        <h4 className="text-sm font-semibold text-ink">Recent adjustments</h4>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No manual adjustments yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {recent.map((row) => (
              <li key={row.id} className="flex items-start gap-3 py-2.5">
                <Avatar name={row.member?.name ?? "Deleted member"} src={row.member?.avatarUrl} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    {row.member ? (
                      <Link href={`/leaderboard/points?member=${encodeURIComponent(row.member.username)}`} className="font-medium text-ink hover:text-accent">
                        {row.member.name}
                      </Link>
                    ) : (
                      <span className="font-medium italic text-ink-muted">Deleted member</span>
                    )}
                    <span className={cn("font-semibold tabular-nums", row.points >= 0 ? "text-success" : "text-danger")}>{formatSignedPoints(row.points)}</span>
                  </p>
                  {row.note && <p className="break-words text-sm text-ink-muted">{row.note}</p>}
                  <p className="text-xs text-ink-faint">
                    <LocalTime iso={row.createdAt} />
                  </p>
                </div>
                <IconButton label="Undo this adjustment" size="icon-sm" onClick={() => setToUndo(row)} disabled={undoing}>
                  <Icon.Trash className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={toUndo !== null}
        onClose={() => (undoing ? undefined : setToUndo(null))}
        onConfirm={confirmUndo}
        loading={undoing}
        destructive
        title="Undo this adjustment?"
        description={
          toUndo
            ? `${formatSignedPoints(toUndo.points)} points for ${toUndo.member?.name ?? "this member"} will be removed from their total. They are not notified.`
            : undefined
        }
        confirmLabel="Undo adjustment"
      />
    </section>
  );
}
