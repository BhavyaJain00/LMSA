import { cn, formatPrice, gradientFor, initials } from "@/lib/utils";
import { intlLocale } from "@/i18n/config";

/** Price formatter that renders zero as "$0.00" instead of "Free". `locale` is the active language (English when omitted). */
export function money(cents: number, currency: string, locale?: string): string {
  if (cents !== 0) return formatPrice(cents, currency, undefined, locale);
  try {
    return new Intl.NumberFormat(intlLocale(locale ?? "en"), { style: "currency", currency }).format(0);
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
