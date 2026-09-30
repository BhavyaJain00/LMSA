"use client";

import { useMemo, useState, useTransition } from "react";
import type { PaymentItemType } from "@/lib/types";
import { recordPaymentAction, sendPaymentRemindersAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { MemberPicker, type PickerMember } from "@/components/admin/settings/member-picker";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { money } from "./order-summary";

export interface RecordableItemOption {
  type: PaymentItemType;
  id: string;
  title: string;
  price: number;
  currency: string;
}

export interface CouponOption {
  id: string;
  code: string;
  enabled: boolean;
}

const PAID_FOR: { value: PaymentItemType; label: string }[] = [
  { value: "course", label: "Course" },
  { value: "batch", label: "Batch" },
  { value: "certificate", label: "Certificate" },
  { value: "plan", label: "Membership" },
  { value: "bundle", label: "Bundle" },
];

/** Cents to the decimal string used by number inputs. */
function toDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

function toCents(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * "New transaction": record a payment made outside checkout (bank transfer,
 * invoice, cash). With "Received" on, the learner gets access immediately.
 */
export function NewTransactionButton({
  members,
  items,
  coupons,
  currencies,
  defaultCurrency,
}: {
  members: PickerMember[];
  items: RecordableItemOption[];
  coupons: CouponOption[];
  currencies: readonly string[];
  defaultCurrency: string;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <Button size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setOpen(true)}>
        New
      </Button>
      {open && (
        <NewTransactionDialog
          key={formKey}
          members={members}
          items={items}
          coupons={coupons}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          onClose={() => {
            setOpen(false);
            setFormKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

function NewTransactionDialog({
  members,
  items,
  coupons,
  currencies,
  defaultCurrency,
  onClose,
}: {
  members: PickerMember[];
  items: RecordableItemOption[];
  coupons: CouponOption[];
  currencies: readonly string[];
  defaultCurrency: string;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [itemType, setItemType] = useState<PaymentItemType>("course");
  const [itemId, setItemId] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [original, setOriginal] = useState("");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [billingName, setBillingName] = useState("");
  const [received, setReceived] = useState(true);
  const { onSubmit, pending, errors, formError, dirty, markDirty } = useFormAction(recordPaymentAction, { onSuccess: onClose });
  const formId = "new-transaction-form";

  const options = useMemo(() => items.filter((i) => i.type === itemType), [items, itemType]);
  const total = Math.max(0, toCents(original) - toCents(discount)) + toCents(tax);
  const member = members.find((m) => m.id === memberId);

  const chooseItem = (id: string) => {
    setItemId(id);
    const item = items.find((i) => i.type === itemType && i.id === id);
    if (item) {
      setOriginal(item.price > 0 ? toDecimal(item.price) : "");
      setCurrency(item.currency);
    }
    markDirty();
  };

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      size="lg"
      title="New Transaction"
      description="Record a payment received outside checkout, such as a bank transfer or an invoice."
      footer={
        <>
          {dirty && (
            <Badge tone="warning" dot className="mr-auto">
              Not saved
            </Badge>
          )}
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-5">
        {formError && !Object.keys(errors).length && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Member" htmlFor="tx-member" error={errors.userId} hint={errors.userId ? undefined : "The user this payment is recorded against."} required className="sm:col-span-2">
            <MemberPicker
              id="tx-member"
              name="userId"
              members={members}
              invalid={!!errors.userId}
              onChange={(id) => {
                setMemberId(id);
                const m = members.find((x) => x.id === id);
                if (m && !billingName) setBillingName(m.name);
                markDirty();
              }}
            />
          </Field>
          <Field label="Paid For" htmlFor="tx-type" error={errors.itemType} required>
            <Select
              id="tx-type"
              name="itemType"
              value={itemType}
              onChange={(e) => {
                setItemType(e.target.value as PaymentItemType);
                setItemId("");
              }}
              options={PAID_FOR}
            />
          </Field>
          <Field
            label={itemType === "batch" ? "Batch" : itemType === "plan" ? "Membership plan" : itemType === "bundle" ? "Bundle" : "Course"}
            htmlFor="tx-item"
            error={errors.itemId}
            hint={errors.itemId ? undefined : "What this payment paid for."}
            required
          >
            <Select
              id="tx-item"
              name="itemId"
              value={itemId}
              onChange={(e) => chooseItem(e.target.value)}
              placeholder={options.length ? "Select an item" : itemType === "certificate" ? "No course sells certificates" : itemType === "plan" ? "No membership plans yet" : itemType === "bundle" ? "No bundles yet" : "Nothing to select"}
              options={options.map((o) => ({ value: o.id, label: o.title }))}
              invalid={!!errors.itemId}
            />
          </Field>
          <Field label="Billing Name" htmlFor="tx-billing" error={errors.billingName} required>
            <Input
              id="tx-billing"
              name="billingName"
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
              placeholder={member?.name ?? "Ada Lovelace"}
              maxLength={140}
              invalid={!!errors.billingName}
            />
          </Field>
          <Field label="Currency" htmlFor="tx-currency" error={errors.currency} hint={errors.currency ? undefined : "The currency the amounts are in."} required>
            <Select id="tx-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Original Amount" htmlFor="tx-original" error={errors.originalAmount}>
            <Input id="tx-original" name="originalAmount" type="number" min={0} step="0.01" value={original} onChange={(e) => setOriginal(e.target.value)} placeholder="0" invalid={!!errors.originalAmount} />
          </Field>
          <Field label="Discount Amount" htmlFor="tx-discount" error={errors.discountAmount}>
            <Input id="tx-discount" name="discountAmount" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" invalid={!!errors.discountAmount} />
          </Field>
          <Field label="Tax Amount" htmlFor="tx-tax" error={errors.taxAmount}>
            <Input id="tx-tax" name="taxAmount" type="number" min={0} step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" invalid={!!errors.taxAmount} />
          </Field>
          <Field label="Coupon" htmlFor="tx-coupon" error={errors.couponId} hint={errors.couponId ? undefined : "The coupon this payment was discounted by."}>
            <Select
              id="tx-coupon"
              name="couponId"
              defaultValue=""
              options={[{ value: "", label: "No coupon" }, ...coupons.map((c) => ({ value: c.id, label: c.enabled ? c.code : `${c.code} (disabled)` }))]}
            />
          </Field>
          <Field label="Payment ID" htmlFor="tx-payment-id" error={errors.gatewayPaymentId} hint={errors.gatewayPaymentId ? undefined : "Bank or provider reference, if any."}>
            <Input id="tx-payment-id" name="gatewayPaymentId" maxLength={120} className="font-mono" invalid={!!errors.gatewayPaymentId} />
          </Field>
          <Field label="Source" htmlFor="tx-source" error={errors.source} hint={errors.source ? undefined : "Where the learner came from."}>
            <Input id="tx-source" name="source" maxLength={80} placeholder="Bank transfer" invalid={!!errors.source} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
          <span className="text-sm text-ink-muted">Total</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{money(total, currency)}</span>
        </div>

        <div className="rounded-xl border border-border p-4">
          <Switch
            id="tx-received"
            name="received"
            checked={received}
            onChange={(e) => setReceived(e.target.checked)}
            label="Received"
            description={
              received
                ? "The payment has arrived: the order is marked as paid and the member gets access right away."
                : "Record the order as unpaid. Mark it as paid later from its transaction."
            }
          />
        </div>
      </form>
    </Dialog>
  );
}

/** Bulk "Send reminders" for unpaid orders (only offered when payment reminders are on). */
export function SendRemindersButton({ count }: { count: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" leftIcon={<Icon.Bell className="size-4" />} onClick={() => setOpen(true)} disabled={count === 0} title={count === 0 ? "No unpaid orders from the last 7 days" : undefined}>
        Send reminders
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        onConfirm={() =>
          startTransition(async () => {
            const res = await sendPaymentRemindersAction();
            if (res.ok) {
              toast.success(res.message ?? "Reminders sent");
              setOpen(false);
            } else toast.error(res.error);
          })
        }
        loading={busy}
        title="Send payment reminders?"
        description={`Learners with an unpaid order from the last 7 days (${count} ${count === 1 ? "order" : "orders"}) get a notification asking them to complete their enrollment. Orders reminded in the last 24 hours, learners who already have access and sold-out batches are skipped.`}
        confirmLabel="Send reminders"
      />
    </>
  );
}
