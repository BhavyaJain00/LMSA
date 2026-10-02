"use client";

import type { ReactNode } from "react";
import type { PaymentItemType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFormatter, useLocale, useT } from "@/i18n/client";
import { ITEM_TYPE_KEYS } from "./labels";
import { ItemThumb, money, type SummaryLines } from "./money";

/**
 * Order summary card (Frappe: Billing → order summary). A client component so
 * it renders on any page (checkout, order and gift pages); its strings are
 * `global.` keys, which every page provides.
 */
export function OrderSummary({
  itemType,
  title,
  subtitle,
  imageUrl,
  gradient,
  lines,
  footer,
  className,
}: {
  itemType: PaymentItemType;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  gradient?: string;
  lines: SummaryLines;
  footer?: ReactNode;
  className?: string;
}) {
  const t = useT("account");
  const f = useFormatter();
  const locale = useLocale();
  const m = (cents: number, currency: string) => money(cents, currency, locale);
  const showOriginal = lines.discountAmount > 0 || lines.taxAmount > 0;
  const taxName = `${lines.taxLabel ?? t("global.summary.tax")}${lines.taxPercentage ? ` (${f.number(lines.taxPercentage)}%)` : ""}`;
  return (
    <section aria-label={t("global.summary.label")} className={cn("rounded-card border border-border bg-surface-2 p-5", className)}>
      <ItemThumb imageUrl={imageUrl} gradient={gradient} title={title} className="mb-4" />
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("global.summary.paymentFor", { type: t(ITEM_TYPE_KEYS[itemType]) })}</p>
      <p className="mt-0.5 font-semibold leading-snug text-ink">{title}</p>
      {subtitle && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{subtitle}</p>}

      <dl className="mt-4 space-y-2 text-sm">
        {showOriginal && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("global.summary.original")}</dt>
            <dd className="tabular-nums text-ink">{m(lines.originalAmount, lines.currency)}</dd>
          </div>
        )}
        {lines.discountAmount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">
              {lines.couponCode
                ? t.rich("global.summary.discountWithCode", {
                    code: lines.couponCode,
                    chip: (text) => <span className="rounded bg-success/12 px-1.5 py-0.5 font-mono text-[11px] font-medium text-success">{text}</span>,
                  })
                : t("global.summary.discount")}
            </dt>
            <dd className="tabular-nums text-success">- {m(lines.discountAmount, lines.currency)}</dd>
          </div>
        )}
        {lines.taxAmount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {lines.taxInclusive ? t("global.summary.taxIncluded", { label: taxName }) : t("global.summary.taxAmount", { label: taxName })}
            </dt>
            <dd className="tabular-nums text-ink">{m(lines.taxAmount, lines.currency)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink">{t("global.summary.total")}</dt>
          <dd className="text-lg font-bold tabular-nums text-ink">{m(lines.total, lines.currency)}</dd>
        </div>
        {lines.usdEquivalent ? (
          <p className="text-end text-xs text-ink-muted">
            {t.rich("global.summary.usd", { amount: m(lines.usdEquivalent, "USD"), muted: (text) => <span className="text-ink-faint">{text}</span> })}
          </p>
        ) : null}
      </dl>
      {footer}
    </section>
  );
}
