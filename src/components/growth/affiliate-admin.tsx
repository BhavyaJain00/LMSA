"use client";

import { useState, useTransition } from "react";
import type { Affiliate, Settings } from "@/lib/types";
import { saveAffiliateSettingsAction, setAffiliateStatusAction, updateAffiliateAction } from "@/lib/actions/affiliates";
import { MAX_COOKIE_DAYS } from "@/lib/growth/affiliates-shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { FormError, Input, Select, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { PayoutDialog, type PayoutTarget } from "./payout-dialog";

/* ------------------------------------------------------------------ */
/* Status changes                                                      */
/* ------------------------------------------------------------------ */

function useStatusChange() {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const change = (id: string, status: Affiliate["status"], done?: () => void) =>
    startTransition(async () => {
      const result = await setAffiliateStatusAction(id, status);
      if (result.ok) toast.success(result.message ?? "Saved");
      else toast.error(result.error);
      done?.();
    });
  return { busy, change };
}

/**
 * Actions menu of one affiliate: approve / pause / reactivate, and on the
 * list also open and pay (the detail page has its own payout button).
 */
export function AffiliateRowActions({ affiliate, payout, detail = false }: { affiliate: Pick<Affiliate, "id" | "code" | "status">; payout: PayoutTarget; detail?: boolean }) {
  const { busy, change } = useStatusChange();
  const [paying, setPaying] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const canPay = !detail && payout.balances.some((b) => b.amount > 0);

  const items: DropdownItem[] = detail ? [] : [{ label: "Open details", icon: <Icon.Eye />, href: `/admin/affiliates/${affiliate.id}` }];
  if (affiliate.status === "pending") items.push({ label: "Approve", icon: <Icon.CheckCircle />, onClick: () => change(affiliate.id, "active") });
  if (affiliate.status === "paused") items.push({ label: "Reactivate", icon: <Icon.Refresh />, onClick: () => change(affiliate.id, "active") });
  if (canPay) items.push({ label: "Record payout", icon: <Icon.CreditCard />, onClick: () => setPaying(true) });
  if (affiliate.status !== "paused") {
    items.push({ label: affiliate.status === "pending" ? "Decline (pause)" : "Pause", icon: <Icon.Pause />, destructive: true, separator: items.length > 0, onClick: () => setConfirmPause(true) });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        {affiliate.status === "pending" && (
          <Button size="xs" onClick={() => change(affiliate.id, "active")} loading={busy} className="hidden sm:inline-flex">
            Approve
          </Button>
        )}
        <Dropdown
          trigger={
            <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
              <Icon.MoreHorizontal className="size-4" aria-hidden="true" />
              <span className="sr-only">Actions for affiliate {affiliate.code}</span>
            </span>
          }
          items={items}
        />
      </div>
      {!detail && <PayoutDialog target={payout} open={paying} onClose={() => setPaying(false)} />}
      <ConfirmDialog
        open={confirmPause}
        onClose={() => !busy && setConfirmPause(false)}
        onConfirm={() => change(affiliate.id, "paused", () => setConfirmPause(false))}
        loading={busy}
        destructive
        title={`Pause affiliate ${affiliate.code}?`}
        description="Their links stop crediting new sales right away. Commissions already earned stay payable, and you can reactivate them at any time."
        confirmLabel="Pause"
      />
    </>
  );
}

/** Payout button on the affiliate detail page. */
export function PayoutButton({ payout }: { payout: PayoutTarget }) {
  const [open, setOpen] = useState(false);
  const canPay = payout.balances.some((b) => b.amount > 0);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!canPay} leftIcon={<Icon.CreditCard className="size-4" />}>
        Record payout
      </Button>
      <PayoutDialog target={payout} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Awaiting review" },
  { value: "paused", label: "Paused" },
];

