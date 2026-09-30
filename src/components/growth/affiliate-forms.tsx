"use client";

import { applyAffiliateAction, updatePayoutEmailAction } from "@/lib/actions/affiliates";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/** Join the affiliate program (payout email + program rules). */
export function AffiliateApplyForm({ accountEmail, percent, cookieDays, autoApprove }: { accountEmail: string; percent: number; cookieDays: number; autoApprove: boolean }) {
  const { onSubmit, pending, errors, formError } = useFormAction(applyAffiliateAction);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Payout email"
        htmlFor="aff-payout-email"
        hint={`Where we send your commissions (PayPal, Wise or bank details are arranged by email). Leave empty to use ${accountEmail}.`}
        error={errors.payoutEmail}
      >
        <Input id="aff-payout-email" name="payoutEmail" type="email" autoComplete="email" placeholder={accountEmail} invalid={!!errors.payoutEmail} maxLength={200} />
      </Field>
      <div>
        <Checkbox
          name="agree"
          label="I accept the program rules"
          description={`You earn ${percent}% of the price (excluding tax) of purchases made within ${cookieDays} days of a click on your link. Buying through your own link, refunded orders and orders flagged as self-referrals earn nothing.`}
          aria-invalid={!!errors.agree}
        />
        {errors.agree && <p className="mt-1.5 text-xs text-danger">{errors.agree}</p>}
      </div>
      <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      <Button type="submit" loading={pending} leftIcon={<Icon.Handshake className="size-4" />}>
        {autoApprove ? "Join and get my link" : "Apply to join"}
      </Button>
    </form>
  );
}

/** Change the payout email of the signed-in affiliate. */
export function PayoutEmailForm({ current, accountEmail }: { current?: string; accountEmail: string }) {
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(updatePayoutEmailAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <label htmlFor="payout-email" className="sr-only">
          Payout email
        </label>
        <Input
          id="payout-email"
          name="payoutEmail"
          type="email"
          autoComplete="email"
          defaultValue={current ?? ""}
          placeholder={accountEmail}
          invalid={!!errors.payoutEmail}
          aria-describedby="payout-email-hint"
          maxLength={200}
        />
        <p id="payout-email-hint" className={errors.payoutEmail ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-muted"}>
          {errors.payoutEmail ?? `Payouts and payout questions go here. Empty = ${accountEmail}.`}
        </p>
      </div>
      <Button type="submit" variant="outline" loading={pending} disabled={!dirty}>
        Save
      </Button>
    </form>
  );
}
