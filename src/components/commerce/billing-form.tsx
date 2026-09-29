"use client";

import { useState } from "react";
import type { PaymentItemType, Settings } from "@/lib/types";
import { placeOrderAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { BILLING_SOURCES, COUNTRIES, INDIAN_STATES } from "./countries";
import { launchStatusLabel, useCheckoutLauncher, usePreloadRazorpay } from "./checkout-launcher";

export interface BillingDefaults {
  billingName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gstin: string;
  pan: string;
  source: string;
}

type Gateway = Settings["commerce"]["paymentGateway"];

const GATEWAY_NAME: Record<Gateway, string> = { none: "", manual: "Manual payment", stripe: "Stripe", razorpay: "Razorpay" };

/**
 * Billing details + payment section of the checkout page. Submits to
 * `placeOrderAction`, which validates everything again and computes the
 * amount on the server. Free and manual orders redirect to the order page;
 * Stripe returns its hosted checkout URL and Razorpay the options for its
 * payment window, which `useCheckoutLauncher` opens.
 */
export function BillingForm({
  itemType,
  itemId,
  couponCode,
  expectedTotal,
  totalLabel,
  gateway,
  gatewayReady,
  gatewayMode,
  applyTax,
  taxLabel,
  defaults,
  contactEmail,
}: {
  itemType: PaymentItemType;
  itemId: string;
  couponCode: string;
  expectedTotal: number;
  totalLabel: string;
  gateway: Gateway;
  /** False when the active gateway is Stripe/Razorpay but its keys are missing. */
  gatewayReady: boolean;
  gatewayMode: "test" | "live" | null;
  applyTax: boolean;
  taxLabel: string;
  defaults: BillingDefaults;
  contactEmail?: string;
}) {
  const [country, setCountry] = useState(defaults.country);
  const launcher = useCheckoutLauncher();
  const { onSubmit, pending, errors, formError } = useFormAction(placeOrderAction, {
    toastSuccess: false,
    toastError: false,
    onSuccess: (result) => void launcher.launch(result.data),
  });
  const free = expectedTotal <= 0 || gateway === "none";
  const online = !free && (gateway === "stripe" || gateway === "razorpay");
  const unavailable = online && !gatewayReady;
  usePreloadRazorpay(!free && gateway === "razorpay" && gatewayReady);
  const india = country === "India";
  const busy = pending || launcher.busy;
  const statusLabel = launchStatusLabel(launcher.status, GATEWAY_NAME[gateway] || "payment");

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="billing-address-heading">
      <input type="hidden" name="itemType" value={itemType} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="coupon" value={couponCode} />
      <input type="hidden" name="expectedTotal" value={expectedTotal} />

      <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
        <h2 id="billing-address-heading" className="text-lg font-semibold text-ink">
          Address
        </h2>
        {formError && !Object.keys(errors).length && (
          <div className="mt-4">
            <FormError message={formError} />
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Field label="Billing Name" htmlFor="billingName" error={errors.billingName} required>
              <Input id="billingName" name="billingName" defaultValue={defaults.billingName} autoComplete="name" maxLength={140} invalid={!!errors.billingName} />
            </Field>
            <Field label="Address Line 1" htmlFor="line1" error={errors.line1} required>
              <Input id="line1" name="line1" defaultValue={defaults.line1} autoComplete="address-line1" maxLength={200} invalid={!!errors.line1} />
            </Field>
            <Field label="Address Line 2" htmlFor="line2" error={errors.line2}>
              <Input id="line2" name="line2" defaultValue={defaults.line2} autoComplete="address-line2" maxLength={200} invalid={!!errors.line2} />
            </Field>
            <Field label="City" htmlFor="city" error={errors.city} required>
              <Input id="city" name="city" defaultValue={defaults.city} autoComplete="address-level2" maxLength={100} invalid={!!errors.city} />
            </Field>
            <Field label="State/Province" htmlFor="state" error={errors.state} required={india}>
              {india ? (
                <Select
                  key="state-india"
                  id="state"
                  name="state"
                  defaultValue={INDIAN_STATES.find((s) => s.toLowerCase() === defaults.state.toLowerCase()) ?? ""}
                  placeholder="Select a state"
                  options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                  invalid={!!errors.state}
                />
              ) : (
                <Input key="state-text" id="state" name="state" defaultValue={defaults.state} autoComplete="address-level1" maxLength={100} invalid={!!errors.state} />
              )}
            </Field>
          </div>
          <div className="space-y-4">
            <Field label="Country" htmlFor="country" error={errors.country} required>
              <Select
                id="country"
                name="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Select your country"
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                autoComplete="country-name"
                invalid={!!errors.country}
              />
            </Field>
            <Field label="Postal Code" htmlFor="pincode" error={errors.pincode}>
              <Input id="pincode" name="pincode" defaultValue={defaults.pincode} autoComplete="postal-code" maxLength={12} invalid={!!errors.pincode} />
            </Field>
            <Field label="Where did you hear about us?" htmlFor="source" error={errors.source} required>
              <Select
                id="source"
                name="source"
                defaultValue={defaults.source}
                placeholder="Select an option"
                options={BILLING_SOURCES.map((s) => ({ value: s, label: s }))}
                invalid={!!errors.source}
              />
            </Field>
            {applyTax && (
              <>
                <Field label="GST Number" htmlFor="gstin" error={errors.gstin} hint={errors.gstin ? undefined : `Optional. Add it to claim ${taxLabel} input credit.`}>
                  <Input id="gstin" name="gstin" defaultValue={defaults.gstin} maxLength={15} className="font-mono uppercase" invalid={!!errors.gstin} />
                </Field>
                <Field label="PAN Number" htmlFor="pan" error={errors.pan} hint={errors.pan ? undefined : "Required when you enter a GST number."}>
                  <Input id="pan" name="pan" defaultValue={defaults.pan} maxLength={10} className="font-mono uppercase" invalid={!!errors.pan} />
                </Field>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Payment</h2>
          {online && gatewayReady && gatewayMode === "test" && (
            <Badge tone="warning" dot>
              Test mode
            </Badge>
          )}
        </div>
        {free ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
            <Icon.Gift className="mt-0.5 size-4 shrink-0 text-success" />
            {expectedTotal <= 0 ? "Your discount covers the full price — no payment is needed." : "No payment is collected for this order. You'll get access right away."}
          </p>
        ) : gateway === "manual" ? (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Receipt className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                Place your order and we&apos;ll share the payment details on the next page. Your access is activated as soon as an administrator confirms the payment of{" "}
                <strong className="text-ink">{totalLabel}</strong>.
              </span>
            </p>
            {contactEmail && (
              <p className="pl-6 text-xs">
                Questions? Write to{" "}
                <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline">
                  {contactEmail}
                </a>
                .
              </p>
            )}
          </div>
        ) : unavailable ? (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>
              Online payments are unavailable right now. Please try again later
              {contactEmail ? (
                <>
                  {" "}
                  or write to{" "}
                  <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline">
                    {contactEmail}
                  </a>
                </>
              ) : null}
              .
            </span>
          </div>
        ) : gateway === "stripe" ? (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Lock className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                You&apos;ll continue to Stripe&apos;s secure checkout to pay <strong className="text-ink">{totalLabel}</strong> by card or wallet. Card details never touch our
                servers.
              </span>
            </p>
            {gatewayMode === "test" && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
                <Icon.Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  Test mode: no real money moves. Pay with card <span className="font-mono">4242 4242 4242 4242</span>, any future expiry date and any CVC.
                </span>
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Lock className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                Pay <strong className="text-ink">{totalLabel}</strong> securely with Razorpay — cards, UPI, netbanking or wallets. A secure payment window opens after you place
                the order.
              </span>
            </p>
            {gatewayMode === "test" && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
                <Icon.Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>Test mode: no real money moves. Use Razorpay&apos;s test cards or the &ldquo;success&rdquo; option in test UPI/netbanking.</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Checkbox id="consent" name="consent" label="I consent to my personal information being stored for invoicing" aria-invalid={!!errors.consent || undefined} />
            {errors.consent && <p className="mt-1.5 pl-6.5 text-xs text-danger">{errors.consent}</p>}
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
            <Button
              type="submit"
              loading={busy}
              disabled={unavailable}
              className="w-full sm:w-auto"
              leftIcon={free ? undefined : online ? <Icon.Lock className="size-4" /> : <Icon.Receipt className="size-4" />}
            >
              {free ? "Enroll for Free" : gateway === "manual" ? `Place order · ${totalLabel}` : gateway === "stripe" ? `Continue to payment · ${totalLabel}` : `Pay ${totalLabel}`}
            </Button>
            {statusLabel && (
              <p className="text-xs text-ink-muted" role="status" aria-live="polite">
                {statusLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
