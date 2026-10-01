import "server-only";
import type { Database, Payment, Settings, Upsell, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { checkBillingAccess, computeOrderSummary, getBillingItem, priceItemIn, type BillingItem, type OrderSummary } from "@/lib/data/commerce";
import type { TaxContext } from "./tax";
import { formatPrice } from "@/lib/utils";
import { bundleCourses } from "./bundles";
import { discountedPrice, itemRef, upsellFor, upsellPerformance, type UpsellItemType, type UpsellPerformance } from "./upsells";

/**
 * Upsell offers for a buyer (order bump at checkout, one-click offer after
 * the purchase) and the admin read models of `/admin/upsells`.
 */

export interface UpsellOffer {
  upsell: Upsell;
  item: BillingItem;
  /** The offer priced at the upsell discount, with tax. */
  summary: OrderSummary;
  /** What the offer costs without the upsell discount (tax included), to show the saving. */
  listTotal: number;
}

/**
 * The offer priced for checkout: the upsell discount comes off the list
 * price first, then tax applies, exactly as for a coupon.
 */
export function offerSummary(item: BillingItem, discountPercent: number, settings: Settings, tax?: TaxContext | null): OrderSummary {
  const price = discountedPrice(item.amount, discountPercent);
  const s = computeOrderSummary({ ...item, amount: price }, null, settings, tax);
  return { ...s, originalAmount: item.amount, discountAmount: item.amount - price };
}

/**
 * The offer `user` can take for `trigger` right now: an active upsell whose
 * offer item they can buy (not owned, no open order, on sale), priced in the
 * trigger's currency (its fixed price in that currency when multi-currency
 * is on), taxed like the main order and costing something after the discount.
 */
async function offerFor(
  user: User,
  trigger: { type: string; id: string; currency: string },
  settings: Settings,
  upsells: readonly Upsell[],
  tax: TaxContext | null,
): Promise<UpsellOffer | null> {
  const upsell = upsellFor(upsells, trigger);
  if (!upsell) return null;
  const listed = await getBillingItem(upsell.offerItemType, upsell.offerItemId);
  const item = listed ? priceItemIn(listed, trigger.currency, settings) : null;
  if (!item || item.currency.toUpperCase() !== trigger.currency.toUpperCase()) return null;
  const access = await checkBillingAccess(user, item);
  if (access.status !== "ok") return null;
  const summary = offerSummary(item, upsell.discountPercent, settings, tax);
  if (summary.total <= 0) return null;
  return { upsell, item, summary, listTotal: computeOrderSummary(item, null, settings, tax).total };
}

/**
 * The order bump for a checkout of `item` (courses and bundles paid in one
 * payment), with the main order's tax context so both rows are taxed alike.
 */
export async function orderBumpFor(user: User, item: BillingItem, tax: TaxContext | null = null): Promise<UpsellOffer | null> {
  if (item.type !== "course" && item.type !== "bundle") return null;
  const db = await getDb();
  return offerFor(user, item, db.settings, db.upsells, tax);
}

/** The one-click offer shown on the order page of a paid course/bundle order, unless it was taken already. */
export async function postPurchaseOfferFor(user: User, payment: Payment): Promise<UpsellOffer | null> {
  if (payment.userId !== user.id || payment.status !== "paid" || payment.upsellOfPaymentId) return null;
  if (payment.itemType !== "course" && payment.itemType !== "bundle") return null;
  if (payment.installmentNumber) return null;
  const db = await getDb();
  const tax: TaxContext = { rules: db.taxRules, country: payment.taxCountry ?? payment.address?.country ?? null };
  const offer = await offerFor(user, { type: payment.itemType, id: payment.itemId, currency: payment.currency }, db.settings, db.upsells, tax);
  if (!offer) return null;
  // Already accepted (bump or one-click) from this order.
  const taken = db.payments.some((p) => p.upsellOfPaymentId === payment.id && p.itemType === offer.upsell.offerItemType && p.itemId === offer.upsell.offerItemId && p.status !== "failed");
  return taken ? null : offer;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface UpsellItemChoice {
  /** "course:<id>" / "bundle:<id>" */
  ref: string;
  type: UpsellItemType;
  id: string;
  title: string;
  price: number;
  currency: string;
  published: boolean;
}

/** Courses (paid) and bundles an upsell can use as trigger or offer. */
export function upsellItemChoices(db: Pick<Database, "courses" | "bundles">): UpsellItemChoice[] {
  const courses = db.courses
    .filter((c) => c.paidCourse && c.price > 0)
    .map((c) => ({ ref: itemRef("course", c.id), type: "course" as const, id: c.id, title: c.title, price: c.price, currency: c.currency || "USD", published: c.published }));
  const bundles = db.bundles.map((b) => ({ ref: itemRef("bundle", b.id), type: "bundle" as const, id: b.id, title: b.title, price: b.price, currency: b.currency || "USD", published: b.published }));
  return [...courses, ...bundles].sort((a, b) => a.title.localeCompare(b.title));
}

export interface AdminUpsellRow extends Upsell {
  triggerTitle: string;
  offerTitle: string;
  triggerHref: string | null;
  offerHref: string | null;
  /** Offer list price and the price after the discount (offer currency). */
  offerPrice: number;
  offerDiscounted: number;
  currency: string;
  /** Trigger and offer are priced in different currencies, so the bump is never shown. */
  currencyMismatch: boolean;
  /** The offer is not on sale (unpublished course, hidden bundle) or a side was deleted. */
  unavailable: boolean;
  performance: UpsellPerformance;
}

export interface AdminUpsellFilter {
  status: "all" | "active" | "paused";
  search?: string;
  page: number;
}

export const ADMIN_UPSELLS_PAGE_SIZE = 20;

export function parseAdminUpsellFilter(sp: Record<string, string | string[] | undefined> | URLSearchParams): AdminUpsellFilter {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? "") : typeof sp[k] === "string" ? (sp[k] as string) : "");
  const status = get("status");
  const page = Number.parseInt(get("page"), 10);
  return {
    status: status === "active" || status === "paused" ? status : "all",
    search: get("q").trim().slice(0, 100) || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function describe(db: Database, type: UpsellItemType, id: string): { title: string; href: string | null; price: number; currency: string; onSale: boolean } {
  if (type === "course") {
    const c = db.courses.find((x) => x.id === id);
    return c
      ? { title: c.title, href: `/courses/${c.slug}`, price: c.paidCourse ? c.price : 0, currency: c.currency || "USD", onSale: c.published && !c.upcoming && c.paidCourse && c.price > 0 }
      : { title: "Deleted course", href: null, price: 0, currency: db.settings.commerce.defaultCurrency, onSale: false };
  }
  const b = db.bundles.find((x) => x.id === id);
  return b
    ? { title: b.title, href: `/bundles/${b.slug}`, price: b.price, currency: b.currency || "USD", onSale: b.published && db.settings.growth.bundlesEnabled && bundleCourses(b, db.courses).some((c) => c.published) }
    : { title: "Deleted bundle", href: null, price: 0, currency: db.settings.commerce.defaultCurrency, onSale: false };
}

export interface AdminUpsellStats {
  total: number;
  active: number;
  accepted: number;
  revenue: { currency: string; amount: number }[];
}

export async function getAdminUpsells(filter: AdminUpsellFilter, opts: { all?: boolean } = {}): Promise<{ rows: AdminUpsellRow[]; total: number; page: number; pageCount: number; stats: AdminUpsellStats }> {
  const db = await getDb();
  const rows: AdminUpsellRow[] = db.upsells
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((u) => {
      const trigger = describe(db, u.triggerItemType, u.triggerItemId);
      const offer = describe(db, u.offerItemType, u.offerItemId);
      return {
        ...u,
        triggerTitle: trigger.title,
        offerTitle: offer.title,
        triggerHref: trigger.href,
        offerHref: offer.href,
        offerPrice: offer.price,
        offerDiscounted: discountedPrice(offer.price, u.discountPercent),
        currency: offer.currency,
        currencyMismatch: trigger.currency.toUpperCase() !== offer.currency.toUpperCase(),
        unavailable: !offer.onSale || !trigger.href,
        performance: upsellPerformance(u, db.payments),
      };
    });
  const revenue = new Map<string, number>();
  for (const r of rows) for (const [currency, amount] of Object.entries(r.performance.revenue)) revenue.set(currency, (revenue.get(currency) ?? 0) + amount);
  const stats: AdminUpsellStats = {
    total: rows.length,
    active: rows.filter((r) => r.active).length,
    accepted: rows.reduce((sum, r) => sum + r.performance.accepted, 0),
    revenue: Array.from(revenue, ([currency, amount]) => ({ currency, amount })),
  };
  const q = filter.search?.toLowerCase();
  const matched = rows.filter((r) => {
    if (filter.status === "active" && !r.active) return false;
    if (filter.status === "paused" && r.active) return false;
    return !q || `${r.headline} ${r.triggerTitle} ${r.offerTitle}`.toLowerCase().includes(q);
  });
  if (opts.all) return { rows: matched, total: matched.length, page: 1, pageCount: 1, stats };
  const pageCount = Math.max(1, Math.ceil(matched.length / ADMIN_UPSELLS_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  return { rows: matched.slice((page - 1) * ADMIN_UPSELLS_PAGE_SIZE, page * ADMIN_UPSELLS_PAGE_SIZE), total: matched.length, page, pageCount, stats };
}

function csvCell(value: string | number | undefined | null): string {
  let s = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function upsellsToCsv(rows: readonly AdminUpsellRow[]): string {
  const header = ["Headline", "Status", "Trigger type", "Trigger", "Offer type", "Offer", "Discount %", "Offer price", "Offer price after discount", "Currency", "Trigger sales", "Accepted", "Order bumps", "Post-purchase", "Conversion %", "Revenue", "Created at"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.headline,
        r.active ? "Active" : "Paused",
        r.triggerItemType,
        r.triggerTitle,
        r.offerItemType,
        r.offerTitle,
        r.discountPercent,
        (r.offerPrice / 100).toFixed(2),
        (r.offerDiscounted / 100).toFixed(2),
        r.currency,
        r.performance.triggerSales,
        r.performance.accepted,
        r.performance.bumps,
        r.performance.postPurchase,
        r.performance.conversionPercent,
        Object.entries(r.performance.revenue)
          .map(([c, a]) => formatPrice(a, c))
          .join(" + "),
        r.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
