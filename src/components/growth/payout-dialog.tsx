"use client";

import { useState } from "react";
import { recordPayoutAction } from "@/lib/actions/affiliates";
import { PAYOUT_METHODS } from "@/lib/growth/affiliates-shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/input";
import { money } from "@/components/commerce/order-summary";
import { useFormAction } from "@/components/admin/settings/use-form-action";

export interface PayoutTarget {
  affiliateId: string;
  name: string;
  code: string;
  /** Where to send the money (payout email, else the account email). */
  payTo: string;
  balances: { currency: string; amount: number }[];
}

/**
 * Record that an affiliate's approved balance in one currency was paid:
 * every approved commission in that currency is marked paid.
 */
export function PayoutDialog({ target, open, onClose }: { target: PayoutTarget; open: boolean; onClose: () => void }) {
  const payable = target.balances.filter((b) => b.amount > 0);
  const [currency, setCurrency] = useState(payable[0]?.currency ?? "");
  const { onSubmit, pending, errors, formError } = useFormAction(recordPayoutAction, { onSuccess: onClose });
  const amount = payable.find((b) => b.currency === currency)?.amount ?? 0;

  return (
    <Dialog open={open} onClose={onClose} title={`Pay ${target.name}`} description={`Affiliate ${target.code} · send to ${target.payTo}`}>
      {payable.length === 0 ? (
        <p className="text-sm text-ink-muted">There is no approved balance to pay. Approve commissions first.</p>
      ) : (
        <form id={`payout-${target.affiliateId}`} onSubmit={onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="affiliateId" value={target.affiliateId} />
          {payable.length > 1 ? (
            <Field label="Currency" htmlFor="payout-currency" error={errors.currency}>
              <Select id="payout-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.currentTarget.value)}>
                {payable.map((b) => (
                  <option key={b.currency} value={b.currency}>
                    {b.currency} · {money(b.amount, b.currency)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="currency" value={currency} />
          )}
          <div className="rounded-lg bg-surface-2 p-4">
            <p className="text-sm text-ink-muted">Amount to pay</p>
            <p className="text-2xl font-semibold tabular-nums text-ink">{money(amount, currency)}</p>
            <p className="mt-1 text-xs text-ink-muted">All approved commissions in {currency}, after refund adjustments.</p>
          </div>
          <Field label="Paid with" htmlFor="payout-method" required error={errors.method}>
            <Select id="payout-method" name="method" defaultValue="bank_transfer" options={[...PAYOUT_METHODS]} />
          </Field>
          <Field label="Reference" htmlFor="payout-reference" hint="Transaction or transfer ID, shown to the affiliate." error={errors.reference}>
            <Input id="payout-reference" name="reference" maxLength={120} autoComplete="off" />
          </Field>
          <FormError message={formError && !Object.keys(errors).length ? formError : null} />
        </form>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {payable.length > 0 && (
          <Button type="submit" form={`payout-${target.affiliateId}`} loading={pending}>
            Mark {money(amount, currency)} as paid
          </Button>
        )}
      </div>
    </Dialog>
  );
}
