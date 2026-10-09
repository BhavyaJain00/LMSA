"use client";

import { useState, type ReactNode } from "react";
import type { Settings } from "@/lib/types";
import type { GatewayStatusView } from "@/lib/payments/types";
import { savePaymentGatewaySettingsAction } from "@/lib/actions/payments";
import { currencies } from "@/lib/config";
import { Input, RadioCard, Select, Switch, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "./settings-ui";
import { SaveBar } from "./save-bar";
import { useFormAction } from "./use-form-action";
import { useT } from "@/i18n/client";

type Gateway = Settings["commerce"]["paymentGateway"];

interface GatewayChoice {
  value: Gateway;
  title: string;
  description: string;
  icon: ReactNode;
  /** Problem that keeps this gateway from being selected (keys missing). */
  blocked?: string;
}

type AdminT = ReturnType<typeof useT<"admin">>;

function gatewayChoices(statuses: GatewayStatusView[], t: AdminT): GatewayChoice[] {
  const status = (g: "stripe" | "razorpay") => statuses.find((s) => s.gateway === g);
  const describe = (g: "stripe" | "razorpay", text: string) => {
    const s = status(g);
    if (!s?.configured) return `${text} ${t("paymentsForm.gateway.unavailable", { reason: s?.missing[0] ?? t("paymentsForm.gateway.keysMissing") })}`;
    return `${text} ${s.mode === "live" ? t("paymentsForm.gateway.live") : t("paymentsForm.gateway.test")}`;
  };
  return [
    {
      value: "manual",
      title: t("paymentsForm.gateway.manualTitle"),
      description: t("paymentsForm.gateway.manualDescription"),
      icon: <Icon.Receipt className="size-5" />,
    },
    {
      value: "stripe",
      title: "Stripe",
      description: describe("stripe", t("paymentsForm.gateway.stripeDescription")),
      icon: <Icon.CreditCard className="size-5" />,
      blocked: status("stripe")?.configured ? undefined : (status("stripe")?.missing[0] ?? t("paymentsForm.gateway.notConfigured", { gateway: "Stripe" })),
    },
    {
      value: "razorpay",
      title: "Razorpay",
      description: describe("razorpay", t("paymentsForm.gateway.razorpayDescription")),
      icon: <Icon.CreditCard className="size-5" />,
      blocked: status("razorpay")?.configured ? undefined : (status("razorpay")?.missing[0] ?? t("paymentsForm.gateway.notConfigured", { gateway: "Razorpay" })),
    },
    {
      value: "none",
      title: t("paymentsForm.gateway.noneTitle"),
      description: t("paymentsForm.gateway.noneDescription"),
      icon: <Icon.Gift className="size-5" />,
    },
  ];
}

export function PaymentsForm({ initial, gateways }: { initial: Settings["commerce"]; gateways: GatewayStatusView[] }) {
  const t = useT("admin");
  const { onSubmit, pending, errors, dirty, markDirty, state } = useFormAction(savePaymentGatewaySettingsAction);
  const [gateway, setGateway] = useState<Gateway>(initial.paymentGateway);
  const [applyTax, setApplyTax] = useState(initial.applyTax);
  const choices = gatewayChoices(gateways, t);
  const selectedBlocked = choices.find((c) => c.value === gateway)?.blocked;

  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-6">
      <SettingsSection title={t("paymentsForm.config.title")}>
        <SettingsRow label={t("paymentsForm.currency.label")} description={t("paymentsForm.currency.description")} htmlFor="defaultCurrency" error={errors.defaultCurrency}>
          <Select id="defaultCurrency" name="defaultCurrency" defaultValue={initial.defaultCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
        </SettingsRow>
        <SettingsSwitchRow>
          <Switch
            name="showUsdEquivalent"
            defaultChecked={initial.showUsdEquivalent}
            label={t("paymentsForm.usd.label")}
            description={t("paymentsForm.usd.description")}
          />
        </SettingsSwitchRow>
        <SettingsSwitchRow>
          <Switch name="applyRounding" defaultChecked={initial.applyRounding} label={t("paymentsForm.rounding.label")} description={t("paymentsForm.rounding.description")} />
        </SettingsSwitchRow>
      </SettingsSection>

      <SettingsSection title={t("paymentsForm.gateway.title")} description={t("paymentsForm.gateway.description")}>
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-5" role="radiogroup" aria-label={t("paymentsForm.gateway.label")}>
          {choices.map((g) => (
            <RadioCard
              key={g.value}
              name="paymentGateway"
              value={g.value}
              checked={gateway === g.value}
              disabled={!!g.blocked && gateway !== g.value}
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
        {selectedBlocked && !errors.paymentGateway && (
          <p role="alert" className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-ink sm:mx-5">
            <Icon.AlertTriangle className="mt-px size-3.5 shrink-0 text-danger" />
            {t("paymentsForm.gateway.blocked", { reason: selectedBlocked })}
          </p>
        )}
        {errors.paymentGateway && <p className="px-5 pb-3 text-xs text-danger">{errors.paymentGateway}</p>}
      </SettingsSection>

      <SettingsSection title={t("paymentsForm.methods.title")} description={t("paymentsForm.methods.description")}>
        {(["razorpay", "stripe", "manual"] as const).map((id) => {
          const s = id === "manual" ? null : gateways.find((g) => g.gateway === id);
          const main = gateway === id;
          const state =
            id === "manual"
              ? null
              : s?.configured
                ? s.mode === "test"
                  ? t("paymentsForm.methods.readyTest")
                  : t("paymentsForm.methods.ready")
                : t("paymentsForm.methods.needsKeys", { missing: s?.missing.join(", ") || "API keys" });
          const good = main || id === "manual" || !!s?.configured;
          return (
            <SettingsSwitchRow key={id}>
              <Switch
                name={"method_" + id}
                defaultChecked={initial.paymentMethods?.[id] ?? true}
                disabled={main}
                label={t(("paymentsForm.methods." + id) as "paymentsForm.methods.manual")}
                description={
                  <>
                    {t(("paymentsForm.methods." + id + "Description") as "paymentsForm.methods.manualDescription")}
                    {(main || state) && <span className={"mt-1 block text-xs font-medium " + (good ? "text-success" : "text-warning")}>{main ? t("paymentsForm.methods.main") : state}</span>}
                  </>
                }
              />
              {main && <input type="hidden" name={"method_" + id} value="on" />}
            </SettingsSwitchRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title={t("paymentsForm.manual.title")} description={t("paymentsForm.manual.description")}>
        <SettingsRow label={t("paymentsForm.manual.instructions")} description={t("paymentsForm.manual.instructionsHint")} htmlFor="manualInstructions" error={errors.manualInstructions}>
          <Textarea id="manualInstructions" name="manualInstructions" rows={3} maxLength={600} defaultValue={initial.manualPayment?.instructions ?? ""} invalid={!!errors.manualInstructions} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.accountName")} htmlFor="manualAccountName" error={errors.manualAccountName}>
          <Input id="manualAccountName" name="manualAccountName" maxLength={120} defaultValue={initial.manualPayment?.accountName ?? ""} invalid={!!errors.manualAccountName} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.bankName")} htmlFor="manualBankName" error={errors.manualBankName}>
          <Input id="manualBankName" name="manualBankName" maxLength={120} defaultValue={initial.manualPayment?.bankName ?? ""} invalid={!!errors.manualBankName} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.accountNumber")} htmlFor="manualAccountNumber" error={errors.manualAccountNumber}>
          <Input id="manualAccountNumber" name="manualAccountNumber" maxLength={40} className="font-mono" dir="ltr" defaultValue={initial.manualPayment?.accountNumber ?? ""} invalid={!!errors.manualAccountNumber} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.ifsc")} htmlFor="manualIfsc" error={errors.manualIfsc}>
          <Input id="manualIfsc" name="manualIfsc" maxLength={20} className="font-mono uppercase" dir="ltr" defaultValue={initial.manualPayment?.ifsc ?? ""} invalid={!!errors.manualIfsc} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.swift")} htmlFor="manualSwift" error={errors.manualSwift}>
          <Input id="manualSwift" name="manualSwift" maxLength={11} className="font-mono uppercase" dir="ltr" defaultValue={initial.manualPayment?.swift ?? ""} invalid={!!errors.manualSwift} />
        </SettingsRow>
        <SettingsRow label={t("paymentsForm.manual.upiId")} description={t("paymentsForm.manual.upiHint")} htmlFor="manualUpiId" error={errors.manualUpiId}>
          <Input id="manualUpiId" name="manualUpiId" maxLength={100} className="font-mono" dir="ltr" placeholder="school@okbank" defaultValue={initial.manualPayment?.upiId ?? ""} invalid={!!errors.manualUpiId} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("paymentsForm.tax.title")}>
        <SettingsSwitchRow>
          <Switch
            name="applyTax"
            checked={applyTax}
            onChange={(e) => setApplyTax(e.target.checked)}
            label={t("paymentsForm.tax.label")}
            description={t("paymentsForm.tax.description")}
          />
        </SettingsSwitchRow>
        <SettingsRow label={t("paymentsForm.taxPercentage.label")} description={t("paymentsForm.taxPercentage.description")} htmlFor="taxPercentage" error={errors.taxPercentage} required={applyTax}>
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
        <SettingsRow label={t("paymentsForm.taxLabel.label")} description={t("paymentsForm.taxLabel.description")} htmlFor="taxLabel" error={errors.taxLabel} required={applyTax}>
          <Input id="taxLabel" name="taxLabel" defaultValue={initial.taxLabel} maxLength={30} placeholder={t("paymentsForm.taxLabel.placeholder")} invalid={!!errors.taxLabel} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("paymentsForm.reminders.title")}>
        <SettingsSwitchRow>
          <Switch
            name="sendPaymentReminders"
            defaultChecked={initial.sendPaymentReminders}
            label={t("paymentsForm.reminders.label")}
            description={t("paymentsForm.reminders.description")}
          />
        </SettingsSwitchRow>
      </SettingsSection>

      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}
