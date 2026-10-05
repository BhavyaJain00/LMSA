"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Upsell, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { verificationError } from "@/lib/auth/verification";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { getPaymentByOrderId, insertPendingOrder, notifyAdminsOfPendingOrder, orderTaxFields } from "@/lib/data/commerce";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { GATEWAY_NAMES, checkoutUrls, createCheckout, gatewayErrorMessage, isConfigured, isRealGateway } from "@/lib/payments/gateway";
import type { CheckoutNext } from "@/lib/payments/types";
import { postPurchaseOfferFor } from "@/lib/commerce/upsell-service";
import { validateUpsellInput } from "@/lib/commerce/upsells";
import { fd, fdBool, uid } from "@/lib/utils";

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateUpsells(): void {
  revalidatePath("/admin/upsells");
  // Checkout pages and order pages show the offers.
  revalidatePath("/billing/[type]/[id]", "page");
}

/** Create or edit an upsell (admin). */
export async function saveUpsellAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Only administrators can manage upsells." };
  const id = fd(formData, "id");
  const db = await getDb();
  if (id && !db.upsells.some((u) => u.id === id)) return { ok: false, error: "This upsell no longer exists." };
  const parsed = validateUpsellInput(
    { trigger: fd(formData, "trigger"), offer: fd(formData, "offer"), discountPercent: fd(formData, "discountPercent"), headline: fd(formData, "headline"), active: fdBool(formData, "active") },
    {
      exists: (ref) => (ref.type === "course" ? db.courses.some((c) => c.id === ref.id && c.paidCourse && c.price > 0) : db.bundles.some((b) => b.id === ref.id)),
      duplicateOf: (draft) =>
        db.upsells.find(
          (u) => u.id !== id && u.triggerItemType === draft.triggerItemType && u.triggerItemId === draft.triggerItemId && u.offerItemType === draft.offerItemType && u.offerItemId === draft.offerItemId,
        )?.id ?? null,
    },
  );
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };

  const saved = await mutate((d): Upsell | null => {
    if (id) {
      const row = d.upsells.find((u) => u.id === id);
      if (!row) return null;
      Object.assign(row, parsed.value);
      return { ...row };
    }
    const row: Upsell = { id: uid("ups"), ...parsed.value, createdAt: new Date().toISOString() };
    d.upsells.push(row);
    return { ...row };
  });
  if (!saved) return { ok: false, error: "This upsell no longer exists." };
  await audit(actor, id ? "upsell.update" : "upsell.create", { type: "upsell", id: saved.id }, { discountPercent: saved.discountPercent, active: saved.active });
  revalidateUpsells();
  return { ok: true, data: { id: saved.id }, message: id ? "Upsell saved." : "Upsell created." };
}

export type UpsellBulkOp = "activate" | "pause" | "delete";

const MAX_BULK = 200;

/** Activate, pause or delete upsells. Orders that came from an upsell are never touched. */
export async function upsellsAction(ids: string[], op: UpsellBulkOp): Promise<ActionResult<{ changed: number }>> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Only administrators can manage upsells." };
  const wanted = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string" && !!x && x.length <= 64))] : [];
  if (!wanted.length) return { ok: false, error: "Select at least one upsell." };
  if (wanted.length > MAX_BULK) return { ok: false, error: `Update at most ${MAX_BULK} upsells at a time.` };
  if (op !== "activate" && op !== "pause" && op !== "delete") return { ok: false, error: "Unknown action." };
  const set = new Set(wanted);
  const changed = await mutate((d) => {
    if (op === "delete") {
      const before = d.upsells.length;
      d.upsells = d.upsells.filter((u) => !set.has(u.id));
      return before - d.upsells.length;
    }
    let n = 0;
    for (const u of d.upsells) {
      if (!set.has(u.id) || u.active === (op === "activate")) continue;
      u.active = op === "activate";
      n++;
    }
    return n;
  });
  await audit(actor, `upsell.${op}`, { type: "upsell", id: wanted.join(",").slice(0, 200) }, { count: changed });
  revalidateUpsells();
  const noun = `upsell${changed === 1 ? "" : "s"}`;
  if (!changed) return { ok: true, data: { changed }, message: "Nothing to change." };
  return { ok: true, data: { changed }, message: op === "delete" ? `${changed} ${noun} deleted.` : op === "activate" ? `${changed} ${noun} activated.` : `${changed} ${noun} paused.` };
}

