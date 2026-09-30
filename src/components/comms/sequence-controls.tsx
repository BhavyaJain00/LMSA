"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import {
  deleteSequenceAction,
  duplicateSequenceAction,
  runCommsNowAction,
  sendSequenceTestAction,
  setSequenceActiveAction,
  stopAllSequenceEnrollmentsAction,
  stopSequenceEnrollmentAction,
} from "@/lib/actions/sequences";
import { MAX_TEST_RECIPIENTS } from "@/lib/comms/campaign-core";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { LiveEmailPreview } from "./live-email-preview";

/** Runs a sequence action, shows its outcome as a toast and refreshes the page data. */
function useSequenceAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await action();
        // Actions that redirect never return.
        if (!result) return;
        if (result.ok) {
          if (result.message) toast.success(result.message);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      } finally {
        after?.();
      }
    });
  return { pending, run };
}

/** On/off switch of a sequence. Switching it on sends overdue emails of people who were part-way through. */
export function SequenceActiveToggle({ id, name, active, withLabel }: { id: string; name: string; active: boolean; withLabel?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(active);
  const inputId = useId();

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setShown(next);
      const result = await setSequenceActiveAction(id, next);
      if (result.ok) {
        if (result.message) toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <span className="inline-flex items-center gap-2">
      <Switch id={inputId} checked={shown} disabled={pending} onChange={(e) => toggle(e.target.checked)} aria-label={`${shown ? "Pause" : "Switch on"} “${name}”`} />
      {withLabel && <span className="text-sm font-medium text-ink">{shown ? "On" : "Off"}</span>}
    </span>
  );
}

/** "More" menu of a sequence: open, edit, duplicate, stop everyone in progress, delete. */
export function SequenceMenu({
  id,
  name,
  activePeople,
  showOpen,
  variant = "icon",
}: {
  id: string;
  name: string;
  /** People part-way through the sequence. */
  activePeople: number;
  showOpen?: boolean;
  variant?: "icon" | "button";
}) {
  const { pending, run } = useSequenceAction();
  const [confirm, setConfirm] = useState<"delete" | "stop" | null>(null);

  const items: DropdownItem[] = [];
  if (showOpen) items.push({ label: "View report", icon: <Icon.BarChart />, href: `/admin/sequences/${id}` });
  items.push({ label: "Edit", icon: <Icon.Edit />, href: `/admin/sequences/${id}/edit` });
  items.push({ label: "Duplicate", description: "The copy starts switched off", icon: <Icon.Copy />, disabled: pending, onClick: () => run(() => duplicateSequenceAction(id)) });
  items.push({
    label: "Stop everyone in progress",
    description: activePeople ? `${activePeople.toLocaleString("en-US")} ${activePeople === 1 ? "person" : "people"}` : "Nobody is part-way through",
    icon: <Icon.XCircle />,
    separator: true,
    disabled: pending || activePeople === 0,
    onClick: () => setConfirm("stop"),
  });
  items.push({ label: "Delete", icon: <Icon.Trash />, destructive: true, disabled: pending, onClick: () => setConfirm("delete") });

  return (
    <>
      <Dropdown
        trigger={
          variant === "icon" ? (
            <span className={buttonClasses({ variant: "ghost", size: "icon-sm" })}>
              <Icon.MoreHorizontal className="size-4" />
              <span className="sr-only">Actions for “{name}”</span>
            </span>
          ) : (
            <span className={buttonClasses({ variant: "outline" })}>
              <Icon.MoreHorizontal className="size-4" />
              More
            </span>
          )
        }
        items={items}
      />
      <ConfirmDialog
        open={confirm === "stop"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => stopAllSequenceEnrollmentsAction(id), () => setConfirm(null))}
        title="Stop everyone in progress?"
        description={`${activePeople.toLocaleString("en-US")} ${activePeople === 1 ? "person" : "people"} part-way through “${name}” won't receive its remaining emails. People who trigger the sequence from now on still start it.`}
        confirmLabel="Stop them"
        destructive
        loading={pending}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => run(() => deleteSequenceAction(id), () => setConfirm(null))}
        title="Delete this sequence?"
        description={`“${name}”, its emails and the record of who received them are removed for good.${activePeople ? ` ${activePeople.toLocaleString("en-US")} ${activePeople === 1 ? "person" : "people"} part-way through won't get the remaining emails.` : ""}`}
        confirmLabel="Delete sequence"
        destructive
        loading={pending}
      />
    </>
  );
}

/** Preview one saved email of a sequence, or send it to yourself as a test. */
export function StepActions({
  sequenceId,
  stepId,
  subject,
  body,
  courseId,
  defaultTo,
  emailEnabled,
}: {
  sequenceId: string;
  stepId: string;
  subject: string;
  body: string;
  courseId?: string;
  defaultTo: string;
  emailEnabled: boolean;
}) {
  const fieldId = useId();
  const toast = useToast();
  const [dialog, setDialog] = useState<"preview" | "test" | null>(null);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await sendSequenceTestAction(sequenceId, stepId, to);
      if (result.ok) {
        toast.success(result.message ?? "Test sent");
        setDialog(null);
      } else {
        setError(result.error);
      }
    });

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onClick={() => setDialog("preview")} leftIcon={<Icon.Eye className="size-3.5" />}>
          Preview
        </Button>
        <Button size="xs" variant="outline" onClick={() => setDialog("test")} disabled={!emailEnabled} leftIcon={<Icon.Send className="size-3.5" />}>
          Send test
        </Button>
      </div>
      <Dialog open={dialog === "preview"} onClose={() => setDialog(null)} title="Email preview" size="lg">
        {dialog === "preview" && <LiveEmailPreview kind="sequence" subject={subject} body={body} courseId={courseId} heightClass="h-[480px] max-h-[55vh]" />}
      </Dialog>
      <Dialog
        open={dialog === "test"}
        onClose={() => setDialog(null)}
        title="Send a test email"
        description={`“${subject}”`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={send} loading={pending} leftIcon={<Icon.Send className="size-4" />}>
              Send test
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Field label="Send to" htmlFor={fieldId} hint={`Up to ${MAX_TEST_RECIPIENTS} addresses, separated by commas. Tests are marked “[Test]” and aren't tracked.`}>
            <Input id={fieldId} type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} disabled={pending} />
          </Field>
          <FormError message={error} />
        </form>
      </Dialog>
    </>
  );
}

/** Remove one person from a sequence (they receive no further emails from it). */
export function StopEnrollmentButton({ enrollmentId, who }: { enrollmentId: string; who: string }) {
  const { pending, run } = useSequenceAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} disabled={pending} aria-label={`Stop the sequence for ${who}`}>
        Stop
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => run(() => stopSequenceEnrollmentAction(enrollmentId), () => setOpen(false))}
        title="Stop the sequence for this person?"
        description={`${who} won't receive the remaining emails of this sequence.`}
        confirmLabel="Stop"
        destructive
        loading={pending}
      />
    </>
  );
}

/** Run the comms work that is due right now instead of waiting for the next scheduled run. */
export function RunCommsButton() {
  const { pending, run } = useSequenceAction();
  return (
    <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => runCommsNowAction())} leftIcon={<Icon.Refresh className="size-4" />}>
      Run now
    </Button>
  );
}
