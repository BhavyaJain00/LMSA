import type { ReactNode } from "react";
import type { PaymentItemType } from "@/lib/types";
import { cn, formatPrice, gradientFor, initials } from "@/lib/utils";

/** Price formatter that renders zero as "$0.00" instead of "Free". */
export function money(cents: number, currency: string): string {
  if (cents !== 0) return formatPrice(cents, currency);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(0);
  } catch {
    return `${currency} 0.00`;
  }
}

export function ItemThumb({ imageUrl, gradient, title, className }: { imageUrl?: string; gradient?: string; title: string; className?: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={cn("aspect-video w-full rounded-lg object-cover", className)} />;
  }
  return (
    <div className={cn("flex aspect-video w-full items-center justify-center rounded-lg bg-linear-to-br text-2xl font-bold text-white", gradientFor(gradient), className)} aria-hidden="true">
      {initials(title)}
    </div>
  );
}

export interface SummaryLines {
  currency: string;
  originalAmount: number;
  discountAmount: number;
  taxAmount: number;
  taxLabel?: string;
  taxPercentage?: number;
  /** The tax is part of the price (shown as "included", not added). */
  taxInclusive?: boolean;
  total: number;
  couponCode?: string | null;
  usdEquivalent?: number | null;
}

const TYPE_LABEL: Record<PaymentItemType, string> = {
  course: "Course",
  batch: "Batch",
  certificate: "Certificate",
  plan: "Membership",
  bundle: "Bundle",
  gift: "Gift",
  seats: "Team seats",
};

/** Order summary card (Frappe: Billing → order summary). Server-safe. */
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
  const showOriginal = lines.discountAmount > 0 || lines.taxAmount > 0;
  return (
    <section aria-label="Order summary" className={cn("rounded-card border border-border bg-surface-2 p-5", className)}>
      <ItemThumb imageUrl={imageUrl} gradient={gradient} title={title} className="mb-4" />
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Payment for {TYPE_LABEL[itemType]}:</p>
      <p className="mt-0.5 font-semibold leading-snug text-ink">{title}</p>
      {subtitle && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{subtitle}</p>}

      <dl className="mt-4 space-y-2 text-sm">
        {showOriginal && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">Original amount:</dt>
            <dd className="tabular-nums text-ink">{money(lines.originalAmount, lines.currency)}</dd>
          </div>
        )}
        {lines.discountAmount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">
              Discount{lines.couponCode ? <span className="ml-1 rounded bg-success/12 px-1.5 py-0.5 font-mono text-[11px] font-medium text-success">{lines.couponCode}</span> : null}:
            </dt>
            <dd className="tabular-nums text-success">- {money(lines.discountAmount, lines.currency)}</dd>
          </div>
        )}
        {lines.taxAmount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {lines.taxLabel ?? "Tax"}
              {lines.taxPercentage ? ` (${lines.taxPercentage}%)` : ""} {lines.taxInclusive ? "included:" : "amount:"}
            </dt>
            <dd className="tabular-nums text-ink">{money(lines.taxAmount, lines.currency)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink">Total:</dt>
          <dd className="text-lg font-bold tabular-nums text-ink">{money(lines.total, lines.currency)}</dd>
        </div>
        {lines.usdEquivalent ? (
          <p className="text-right text-xs text-ink-muted">
            ≈ {money(lines.usdEquivalent, "USD")} USD <span className="text-ink-faint">(indicative)</span>
          </p>
        ) : null}
      </dl>
      {footer}
    </section>
  );
}
