"use client";

import { useId, useState } from "react";
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
  return (
    <Dialog open={open} onClose={onClose} title={`Pay ${target.name}`} description={`Affiliate ${target.code} · send to ${target.payTo}`}>
      {/* Mounted only while open: many rows share a page, and a fresh form each time keeps balances current. */}
      {open && <PayoutForm target={target} onClose={onClose} />}
    </Dialog>
  );
}

function PayoutForm({ target, onClose }: { target: PayoutTarget; onClose: () => void }) {
  const id = useId();
  const payable = target.balances.filter((b) => b.amount > 0);
  const [chosen, setChosen] = useState(payable[0]?.currency ?? "");
  const { onSubmit, pending, errors, formError } = useFormAction(recordPayoutAction, { onSuccess: onClose });
  // A payout recorded elsewhere can remove the chosen currency from the balances.
  const currency = payable.some((b) => b.currency === chosen) ? chosen : (payable[0]?.currency ?? "");
  const amount = payable.find((b) => b.currency === currency)?.amount ?? 0;

  if (payable.length === 0) {
    return (
      <>
        <p className="text-sm text-ink-muted">There is no approved balance to pay. Approve commissions first.</p>
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
        <input type="hidden" name="affiliateId" value={target.affiliateId} />
        {payable.length > 1 ? (
          <Field label="Currency" htmlFor={`${id}-currency`} error={errors.currency}>
            <Select id={`${id}-currency`} name="currency" value={currency} onChange={(e) => setChosen(e.currentTarget.value)}>
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
        <Field label="Paid with" htmlFor={`${id}-method`} required error={errors.method}>
          <Select id={`${id}-method`} name="method" defaultValue="bank_transfer" options={[...PAYOUT_METHODS]} />
        </Field>
        <Field label="Reference" htmlFor={`${id}-reference`} hint="Transaction or transfer ID, shown to the affiliate." error={errors.reference}>
          <Input id={`${id}-reference`} name="reference" maxLength={120} autoComplete="off" />
        </Field>
        <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Mark {money(amount, currency)} as paid
        </Button>
      </div>
    </form>
  );
}
