"use client";

import { useState, type ReactNode } from "react";
import type { Settings } from "@/lib/types";
import { savePaymentSettingsAction } from "@/lib/actions/settings";
import { currencies } from "@/lib/config";
import { Input, RadioCard, Select, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";

type Gateway = Settings["commerce"]["paymentGateway"];

const GATEWAYS: { value: Gateway; title: string; description: string; icon: ReactNode }[] = [
  {
    value: "manual",
    title: "Manual payment",
    description: "Learners place an order and pay offline (bank transfer, invoice). Confirm payments in Transactions to enroll them.",
    icon: <Icon.Receipt className="size-5" />,
  },
  {
    value: "stripe",
    title: "Stripe (test mode)",
    description: "Checkout shows a 'Test payment' button that simulates a successful card payment.",
    icon: <Icon.CreditCard className="size-5" />,
  },
  {
    value: "razorpay",
    title: "Razorpay (test mode)",
    description: "Checkout shows a 'Test payment' button that simulates a successful Razorpay payment.",
    icon: <Icon.CreditCard className="size-5" />,
  },
  {
    value: "none",
    title: "No payment gateway",
    description: "Payment is not collected: paid items are granted as soon as the learner checks out.",
    icon: <Icon.Gift className="size-5" />,
  },
];

export function PaymentsForm({ initial }: { initial: Settings["commerce"] }) {
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(savePaymentSettingsAction);
  const [gateway, setGateway] = useState<Gateway>(initial.paymentGateway);
  const [applyTax, setApplyTax] = useState(initial.applyTax);

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title="Configuration">
        <SettingsRow label="Default Currency" description="Default currency used for new course and batch prices." htmlFor="defaultCurrency" error={errors.defaultCurrency}>
          <Select id="defaultCurrency" name="defaultCurrency" defaultValue={initial.defaultCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
        </SettingsRow>
        <SettingsSwitchRow>
          <Switch
            name="showUsdEquivalent"
            defaultChecked={initial.showUsdEquivalent}
            label="Show USD equivalent amount"
            description="If enabled, checkout shows an approximate USD equivalent for prices in other currencies."
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch name="applyRounding" defaultChecked={initial.applyRounding} label="Apply rounding on equivalent" description="If enabled, the USD equivalent is rounded up to the next whole dollar." />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title="Payment Gateway" description="Payment gateway used to process course, batch and certificate purchases.">
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-5" role="radiogroup" aria-label="Payment gateway">
          {GATEWAYS.map((g) => (
            <RadioCard
              key={g.value}
              name="paymentGateway"
              value={g.value}
              checked={gateway === g.value}
              onChange={(v) => {
                setGateway(v as Gateway);
                markDirty();
              }}
              title={g.title}
              description={g.description}
              icon={g.icon}
            />
          ))}
        </div>
        {errors.paymentGateway && <p className="px-5 pb-3 text-xs text-danger">{errors.paymentGateway}</p>}
      </SettingsSection>

      <SettingsSection title="Tax">
        <SettingsSwitchRow>
          <Switch
            name="applyTax"
            checked={applyTax}
            onChange={(e) => setApplyTax(e.target.checked)}
            label="Apply tax"
            description="If enabled, tax is added to every order total and checkout asks for GSTIN / PAN (optional)."
          />
        </SettingsSwitchRow>
        <SettingsRow label="Tax percentage" description="Percentage added on top of the discounted price." htmlFor="taxPercentage" error={errors.taxPercentage} required={applyTax}>
          <Input
            id="taxPercentage"
            name="taxPercentage"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={initial.taxPercentage}
            rightAddon={<span className="text-xs">%</span>}
            invalid={!!errors.taxPercentage}
          />
        </SettingsRow>
        <SettingsRow label="Tax label" description="Shown in the order summary, e.g. GST or VAT." htmlFor="taxLabel" error={errors.taxLabel} required={applyTax}>
          <Input id="taxLabel" name="taxLabel" defaultValue={initial.taxLabel} maxLength={30} placeholder="GST" invalid={!!errors.taxLabel} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Payment Reminders">
        <SettingsSwitchRow>
          <Switch
            name="sendPaymentReminders"
            defaultChecked={initial.sendPaymentReminders}
            label="Send payment reminders"
            description="If enabled, learners who left an order unpaid are reminded to complete their enrollment."
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} />
    </form>
  );
}
