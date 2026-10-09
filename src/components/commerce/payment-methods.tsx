"use client";

import { useState, type ReactNode } from "react";
import type { ManualPaymentDetails } from "@/lib/types";
import type { CheckoutMethodId, CheckoutMethodView } from "@/lib/payments/methods";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const GATEWAY_BRAND: Record<CheckoutMethodId, string | null> = { stripe: "Stripe", razorpay: "Razorpay", manual: null };

/** Small brand chips under each method (text marks, no third-party logos). */
const CHIPS: Record<CheckoutMethodId, string[]> = {
  razorpay: ["UPI", "GPay", "PhonePe", "Paytm", "Cards", "NetBanking", "Wallets", "EMI"],
  stripe: ["VISA", "Mastercard", "AMEX", "RuPay", "Apple Pay", "Google Pay"],
  manual: ["NEFT", "IMPS", "RTGS", "UPI"],
};

const ICONS: Record<CheckoutMethodId, ReactNode> = {
  razorpay: <Icon.Smartphone className="size-5" />,
  stripe: <Icon.CreditCard className="size-5" />,
  manual: <Icon.Building className="size-5" />,
};

/**
 * The buyer's choice of payment method: one large tile per method with what it accepts. Methods whose keys
 * are not set yet are shown as "Available soon" (administrators also see how to switch them on).
 */
export function PaymentMethodPicker({
  methods,
  value,
  onChange,
  showAdminHints = false,
  error,
}: {
  methods: CheckoutMethodView[];
  value: CheckoutMethodId | null;
  onChange: (id: CheckoutMethodId) => void;
  showAdminHints?: boolean;
  error?: string;
}) {
  const t = useT("account");
  return (
    <fieldset>
      <legend className="sr-only">{t("commerce.methods.label")}</legend>
      <div className="space-y-3" role="radiogroup" aria-invalid={!!error || undefined}>
        {methods.map((m) => {
          const checked = value === m.id;
          const brand = GATEWAY_BRAND[m.id];
          return (
            <label
              key={m.id}
              className={cn(
                "relative flex items-start gap-3.5 rounded-xl border p-4 transition-colors",
                !m.ready ? "cursor-not-allowed border-border bg-surface-2/50 opacity-70" : "cursor-pointer",
                m.ready && checked ? "border-accent bg-accent/5 ring-1 ring-accent" : m.ready ? "border-border hover:border-border-strong hover:bg-surface-2/60" : "",
              )}
            >
              <input
                type="radio"
                name="method"
                value={m.id}
                checked={checked}
                disabled={!m.ready}
                onChange={() => onChange(m.id)}
                className="mt-1 size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
              />
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", checked && m.ready ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted")}>{ICONS[m.id]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-ink">{t(`commerce.methods.${m.id}.title`)}</span>
                  {!m.ready && <Badge tone="neutral">{t("commerce.methods.unavailable")}</Badge>}
                  {m.ready && m.mode === "test" && (
                    <Badge tone="warning" dot>
                      {t("commerce.billing.testMode")}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-ink-muted">{t(`commerce.methods.${m.id}.note`)}</span>
                <span className="mt-2.5 flex flex-wrap gap-1.5" aria-hidden="true">
                  {CHIPS[m.id].map((chip) => (
                    <span key={chip} className="rounded-md border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold tracking-wide text-ink-muted">
                      {chip}
                    </span>
                  ))}
                </span>
                {brand && m.ready && (
                  <span className="mt-2 flex items-center gap-1 text-xs text-ink-faint">
                    <Icon.ShieldCheck className="size-3.5" aria-hidden="true" />
                    {t("commerce.methods.secured", { name: brand })}
                  </span>
                )}
                {brand && !m.ready && showAdminHints && <span className="mt-2 block text-xs text-warning">{t("commerce.methods.unavailableAdmin", { name: brand })}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

function CopyValue({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const t = useT("account");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <dt className="text-xs text-ink-faint">{label}</dt>
        <dd className={cn("truncate text-sm font-semibold text-ink", mono && "font-mono")} dir="ltr">
          {value}
        </dd>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
        aria-label={t("commerce.manual.copy", { label })}
      >
        {copied ? <Icon.Check className="size-3.5 text-success" aria-hidden="true" /> : <Icon.Copy className="size-3.5" aria-hidden="true" />}
        <span aria-live="polite">{copied ? t("commerce.manual.copied") : t("commerce.manual.copyShort")}</span>
      </button>
    </div>
  );
}

/**
 * Bank account and UPI details for a manual payment, each with a copy button, the amount, and a "Pay with a UPI
 * app" link on phones (INR only). Shown at checkout and again on the order page.
 */
export function ManualPaymentPanel({
  details,
  amountLabel,
  upiUrl,
  reference,
  context = "checkout",
  children,
}: {
  details: ManualPaymentDetails;
  /** Where the panel is shown: changes the text used when no account details are saved. */
  context?: "checkout" | "order";
  amountLabel: string;
  /** upi:// link with the amount filled in (INR orders with a UPI ID). */
  upiUrl?: string | null;
  /** Shown as "Reference to use" (the order ID on the order page). */
  reference?: string;
  children?: ReactNode;
}) {
  const t = useT("account");
  const rows: { label: string; value?: string; mono?: boolean }[] = [
    { label: t("commerce.manual.accountName"), value: details.accountName, mono: false },
    { label: t("commerce.manual.bankName"), value: details.bankName, mono: false },
    { label: t("commerce.manual.accountNumber"), value: details.accountNumber },
    { label: t("commerce.manual.ifsc"), value: details.ifsc },
    { label: t("commerce.manual.swift"), value: details.swift },
    { label: t("commerce.manual.upiId"), value: details.upiId },
  ];
  const filled = rows.filter((r): r is { label: string; value: string; mono?: boolean } => !!r.value?.trim());
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{t("commerce.manual.title")}</p>
        <p className="text-sm text-ink-muted">
          {t("commerce.manual.amount")}: <strong className="text-ink">{amountLabel}</strong>
        </p>
      </div>
      {details.instructions?.trim() && <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{details.instructions.trim()}</p>}
      {filled.length > 0 ? (
        <dl className="mt-2 divide-y divide-border">
          {filled.map((r) => (
            <CopyValue key={r.label} label={r.label} value={r.value.trim()} mono={r.mono} />
          ))}
          {reference && <CopyValue label={t("commerce.manual.referenceToUse")} value={reference} />}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{t(context === "order" ? "commerce.manual.noDetailsOrder" : "commerce.manual.noDetails")}</p>
      )}
      {upiUrl && (
        <a href={upiUrl} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg sm:hidden">
          <Icon.Smartphone className="size-4" aria-hidden="true" />
          {t("commerce.manual.openUpi")}
        </a>
      )}
      {children}
    </div>
  );
}
