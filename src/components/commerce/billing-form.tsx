"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ActionResult, PaymentItemType, Settings } from "@/lib/types";
import type { CheckoutNext } from "@/lib/payments/types";
import { placeOrderAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { LegalAgreement } from "@/components/legal/legal-agreement";
import type { AgreementLink } from "@/lib/legal/agreement";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { BILLING_SOURCES, COUNTRIES, INDIAN_STATES } from "./countries";
import { launchStatusLabel, useCheckoutLauncher, usePreloadRazorpay } from "./checkout-launcher";
import { setOrderBumpTicked } from "./order-bump-summary";
import { normalizeVatId } from "@/lib/commerce/vat-id";
import { validateVatId } from "@/lib/payments/billing-input";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/catalog";

/** Labels of the stored "where did you hear about us" values (the values stay English). */
const SOURCE_KEYS: Record<(typeof BILLING_SOURCES)[number], MessageKey<"account">> = {
  "Search engine": "commerce.billing.sources.search",
  "Social media": "commerce.billing.sources.social",
  "Friend or colleague": "commerce.billing.sources.friend",
  Newsletter: "commerce.billing.sources.newsletter",
  "Blog or article": "commerce.billing.sources.blog",
  "Event or webinar": "commerce.billing.sources.event",
  Advertisement: "commerce.billing.sources.ad",
  Other: "commerce.billing.sources.other",
};

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
  /** The buyer's VAT / tax number; with by-country tax, the one the summary was priced for. */
  vatId?: string;
  source: string;
}

type Gateway = Settings["commerce"]["paymentGateway"];

/** What the buyer signs up for when the item is a membership plan (computed on the server). */
export interface MembershipCheckoutTerms {
  planName: string;
  /** Billed every month/year (false for lifetime plans). */
  recurring: boolean;
  /** Free days before the first charge for this buyer (0 = charged now). */
  trialDays: number;
  /** Price per period, e.g. "$19.00/month" (the plain price for lifetime plans), already in the buyer's language. */
  periodLabel: string;
  /** "month", "year" or "lifetime". */
  intervalNoun: string;
  /** Formatted date of the first charge when there is a trial. */
  firstChargeOn: string | null;
  /** The gateway charges every period by itself (Stripe, Razorpay). */
  automaticRenewal: boolean;
}

/** Set when the buyer chose to pay a course in installments (computed on the server). */
export interface InstallmentCheckoutTerms {
  /** Number of payments. */
  count: number;
  /** "every 30 days", "every week", already in the buyer's language. */
  interval: string;
  /** Stripe charges the remaining payments by itself; otherwise the buyer pays each one from a reminder. */
  automatic: boolean;
}

/** An order bump offered on this checkout (computed on the server). */
export interface OrderBumpView {
  upsellId: string;
  headline: string;
  title: string;
  href: string;
  /** Offer price after the upsell discount, tax included (smallest unit). */
  amount: number;
  priceLabel: string;
  /** List price, shown struck through when there is a discount. */
  listPriceLabel: string | null;
  discountPercent: number;
  /** What the checkout charges with the bump ticked, e.g. "$129.00". */
  totalWithBumpLabel: string;
}

/** Brand names of the gateways that open a checkout (the manual and free flows never launch one). */
const GATEWAY_NAME: Record<Gateway, string | null> = { none: null, manual: null, stripe: "Stripe", razorpay: "Razorpay" };

