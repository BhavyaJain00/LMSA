"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { verificationError } from "@/lib/auth/verification";
import { getRequestInfo } from "@/lib/auth/request-info";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { notifyAdminsOfPendingOrder } from "@/lib/data/commerce";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { GATEWAY_NAMES, checkoutUrls, createCheckout, gatewayErrorMessage, isConfigured, isRealGateway, resumeCheckout } from "@/lib/payments/gateway";
import { billingFields, readBilling, validateBilling } from "@/lib/payments/billing-input";
import type { CheckoutNext } from "@/lib/payments/types";
import { deliverGift, giftSummary, insertGiftOrder, redeemGift, resolveGiftItem, updateScheduledGift } from "@/lib/commerce/gift-service";
import { parseGiftItemType, validateGiftInput } from "@/lib/commerce/gifts";
import { fd } from "@/lib/utils";

function orderPath(orderId: string): string {
  return `/billing/success/${encodeURIComponent(orderId)}`;
}

function revalidateGifts(orderId?: string): void {
  revalidatePath("/gift");
  revalidatePath("/billing/history");
  revalidatePath("/admin/settings/plans");
  revalidatePath("/admin/settings/transactions");
  if (orderId) revalidatePath(orderPath(orderId));
}

/**
 * Buy a course, bundle or membership plan as a gift. The price is computed
 * on the server (item price and tax; gifts take no coupons) and the order is
 * settled like any checkout: free/no gateway at once, manual orders wait for
 * an administrator, Stripe/Razorpay open their checkout. The recipient is
 * emailed once the order is paid (or at the chosen send time).
 */
export async function placeGiftOrderAction(_prev: ActionResult<CheckoutNext> | null, formData: FormData): Promise<ActionResult<CheckoutNext>> {
  const type = parseGiftItemType(fd(formData, "giftType"));
  const itemId = fd(formData, "itemId");
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Please log in to buy a gift.", "warning");
    redirect(`/login?next=${encodeURIComponent(safeRedirectPath(type && itemId ? `/gift?type=${type}&id=${encodeURIComponent(itemId)}` : "/gift", "/gift"))}`);
  }
  if (!type || !itemId) return { ok: false, error: "Choose what you'd like to give." };
  const check = await resolveGiftItem(type, itemId);
  if (!check.ok) return { ok: false, error: check.error };
  const item = check.item;

  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: blocked };

  const gift = validateGiftInput(
    { recipientEmail: fd(formData, "recipientEmail"), recipientName: fd(formData, "recipientName"), message: fd(formData, "message"), sendAt: fd(formData, "sendAt") },
    { buyerEmail: user.email },
  );
  const db = await getDb();
  const settings = db.settings;
  const input = readBilling(formData);
  const fieldErrors = { ...(gift.ok ? {} : gift.errors), ...validateBilling(input, settings.commerce.applyTax) };
  if (Object.keys(fieldErrors).length || !gift.ok) return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the errors below.", fieldErrors };

  const summary = giftSummary(item, settings);
  const expected = fd(formData, "expectedTotal");
  if (expected !== "" && Number(expected) !== summary.total) {
    return { ok: false, error: "The price changed while you were checking out. Please review the updated order summary and try again." };
  }
  const gateway = settings.commerce.paymentGateway;
  const settleNow = summary.total <= 0 || gateway === "none";
  if (!settleNow && isRealGateway(gateway) && !isConfigured(gateway)) {
    return { ok: false, error: "Online payments are not available right now. Please try again later or contact us." };
  }

  const inserted = await insertGiftOrder({ buyer: user, item, summary, draft: gift.value, billing: billingFields(input, settings.commerce.applyTax), gateway });
  if (!inserted.ok) return { ok: false, error: inserted.error };
  const { payment, existing } = inserted;
  await audit(user, "gift.order", { type: "gift", id: inserted.gift.id }, { orderId: payment.orderId, itemType: type, itemId: item.id, scheduled: !!gift.value.sendAt });

  if (existing && payment.gateway === "manual") {
    await setFlash("You already have an open order for this gift. Its message and date were updated.", "info");
    redirect(orderPath(payment.orderId));
  }

  if (settleNow) {
    const res = await fulfillPayment(payment.id, undefined, { source: "checkout" });
    if (!res.ok) return { ok: false, error: res.error };
    revalidateGifts(payment.orderId);
    await setFlash(gift.value.sendAt ? "Your gift is ready and will be emailed on the date you chose." : "Your gift is on its way!", "success");
    redirect(orderPath(payment.orderId));
  }

  if (gateway === "manual") {
    await notifyAdminsOfPendingOrder(payment, user.name);
    revalidateGifts(payment.orderId);
    await setFlash("Order placed. We'll send your gift as soon as we confirm the payment.", "success");
    redirect(orderPath(payment.orderId));
  }

  if (existing) {
    // The same gift is already being paid: continue that checkout instead of opening a second one.
    const resumed = await resumeCheckout(payment);
    revalidateGifts(payment.orderId);
    return resumed.ok ? { ok: true, data: resumed.next, message: resumed.message } : { ok: false, error: resumed.error };
  }

  try {
    const next = await createCheckout(payment, checkoutUrls(payment));
    revalidateGifts(payment.orderId);
    return { ok: true, data: next, message: next.kind === "redirect" ? `Redirecting to ${GATEWAY_NAMES[gateway as keyof typeof GATEWAY_NAMES] ?? "payment"}…` : undefined };
  } catch (error) {
    // Nothing reached the gateway: drop the order (and its gift) so the buyer can simply try again.
    await mutate((d) => {
      const dropped = d.payments.some((p) => p.id === payment.id && p.status === "pending" && !p.gatewayOrderId);
      if (!dropped) return;
      d.payments = d.payments.filter((p) => p.id !== payment.id);
      d.gifts = d.gifts.filter((g) => g.id !== inserted.gift.id);
    });
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}

