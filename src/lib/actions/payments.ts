"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Payment, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import {
  checkBillingAccess,
  computeOrderSummary,
  fulfillPayment,
  generateOrderId,
  getBillingItem,
  notifyAdminsOfPendingOrder,
  parseItemType,
  refundPayment,
  validateCoupon,
} from "@/lib/data/commerce";
import { BILLING_SOURCES, GSTIN_RE, PAN_RE, canonicalIndianState, isKnownCountry } from "@/components/commerce/countries";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, uid } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

interface BillingInput {
  billingName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gstin: string;
  pan: string;
  source: string;
  consent: boolean;
}

function readBilling(formData: FormData): BillingInput {
  return {
    billingName: fd(formData, "billingName"),
    line1: fd(formData, "line1"),
    line2: fd(formData, "line2"),
    city: fd(formData, "city"),
    state: fd(formData, "state"),
    country: fd(formData, "country"),
    pincode: fd(formData, "pincode"),
    gstin: fd(formData, "gstin").toUpperCase(),
    pan: fd(formData, "pan").toUpperCase(),
    source: fd(formData, "source"),
    consent: fdBool(formData, "consent"),
  };
}

/** Validation order mirrors Frappe's checkout: source, consent, mandatory fields, tax ids, state. */
function validateBilling(input: BillingInput, applyTax: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.source || !(BILLING_SOURCES as readonly string[]).includes(input.source)) {
    errors.source = "Please let us know where you heard about us from.";
  }
  if (!input.consent) errors.consent = "Please provide your consent to proceed with the payment.";
  if (input.billingName.length < 2 || input.billingName.length > 140) errors.billingName = "Please enter a valid Billing Name";
  if (input.line1.length < 3 || input.line1.length > 200) errors.line1 = "Please enter a valid Address Line 1";
  if (input.line2.length > 200) errors.line2 = "Please enter a valid Address Line 2";
  if (input.city.length < 2 || input.city.length > 100) errors.city = "Please enter a valid City";
  if (!isKnownCountry(input.country)) errors.country = "Please select your country.";
  if (input.pincode && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(input.pincode)) errors.pincode = "Please enter a valid Postal Code";
  if (input.country === "India") {
    if (!input.state) errors.state = "Please select your state.";
    else if (!canonicalIndianState(input.state)) errors.state = "Please select your state from the list.";
  } else if (input.state.length > 100) {
    errors.state = "Please enter a valid State/Province";
  }
  if (applyTax) {
    if (input.gstin && !GSTIN_RE.test(input.gstin)) errors.gstin = "Please enter a valid GST number.";
    if (input.gstin && !input.pan) errors.pan = "Please enter a valid pan number.";
    else if (input.pan && !PAN_RE.test(input.pan)) errors.pan = "Please enter a valid pan number.";
  }
  return errors;
}

/**
 * Place an order for a course, batch or certificate.
 *
 * Gateways:
 *  - total 0 or gateway "none" → recorded as paid immediately and fulfilled.
 *  - "manual"   → pending payment; admins confirm it in Settings → Transactions.
 *  - "stripe" / "razorpay" → test mode: the payment is captured immediately.
 */