type CheckoutAction = (prev: ActionResult<CheckoutNext> | null, formData: FormData) => Promise<ActionResult<CheckoutNext>>;

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
  currency,
  repriceOnCountry = false,
  expectedTotal,
  totalLabel,
  gateway,
  gatewayReady,
  gatewayMode,
  applyTax,
  taxLabel,
  defaults,
  contactEmail,
  legal = [],
  membership = null,
  installments = null,
  bump = null,
  action = placeOrderAction,
  extraFields,
  gift = false,
  reverseCharge = false,
}: {
  itemType: PaymentItemType;
  itemId: string;
  couponCode: string;
  /** Currency the summary was priced in (the buyer's choice when the item has a fixed price in it). */
  currency?: string;
  /** Tax depends on the buyer's country: picking another country re-prices the summary (`?country=`). */
  repriceOnCountry?: boolean;
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
  /** Published terms, refund and privacy pages (`agreementDocuments("checkout", await legalLinks())`). */
  legal?: AgreementLink[];
  /** Set when the item is a membership plan: changes the payment wording and the submit label. */
  membership?: MembershipCheckoutTerms | null;
  /** Set when the order is the first payment of a plan: `expectedTotal` and `totalLabel` are one payment. */
  installments?: InstallmentCheckoutTerms | null;
  /** An order bump the buyer can tick: added to the same payment at its offer price. */
  bump?: OrderBumpView | null;
  /** Server Action that places the order (the gift checkout uses its own). */
  action?: CheckoutAction;
  /** Fields shown above the address (e.g. the gift recipient), given the field errors of the last submit. */
  extraFields?: (errors: Record<string, string>) => ReactNode;
  /** The order is a gift for someone else: changes the payment wording. */
  gift?: boolean;
  /** EU reverse charge applies to the priced summary (no VAT for this business buyer). */
  reverseCharge?: boolean;
}) {
  const t = useT("account");
  const [country, setCountry] = useState(defaults.country);
  const router = useRouter();
  const pathname = usePathname();
  const [repricing, startRepricing] = useTransition();
  // VAT number: with by-country tax it can remove VAT (EU reverse charge), so the summary is re-priced for it (`?vat=`).
  const pricedVat = normalizeVatId(defaults.vatId);
  const [vat, setVat] = useState(defaults.vatId ?? "");
  const [vatHint, setVatHint] = useState<string | null>(null);
  const [vatRepriced, setVatRepriced] = useState(false);
  const vatChanged = repriceOnCountry && normalizeVatId(vat) !== pricedVat;
  const repriceForVat = (): boolean => {
    if (!vatChanged) return false;
    const value = normalizeVatId(vat);
    const query = new URLSearchParams(window.location.search);
    query.set("vat", value);
    if (country) query.set("country", country);
    startRepricing(() => router.replace(`${pathname}?${query}`, { scroll: false }));
    return true;
  };
  const changeCountry = (value: string) => {
    setCountry(value);
    setVatHint(null);
    if (!repriceOnCountry) return;
    const query = new URLSearchParams(window.location.search);
    if (value) query.set("country", value);
    else query.delete("country");
    // The VAT number typed so far is priced together with the new country.
    if (vatChanged) query.set("vat", normalizeVatId(vat));
    startRepricing(() => router.replace(`${pathname}?${query}`, { scroll: false }));
  };
  const checkVat = () => {
    setVatHint(validateVatId(vat, country));
    repriceForVat();
  };
  const [withBump, setWithBump] = useState(false);
  const launcher = useCheckoutLauncher();
  const { onSubmit: submitOrder, pending, errors, formError } = useFormAction(action, {
    toastSuccess: false,
    toastError: false,
    onSuccess: (result) => void launcher.launch(result.data),
  });
  // A VAT number typed but not priced yet (e.g. Enter pressed in the field): price it first, then let the buyer confirm.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (repriceForVat()) {
      e.preventDefault();
      setVatRepriced(true);
      return;
    }
    setVatRepriced(false);
    submitOrder(e);
  };
  const bumped = !!bump && withBump;
  const free = (expectedTotal <= 0 && !bumped) || gateway === "none";
  const online = !free && (gateway === "stripe" || gateway === "razorpay");
  const unavailable = online && !gatewayReady;
  usePreloadRazorpay(!free && gateway === "razorpay" && gatewayReady);
  const india = country === "India";
  const busy = pending || launcher.busy || repricing;
  const statusLabel = launchStatusLabel(launcher.status, GATEWAY_NAME[gateway], t);
  // What the order charges today, with the order bump when it is ticked.
  const payLabel = bumped ? bump.totalWithBumpLabel : totalLabel;
  const trial = !!membership && membership.trialDays > 0 && !free;
  const renews = !!membership?.recurring;
  const later = installments ? installments.count - 1 : 0;
  const installmentLine = installments
    ? t(installments.automatic ? "commerce.billing.installmentsAuto" : "commerce.billing.installmentsManual", { amount: totalLabel, count: later, interval: installments.interval })
    : null;
  // What the gateway collects, in the buyer's words.
  const chargeLine = trial
    ? t("commerce.billing.trialLine", { days: membership.trialDays, date: membership.firstChargeOn ?? "", period: membership.periodLabel })
    : renews
      ? t("commerce.billing.renewLine", { amount: totalLabel, period: membership.periodLabel })
      : installments?.automatic
        ? installmentLine
        : null;
  const submitLabel = gift
    ? free
      ? t("commerce.billing.submit.sendGift")
      : gateway === "manual"
        ? t("commerce.billing.submit.placeGift", { amount: payLabel })
        : gateway === "stripe"
          ? t("commerce.billing.submit.continue", { amount: payLabel })
          : t("commerce.billing.submit.pay", { amount: payLabel })
    : installments && !free
      ? gateway === "manual"
        ? t("commerce.billing.submit.placeToday", { amount: totalLabel })
        : gateway === "stripe"
          ? t("commerce.billing.submit.continueToday", { amount: totalLabel })
          : t("commerce.billing.submit.payToday", { amount: totalLabel })
      : free
        ? membership
          ? t("commerce.billing.submit.startMembership")
          : t("commerce.billing.submit.enrollFree")
        : trial
          ? t("commerce.billing.submit.startTrial", { days: membership.trialDays })
          : renews
            ? gateway === "manual"
              ? t("commerce.billing.submit.placeOrder", { amount: membership.periodLabel })
              : t("commerce.billing.submit.subscribe", { amount: membership.periodLabel })
            : gateway === "manual"
              ? t("commerce.billing.submit.placeOrder", { amount: payLabel })
              : gateway === "stripe"
                ? t("commerce.billing.submit.continue", { amount: payLabel })
                : t("commerce.billing.submit.pay", { amount: payLabel });
  const bold = (text: ReactNode) => <strong className="text-ink">{text}</strong>;
  const mailLink = (text: ReactNode) => (
    <a href={`mailto:${contactEmail}`} className="font-medium text-accent hover:underline" dir="ltr">
      {text}
    </a>
  );

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="billing-address-heading">
      <input type="hidden" name="itemType" value={itemType} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="coupon" value={couponCode} />
      {currency && <input type="hidden" name="currency" value={currency} />}
      <input type="hidden" name="expectedTotal" value={expectedTotal} />
      {installments && <input type="hidden" name="paymentOption" value="installments" />}
      {bumped && (
        <>
          <input type="hidden" name="bump" value={bump.upsellId} />
          <input type="hidden" name="bumpExpected" value={bump.amount} />
        </>
      )}

      {extraFields?.(errors)}

      <div className={`rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6${extraFields ? " mt-5" : ""}`}>
        <h2 id="billing-address-heading" className="text-lg font-semibold text-ink">
          {gift ? t("commerce.billing.yourAddress") : t("commerce.billing.address")}
        </h2>
        {formError && !Object.keys(errors).length && (
          <div className="mt-4">
            <FormError message={formError} />
          </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <Field label={t("commerce.billing.billingName")} htmlFor="billingName" error={errors.billingName} required>
              <Input id="billingName" name="billingName" defaultValue={defaults.billingName} autoComplete="name" maxLength={140} invalid={!!errors.billingName} />
            </Field>
            <Field label={t("commerce.billing.line1")} htmlFor="line1" error={errors.line1} required>
              <Input id="line1" name="line1" defaultValue={defaults.line1} autoComplete="address-line1" maxLength={200} invalid={!!errors.line1} />
            </Field>
            <Field label={t("commerce.billing.line2")} htmlFor="line2" error={errors.line2}>
              <Input id="line2" name="line2" defaultValue={defaults.line2} autoComplete="address-line2" maxLength={200} invalid={!!errors.line2} />
            </Field>
            <Field label={t("commerce.billing.city")} htmlFor="city" error={errors.city} required>
              <Input id="city" name="city" defaultValue={defaults.city} autoComplete="address-level2" maxLength={100} invalid={!!errors.city} />
            </Field>
            <Field label={t("commerce.billing.state")} htmlFor="state" error={errors.state} required={india}>
              {india ? (
                <Select
                  key="state-india"
                  id="state"
                  name="state"
                  defaultValue={INDIAN_STATES.find((s) => s.toLowerCase() === defaults.state.toLowerCase()) ?? ""}
                  placeholder={t("commerce.billing.selectState")}
                  options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                  invalid={!!errors.state}
                />
              ) : (
                <Input key="state-text" id="state" name="state" defaultValue={defaults.state} autoComplete="address-level1" maxLength={100} invalid={!!errors.state} />
              )}
            </Field>
          </div>
          <div className="space-y-4">
            <Field label={t("commerce.billing.country")} htmlFor="country" error={errors.country} required>
              <Select
                id="country"
                name="country"
                value={country}
                onChange={(e) => changeCountry(e.target.value)}
                placeholder={t("commerce.billing.selectCountry")}
                options={COUNTRIES.map((c) => ({ value: c, label: c }))}
                autoComplete="country-name"
                invalid={!!errors.country}
                aria-describedby={repriceOnCountry ? "country-tax-note" : undefined}
              />
            </Field>
            {repriceOnCountry && (
              <p id="country-tax-note" className="-mt-2 flex items-center gap-1.5 text-xs text-ink-muted" aria-live="polite">
                {repricing ? <Icon.Refresh className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon.Info className="size-3.5" aria-hidden="true" />}
                {repricing ? t("commerce.billing.updatingTax") : t("commerce.billing.taxByCountry")}
              </p>
            )}
            <Field label={t("commerce.billing.postalCode")} htmlFor="pincode" error={errors.pincode}>
              <Input id="pincode" name="pincode" defaultValue={defaults.pincode} autoComplete="postal-code" maxLength={12} invalid={!!errors.pincode} />
            </Field>
            <Field label={t("commerce.billing.source")} htmlFor="source" error={errors.source} required>
              <Select
                id="source"
                name="source"
                defaultValue={defaults.source}
                placeholder={t("commerce.billing.selectOption")}
                options={BILLING_SOURCES.map((s) => ({ value: s, label: t(SOURCE_KEYS[s]) }))}
                invalid={!!errors.source}
              />
            </Field>
            <Field
              label={t("commerce.billing.vatId")}
              htmlFor="vatId"
              error={errors.vatId ?? vatHint ?? undefined}
              hint={errors.vatId || vatHint ? undefined : repriceOnCountry ? t("commerce.billing.vatIdReverseHint") : t("commerce.billing.vatIdHint")}
            >
              <Input
                id="vatId"
                name="vatId"
                value={vat}
                onChange={(e) => {
                  setVat(e.target.value);
                  setVatHint(null);
                }}
                onBlur={checkVat}
                maxLength={24}
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase"
                dir="ltr"
                invalid={!!(errors.vatId || vatHint)}
              />
            </Field>
            {repriceOnCountry && (repricing && vatChanged ? (
              <p className="-mt-2 flex items-center gap-1.5 text-xs text-ink-muted" aria-live="polite">
                <Icon.Refresh className="size-3.5 animate-spin" aria-hidden="true" />
                {t("commerce.billing.updatingVat")}
              </p>
            ) : reverseCharge && !vatChanged ? (
              <p className="-mt-2 flex items-start gap-1.5 text-xs text-success" role="status">
                <Icon.CheckCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {t("commerce.billing.reverseCharge")}
              </p>
            ) : null)}
            {applyTax && (
              <>
                <Field label={t("commerce.billing.gst")} htmlFor="gstin" error={errors.gstin} hint={errors.gstin ? undefined : t("commerce.billing.gstHint", { tax: taxLabel })}>
                  <Input id="gstin" name="gstin" defaultValue={defaults.gstin} maxLength={15} className="font-mono uppercase" dir="ltr" invalid={!!errors.gstin} />
                </Field>
                <Field label={t("commerce.billing.pan")} htmlFor="pan" error={errors.pan} hint={errors.pan ? undefined : t("commerce.billing.panHint")}>
                  <Input id="pan" name="pan" defaultValue={defaults.pan} maxLength={10} className="font-mono uppercase" dir="ltr" invalid={!!errors.pan} />
                </Field>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">{t("commerce.billing.payment")}</h2>
          {online && gatewayReady && gatewayMode === "test" && (
            <Badge tone="warning" dot>
              {t("commerce.billing.testMode")}
            </Badge>
          )}
        </div>
        {free ? (
          <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
            <Icon.Gift className="mt-0.5 size-4 shrink-0 text-success" />
            {membership ? t("commerce.billing.freeMembership") : expectedTotal <= 0 ? t("commerce.billing.freeDiscount") : t("commerce.billing.freeOrder")}
          </p>
        ) : gateway === "manual" ? (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Receipt className="mt-0.5 size-4 shrink-0 text-accent" />
              {trial ? (
                <span>{t.rich("commerce.billing.manualTrial", { amount: totalLabel, date: membership.firstChargeOn ?? "", b: bold })}</span>
              ) : (
                <span>
                  {t.rich(
                    gift ? "commerce.billing.manualGift" : membership ? "commerce.billing.manualMembership" : installments ? "commerce.billing.manualFirst" : "commerce.billing.manualAccess",
                    { amount: payLabel, b: bold },
                  )}
                  {installmentLine && <> {installmentLine}</>}
                </span>
              )}
            </p>
            {contactEmail && (
              <p className="ps-6 text-xs">{t.rich("commerce.billing.questions", { email: contactEmail, link: mailLink })}</p>
            )}
          </div>
        ) : unavailable ? (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>{contactEmail ? t.rich("commerce.billing.unavailableContact", { email: contactEmail, link: mailLink }) : t("commerce.billing.unavailable")}</span>
          </div>
        ) : gateway === "stripe" ? (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Lock className="mt-0.5 size-4 shrink-0 text-success" />
              {chargeLine ? (
                <span>{t.rich(trial ? "commerce.billing.stripeSave" : "commerce.billing.stripePayCharge", { charge: chargeLine, b: bold })}</span>
              ) : (
                <span>{t.rich("commerce.billing.stripePay", { amount: payLabel, b: bold })}</span>
              )}
            </p>
            {gatewayMode === "test" && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
                <Icon.Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  {t.rich("commerce.billing.stripeTest", {
                    code: (text) => (
                      <span className="font-mono" dir="ltr">
                        {text}
                      </span>
                    ),
                  })}
                </span>
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <p className="flex items-start gap-2">
              <Icon.Lock className="mt-0.5 size-4 shrink-0 text-success" />
              {chargeLine && !installments ? (
                <span>{t.rich(trial ? "commerce.billing.razorpayTrial" : "commerce.billing.razorpayRenew", { charge: chargeLine, b: bold })}</span>
              ) : (
                <span>
                  {t.rich("commerce.billing.razorpayPay", { amount: payLabel, b: bold })}
                  {installmentLine && <strong className="text-ink"> {installmentLine}</strong>}
                </span>
              )}
            </p>
            {gatewayMode === "test" && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
                <Icon.Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>{t("commerce.billing.razorpayTest")}</span>
              </p>
            )}
          </div>
        )}

        {bump && (
          <div className={`mt-5 rounded-xl border-2 border-dashed p-4 transition-colors ${withBump ? "border-success bg-success/8" : "border-accent/50 bg-accent/5"}`}>
            <label htmlFor="order-bump" className="flex cursor-pointer items-start gap-3">
              <input
                id="order-bump"
                type="checkbox"
                className="mt-1 size-5 shrink-0 cursor-pointer rounded border-border-strong accent-accent"
                checked={withBump}
                onChange={(e) => {
                  setWithBump(e.target.checked);
                  setOrderBumpTicked(e.target.checked);
                }}
                aria-describedby="order-bump-details"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{bump.headline}</span>
                <span id="order-bump-details" className="mt-1 block text-sm text-ink-muted">
                  {t.rich("commerce.billing.bumpAdd", { title: bump.title, price: bump.priceLabel, b: bold })}
                  {bump.listPriceLabel && (
                    <>
                      {" "}
                      <span className="line-through">{bump.listPriceLabel}</span>
                      {bump.discountPercent > 0 && <span className="ms-1 font-medium text-success">{t("commerce.billing.bumpOff", { percent: bump.discountPercent })}</span>}
                    </>
                  )}
                  . {t("commerce.billing.bumpOnePayment")}{" "}
                  <a href={bump.href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                    {t("commerce.billing.whatsIncluded")}
                  </a>
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Checkbox id="consent" name="consent" label={t("commerce.billing.consent")} aria-invalid={!!errors.consent || undefined} />
            {errors.consent && <p className="mt-1.5 ps-6.5 text-xs text-danger">{errors.consent}</p>}
            <LegalAgreement
              documents={legal}
              lead={membership ? t("commerce.billing.leadMembership") : free && !gift ? t("commerce.billing.leadEnroll") : t("commerce.billing.leadOrder")}
              className="mt-2 ps-6.5"
            />
          </div>
          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
            {vatRepriced && !repricing && (
              <p className="text-xs text-ink-muted" role="status">
                {t("commerce.billing.vatRepriced")}
              </p>
            )}
            <Button
              type="submit"
              loading={busy}
              disabled={unavailable}
              className="w-full sm:w-auto"
              leftIcon={free ? undefined : online ? <Icon.Lock className="size-4" /> : <Icon.Receipt className="size-4" />}
            >
              {submitLabel}
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
