"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { Settings } from "@/lib/types";
import {
  approveInstructorAction,
  recordInstructorPayoutAction,
  rejectInstructorAction,
  saveMarketplaceSettingsAction,
  updateInstructorTermsAction,
} from "@/lib/actions/marketplace";
import { PAYOUT_METHODS } from "@/lib/growth/affiliates-shared";
import { MARKETPLACE_LIMITS } from "@/lib/teaching/marketplace-shared";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { money } from "@/components/commerce/order-summary";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { moneyList } from "@/components/growth/affiliate-badges";

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

export interface ReviewTarget {
  id: string;
  name: string;
  status: "applied" | "approved" | "rejected";
  sharePercent: number;
}

/** Approve / decline (or suspend) buttons with their dialogs. */
export function InstructorReviewButtons({ target, compact = false }: { target: ReviewTarget; compact?: boolean }) {
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {target.status !== "approved" && (
          <Button size={compact ? "xs" : "md"} onClick={() => setOpen("approve")} leftIcon={compact ? undefined : <Icon.CheckCircle className="size-4" />}>
            Approve
          </Button>
        )}
        {target.status !== "rejected" && (
          <Button size={compact ? "xs" : "md"} variant="outline" onClick={() => setOpen("reject")}>
            {target.status === "approved" ? "Suspend" : "Decline"}
          </Button>
        )}
      </div>
      <Dialog
        open={open === "approve"}
        onClose={close}
        title={`Approve ${target.name}`}
        description="They get the course creator role and earn their share of the net revenue of the courses they teach."
      >
        {open === "approve" && <ApproveForm target={target} onDone={close} />}
      </Dialog>
      <Dialog
        open={open === "reject"}
        onClose={close}
        title={target.status === "approved" ? `Suspend ${target.name}` : `Decline ${target.name}`}
        description={
          target.status === "approved"
            ? "New sales stop earning for them. Unpaid earnings stay payable and their courses are not changed."
            : "They can update their application and apply again."
        }
      >
        {open === "reject" && <RejectForm target={target} onDone={close} />}
      </Dialog>
    </>
  );
}

function ApproveForm({ target, onDone }: { target: ReviewTarget; onDone: () => void }) {
  const id = useId();
  const { onSubmit, pending, errors } = useFormAction(approveInstructorAction, { onSuccess: onDone });
  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="id" value={target.id} />
      <Field label="Revenue share" htmlFor={`${id}-share`} required error={errors.sharePercent} hint="Percent of the net course revenue (after discounts, tax and refunds) paid to this instructor.">
        <Input
          id={`${id}-share`}
          name="sharePercent"
          type="number"
          min={0}
          max={100}
          step={0.5}
          inputMode="decimal"
          defaultValue={target.sharePercent}
          rightAddon="%"
          invalid={!!errors.sharePercent}
          autoFocus
        />
      </Field>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Approve instructor
        </Button>
      </div>
    </form>
  );
}

