import "server-only";
import type { Database, Payment, PaymentItemType, PaymentStatus, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";

/**
 * Invoice numbering and the printable invoice view model.
 *
 * Every paid order gets a sequential number per calendar year
 * (`INV-2026-00042`). Numbers are assigned inside `mutate` — the store runs
 * mutations one at a time — so two orders paid at the same moment can never
 * receive the same number, and a number, once assigned, never changes.
 */

const INVOICE_RE = /^INV-(\d{4})-(\d{5,})$/;

export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

export function parseInvoiceNumber(value: string | undefined | null): { year: number; sequence: number } | null {
  const m = value ? INVOICE_RE.exec(value) : null;
  return m ? { year: Number(m[1]), sequence: Number(m[2]) } : null;
}

/** Highest sequence already used in `year`. */
function maxSequence(payments: Payment[], year: number): number {
  let max = 0;
  for (const p of payments) {
    const parsed = parseInvoiceNumber(p.invoiceNumber);
    if (parsed && parsed.year === year && parsed.sequence > max) max = parsed.sequence;
  }
  return max;
}

function invoiceYear(payment: Payment, fallback: Date): number {
  const at = new Date(payment.paidAt ?? "");
  return Number.isNaN(at.getTime()) ? fallback.getUTCFullYear() : at.getUTCFullYear();
}

/**
 * Give `payment` (a row of `db.payments`) the next invoice number of its paid
 * year. Must be called inside `mutate`. Returns the existing number when the
 * payment already has one.
 */
export function assignInvoiceNumber(db: Database, payment: Payment, now: Date = new Date()): string {
  if (payment.invoiceNumber) return payment.invoiceNumber;
  const year = invoiceYear(payment, now);
  payment.invoiceNumber = formatInvoiceNumber(year, maxSequence(db.payments, year) + 1);
  return payment.invoiceNumber;
}

/**
 * Orders that are sales: something was charged. Free orders (total 0, or
 * granted while no gateway collects payments) get no invoice.
 */
export function isInvoiceable(p: Pick<Payment, "amount" | "gateway">): boolean {
  return p.amount > 0 && p.gateway !== "free" && p.gateway !== "none";
}

/** Paid (or since refunded) orders that do not have an invoice number yet. */
export function needsInvoiceNumber(p: Payment): boolean {
  return (p.status === "paid" || p.status === "refunded") && !!p.paidAt && !p.invoiceNumber && isInvoiceable(p);
}

/**
 * Number orders that were paid before invoices existed (or were imported),
 * oldest payment first. Cheap no-op when every paid order is numbered.
 */
export async function backfillInvoiceNumbers(): Promise<number> {
  const db = await getDb();
  if (!db.payments.some(needsInvoiceNumber)) return 0;
  return mutate((d) => {
    const due = d.payments.filter(needsInvoiceNumber).sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
    const now = new Date();
    for (const p of due) assignInvoiceNumber(d, p, now);
    return due.length;
  });
}

/** Whether an order has (or will have) a printable invoice. */
export function hasInvoice(p: Pick<Payment, "status" | "paidAt" | "amount" | "gateway">): boolean {
  return (p.status === "paid" || p.status === "refunded") && !!p.paidAt && isInvoiceable(p);
}

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

export interface InvoiceView {
  invoiceNumber: string;
  orderId: string;
  status: PaymentStatus;
  /** Label shown on the status stamp, e.g. "Paid", "Refunded", "Partially refunded". */
  statusLabel: string;
  issuedAt: string;
  seller: {
    name: string;
    tagline?: string;
    logoUrl?: string;
    email?: string;
    url?: string;
    footerText?: string;
  };
  buyer: {
    name: string;
    email?: string;
    addressLines: string[];
    gstin?: string;
    pan?: string;
  };
  item: {
    type: PaymentItemType;
    typeLabel: string;
    title: string;
  };
  currency: string;
  originalAmount: number;
  discountAmount: number;
  couponCode?: string;
  /** Amount after discount, before tax. */
  taxableAmount: number;
  taxLabel: string;
  /** Tax rate in percent, derived from the stored amounts (null when no tax was charged). */
  taxRate: number | null;
  taxAmount: number;
  total: number;
  refundedAmount: number;
  refundedAt?: string;
  refundId?: string;
  /** What the buyer finally paid after refunds. */
  netAmount: number;
  gatewayLabel: string;
  gatewayPaymentId?: string;
  paidAt?: string;
}

const ITEM_TYPE_LABELS: Record<PaymentItemType, string> = { course: "Course", batch: "Batch", certificate: "Certificate" };

/**
 * Tax rate for the invoice. The order stores amounts, not the rate, so the
 * rate is derived from them; when the configured rate reproduces the stored
 * tax exactly it is used verbatim (avoids 17.99% style rounding artefacts).
 */
export function deriveTaxRate(taxableAmount: number, taxAmount: number, configuredRate: number): number | null {
  if (taxAmount <= 0 || taxableAmount <= 0) return null;
  if (configuredRate > 0 && Math.round((taxableAmount * configuredRate) / 100) === taxAmount) return configuredRate;
  return Math.round((taxAmount / taxableAmount) * 10000) / 100;
}

export function formatAddressLines(address: Payment["address"]): string[] {
  if (!address) return [];
  const cityLine = [address.city, address.state, address.pincode].filter(Boolean).join(", ");
  return [address.line1, address.line2, cityLine, address.country].filter((l): l is string => !!l && l.trim().length > 0);
}

export function buildInvoiceView(
  payment: Payment,
  opts: { settings: Settings; buyer: Pick<User, "email"> | null; gatewayLabel: string },
): InvoiceView | null {
  if (!hasInvoice(payment) || !payment.invoiceNumber) return null;
  const { settings } = opts;
  const taxableAmount = Math.max(0, payment.originalAmount - payment.discountAmount);
  const refundedAmount = payment.status === "refunded" ? (payment.refundedAmount ?? payment.amount) : (payment.refundedAmount ?? 0);
  const statusLabel =
    payment.status === "refunded"
      ? refundedAmount > 0 && refundedAmount < payment.amount
        ? "Partially refunded"
        : "Refunded"
      : refundedAmount > 0
        ? "Paid · partially refunded"
        : "Paid";
  return {
    invoiceNumber: payment.invoiceNumber,
    orderId: payment.orderId,
    status: payment.status,
    statusLabel,
    issuedAt: payment.paidAt ?? payment.createdAt,
    seller: {
      name: settings.brand.name,
      tagline: settings.brand.tagline || undefined,
      logoUrl: settings.brand.logoUrl || undefined,
      email: settings.contact.email || undefined,
      url: settings.contact.url || undefined,
      footerText: settings.brand.footerText || undefined,
    },
    buyer: {
      name: payment.billingName,
      email: opts.buyer?.email,
      addressLines: formatAddressLines(payment.address),
      gstin: payment.gstin,
      pan: payment.pan,
    },
    item: { type: payment.itemType, typeLabel: ITEM_TYPE_LABELS[payment.itemType], title: payment.itemTitle },
    currency: payment.currency,
    originalAmount: payment.originalAmount,
    discountAmount: payment.discountAmount,
    couponCode: payment.couponCode,
    taxableAmount,
    taxLabel: settings.commerce.taxLabel || "Tax",
    taxRate: deriveTaxRate(taxableAmount, payment.taxAmount, settings.commerce.taxPercentage),
    taxAmount: payment.taxAmount,
    total: payment.amount,
    refundedAmount,
    refundedAt: payment.refundedAt,
    refundId: payment.refundId,
    netAmount: Math.max(0, payment.amount - refundedAmount),
    gatewayLabel: opts.gatewayLabel,
    gatewayPaymentId: payment.gatewayPaymentId,
    paidAt: payment.paidAt,
  };
}
