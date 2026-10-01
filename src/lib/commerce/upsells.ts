import type { Payment, Upsell } from "@/lib/types";

/**
 * Upsell rules (pure, unit tested).
 *
 * An upsell links a trigger item (course or bundle) to an offer item at a
 * discount. It is shown twice:
 *  - as an ORDER BUMP on the trigger's checkout: ticking it adds the offer as
 *    a second order row (`<main order id>-B`, `upsellOfPaymentId` = the main
 *    row) charged in the same gateway checkout and settled with it;
 *  - as a POST-PURCHASE offer on the trigger's order page: one click places
 *    a separate order (`upsellOfPaymentId` = the paid trigger order).
 */

export type UpsellItemType = Upsell["triggerItemType"];

export function parseUpsellItemType(raw: unknown): UpsellItemType | null {
  return raw === "course" || raw === "bundle" ? raw : null;
}

export const BUMP_ORDER_SUFFIX = "-B";

export function bumpOrderId(mainOrderId: string): string {
  return `${mainOrderId}${BUMP_ORDER_SUFFIX}`;
}

/** An order-bump row (charged together with its main order). */
export function isOrderBump(p: Pick<Payment, "orderId" | "upsellOfPaymentId">): boolean {
  return !!p.upsellOfPaymentId && p.orderId.endsWith(BUMP_ORDER_SUFFIX);
}

/** The order-bump rows charged together with `main`. */
export function bumpsOf<P extends Pick<Payment, "orderId" | "upsellOfPaymentId">>(payments: readonly P[], main: Pick<Payment, "id">): P[] {
  return payments.filter((p) => p.upsellOfPaymentId === main.id && isOrderBump(p));
}

/**
 * What the gateway checkout of `main` charges: its own amount plus every
 * order bump that is still part of the purchase (not cancelled).
 */
export function chargeAmount(payments: readonly Pick<Payment, "id" | "orderId" | "upsellOfPaymentId" | "amount" | "status">[], main: Pick<Payment, "id" | "amount">): number {
  return main.amount + bumpsOf(payments, main).filter((b) => b.status !== "failed").reduce((sum, b) => sum + b.amount, 0);
}

/** Offer price after the upsell discount (smallest currency unit, rounded). */
export function discountedPrice(price: number, discountPercent: number): number {
  const pct = Math.min(100, Math.max(0, discountPercent));
  return Math.max(0, Math.round((Math.max(0, price) * (100 - pct)) / 100));
}

