import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

export interface PaymentOption {
  /** Checkout URL with this option selected. */
  href: string;
  active: boolean;
  title: string;
  /** What is charged, e.g. "$49.00" or "3 × $17.00". */
  price: string;
  note: ReactNode;
  icon: ReactNode;
}

/**
 * "Pay in full" or "Pay in installments" on the checkout page of a course
 * sold in installments. The choice lives in the URL (`?pay=installments`), so
 * the server prices the order summary for it; each option is a link.
 */
export async function PaymentOptionPicker({ options, className }: { options: PaymentOption[]; className?: string }) {
  const t = await getT("account");
  return (
    <nav aria-label={t("commerce.payOption.title")} className={cn("rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6", className)}>
      <h2 className="text-lg font-semibold text-ink">{t("commerce.payOption.title")}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <li key={option.href}>
            <Link
              href={option.href}
              scroll={false}
              replace
              aria-current={option.active ? "true" : undefined}
              className={cn(
                "flex h-full items-start gap-3 rounded-xl border p-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
                option.active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border hover:bg-surface-2",
              )}
            >
              <span className={cn("mt-0.5 shrink-0", option.active ? "text-accent" : "text-ink-muted")} aria-hidden="true">
                {option.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{option.title}</span>
                  {option.active && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                      <Icon.CheckCircle className="size-3.5" aria-hidden="true" />
                      {t("commerce.payOption.selected")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-base font-semibold tabular-nums text-ink">{option.price}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{option.note}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
