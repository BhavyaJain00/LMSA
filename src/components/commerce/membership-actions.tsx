"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import type { ActionResult, PlanInterval } from "@/lib/types";
import { cancelMyMembershipAction, changeMyPlanAction, renewMyMembershipAction, resumeMyMembershipAction } from "@/lib/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { intervalSuffix } from "@/lib/commerce/plans";
import { formatPrice } from "@/lib/utils";

/** Runs one of the member's own membership actions and reports the result as a toast. */
function useMembershipAction(failTitle: string) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult>, onDone?: () => void) => {
    startTransition(async () => {
      try {
        const res = await action();
        if (res.ok) {
          toast.success(res.message ?? "Done");
          router.refresh();
        } else {
          toast.error(failTitle, res.error);
        }
      } catch (error) {
        // An action that redirects (the renewal order page) rejects with Next's redirect signal.
        unstable_rethrow(error);
        toast.error(failTitle, "Please check your connection and try again.");
      }
      onDone?.();
    });
  };
  return { pending, run };
}

/** "Cancel membership": stops the renewal; access continues until the period end. */
export function CancelMembershipButton({ accessUntilLabel, trial }: { accessUntilLabel: string; trial: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useMembershipAction("The membership could not be cancelled");
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setOpen(true)}>
        Cancel membership
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={() => run(cancelMyMembershipAction, () => setOpen(false))}
        loading={pending}
        destructive
        title="Cancel your membership?"
        description={
          trial
            ? `Your free trial keeps running until ${accessUntilLabel} and nothing will be charged. After that the included courses lock again; your progress is kept.`
            : `You won't be charged again. You keep full access until ${accessUntilLabel}; after that the included courses lock again and your progress is kept. You can resume any time before then.`
        }
        confirmLabel="Cancel membership"
        cancelLabel="Keep membership"
      />
    </>
  );
}

/** Undo a scheduled cancellation. */
export function ResumeMembershipButton() {
  const { pending, run } = useMembershipAction("The membership could not be resumed");
  return (
    <Button size="sm" loading={pending} onClick={() => run(resumeMyMembershipAction)} leftIcon={<Icon.Refresh className="size-4" />}>
      Resume membership
    </Button>
  );
}

/** "Renew now" for memberships paid by hand: opens (or creates) the renewal order. */
export function RenewMembershipButton({ label = "Renew now" }: { label?: string }) {
  const { pending, run } = useMembershipAction("The renewal could not be started");
  return (
    <Button size="sm" loading={pending} onClick={() => run(renewMyMembershipAction)} leftIcon={<Icon.CreditCard className="size-4" />}>
      {label}
    </Button>
  );
}

export interface ChangePlanOption {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: PlanInterval;
}

/**
 * Plans the member can switch to. Switching is confirmed first because it
 * changes what they are billed; how the difference is settled depends on who
 * bills the membership. Stripe prorates, so the switch happens now; otherwise
 * it is scheduled for the next renewal (`renewalLabel`), and the current plan
 * (`currentId`, listed while a change is scheduled) keeps the membership as it is.
 */
export function ChangePlanList({
  options,
  currentId,
  currentName,
  billing,
  renewalLabel,
}: {
  options: ChangePlanOption[];
  currentId: string;
  currentName: string;
  billing: "stripe" | "razorpay" | "manual";
  /** "on 12 May 2026", or "after your trial" for a trial paid by hand. */
  renewalLabel: string;
}) {
  const [target, setTarget] = useState<ChangePlanOption | null>(null);
  const { pending, run } = useMembershipAction("The plan could not be changed");
  const immediate = billing === "stripe";
  const keeping = !!target && target.id === currentId;
  const describe = (t: ChangePlanOption): string => {
    if (t.id === currentId) return `Your scheduled plan change is cancelled and your membership stays on ${currentName}.`;
    const price = `${formatPrice(t.price, t.currency)}${intervalSuffix(t.interval)}`;
    if (immediate) {
      return `You move from ${currentName} to ${t.name} (${price}) right away, and its courses unlock immediately. Stripe prorates the difference: you are credited for the unused time on your current plan and charged the new price on your next invoice.`;
    }
    return `You move from ${currentName} to ${t.name} (${price}) when your membership renews ${renewalLabel}${billing === "razorpay" ? ", and Razorpay bills the new price from then" : ""}. Until then you keep ${currentName} and its courses.`;
  };
  return (
    <>
      <ul className="divide-y divide-border">
        {options.map((option) => (
          <li key={option.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                {option.name}
                <Badge tone="outline" size="xs">
                  {option.interval === "year" ? "Yearly" : "Monthly"}
                </Badge>
              </p>
              <p className="text-sm text-ink-muted tabular-nums">
                {formatPrice(option.price, option.currency)}
                {intervalSuffix(option.interval)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setTarget(option)} disabled={pending}>
              {option.id === currentId ? "Keep this plan" : "Switch to this plan"}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!target}
        onClose={() => (pending ? undefined : setTarget(null))}
        onConfirm={() => {
          if (!target) return;
          const planId = target.id;
          run(
            () => changeMyPlanAction(planId),
            () => setTarget(null),
          );
        }}
        loading={pending}
        title={target ? (keeping ? `Stay on ${target.name}?` : `Switch to ${target.name}?`) : "Switch plan?"}
        description={target ? describe(target) : undefined}
        confirmLabel={keeping ? "Keep my plan" : "Switch plan"}
        cancelLabel="Go back"
      />
    </>
  );
}