export function AffiliateEditForm({ affiliate }: { affiliate: Pick<Affiliate, "id" | "code" | "commissionPercent" | "status" | "payoutEmail"> }) {
  const { onSubmit, pending, errors, formError, dirty, markDirty, state } = useFormAction(updateAffiliateAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate>
      <input type="hidden" name="id" value={affiliate.id} />
      <SettingsSection title="Affiliate settings">
        <SettingsRow label="Referral code" htmlFor="aff-code" description="Used in ?ref= links. Changing it stops old links from crediting this affiliate." error={errors.code}>
          <Input id="aff-code" name="code" defaultValue={affiliate.code} className="font-mono uppercase" maxLength={32} invalid={!!errors.code} autoComplete="off" />
        </SettingsRow>
        <SettingsRow label="Commission" htmlFor="aff-percent" description="Percent of the net, tax-exclusive price. Applies to new sales." error={errors.commissionPercent}>
          <Input
            id="aff-percent"
            name="commissionPercent"
            type="number"
            min={0}
            max={100}
            step={0.5}
            inputMode="decimal"
            defaultValue={affiliate.commissionPercent}
            rightAddon="%"
            invalid={!!errors.commissionPercent}
          />
        </SettingsRow>
        <SettingsRow label="Payout email" htmlFor="aff-payout" description="Where payouts are sent. Empty uses the account email." error={errors.payoutEmail}>
          <Input id="aff-payout" name="payoutEmail" type="email" defaultValue={affiliate.payoutEmail ?? ""} invalid={!!errors.payoutEmail} maxLength={200} />
        </SettingsRow>
        <SettingsRow label="Status" htmlFor="aff-status" description="Only active affiliates earn commissions on new sales." error={errors.status}>
          <Select id="aff-status" name="status" defaultValue={affiliate.status} options={STATUS_OPTIONS} />
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
/* Program settings                                                    */
/* ------------------------------------------------------------------ */

type ProgramSettings = Pick<Settings["growth"], "affiliatesEnabled" | "affiliateAutoApprove" | "defaultCommissionPercent" | "cookieDays">;

export function AffiliateSettingsForm({ initial }: { initial: ProgramSettings }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(saveAffiliateSettingsAction);
  const [enabled, setEnabled] = useState(initial.affiliatesEnabled);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <input type="hidden" name="section" value="affiliates" />
      <SettingsSection title="Affiliate program" description="Members share referral links and earn a commission on the purchases they bring in.">
        <SettingsSwitchRow>
          <Switch
            name="affiliatesEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            label="Affiliate program"
            description="Shows the Affiliate page to members and credits commissions on new sales. Turning it off keeps existing commissions payable."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch
            name="affiliateAutoApprove"
            defaultChecked={initial.affiliateAutoApprove}
            label="Approve new affiliates automatically"
            description="Members get their link as soon as they join. Otherwise every application waits for an administrator."
          />
        </SettingsSwitchRow>
        <SettingsRow
          label="Default commission"
          htmlFor="set-percent"
          description="Percent of the net, tax-exclusive price for new affiliates. Change it per affiliate on their page."
          error={errors.defaultCommissionPercent}
        >
          <Input
            id="set-percent"
            name="defaultCommissionPercent"
            type="number"
            min={0}
            max={100}
            step={0.5}
            inputMode="decimal"
            defaultValue={initial.defaultCommissionPercent}
            rightAddon="%"
            invalid={!!errors.defaultCommissionPercent}
          />
        </SettingsRow>
        <SettingsRow
          label="Referral window"
          htmlFor="set-days"
          description="A purchase is credited to the last affiliate link the buyer clicked within this many days."
          error={errors.cookieDays}
        >
          <Input
            id="set-days"
            name="cookieDays"
            type="number"
            min={1}
            max={MAX_COOKIE_DAYS}
            step={1}
            inputMode="numeric"
            defaultValue={initial.cookieDays}
            rightAddon="days"
            invalid={!!errors.cookieDays}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Fraud checks" description="Applied automatically to every commission.">
        <ul className="list-disc space-y-1 px-4 py-4 pl-9 text-sm text-ink-muted sm:px-5 sm:pl-10">
          <li>Purchases through a member&apos;s own link never earn a commission.</li>
          <li>Commissions are flagged when the buyer signed in from an IP address the affiliate also used.</li>
          <li>Commissions are flagged when the buyer&apos;s email is the affiliate&apos;s account or payout email (ignoring +tags, and dots for Gmail).</li>
          <li>Refunds void unpaid commissions; refunds after a payout are deducted from the next one.</li>
        </ul>
      </SettingsSection>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
