import "server-only";
import type { Database, Payment, Settings, TaxRule } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { currencies } from "@/lib/config";
import { csvCell } from "@/lib/data/commerce";
import { formatPrice } from "@/lib/utils";
import { isRecurringInterval } from "./plans";
import { countryCode, countryName, isTaxInclusive } from "./tax";
import { normalizeCurrency, priceOptions } from "./currency";

/**
 * Read models of Admin → Settings → Taxes & currencies: the tax rules with
 * what each collected, the items that can carry fixed prices in other
 * currencies, and the tax report (screen + CSV).
 */

/** Currencies the platform sells in: the default currency first, then the supported ones. */
export function saleCurrencies(settings: Pick<Settings, "commerce">): string[] {
  const base = normalizeCurrency(settings.commerce.defaultCurrency) ?? "USD";
  return [base, ...currencies.filter((c) => c !== base)];
}

/* ------------------------------------------------------------------ */
/* Tax rules                                                           */
/* ------------------------------------------------------------------ */

export interface TaxRuleRow extends TaxRule {
  countryName: string;
  /** Paid orders taxed under this country. */
  orders: number;
  /** Tax collected per currency (paid orders, less refunded orders). */
  collected: { currency: string; amount: number }[];
}

function isSale(p: Payment): boolean {
  return p.status === "paid" || (p.status === "refunded" && (p.refundedAmount ?? p.amount) < p.amount);
}

function isTaxedSale(p: Payment): boolean {
  return isSale(p) && p.taxAmount > 0;
}

/** Sales for the tax report: taxed ones, and EU reverse-charge ones (0% VAT, listed for the EC sales list). */
function isReportedSale(p: Payment): boolean {
  return isSale(p) && (p.taxAmount > 0 || !!p.reverseCharge);
}

/** Country a paid order was taxed for: the stored tax country, else its billing address. */
export function orderTaxCountry(p: Pick<Payment, "taxCountry" | "address">): string | null {
  return countryCode(p.taxCountry) ?? countryCode(p.address?.country);
}

export function taxRuleRows(db: Pick<Database, "taxRules" | "payments">): TaxRuleRow[] {
  const byCountry = new Map<string, { orders: number; collected: Map<string, number> }>();
  for (const p of db.payments) {
    if (!isTaxedSale(p)) continue;
    const country = orderTaxCountry(p);
    if (!country) continue;
    const entry = byCountry.get(country) ?? { orders: 0, collected: new Map<string, number>() };
    entry.orders += 1;
    entry.collected.set(p.currency, (entry.collected.get(p.currency) ?? 0) + p.taxAmount);
    byCountry.set(country, entry);
  }
  return db.taxRules
    .map((rule) => {
      const stats = byCountry.get(rule.country.toUpperCase());
      return {
        ...rule,
        countryName: countryName(rule.country),
        orders: stats?.orders ?? 0,
        collected: stats ? Array.from(stats.collected, ([currency, amount]) => ({ currency, amount })) : [],
      };
    })
    .sort((a, b) => a.countryName.localeCompare(b.countryName));
}

/* ------------------------------------------------------------------ */
/* Tax report                                                          */
/* ------------------------------------------------------------------ */

export interface TaxReportFilter {
  /** ISO date (inclusive), e.g. "2026-01-01". */
  from: string | null;
  to: string | null;
  country: string | null;
}

export function parseTaxReportFilter(sp: Record<string, string | string[] | undefined> | URLSearchParams): TaxReportFilter {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  return { from: date(get("from")), to: date(get("to")), country: countryCode(get("country")) };
}

export interface TaxReportLine {
  orderId: string;
  invoiceNumber: string;
  paidAt: string;
  buyer: string;
  country: string | null;
  taxName: string;
  rate: number | null;
  inclusive: boolean;
  net: number;
  tax: number;
  total: number;
  currency: string;
  refunded: boolean;
  /** The buyer's VAT / tax number from checkout. */
  buyerTaxId: string;
  /** EU reverse charge: no VAT charged, the buyer accounts for it. */
  reverseCharge: boolean;
  /** Reverse-charged although VIES could not confirm the VAT number at checkout: to be checked. */
  vatUnverified: boolean;
}

export interface TaxReportTotals {
  currency: string;
  net: number;
  tax: number;
  total: number;
  orders: number;
}

/** Paid orders that charged tax (or were reverse-charged), newest first, with totals per currency. */
export function taxReport(db: Pick<Database, "payments" | "taxRules" | "settings">, filter: TaxReportFilter): { lines: TaxReportLine[]; totals: TaxReportTotals[] } {
  const from = filter.from ? Date.parse(`${filter.from}T00:00:00Z`) : null;
  const to = filter.to ? Date.parse(`${filter.to}T23:59:59.999Z`) : null;
  const lines: TaxReportLine[] = [];
  const totals = new Map<string, TaxReportTotals>();
  for (const p of db.payments) {
    if (!isReportedSale(p) || !p.paidAt) continue;
    const at = Date.parse(p.paidAt);
    if ((from !== null && at < from) || (to !== null && at > to)) continue;
    const country = orderTaxCountry(p);
    if (filter.country && country !== filter.country) continue;
    const inclusive = isTaxInclusive(p);
    // Inclusive or not, the charged amount is the net price plus the tax.
    const net = p.amount - p.taxAmount;
    const rule = p.taxCountry ? db.taxRules.find((r) => r.country.toUpperCase() === p.taxCountry?.toUpperCase()) : null;
    lines.push({
      orderId: p.orderId,
      invoiceNumber: p.invoiceNumber ?? "",
      paidAt: p.paidAt,
      buyer: p.billingName,
      country,
      taxName: rule?.name ?? (p.reverseCharge ? "VAT" : db.settings.commerce.taxLabel || "Tax"),
      rate: p.reverseCharge && p.taxAmount <= 0 ? 0 : (p.taxRate ?? null),
      inclusive,
      net,
      tax: p.taxAmount,
      total: p.amount,
      currency: p.currency,
      refunded: p.status === "refunded" || (p.refundedAmount ?? 0) > 0,
      buyerTaxId: p.buyerVatId ?? "",
      reverseCharge: !!p.reverseCharge && p.taxAmount <= 0,
      vatUnverified: !!p.reverseCharge && p.vatCheck === "unverified",
    });
    const t = totals.get(p.currency) ?? { currency: p.currency, net: 0, tax: 0, total: 0, orders: 0 };
    t.net += net;
    t.tax += p.taxAmount;
    t.total += p.amount;
    t.orders += 1;
    totals.set(p.currency, t);
  }
  lines.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  return { lines, totals: [...totals.values()].sort((a, b) => b.tax - a.tax) };
}

