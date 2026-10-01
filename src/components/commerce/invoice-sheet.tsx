import type { ReactNode } from "react";
import type { InvoiceView } from "@/lib/payments/invoice";
import { cn, formatDate, initials } from "@/lib/utils";
import { taxLineLabel } from "@/lib/commerce/tax";
import { money } from "./order-summary";

/**
 * Printable invoice (server-safe). Screen styles use the design tokens; the
 * invoice page's print stylesheet maps them to a light palette and removes
 * the app chrome so only this sheet is printed.
 */
export function InvoiceSheet({ invoice, className }: { invoice: InvoiceView; className?: string }) {
  const refunded = invoice.refundedAmount > 0;
  const stampTone =
    invoice.status === "refunded" ? "border-danger/40 text-danger" : refunded ? "border-warning/50 text-warning" : "border-success/50 text-success";

  return (
    <article
      id="invoice-sheet"
      aria-label={`Invoice ${invoice.invoiceNumber}`}
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
              {invoice.seller.email && <p>{invoice.seller.email}</p>}
              {invoice.seller.url && <p className="break-all">{invoice.seller.url}</p>}
            </div>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-bold uppercase tracking-[0.2em] text-ink">Invoice</p>
          <p className="mt-1 font-mono text-sm font-semibold">{invoice.invoiceNumber}</p>
          <p className="mt-0.5 text-sm text-ink-muted">Issued {formatDate(invoice.issuedAt, { month: "long" })}</p>
          <span className={cn("mt-3 inline-block rotate-[-3deg] rounded-md border-2 px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest", stampTone)}>
            {invoice.statusLabel}
          </span>
        </div>
      </header>

      {/* Parties */}
      <section className="grid gap-6 border-b border-border py-6 sm:grid-cols-2" aria-label="Billing details">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Billed to</h2>
          <p className="mt-2 font-semibold">{invoice.buyer.name}</p>
          {invoice.buyer.email && <p className="break-all text-sm text-ink-muted">{invoice.buyer.email}</p>}
          {invoice.buyer.addressLines.length > 0 && (
            <address className="mt-1 text-sm not-italic leading-relaxed text-ink-muted">
              {invoice.buyer.addressLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </address>
          )}
          {(invoice.buyer.gstin || invoice.buyer.pan) && (
            <dl className="mt-2 space-y-0.5 text-sm">
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
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm sm:justify-self-end">
          <Meta label="Invoice number" mono>
            {invoice.invoiceNumber}
          </Meta>
          <Meta label="Order ID" mono>
            {invoice.orderId}
          </Meta>
          <Meta label="Invoice date">{formatDate(invoice.issuedAt)}</Meta>
          {invoice.paidAt && <Meta label="Paid on">{formatDate(invoice.paidAt)}</Meta>}
          <Meta label="Payment method">{invoice.gatewayLabel}</Meta>
          {invoice.gatewayPaymentId && (
            <Meta label="Payment ID" mono>
              {invoice.gatewayPaymentId}
            </Meta>
          )}
        </dl>
      </section>

      {/* Line items */}
      <section className="py-6" aria-label="Items">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-ink-faint">
              <th scope="col" className="pb-2 font-semibold">
                Description
              </th>
              <th scope="col" className="hidden pb-2 text-right font-semibold sm:table-cell print:table-cell">
                Qty
              </th>
              <th scope="col" className="hidden pb-2 text-right font-semibold sm:table-cell print:table-cell">
                Unit price
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border align-top">
              <td className="py-3 pr-3">
                <p className="font-medium">{invoice.item.title}</p>
                <p className="text-xs text-ink-muted">{invoice.item.typeLabel}</p>
              </td>
              <td className="hidden py-3 text-right tabular-nums sm:table-cell print:table-cell">1</td>
              <td className="hidden py-3 text-right tabular-nums sm:table-cell print:table-cell">{money(invoice.originalAmount, invoice.currency)}</td>
              <td className="py-3 text-right tabular-nums">{money(invoice.originalAmount, invoice.currency)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="ml-auto mt-4 w-full max-w-xs space-y-2 text-sm">
          <Total label="Subtotal">{money(invoice.originalAmount, invoice.currency)}</Total>
          {invoice.discountAmount > 0 && (
            <Total label={invoice.couponCode ? `Discount (${invoice.couponCode})` : "Discount"} className="text-success">
              − {money(invoice.discountAmount, invoice.currency)}
            </Total>
          )}
          {(invoice.discountAmount > 0 || invoice.taxAmount > 0) && <Total label="Taxable amount">{money(invoice.taxableAmount, invoice.currency)}</Total>}
          {invoice.taxAmount > 0 && (
            <Total label={taxLineLabel({ name: invoice.taxCountryName ? `${invoice.taxLabel} · ${invoice.taxCountryName}` : invoice.taxLabel, rate: invoice.taxRate, inclusive: invoice.taxInclusive })}>
              {money(invoice.taxAmount, invoice.currency)}
            </Total>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-border-strong pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">
              {money(invoice.total, invoice.currency)} <span className="text-xs font-medium text-ink-muted">{invoice.currency.toUpperCase()}</span>
            </dd>
          </div>
          <Total label="Amount paid">{money(invoice.total, invoice.currency)}</Total>
          {refunded && (
            <>
              <Total label={`Refunded${invoice.refundedAt ? ` on ${formatDate(invoice.refundedAt)}` : ""}`} className="text-danger">
                − {money(invoice.refundedAmount, invoice.currency)}
              </Total>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 font-semibold">
                <dt>Net paid</dt>
                <dd className="tabular-nums">{money(invoice.netAmount, invoice.currency)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <footer className="border-t border-border pt-5 text-xs leading-relaxed text-ink-muted">
        <p>Thank you for learning with {invoice.seller.name}.</p>
        {invoice.refundId && <p className="mt-1">Refund reference: <span className="font-mono">{invoice.refundId}</span></p>}
        <p className="mt-1">This is a computer-generated invoice and does not require a signature.</p>
        {invoice.seller.footerText && <p className="mt-1">{invoice.seller.footerText}</p>}
      </footer>
    </article>
  );
}

function Meta({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn("min-w-0 break-all sm:text-right", mono && "font-mono text-[13px]")}>{children}</dd>
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