/**
 * One-click post-purchase offer on the order page of a paid course or bundle
 * order: places an order for the offer at the upsell price with the billing
 * details of that order, then settles it like a checkout (free at once,
 * manual orders wait for an administrator, Stripe/Razorpay open their
 * checkout). The offer is checked again on the server.
 */
export async function acceptUpsellAction(orderId: string): Promise<ActionResult<CheckoutNext>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again to continue." };
  if (typeof orderId !== "string" || !orderId || orderId.length > 64) return { ok: false, error: "Order not found." };
  const main = await getPaymentByOrderId(orderId);
  if (!main || main.userId !== user.id) return { ok: false, error: "Order not found." };
  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: blocked };
  const offer = await postPurchaseOfferFor(user, main);
  if (!offer) return { ok: false, error: "This offer is no longer available." };

  const db = await getDb();
  const gateway = db.settings.commerce.paymentGateway;
  const settleNow = offer.summary.total <= 0 || gateway === "none";
  if (!settleNow && isRealGateway(gateway) && !isConfigured(gateway)) {
    return { ok: false, error: "Online payments are not available right now. Please try again later or contact us." };
  }
  const inserted = await insertPendingOrder({
    id: uid("pay"),
    userId: user.id,
    itemType: offer.item.type,
    itemId: offer.item.id,
    itemTitle: offer.item.title,
    ...(offer.item.bundle ? { bundleId: offer.item.bundle.id } : {}),
    upsellOfPaymentId: main.id,
    originalAmount: offer.summary.originalAmount,
    discountAmount: offer.summary.discountAmount,
    taxAmount: offer.summary.taxAmount,
    amount: offer.summary.total,
    currency: offer.summary.currency,
    ...orderTaxFields(offer.summary),
    billingName: main.billingName,
    address: main.address,
    gstin: main.gstin,
    pan: main.pan,
    ...(main.buyerVatId ? { buyerVatId: main.buyerVatId } : {}),
    source: main.source,
    // The one-click add-on is credited to the affiliate of the order it follows.
    ...(main.affiliateId ? { affiliateId: main.affiliateId } : {}),
    gateway: offer.summary.total <= 0 ? "free" : gateway,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  if (!inserted.ok) return { ok: false, error: inserted.error };
  const payment = inserted.payment;
  const page = `/billing/success/${encodeURIComponent(payment.orderId)}`;
  revalidatePath(`/billing/success/${encodeURIComponent(main.orderId)}`);
  revalidatePath("/billing/history");

  if (inserted.existing) return { ok: true, data: { kind: "redirect", url: page }, message: "You already have an open order for this." };
  if (settleNow) {
    const res = await fulfillPayment(payment.id, undefined, { source: "checkout" });
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath("/", "layout");
    return { ok: true, data: { kind: "redirect", url: page }, message: `${offer.item.title} is yours. Enjoy!` };
  }
  if (gateway === "manual") {
    await notifyAdminsOfPendingOrder(payment, user.name);
    return { ok: true, data: { kind: "redirect", url: page }, message: "Order placed. We'll confirm your payment shortly." };
  }
  try {
    const next = await createCheckout(payment, checkoutUrls(payment));
    return { ok: true, data: next, message: next.kind === "redirect" ? `Redirecting to ${GATEWAY_NAMES[gateway as keyof typeof GATEWAY_NAMES] ?? "payment"}…` : undefined };
  } catch (error) {
    await mutate((d) => {
      d.payments = d.payments.filter((p) => !(p.id === payment.id && p.status === "pending" && !p.gatewayOrderId));
    });
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}