const decimal = (amount: number) => (amount / 100).toFixed(2);
const csvRow = (cells: readonly (string | number)[]) => cells.map(csvCell).join(",");

export function taxReportToCsv(lines: readonly TaxReportLine[]): string {
  const header = ["Paid at", "Invoice", "Order", "Billing name", "Country", "Tax", "Rate %", "Included in price", "Net", "Tax amount", "Total", "Currency", "Refunded", "Buyer VAT No.", "Reverse charge", "VAT No. verified (VIES)"];
  return [
    csvRow(header),
    ...lines.map((l) =>
      csvRow([
        l.paidAt,
        l.invoiceNumber,
        l.orderId,
        l.buyer,
        l.country ?? "",
        l.taxName,
        l.rate === null ? "" : String(l.rate),
        l.inclusive ? "yes" : "no",
        decimal(l.net),
        decimal(l.tax),
        decimal(l.total),
        l.currency,
        l.refunded ? "yes" : "no",
        l.buyerTaxId,
        l.reverseCharge ? "yes" : "no",
        l.reverseCharge ? (l.vatUnverified ? "no" : "yes") : "",
      ]),
    ),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Fixed prices in other currencies                                    */
/* ------------------------------------------------------------------ */

export type PricedItemType = "course" | "bundle" | "plan";

export interface PricedItemRow {
  type: PricedItemType;
  id: string;
  title: string;
  href: string;
  price: number;
  currency: string;
  /** Fixed prices in other currencies, keyed by currency. */
  prices: Record<string, number>;
  priceLabel: string;
}

export interface PricedItemFilter {
  type: PricedItemType | "all";
  search: string | null;
  page: number;
}

export function parsePricedItemFilter(sp: Record<string, string | string[] | undefined>): PricedItemFilter {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const type = one("ptype");
  const page = Number(one("ppage"));
  return {
    type: type === "course" || type === "bundle" || type === "plan" ? type : "all",
    search: one("pq").slice(0, 100) || null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

const PAGE_SIZE = 20;

/**
 * Items that can carry fixed prices: paid courses, bundles and lifetime
 * plans (memberships that renew are billed in their own currency).
 */
export function pricedItems(db: Pick<Database, "courses" | "bundles" | "plans">, filter: PricedItemFilter): { rows: PricedItemRow[]; total: number; page: number; pageCount: number } {
  const all: PricedItemRow[] = [];
  const toRow = (type: PricedItemType, id: string, title: string, href: string, price: number, currency: string, prices: PricedItemRow["prices"]): PricedItemRow => ({
    type,
    id,
    title,
    href,
    price,
    currency: currency.toUpperCase(),
    prices,
    priceLabel: formatPrice(price, currency),
  });
  const extra = (base: { amount: number; currency: string }, list: Parameters<typeof priceOptions>[1]) =>
    Object.fromEntries(
      priceOptions(base, list)
        .filter((o) => !o.isDefault)
        .map((o) => [o.currency, o.amount]),
    );
  for (const c of db.courses) {
    if (!c.paidCourse || c.price <= 0) continue;
    const currency = c.currency || "USD";
    all.push(toRow("course", c.id, c.title, `/courses/${c.slug}`, c.price, currency, extra({ amount: c.price, currency }, c.prices)));
  }
  for (const b of db.bundles) {
    const currency = b.currency || "USD";
    all.push(toRow("bundle", b.id, b.title, `/bundles/${b.slug}`, b.price, currency, extra({ amount: b.price, currency }, b.prices)));
  }
  for (const p of db.plans) {
    if (isRecurringInterval(p.interval) || p.price <= 0) continue;
    const currency = p.currency || "USD";
    all.push(toRow("plan", p.id, p.name, "/pricing", p.price, currency, extra({ amount: p.price, currency }, p.prices)));
  }
  const q = filter.search?.toLowerCase();
  const matching = all
    .filter((r) => (filter.type === "all" || r.type === filter.type) && (!q || r.title.toLowerCase().includes(q)))
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  return { rows: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: matching.length, page, pageCount };
}

/** Everything the Taxes & currencies page shows. */
export async function getTaxAdmin(sp: Record<string, string | string[] | undefined>) {
  const db = await getDb();
  const reportFilter = parseTaxReportFilter(sp);
  const itemFilter = parsePricedItemFilter(sp);
  const report = taxReport(db, reportFilter);
  return {
    settings: db.settings,
    rules: taxRuleRows(db),
    report: { ...report, lines: report.lines.slice(0, 25), count: report.lines.length },
    reportFilter,
    items: pricedItems(db, itemFilter),
    itemFilter,
    currencies: saleCurrencies(db.settings),
  };
}
