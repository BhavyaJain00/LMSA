import type { ReactNode } from "react";
import type { InvoiceView } from "@/lib/payments/invoice";
import { cn, initials } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { money } from "./order-summary";
import { ITEM_TYPE_KEYS, paymentStatusKey } from "./labels";

/**
 * Printable invoice (server component). Screen styles use the design tokens; the
 * invoice page's print stylesheet maps them to a light palette and removes
 * the app chrome so only this sheet is printed.
 */
export async function InvoiceSheet({ invoice, className }: { invoice: InvoiceView; className?: string }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const m = (cents: number) => money(cents, invoice.currency, f.locale);
  const refunded = invoice.refundedAmount > 0;
  const taxName = invoice.taxCountryName ? `${invoice.taxLabel} · ${invoice.taxCountryName}` : invoice.taxLabel;
  const rate = invoice.taxRate !== null && invoice.taxRate > 0 ? f.number(invoice.taxRate) : null;
  const taxLine = invoice.reverseCharge
    ? t("commerce.invoice.taxReverse", { name: taxName })
    : rate
      ? invoice.taxInclusive
        ? t("commerce.invoice.taxRateIncluded", { name: taxName, rate })
        : t("commerce.invoice.taxRate", { name: taxName, rate })
      : invoice.taxInclusive
        ? t("commerce.invoice.taxIncluded", { name: taxName })
        : taxName;
  const statusLabel = t(paymentStatusKey({ status: invoice.status, refundedAmount: invoice.refundedAmount, amount: invoice.total }));
  const stampTone =
    invoice.status === "refunded" ? "border-danger/40 text-danger" : refunded ? "border-warning/50 text-warning" : "border-success/50 text-success";

  return (
    <article
      id="invoice-sheet"
      aria-label={t("commerce.invoice.label", { number: invoice.invoiceNumber })}
      className={cn("invoice-sheet mx-auto w-full max-w-3xl rounded-card border border-border bg-surface-1 p-5 text-ink shadow-card sm:p-10", className)}
    >
      {/* Header */}
      <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {invoice.seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.seller.logoUrl} alt="" className="size-12 shrink-0 rounded-lg object-contain" />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent text-lg font-bold text-accent-fg" aria-hidden="true">
              {initials(invoice.seller.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight">{invoice.seller.name}</p>
            {invoice.seller.tagline && <p className="mt-0.5 text-sm text-ink-muted">{invoice.seller.tagline}</p>}
            <div className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {invoice.seller.email && <p dir="ltr">{invoice.seller.email}</p>}
              {invoice.seller.url && (
                <p className="break-all" dir="ltr">
                  {invoice.seller.url}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="sm:text-end">
          <p className="text-2xl font-bold uppercase tracking-[0.2em] text-ink">{t("commerce.invoice.title")}</p>
          <p className="mt-1 font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{t("commerce.invoice.issued", { date: f.date(invoice.issuedAt, { month: "long" }) })}</p>
          <span className={cn("mt-3 inline-block rotate-[-3deg] rounded-md border-2 px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest", stampTone)}>
            {statusLabel}
          </span>
        </div>
      </header>

      {/* Parties */}
      <section className="grid gap-6 border-b border-border py-6 sm:grid-cols-2" aria-label={t("commerce.invoice.billingDetails")}>
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("commerce.invoice.billedBy")}</h2>
          <p className="mt-2 font-semibold">{invoice.seller.legalName}</p>
          {(invoice.seller.addressLines.length > 0 || invoice.seller.countryName) && (
            <address className="mt-1 text-sm not-italic leading-relaxed text-ink-muted">
              {invoice.seller.addressLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
              {invoice.seller.countryName && <span className="block">{invoice.seller.countryName}</span>}
            </address>
          )}
          {invoice.seller.taxIds.length > 0 && (
            <dl className="mt-2 space-y-0.5 text-sm">
              {invoice.seller.taxIds.map((id) => (
                <div key={`${id.label}-${id.value}`} className="flex flex-wrap gap-x-2">
                  <dt className="text-ink-muted">{id.label}</dt>
                  <dd className="font-mono" dir="ltr">
                    {id.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("commerce.invoice.billedTo")}</h2>
          <p className="mt-2 font-semibold">{invoice.buyer.name}</p>
          {invoice.buyer.email && (
            <p className="break-all text-sm text-ink-muted" dir="ltr">
              {invoice.buyer.email}
            </p>
          )}
          {invoice.buyer.addressLines.length > 0 && (
            <address className="mt-1 text-sm not-italic leading-relaxed text-ink-muted">
              {invoice.buyer.addressLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </address>
          )}
          {(invoice.buyer.gstin || invoice.buyer.pan || invoice.buyer.taxId) && (
            <dl className="mt-2 space-y-0.5 text-sm">
              {invoice.buyer.taxId && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-ink-muted">{invoice.buyer.taxIdKind === "vat" ? t("commerce.invoice.buyerVat") : t("commerce.invoice.buyerTaxId")}</dt>
                  <dd className="font-mono" dir="ltr">
                    {invoice.buyer.taxId}
                  </dd>
                </div>
              )}
              {invoice.buyer.gstin && (
                <div className="flex gap-2">
                  <dt className="text-ink-muted">GSTIN</dt>
                  <dd className="font-mono">{invoice.buyer.gstin}</dd>
                </div>
              )}
              {invoice.buyer.pan && (
                <div className="flex gap-2">
                  <dt className="text-ink-muted">PAN</dt>
                  <dd className="font-mono">{invoice.buyer.pan}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </section>

      {/* Invoice facts */}
      <section className="border-b border-border py-5" aria-label={t("commerce.invoice.number")}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] print:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Meta label={t("commerce.invoice.number")} mono>
            {invoice.invoiceNumber}
          </Meta>
          <Meta label={t("commerce.invoice.orderId")} mono>
            {invoice.orderId}
          </Meta>
          <Meta label={t("commerce.invoice.date")}>{f.date(invoice.issuedAt)}</Meta>
          {invoice.paidAt && <Meta label={t("commerce.invoice.paidOn")}>{f.date(invoice.paidAt)}</Meta>}
          <Meta label={t("commerce.invoice.method")}>{invoice.gatewayLabel}</Meta>
          {invoice.gatewayPaymentId && (
            <Meta label={t("commerce.invoice.paymentId")} mono>
              {invoice.gatewayPaymentId}
            </Meta>
          )}
        </dl>
      </section>

      {/* Line items */}
      <section className="py-6" aria-label={t("commerce.invoice.items")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-strong text-start text-xs uppercase tracking-wide text-ink-faint">
              <th scope="col" className="pb-2 text-start font-semibold">
                {t("commerce.invoice.description")}
              </th>
              <th scope="col" className="hidden pb-2 text-end font-semibold sm:table-cell print:table-cell">
                {t("commerce.invoice.qty")}
              </th>
              <th scope="col" className="hidden pb-2 text-end font-semibold sm:table-cell print:table-cell">
                {t("commerce.invoice.unitPrice")}
              </th>
              <th scope="col" className="pb-2 text-end font-semibold">
                {t("commerce.invoice.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border align-top">
              <td className="py-3 pe-3">
                <p className="font-medium">{invoice.item.title}</p>
                <p className="text-xs text-ink-muted">{t(ITEM_TYPE_KEYS[invoice.item.type])}</p>
              </td>
              <td className="hidden py-3 text-end tabular-nums sm:table-cell print:table-cell">{f.number(1)}</td>
              <td className="hidden py-3 text-end tabular-nums sm:table-cell print:table-cell">{m(invoice.originalAmount)}</td>
              <td className="py-3 text-end tabular-nums">{m(invoice.originalAmount)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="ms-auto mt-4 w-full max-w-xs space-y-2 text-sm">
          <Total label={t("commerce.invoice.subtotal")}>{m(invoice.originalAmount)}</Total>
          {invoice.discountAmount > 0 && (
            <Total label={invoice.couponCode ? t("commerce.invoice.discountCode", { code: invoice.couponCode }) : t("commerce.invoice.discount")} className="text-success">
              − {m(invoice.discountAmount)}
            </Total>
          )}
          {(invoice.discountAmount > 0 || invoice.taxAmount > 0 || invoice.reverseCharge) && <Total label={t("commerce.invoice.taxable")}>{m(invoice.taxableAmount)}</Total>}
          {(invoice.taxAmount > 0 || invoice.reverseCharge) && (
            <Total label={taxLine}>
              {m(invoice.taxAmount)}
            </Total>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-border-strong pt-2 text-base font-bold">
            <dt>{t("commerce.invoice.total")}</dt>
            <dd className="tabular-nums">
              {m(invoice.total)} <span className="text-xs font-medium text-ink-muted">{invoice.currency.toUpperCase()}</span>
            </dd>
          </div>
          <Total label={t("commerce.invoice.amountPaid")}>{m(invoice.total)}</Total>
          {refunded && (
            <>
              <Total label={invoice.refundedAt ? t("commerce.invoice.refundedOn", { date: f.date(invoice.refundedAt) }) : t("commerce.invoice.refunded")} className="text-danger">
                − {m(invoice.refundedAmount)}
              </Total>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 font-semibold">
                <dt>{t("commerce.invoice.netPaid")}</dt>
                <dd className="tabular-nums">{m(invoice.netAmount)}</dd>
              </div>
            </>
          )}
        </dl>

        {invoice.reverseCharge && (
          <div className="mt-5 rounded-lg border border-border-strong px-4 py-3 text-sm">
            <p className="font-semibold uppercase tracking-wide">{t("commerce.invoice.reverseCharge")}</p>
            <p className="mt-1 text-ink-muted">{t("commerce.invoice.reverseChargeNote", { name: invoice.taxLabel })}</p>
          </div>
        )}
      </section>

      <footer className="border-t border-border pt-5 text-xs leading-relaxed text-ink-muted">
        <p>{t("commerce.invoice.thanks", { brand: invoice.seller.name })}</p>
        {invoice.refundId && <p className="mt-1">{t.rich("commerce.invoice.refundRef", { id: invoice.refundId, code: (text) => <span className="font-mono">{text}</span> })}</p>}
        <p className="mt-1">{t("commerce.invoice.computerGenerated")}</p>
        {invoice.seller.footerText && <p className="mt-1">{invoice.seller.footerText}</p>}
      </footer>
    </article>
  );
}

function Meta({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn("min-w-0 break-all", mono && "font-mono text-[13px]")}>{children}</dd>
    </>
  );
}

function Total({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={className ? undefined : "text-ink-muted"}>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