/** The active upsell offered for a trigger item (the oldest one when several exist). */
export function upsellFor(upsells: readonly Upsell[], trigger: { type: string; id: string }): Upsell | null {
  return (
    upsells
      .filter((u) => u.active && u.triggerItemType === trigger.type && u.triggerItemId === trigger.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Admin form                                                          */
/* ------------------------------------------------------------------ */

export const UPSELL_HEADLINE_MAX = 140;

export interface UpsellFormInput {
  trigger: string;
  offer: string;
  discountPercent: string;
  headline: string;
  active: boolean;
}

export interface UpsellDraft {
  triggerItemType: UpsellItemType;
  triggerItemId: string;
  offerItemType: UpsellItemType;
  offerItemId: string;
  discountPercent: number;
  headline: string;
  active: boolean;
}

/** "course:crs_1" / "bundle:bnd_2" — how the admin form encodes an item choice. */
export function parseItemRef(raw: string): { type: UpsellItemType; id: string } | null {
  const [type, ...rest] = raw.split(":");
  const t = parseUpsellItemType(type);
  const id = rest.join(":").trim();
  return t && id ? { type: t, id } : null;
}

export function itemRef(type: UpsellItemType, id: string): string {
  return `${type}:${id}`;
}

export type UpsellValidation = { ok: true; value: UpsellDraft } | { ok: false; errors: Record<string, string> };

/**
 * Validate the admin form. `exists` says whether an item exists;
 * `duplicateOf` returns the id of another upsell with the same trigger and
 * offer (two identical offers would compete for the same checkout).
 */
export function validateUpsellInput(
  input: UpsellFormInput,
  ctx: { exists: (ref: { type: UpsellItemType; id: string }) => boolean; duplicateOf: (draft: UpsellDraft) => string | null },
): UpsellValidation {
  const errors: Record<string, string> = {};
  const trigger = parseItemRef(input.trigger);
  const offer = parseItemRef(input.offer);
  if (!trigger) errors.trigger = "Choose the course or bundle that triggers the offer.";
  else if (!ctx.exists(trigger)) errors.trigger = "This item no longer exists.";
  if (!offer) errors.offer = "Choose the course or bundle to offer.";
  else if (!ctx.exists(offer)) errors.offer = "This item no longer exists.";
  if (trigger && offer && trigger.type === offer.type && trigger.id === offer.id) errors.offer = "Offer something other than the item that was just bought.";

  const raw = input.discountPercent.trim();
  const pct = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(pct) || !Number.isInteger(pct) || pct < 0 || pct > 95) errors.discountPercent = "Enter a whole percentage from 0 to 95.";

  const headline = input.headline.replace(/\s+/g, " ").trim();
  if (headline.length < 3) errors.headline = "Write a short headline (at least 3 characters).";
  else if (headline.length > UPSELL_HEADLINE_MAX) errors.headline = `Keep the headline under ${UPSELL_HEADLINE_MAX} characters.`;

  if (Object.keys(errors).length || !trigger || !offer) return { ok: false, errors };
  const value: UpsellDraft = {
    triggerItemType: trigger.type,
    triggerItemId: trigger.id,
    offerItemType: offer.type,
    offerItemId: offer.id,
    discountPercent: pct,
    headline,
    active: input.active,
  };
  const duplicate = ctx.duplicateOf(value);
  if (duplicate) return { ok: false, errors: { offer: "An upsell with the same trigger and offer already exists. Edit that one instead." } };
  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export interface UpsellPerformance {
  /** Paid orders of the trigger item (each one saw the offer at checkout or after it). */
  triggerSales: number;
  /** Paid offer orders that came from this upsell (bump or post-purchase). */
  accepted: number;
  bumps: number;
  postPurchase: number;
  /** Net revenue of the accepted orders, per currency (smallest unit). */
  revenue: Record<string, number>;
  /** accepted / triggerSales in percent, one decimal. */
  conversionPercent: number;
}

type Row = Pick<Payment, "id" | "orderId" | "itemType" | "itemId" | "status" | "amount" | "currency" | "refundedAmount" | "upsellOfPaymentId">;

/** How an upsell performed, from the orders. An accepted order is attributed by its trigger order's item and its own item. */
export function upsellPerformance(upsell: Pick<Upsell, "triggerItemType" | "triggerItemId" | "offerItemType" | "offerItemId">, payments: readonly Row[]): UpsellPerformance {
  const byId = new Map(payments.map((p) => [p.id, p]));
  const isTrigger = (p: Row) => p.itemType === upsell.triggerItemType && p.itemId === upsell.triggerItemId;
  let triggerSales = 0;
  let accepted = 0;
  let bumps = 0;
  let postPurchase = 0;
  const revenue: Record<string, number> = {};
  for (const p of payments) {
    if (p.status !== "paid" && p.status !== "refunded") continue;
    if (isTrigger(p) && !p.upsellOfPaymentId && p.status === "paid") triggerSales++;
    if (!p.upsellOfPaymentId || p.itemType !== upsell.offerItemType || p.itemId !== upsell.offerItemId) continue;
    const main = byId.get(p.upsellOfPaymentId);
    if (!main || !isTrigger(main)) continue;
    const kept = p.status === "refunded" ? p.amount - Math.min(p.amount, p.refundedAmount ?? p.amount) : p.amount - Math.min(p.amount, p.refundedAmount ?? 0);
    if (p.status === "paid") {
      accepted++;
      if (isOrderBump(p)) bumps++;
      else postPurchase++;
    }
    if (kept > 0) revenue[p.currency] = (revenue[p.currency] ?? 0) + kept;
  }
  return { triggerSales, accepted, bumps, postPurchase, revenue, conversionPercent: triggerSales ? Math.round((accepted / triggerSales) * 1000) / 10 : 0 };
}

/* ------------------------------------------------------------------ */
/* Refunds of a shared gateway payment                                 */
/* ------------------------------------------------------------------ */

export interface GroupRefundRow {
  id: string;
  amount: number;
  /** What is recorded as refunded on the row so far. */
  refundedAmount: number;
  main: boolean;
}

/**
 * Split the total a gateway reports as refunded on one payment shared by an
 * order and its bumps. Refunds already recorded on the bumps stay theirs
 * (they were sent from here for that row); the rest goes to the main order
 * first, then to the bumps in order, never above any row's amount. `full`
 * means the whole payment was refunded. Returns the refunded total per row.
 */
export function allocateGroupRefund(rows: readonly GroupRefundRow[], total: number, full: boolean): Map<string, number> {
  const out = new Map<string, number>();
  if (full) {
    for (const r of rows) out.set(r.id, r.amount);
    return out;
  }
  let left = Math.max(0, Math.round(total));
  const bumps = rows.filter((r) => !r.main);
  for (const b of bumps) {
    const kept = Math.min(b.amount, b.refundedAmount, left);
    out.set(b.id, kept);
    left -= kept;
  }
  for (const m of rows.filter((r) => r.main)) {
    const take = Math.min(m.amount, left);
    out.set(m.id, take);
    left -= take;
  }
  for (const b of bumps) {
    const have = out.get(b.id) ?? 0;
    const take = Math.min(b.amount - have, left);
    out.set(b.id, have + take);
    left -= take;
  }
  return out;
}