function RejectForm({ target, onDone }: { target: ReviewTarget; onDone: () => void }) {
  const id = useId();
  const { onSubmit, pending, errors } = useFormAction(rejectInstructorAction, { onSuccess: onDone });
  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="id" value={target.id} />
      <Field label="Reason" htmlFor={`${id}-reason`} required error={errors.reason} hint="Sent to the member in a notification.">
        <Textarea id={`${id}-reason`} name="reason" rows={4} maxLength={MARKETPLACE_LIMITS.reasonMax} invalid={!!errors.reason} autoFocus />
      </Field>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" loading={pending}>
          {target.status === "approved" ? "Suspend instructor" : "Decline application"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

export function InstructorTermsForm({ profile }: { profile: { id: string; revenueSharePercent: number; payoutEmail?: string } }) {
  const { onSubmit, pending, errors, formError, dirty, markDirty, state } = useFormAction(updateInstructorTermsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate>
      <input type="hidden" name="id" value={profile.id} />
      <SettingsSection title="Terms">
        <SettingsRow label="Revenue share" htmlFor="inst-share" description="Applies to new sales; existing earnings keep their amount." error={errors.sharePercent}>
          <Input
            id="inst-share"
            name="sharePercent"
            type="number"
            min={0}
            max={100}
            step={0.5}
            inputMode="decimal"
            defaultValue={profile.revenueSharePercent}
            rightAddon="%"
            invalid={!!errors.sharePercent}
          />
        </SettingsRow>
        <SettingsRow label="Payout email" htmlFor="inst-payout" description="Empty uses the account email." error={errors.payoutEmail}>
          <Input id="inst-payout" name="payoutEmail" type="email" defaultValue={profile.payoutEmail ?? ""} maxLength={MARKETPLACE_LIMITS.emailMax} invalid={!!errors.payoutEmail} />
        </SettingsRow>
      </SettingsSection>
      {formError && !Object.keys(errors).length && (
        <div className="mt-4">
          <FormError message={formError} />
        </div>
      )}
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Payouts                                                             */
/* ------------------------------------------------------------------ */

export interface InstructorPayoutTarget {
  /** Instructor user id. */
  instructorId: string;
  profileId: string;
  name: string;
  avatarUrl?: string;
  /** Where to send the money (payout email, else the account email). */
  payTo: string;
  balances: { currency: string; amount: number }[];
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Record payouts for one or several instructors in one currency. */
export function InstructorPayoutDialog({ targets, open, onClose, onPaid }: { targets: InstructorPayoutTarget[]; open: boolean; onClose: () => void; onPaid?: () => void }) {
  const single = targets.length === 1 ? targets[0] : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={single ? `Pay ${single.name}` : `Pay ${targets.length} instructors`}
      description={single ? `Send to ${single.payTo}` : "Each instructor's unpaid balance is marked paid with its own payout record."}
    >
      {open && (
        <PayoutForm
          targets={targets}
          onClose={onClose}
          onPaid={() => {
            onPaid?.();
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function PayoutForm({ targets, onClose, onPaid }: { targets: InstructorPayoutTarget[]; onClose: () => void; onPaid: () => void }) {
  const id = useId();
  const currencies = Array.from(new Set(targets.flatMap((t) => t.balances.filter((b) => b.amount > 0).map((b) => b.currency)))).sort();
  const [chosen, setChosen] = useState(currencies[0] ?? "");
  const { onSubmit, pending, errors, formError } = useFormAction(recordInstructorPayoutAction, { onSuccess: onPaid });
  const currency = currencies.includes(chosen) ? chosen : (currencies[0] ?? "");
  const paying = targets.filter((t) => t.balances.some((b) => b.currency === currency && b.amount > 0));
  const total = paying.reduce((s, t) => s + (t.balances.find((b) => b.currency === currency)?.amount ?? 0), 0);

  if (!currencies.length) {
    return (
      <>
        <p className="text-sm text-ink-muted">There is no unpaid balance to pay.</p>
        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        {paying.map((t) => (
          <input key={t.instructorId} type="hidden" name="instructorId" value={t.instructorId} />
        ))}
        {currencies.length > 1 ? (
          <Field label="Currency" htmlFor={`${id}-currency`} error={errors.currency}>
            <Select id={`${id}-currency`} name="currency" value={currency} onChange={(e) => setChosen(e.currentTarget.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
          </Field>
        ) : (
          <input type="hidden" name="currency" value={currency} />
        )}
        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-sm text-ink-muted">Unpaid balance{paying.length > 1 ? ` of ${paying.length} instructors` : ""}</p>
          <p className="text-2xl font-semibold tabular-nums text-ink">{money(total, currency)}</p>
          <p className="mt-1 text-xs text-ink-muted">After refund corrections. A cut-off date below pays only sales up to that day.</p>
        </div>
        {paying.length > 1 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm" aria-label="Instructors in this payout">
            {paying.map((t) => (
              <li key={t.instructorId} className="flex justify-between gap-3">
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">{money(t.balances.find((b) => b.currency === currency)?.amount ?? 0, currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid with" htmlFor={`${id}-method`} required error={errors.method}>
            <Select id={`${id}-method`} name="method" defaultValue="bank_transfer" options={[...PAYOUT_METHODS]} />
          </Field>
          <Field label="Sales up to" htmlFor={`${id}-through`} error={errors.through} hint="Leave as today to pay everything.">
            <Input id={`${id}-through`} name="through" type="date" defaultValue={todayKey()} max={todayKey()} />
          </Field>
        </div>
        <Field label="Reference" htmlFor={`${id}-reference`} hint="Transaction or transfer ID, shown to the instructor." error={errors.reference}>
          <Input id={`${id}-reference`} name="reference" maxLength={MARKETPLACE_LIMITS.referenceMax} autoComplete="off" />
        </Field>
        <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Mark as paid
        </Button>
      </div>
    </form>
  );
}

/** "Record payout" button on an instructor's detail page. */
export function InstructorPayoutButton({ target }: { target: InstructorPayoutTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!target.balances.length} leftIcon={<Icon.CreditCard className="size-4" />}>
        Record payout
      </Button>
      <InstructorPayoutDialog targets={[target]} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Instructors with an unpaid balance: pay one, or select several and pay them together. */
export function PayableInstructorsTable({ rows, fallbackCurrency }: { rows: InstructorPayoutTarget[]; fallbackCurrency: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<InstructorPayoutTarget[] | null>(null);
  const live = rows.filter((r) => selected.has(r.instructorId));
  const allChecked = rows.length > 0 && live.length === rows.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {live.length ? `${live.length} selected` : `${rows.length} ${rows.length === 1 ? "instructor has" : "instructors have"} an unpaid balance`}
        </p>
        <Button size="sm" disabled={!live.length} onClick={() => setPaying(live)} leftIcon={<Icon.CreditCard className="size-4" />}>
          Pay selected
        </Button>
      </div>
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <Checkbox
                aria-label="Select all instructors"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.instructorId)))}
                disabled={!rows.length}
              />
            </TH>
            <TH>Instructor</TH>
            <TH className="hidden md:table-cell">Pay to</TH>
            <TH className="text-right">Unpaid</TH>
            <TH className="w-20">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>Nothing to pay. Instructor earnings from new sales appear here.</TableEmpty>
          ) : (
            rows.map((r) => (
              <TR key={r.instructorId}>
                <TD>
                  <Checkbox aria-label={`Select ${r.name}`} checked={selected.has(r.instructorId)} onChange={() => toggle(r.instructorId)} />
                </TD>
                <TD className="max-w-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <Link href={`/admin/marketplace/${r.profileId}`} className="block truncate font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <p className="truncate text-xs text-ink-muted md:hidden">{r.payTo}</p>
                    </div>
                  </div>
                </TD>
                <TD className="hidden max-w-0 truncate text-ink-muted md:table-cell">{r.payTo}</TD>
                <TD className="whitespace-nowrap text-right font-medium tabular-nums">{moneyList(r.balances, fallbackCurrency)}</TD>
                <TD className="text-right">
                  <Button size="xs" variant="outline" onClick={() => setPaying([r])}>
                    Pay
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
      <InstructorPayoutDialog targets={paying ?? []} open={!!paying} onClose={() => setPaying(null)} onPaid={() => setSelected(new Set())} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function MarketplaceSettingsForm({ initial }: { initial: Settings["marketplace"] }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveMarketplaceSettingsAction);
  const [enabled, setEnabled] = useState(initial.enabled);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Instructor marketplace" description="Outside instructors apply to teach, publish courses and earn a share of the revenue.">
        <SettingsSwitchRow>
          <Switch
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            label="Marketplace"
            description="Credits approved instructors on new course sales. Turning it off stops new earnings; unpaid earnings stay payable."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="allowApplications"
            defaultChecked={initial.allowApplications}
            label="Accept applications"
            description="Shows Teach in the sidebar so members can apply from /teach."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Default revenue share"
          htmlFor="mkt-share"
          description="Suggested when approving a new instructor. Change it per instructor at any time."
          error={errors.defaultRevenueSharePercent}
        >
          <Input
            id="mkt-share"
            name="defaultRevenueSharePercent"
            type="number"
            min={0}
            max={100}
            step={0.5}
            inputMode="decimal"
            defaultValue={initial.defaultRevenueSharePercent}
            rightAddon="%"
            invalid={!!errors.defaultRevenueSharePercent}
          />
        </SettingsRow>
      </SettingsSection>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