export async function placeOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const type = parseItemType(fd(formData, "itemType"));
  const itemId = fd(formData, "itemId");
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Please login to continue with payment.", "warning");
    redirect(`/login?next=${encodeURIComponent(type && itemId ? `/billing/${type}/${itemId}` : "/courses")}`);
  }
  if (!type || !itemId) return { ok: false, error: "Module is incorrect." };

  const item = await getBillingItem(type, itemId);
  if (!item) return { ok: false, error: "Module Name is incorrect or does not exist." };

  const access = await checkBillingAccess(user, item);
  if (access.status === "owned" || access.status === "free") redirect(access.redirectTo);
  if (access.status === "pending") redirect(`/billing/success/${access.payment.orderId}`);
  if (access.status === "denied") return { ok: false, error: access.message };

  const db = await getDb();
  const settings = db.settings;
  const input = readBilling(formData);
  const fieldErrors = validateBilling(input, settings.commerce.applyTax);
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the errors below.", fieldErrors };
  }

  const couponCode = fd(formData, "coupon");
  let coupon = null;
  if (couponCode) {
    const check = await validateCoupon(couponCode, item);
    if (!check.ok) return { ok: false, error: check.error, fieldErrors: { coupon: check.error } };
    coupon = check.coupon;
  }

  const summary = computeOrderSummary(item, coupon, settings);
  const expected = fd(formData, "expectedTotal");
  if (expected !== "" && Number(expected) !== summary.total) {
    return { ok: false, error: "The price changed while you were checking out. Please review the updated order summary and try again." };
  }

  const gateway = settings.commerce.paymentGateway;
  const settleNow = summary.total <= 0 || gateway === "none";
  const payment: Payment = {
    id: uid("pay"),
    orderId: await generateOrderId(),
    userId: user.id,
    itemType: type,
    itemId: item.id,
    itemTitle: item.title,
    originalAmount: summary.originalAmount,
    discountAmount: summary.discountAmount,
    taxAmount: summary.taxAmount,
    amount: summary.total,
    currency: summary.currency,
    couponId: coupon?.id,
    couponCode: coupon?.code,
    billingName: input.billingName,
    address: {
      line1: input.line1,
      line2: input.line2 || undefined,
      city: input.city,
      state: input.country === "India" ? (canonicalIndianState(input.state) ?? undefined) : input.state || undefined,
      country: input.country,
      pincode: input.pincode || undefined,
    },
    gstin: settings.commerce.applyTax ? input.gstin || undefined : undefined,
    pan: settings.commerce.applyTax ? input.pan || undefined : undefined,
    source: input.source,
    gateway: summary.total <= 0 ? "free" : gateway,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    d.payments.push(payment);
  });

  let flash = "Your order has been placed.";
  if (settleNow) {
    const res = await fulfillPayment(payment.id);
    if (!res.ok) return { ok: false, error: res.error };
    flash = summary.total <= 0 ? "You're enrolled! Enjoy learning." : "Your order is confirmed.";
  } else if (gateway === "manual") {
    await notifyAdminsOfPendingOrder(payment, user.name);
    flash = "Order placed. We'll confirm your payment shortly.";
  } else {
    /*
     * Real gateway integration goes here. For Stripe: create a Checkout
     * Session for `summary.total` in `summary.currency` with metadata
     * { paymentId }, redirect the learner to `session.url`, and call
     * fulfillPayment(paymentId, { gatewayPaymentId }) from the verified
     * `checkout.session.completed` webhook. For Razorpay: create an order,
     * open Razorpay Checkout on the client, verify the signature server-side
     * and fulfil on `payment.captured`. In test mode we simulate an
     * immediate successful capture.
     */
    const res = await fulfillPayment(payment.id, { gatewayPaymentId: `test_${gateway}_${uid()}` });
    if (!res.ok) return { ok: false, error: res.error };
    flash = "Test payment successful.";
  }

  revalidatePath("/", "layout");
  await setFlash(flash, "success");
  redirect(`/billing/success/${payment.orderId}`);
}

/** Let a learner cancel their own order while it is still awaiting confirmation. */
export async function cancelOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const orderId = fd(formData, "orderId");
  const db = await getDb();
  const payment = db.payments.find((p) => p.orderId === orderId);
  if (!payment || payment.userId !== user.id) return { ok: false, error: "Order not found." };
  if (payment.status !== "pending") return { ok: false, error: "Only orders awaiting confirmation can be cancelled." };
  await mutate((d) => {
    const row = d.payments.find((p) => p.id === payment.id);
    if (row && row.status === "pending") row.status = "failed";
  });
  revalidatePath(`/billing/success/${payment.orderId}`);
  revalidatePath("/admin/settings/transactions");
  return { ok: true, data: undefined, message: "Your order has been cancelled." };
}

/* ------------------------------------------------------------------ */
/* Admin: transactions                                                 */
/* ------------------------------------------------------------------ */

async function requireAdminActor(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateCommerce() {
  revalidatePath("/admin/settings/transactions");
  revalidatePath("/", "layout");
}

/** Confirm a (manual) payment and fulfil the order. */
export async function markPaymentPaidAction(paymentId: string): Promise<ActionResult<{ notice?: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can confirm payments." };
  const db = await getDb();
  const payment = db.payments.find((p) => p.id === paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "paid") return { ok: false, error: "This order is already paid." };
  const res = await fulfillPayment(paymentId, { gatewayPaymentId: payment.gateway === "manual" ? `manual_${actor.id}_${Date.now()}` : undefined });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommerce();
  return { ok: true, data: { notice: res.data.notice }, message: `Order ${payment.orderId} marked as paid.` };
}

/** Refund a paid order and remove the access it granted. */
export async function refundPaymentAction(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can refund payments." };
  const res = await refundPayment(paymentId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommerce();
  return { ok: true, data: undefined, message: `Order ${res.data.orderId} refunded.` };
}

/** Delete an unpaid, cancelled or refunded payment record. */
export async function deletePaymentAction(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can delete transactions." };
  const db = await getDb();
  const payment = db.payments.find((p) => p.id === paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "paid") return { ok: false, error: "Refund this order before deleting it." };
  await mutate((d) => {
    d.payments = d.payments.filter((p) => p.id !== paymentId);
  });
  revalidateCommerce();
  return { ok: true, data: undefined, message: "Transaction deleted successfully" };
}