/** Change the recipient, message or send date of a gift that was not delivered yet. */
export async function updateGiftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again to continue." };
  const giftId = fd(formData, "giftId");
  const gift = validateGiftInput(
    { recipientEmail: fd(formData, "recipientEmail"), recipientName: fd(formData, "recipientName"), message: fd(formData, "message"), sendAt: fd(formData, "sendAt") },
    { buyerEmail: user.email },
  );
  if (!gift.ok) return { ok: false, error: Object.values(gift.errors)[0] ?? "Please fix the errors below.", fieldErrors: gift.errors };
  const res = await updateScheduledGift(user, giftId, gift.value);
  if (!res.ok) return { ok: false, error: res.error };
  // A date that is now (or cleared) sends it right away.
  if (!gift.value.sendAt) await deliverGift(giftId);
  revalidateGifts();
  return { ok: true, data: undefined, message: gift.value.sendAt ? "Gift updated." : "Gift updated and sent." };
}

async function ownGiftOrAdmin(giftId: string): Promise<{ user: User } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in again to continue." };
  if (typeof giftId !== "string" || !giftId || giftId.length > 64) return { error: "Gift not found." };
  const db = await getDb();
  const gift = db.gifts.find((g) => g.id === giftId);
  if (!gift || (gift.purchaserId !== user.id && !isAdmin(user))) return { error: "Gift not found." };
  return { user };
}

/** Email a delivered gift again, or send a scheduled one now (buyer or administrator). */
export async function sendGiftNowAction(giftId: string): Promise<ActionResult> {
  const found = await ownGiftOrAdmin(giftId);
  if ("error" in found) return { ok: false, error: found.error };
  const db = await getDb();
  const gift = db.gifts.find((g) => g.id === giftId)!;
  let res;
  if (gift.sentAt) {
    res = await deliverGift(giftId, { resend: true, actor: isAdmin(found.user) ? found.user : undefined });
  } else {
    await mutate((d) => {
      const row = d.gifts.find((g) => g.id === giftId);
      if (row && !row.sentAt) row.sendAt = undefined;
    });
    res = await deliverGift(giftId);
  }
  revalidateGifts();
  return res.ok ? { ok: true, data: undefined, message: res.message } : { ok: false, error: res.error };
}

/** Redeem a gift code. Requires an account (any email address); the code works once. */
export async function redeemGiftAction(_prev: ActionResult<{ href: string }> | null, formData: FormData): Promise<ActionResult<{ href: string }>> {
  const code = fd(formData, "code");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeRedirectPath(`/redeem?code=${encodeURIComponent(code.slice(0, 40))}`, "/redeem"))}`);
  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: blocked };
  const { ip } = await getRequestInfo();
  const res = await redeemGift(user, code, ip);
  if (!res.ok) return { ok: false, error: res.error, fieldErrors: res.field ? { code: res.error } : undefined };
  revalidatePath("/", "layout");
  await setFlash(`${res.title} is yours. Enjoy!`, "success");
  redirect(safeRedirectPath(res.href, "/dashboard"));
}

/** Turn selling gifts on or off. Gifts already bought can still be delivered and redeemed. */
export async function setGiftsEnabledAction(enabled: boolean): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor)) return { ok: false, error: "Only administrators can change payment settings." };
  const on = enabled === true;
  await mutate((d) => {
    d.settings.growth.giftsEnabled = on;
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(actor, "settings.update", { type: "settings", id: "growth" }, { giftsEnabled: on });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: on ? "Courses, bundles and plans can be given as gifts." : "Gift checkout is closed. Gifts already bought still work." };
}
