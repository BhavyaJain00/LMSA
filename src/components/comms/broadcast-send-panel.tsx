"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { scheduleBroadcastAction, sendBroadcastAction, sendBroadcastTestAction, unscheduleBroadcastAction } from "@/lib/actions/broadcasts";
import { RATE_OPTIONS, estimateSendMinutes } from "@/lib/comms/broadcast-core";
import { MAX_TEST_RECIPIENTS } from "@/lib/comms/campaign-core";
import { LocalDateTime } from "@/components/assessments/client-time";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/utils";

/** Send a test copy to the staff member (default) or a few other addresses. */
export function BroadcastTestForm({ id, defaultTo, disabled }: { id: string; defaultTo: string; disabled?: boolean }) {
  const fieldId = useId();
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await sendBroadcastTestAction(id, to);
      if (result.ok) toast.success(result.message ?? "Test sent");
      else setError(result.error);
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Field
        label="Send a test to"
        htmlFor={fieldId}
        hint={`Up to ${MAX_TEST_RECIPIENTS} addresses, separated by commas. Tests are marked “[Test]” and aren't tracked.`}
      >
        <Input id={fieldId} type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} disabled={disabled || pending} />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="outline" size="sm" loading={pending} disabled={disabled} leftIcon={<Icon.Send className="size-4" />}>
        Send test email
      </Button>
    </form>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date as the value of an `<input type="datetime-local">` in the browser's time zone. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inOneHour(): Date {
  const d = new Date(Date.now() + 3_600_000);
  d.setSeconds(0, 0);
  return d;
}

function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function durationLabel(minutes: number): string {
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * The last step of a draft or scheduled broadcast: choose the sending speed,
 * then send it now or schedule it (times are entered in the viewer's own
 * time zone and stored in UTC).
 */
export function BroadcastSendPanel({
  id,
  recipients,
  scheduledAt,
  ratePerMinute,
  emailEnabled,
}: {
  id: string;
  /** People the audience reaches right now. */
  recipients: number;
  scheduledAt?: string;
  ratePerMinute: number;
  emailEnabled: boolean;
}) {
  const uid = useId();
  const router = useRouter();
  const toast = useToast();
  const [rate, setRate] = useState(ratePerMinute);
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pending, startTransition] = useTransition();
  const nobody = recipients === 0;
  const blocked = !emailEnabled || nobody;
  const people = `${formatNumber(recipients)} ${recipients === 1 ? "person" : "people"}`;

  const run = (action: () => Promise<ActionResult>, done?: () => void) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await action();
        if (result.ok) {
          if (result.message) toast.success(result.message);
          router.refresh();
        } else {
          setError(result.error);
        }
      } finally {
        done?.();
      }
    });

  const schedule = () => {
    const at = when ? new Date(when) : null;
    if (!at || Number.isNaN(at.getTime())) {
      setError("Choose a date and time.");
      return;
    }
    run(() => scheduleBroadcastAction(id, at.toISOString(), rate), () => setWhen(""));
  };

  return (
    <div className="space-y-5">
      {scheduledAt && (
        <div role="status" className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info">
          <p className="flex gap-2 font-medium">
            <Icon.Clock className="mt-0.5 size-4 shrink-0" />
            <span>
              Scheduled for <LocalDateTime iso={scheduledAt} mode="weekday-datetime" />
            </span>
          </p>
          <p className="mt-1 pl-6 text-xs">The audience is worked out again at that moment, so people who join or unsubscribe before then are handled correctly.</p>
          <Button size="xs" variant="outline" className="ml-6 mt-2" loading={pending} onClick={() => run(() => unscheduleBroadcastAction(id))}>
            Cancel schedule
          </Button>
        </div>
      )}

      <Field
        label="Sending speed"
        htmlFor={`${uid}-rate`}
        hint={nobody ? "Emails are handed to your mail server in batches, never faster than this." : `Sending to ${people} takes ${durationLabel(estimateSendMinutes(recipients, rate))}.`}
      >
        <Select
          id={`${uid}-rate`}
          value={String(rate)}
          onChange={(e) => setRate(Number(e.target.value))}
          disabled={pending}
          options={RATE_OPTIONS.map((r) => ({ value: String(r), label: `${r} emails per minute` }))}
        />
      </Field>

      <div className="space-y-2">
        <label htmlFor={`${uid}-when`} className="block text-sm font-medium text-ink">
          {scheduledAt ? "Move to another time" : "Schedule for later"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${uid}-when`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            disabled={pending || blocked}
            className="sm:flex-1"
            aria-describedby={`${uid}-when-hint`}
          />
          <Button variant="outline" onClick={schedule} loading={pending && !confirmSend} disabled={blocked || !when} leftIcon={<Icon.Calendar className="size-4" />}>
            {scheduledAt ? "Reschedule" : "Schedule"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" id={`${uid}-when-hint`}>
          <span className="text-xs text-ink-muted">Your local time.</span>
          <Button size="xs" variant="subtle" disabled={pending || blocked} onClick={() => setWhen(toLocalInput(inOneHour()))}>
            In 1 hour
          </Button>
          <Button size="xs" variant="subtle" disabled={pending || blocked} onClick={() => setWhen(toLocalInput(tomorrowAt(9)))}>
            Tomorrow 9:00
          </Button>
        </div>
      </div>

      <FormError message={error} />
      {!emailEnabled && <FormError message="Email is turned off, so broadcasts can't be sent. An administrator can switch it on in Settings → Email." />}
      {emailEnabled && nobody && <FormError message="Nobody matches this audience right now. Edit the broadcast and adjust the audience." />}

      <div className="border-t border-border pt-4">
        <Button className="w-full" disabled={blocked || pending} onClick={() => setConfirmSend(true)} leftIcon={<Icon.Send className="size-4" />}>
          Send now to {people}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={() => run(() => sendBroadcastAction(id, rate), () => setConfirmSend(false))}
        title={`Send to ${people}?`}
        description={`Sending starts right away at up to ${rate} emails per minute. You can pause or stop it while it is in progress, but emails that already went out can't be recalled.`}
        confirmLabel="Send broadcast"
        loading={pending}
      />
    </div>
  );
}
