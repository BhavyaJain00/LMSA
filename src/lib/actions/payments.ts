"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Database, Payment, Settings, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import {
  checkBillingAccess,
  checkReminderEligibility,
  computeOrderSummary,
  generateOrderId,
  getBillingItem,
  getPaymentByOrderId,
  insertPendingOrder,
  installmentCheckout,
  membershipTerms,
  notifyAdminsOfPendingOrder,
  orderTaxFields,
  parseItemType,
  priceItemIn,
  sendPaymentReminder,
  sendPendingPaymentReminders,
  validateCouponForBuyer,
} from "@/lib/data/commerce";
import {
  acquireRefundLock,
  applyRefund,
  fulfillPayment,
  isGatewayPaymentReference,
  markPaymentFailed,
  recordGatewayRefund,
  releaseRefundLock,
  type FulfillmentResult,
} from "@/lib/payments/fulfillment";
import {
  GATEWAY_NAMES,
  checkoutUrls,
  closeGatewayCheckout,
  confirmRazorpayCheckout,
  createCheckout,
  gatewayErrorMessage,
  isConfigured,
  isRealGateway,
  isValidRazorpayCheckoutSignature,
  readGatewayRefunds,
  refundsViaGateway,
  reportUnmatchedPayment,
  resumeCheckout,
  sendGatewayRefund,
  syncPaymentStatus,
  testGatewayConnection,
} from "@/lib/payments/gateway";
import { GatewayError } from "@/lib/payments/http";
import { parseDecimalAmount } from "@/lib/payments/amounts";
import { assertPrerequisitesMet } from "@/lib/services/drip";
import { verificationError } from "@/lib/auth/verification";
import type { CheckoutNext } from "@/lib/payments/types";
import { GSTIN_RE, PAN_RE } from "@/components/commerce/countries";
import { billingFields, readBilling, validateBilling, validateVatId } from "@/lib/payments/billing-input";
import { normalizeVatId } from "@/lib/commerce/vat-id";
import { setFlash } from "@/lib/flash";
import { currencies } from "@/lib/config";
import { fd, fdBool, formatPrice, uid } from "@/lib/utils";
import { currentSubscription, ownedCourseIds } from "@/lib/commerce/access";
import { bundleCourses } from "@/lib/commerce/bundles";
import { installmentItemTitle, isInstallmentOrder, validateInstallmentInput } from "@/lib/commerce/installments";
import {
  cancelInstallmentPlan,
  payInstallment,
  remindInstallment,
  setCourseInstallments,
  waiveInstallments,
  type ServiceResult as InstallmentResult,
} from "@/lib/commerce/installment-service";
import { confirmRazorpayMembership } from "@/lib/commerce/memberships";
import { startManualTrial } from "@/lib/commerce/membership-store";
import { isRecurringInterval } from "@/lib/commerce/plans";
import { isGatewayManaged, isOngoing } from "@/lib/commerce/subscriptions";
import { orderBumpFor } from "@/lib/commerce/upsell-service";
import { isOrderBump } from "@/lib/commerce/upsells";
import { normalizeCurrency } from "@/lib/commerce/currency";
import { validateRecoverySettings } from "@/lib/commerce/checkout-recovery";
import { processAbandonedCheckouts } from "@/lib/commerce/checkout-sessions";
import { countryCode, type TaxContext } from "@/lib/commerce/tax";
import { reverseChargeCheck } from "@/lib/commerce/vies";
import { referralAffiliateIdForCheckout } from "@/lib/growth/attribution";
import { trackCheckoutStarted } from "@/lib/growth/checkout-tracking";

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

function orderPath(orderId: string): string {
  return `/billing/success/${encodeURIComponent(orderId)}`;
}

function revalidateOrder(orderId: string) {
  revalidatePath(orderPath(orderId));
  revalidatePath("/billing/history");
  revalidatePath("/admin/settings/transactions");
}

/**
 * Place an order for a course, batch, certificate, membership plan, bundle or
 * team seats.
 * The amount is computed here from the item price, the coupon and the tax
 * settings — never taken from the browser. A course sold in installments can
 * be ordered with `paymentOption=installments`: the order is then the first
 * of the plan's equal payments, and the rest are scheduled once it is paid.
 *
 * Gateways:
 *  - total 0 or gateway "none" → recorded as paid immediately and fulfilled.
 *  - "manual"   → pending payment; admins confirm it in Settings → Transactions.
 *  - "stripe"   → returns the hosted Stripe Checkout URL to redirect to.
 *  - "razorpay" → returns the options for the Razorpay Checkout modal.
 */
export async function placeOrderAction(_prev: ActionResult<CheckoutNext> | null, formData: FormData): Promise<ActionResult<CheckoutNext>> {
  const type = parseItemType(fd(formData, "itemType"));
  const itemId = fd(formData, "itemId");
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Please login to continue with payment.", "warning");
    redirect(`/login?next=${encodeURIComponent(type && itemId ? `/billing/${type}/${itemId}` : "/courses")}`);
  }
  if (!type || !itemId) return { ok: false, error: "Module is incorrect." };

  const listed = await getBillingItem(type, itemId);
  if (!listed) return { ok: false, error: "Module Name is incorrect or does not exist." };
  // Priced in the currency the buyer saw at checkout (a fixed price in that currency, else the default).
  const postedCurrency = normalizeCurrency(fd(formData, "currency"));
  const item = priceItemIn(listed, postedCurrency, (await getDb()).settings);
  if (postedCurrency && postedCurrency !== item.currency.toUpperCase()) {
    return { ok: false, error: "This item is no longer sold in the currency you chose. Reload the page to see the current price." };
  }

  const access = await checkBillingAccess(user, item);
  if (access.status === "owned" || access.status === "free") redirect(access.redirectTo);
  if (access.status === "pending") redirect(orderPath(access.payment.orderId));
  if (access.status === "denied") return { ok: false, error: access.message };

  // Members who must confirm their email can't purchase until they do (Settings → Security).
  const blocked = await verificationError(user);
  if (blocked) return { ok: false, error: blocked };

  const db = await getDb();
  const settings = db.settings;
  const input = readBilling(formData);
  const fieldErrors = validateBilling(input, settings.commerce.applyTax);
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the errors below.", fieldErrors };
  }

  const couponCode = fd(formData, "coupon");
  if (couponCode && item.plan && isRecurringInterval(item.plan.interval)) {
    const error = "Coupons can't be used for memberships that renew.";
    return { ok: false, error, fieldErrors: { coupon: error } };
  }
  let coupon = null;
  if (couponCode) {
    // Rate limited per buyer and IP: codes cannot be guessed by submitting checkouts either.
    const check = await validateCouponForBuyer(couponCode, item, { userId: user.id });
    if (!check.ok) return { ok: false, error: check.error, fieldErrors: { coupon: check.error } };
    coupon = check.coupon;
  }

  // Paying in parts: the plan is priced as one order (surcharge, coupon, tax) and split into equal payments.
  const wantsInstallments = fd(formData, "paymentOption") === "installments";
  // Tax for the country of the billing address (by-country tax), computed here, never taken from the browser.
  // A business buyer's VAT number can make it an EU reverse-charge sale (no VAT, noted on the invoice).
  const tax: TaxContext = { rules: db.taxRules, country: countryCode(input.country), vatId: input.vatId || null };
  const split = wantsInstallments ? installmentCheckout(item, coupon, settings, tax) : null;
  if (wantsInstallments && !split) {
    return { ok: false, error: "This course can no longer be paid in installments. Reload the page to see the current payment options." };
  }
  const summary = split ? split.full : computeOrderSummary(item, coupon, settings, tax);
  // What this order charges: the first payment of a plan, or the whole summary.
  const charge = split ? split.part : { originalAmount: summary.originalAmount, discountAmount: summary.discountAmount, taxAmount: summary.taxAmount, amount: summary.total };
  const expected = fd(formData, "expectedTotal");
  if (expected !== "" && Number(expected) !== charge.amount) {
    return { ok: false, error: "The price changed while you were checking out. Please review the updated order summary and try again." };
  }

  // A reverse-charged sale needs a VAT number the EU registry (VIES) knows.
  const vat = await reverseChargeCheck(summary, input.vatId);
  if (!vat.ok) return { ok: false, error: vat.error, fieldErrors: { vatId: vat.error } };
  const vatCheckFor = (s: { reverseCharge?: boolean }) => (vat.vatCheck && s.reverseCharge ? { vatCheck: vat.vatCheck } : {});

  if (type === "course") {
    // Course prerequisites (drip area) must be completed before a course checkout is created.
    const gate = await assertPrerequisitesMet(user.id, item.id);
    if (!gate.ok) return { ok: false, error: gate.error };
  }

  // Order bump ticked at checkout: offered again on the server (still active, still buyable, same price).
  const bumpId = fd(formData, "bump");
  const bump = bumpId && !split ? await orderBumpFor(user, item, tax) : null;
  if (bumpId && (!bump || bump.upsell.id !== bumpId)) {
    return { ok: false, error: "The add-on offer is no longer available. Reload the page to see your order without it." };
  }
  if (bump && fd(formData, "bumpExpected") !== "" && Number(fd(formData, "bumpExpected")) !== bump.summary.total) {
    return { ok: false, error: "The price of the add-on changed while you were checking out. Please review your order and try again." };
  }
  const total = charge.amount + (bump?.summary.total ?? 0);

  const gateway = settings.commerce.paymentGateway;
  const settleNow = total <= 0 || gateway === "none";
  if (!settleNow && isRealGateway(gateway) && !isConfigured(gateway)) {
    return { ok: false, error: "Online payments are not available right now. Please try again later or contact us." };
  }

  const billing = billingFields(input, settings.commerce.applyTax);
  // Referral attribution is stamped now, from the cookie, so the sale is credited even if the click was never linked.
  const affiliateId = await referralAffiliateIdForCheckout(user.id);
  // The funnel's "started checkout" stage, also for buyers whose browser sends no page-view beacon.
  await trackCheckoutStarted({ userId: user.id, itemType: type, itemId });
  const referral = affiliateId ? { affiliateId } : {};
  const orderGateway = total <= 0 ? "free" : gateway;
  const createdAt = new Date().toISOString();
  // The coupon's usage limit is enforced again inside this serialized insert (the use is reserved there).
  const inserted = await insertPendingOrder({
    id: uid("pay"),
    userId: user.id,
    itemType: type,
    itemId: item.id,
    itemTitle: split ? installmentItemTitle(item.title, 1, split.plan.count) : item.title,
    ...(item.plan ? { planId: item.plan.id } : {}),
    ...(item.bundle ? { bundleId: item.bundle.id } : {}),
    // Team seats: the team and the seat count (the seats are added by the growth `payment.paid` handler).
    ...(item.seats ? { orgId: item.seats.org.id, seats: item.seats.seats } : {}),
    ...(split ? { installmentNumber: 1, installmentsTotal: split.plan.count } : {}),
    originalAmount: charge.originalAmount,
    discountAmount: charge.discountAmount,
    taxAmount: charge.taxAmount,
    amount: charge.amount,
    currency: summary.currency,
    ...orderTaxFields(summary),
    ...vatCheckFor(summary),
    couponId: coupon?.id,
    couponCode: coupon?.code,
    ...billing,
    ...referral,
    gateway: orderGateway,
    status: "pending",
    createdAt,
  }, bump
    ? {
        id: uid("pay"),
        userId: user.id,
        itemType: bump.item.type,
        itemId: bump.item.id,
        itemTitle: bump.item.title,
        ...(bump.item.bundle ? { bundleId: bump.item.bundle.id } : {}),
        originalAmount: bump.summary.originalAmount,
        discountAmount: bump.summary.discountAmount,
        taxAmount: bump.summary.taxAmount,
        amount: bump.summary.total,
        currency: bump.summary.currency,
        ...orderTaxFields(bump.summary),
        ...vatCheckFor(bump.summary),
        ...billing,
        ...referral,
        gateway: orderGateway,
        status: "pending",
        createdAt,
      }
    : undefined);
  if (!inserted.ok) return { ok: false, error: inserted.error, fieldErrors: { coupon: inserted.error } };
  const { payment, existing } = inserted;
  if (existing) {
    await setFlash("You already have an open order for this item.", "info");
    redirect(orderPath(payment.orderId));
  }

  if (settleNow) {
    const res = await fulfillPayment(payment.id, undefined, { source: "checkout" });
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath("/", "layout");
    await finishFulfilledCheckout(res.data, item.course?.slug);
    await setFlash(total <= 0 ? "You're enrolled! Enjoy learning." : "Your order is confirmed.", "success");
    redirect(orderPath(payment.orderId));
  }

  if (gateway === "manual") {
    await notifyAdminsOfPendingOrder(payment, user.name);
    // A membership with a free trial starts right away; the confirmed payment then extends it from the trial's end.
    const trialDays = item.plan ? membershipTerms(db, user.id, item.plan).trialDays : 0;
    const trial = trialDays > 0 ? await startManualTrial(payment.id, trialDays) : null;
    revalidateOrder(payment.orderId);
    if (trial) revalidatePath("/", "layout");
    await setFlash(
      trial
        ? `Your ${trialDays}-day free trial has started. We'll confirm your payment before it ends.`
        : split
          ? `Order placed. Your plan of ${split.plan.count} payments starts when we confirm the first one.`
          : "Order placed. We'll confirm your payment shortly.",
      "success",
    );
    redirect(orderPath(payment.orderId));
  }

  try {
    const next = await createCheckout(payment, checkoutUrls(payment));
    revalidateOrder(payment.orderId);
    return { ok: true, data: next, message: next.kind === "redirect" ? `Redirecting to ${GATEWAY_NAMES[gateway as keyof typeof GATEWAY_NAMES] ?? "payment"}…` : undefined };
  } catch (error) {
    // Nothing reached the gateway: drop the order (and the add-on ticked with it) so the learner can simply try again.
    await mutate((d) => {
      const main = d.payments.find((p) => p.id === payment.id);
      if (!main || main.status !== "pending" || main.gatewayOrderId) return;
      d.payments = d.payments.filter((p) => p.id !== main.id && !(p.upsellOfPaymentId === main.id && isOrderBump(p) && p.status === "pending"));
    });
    return { ok: false, error: gatewayErrorMessage(error) };
  }
}

/** A paid certificate for a course that is not finished yet is issued on completion: show the certification page. */
async function finishFulfilledCheckout(result: FulfillmentResult, courseSlug: string | undefined): Promise<void> {
  if (result.payment.itemType === "certificate" && !result.certificateCode && courseSlug) {
    await setFlash("Certificate purchased. It will be issued as soon as you complete the course.", "success");
    redirect(`/courses/${courseSlug}/certification`);
  }
}

async function ownPayment(orderId: string): Promise<{ user: User; payment: Payment } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in again to continue." };
  if (!orderId || orderId.length > 64) return { error: "Order not found." };
  const payment = await getPaymentByOrderId(orderId);
  if (!payment || payment.userId !== user.id) return { error: "Order not found." };
  return { user, payment: { ...payment } };
}

/**
 * "Complete payment" / "Try again" for a pending order: reopens the gateway
 * checkout (or reports that the payment already went through).
 */
export async function resumeCheckoutAction(orderId: string): Promise<ActionResult<CheckoutNext>> {
  const found = await ownPayment(typeof orderId === "string" ? orderId : "");
  if ("error" in found) return { ok: false, error: found.error };
  let { payment } = found;
  // An order bump is paid in the checkout of its main order.
  if (isOrderBump(payment)) {
    const main = (await getDb()).payments.find((p) => p.id === payment.upsellOfPaymentId);
    if (!main) return { ok: false, error: "The order this add-on belonged to no longer exists. Cancel the add-on and start a new checkout." };
    payment = { ...main };
  }
  if (payment.status === "failed") return { ok: false, error: "This order was cancelled. Start a new checkout to buy it again." };
  if (payment.status === "refunded") return { ok: false, error: "This order was refunded." };
  const res = await resumeCheckout(payment);
  revalidateOrder(payment.orderId);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.next, message: res.message };
}

/**
 * Called by the Razorpay Checkout success handler. The signature is verified
 * server-side (HMAC-SHA256 of `order_id|payment_id` with the key secret)
 * before anything is fulfilled.
 */
export async function confirmRazorpayPaymentAction(input: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<ActionResult<{ redirectTo: string }>> {
  const orderId = typeof input?.orderId === "string" ? input.orderId.trim() : "";
  const razorpayOrderId = typeof input?.razorpayOrderId === "string" ? input.razorpayOrderId.trim() : "";
  const razorpayPaymentId = typeof input?.razorpayPaymentId === "string" ? input.razorpayPaymentId.trim() : "";
  const signature = typeof input?.razorpaySignature === "string" ? input.razorpaySignature.trim() : "";
  if (!orderId || orderId.length > 64 || !/^order_[A-Za-z0-9]+$/.test(razorpayOrderId) || !/^pay_[A-Za-z0-9]+$/.test(razorpayPaymentId) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, error: "The payment response was incomplete. If you were charged, contact support with your order ID." };
  }
  // Only the buyer can confirm their order; missing and foreign orders get the same answer.
  const found = await ownPayment(orderId);
  if ("error" in found) {
    const user = await getCurrentUser();
    const db = await getDb();
    // A genuine Razorpay payment for a checkout whose order was deleted: money arrived without an order.
    if (user && !db.payments.some((p) => p.gatewayOrderId === razorpayOrderId) && isValidRazorpayCheckoutSignature({ razorpayOrderId, razorpayPaymentId, signature })) {
      await reportUnmatchedPayment({ gateway: "razorpay", paymentRef: razorpayPaymentId, checkoutRef: razorpayOrderId });
      return { ok: false, error: "We received your payment but couldn't match it to an open order. Our team has been notified and will contact you." };
    }
    return { ok: false, error: found.error };
  }
  const { payment } = found;

  const state = await confirmRazorpayCheckout(payment, { razorpayOrderId, razorpayPaymentId, signature });
  revalidateOrder(payment.orderId);
  if (state.state === "paid") {
    revalidatePath("/", "layout");
    return { ok: true, data: { redirectTo: orderPath(payment.orderId) }, message: "Payment successful. You're all set!" };
  }
  if (state.state === "processing" || state.state === "pending") {
    return { ok: true, data: { redirectTo: orderPath(payment.orderId) }, message: "We're confirming your payment." };
  }
  if (state.state === "failed") return { ok: false, error: state.reason ?? "The payment was declined." };
  return { ok: false, error: state.message };
}

/**
 * Razorpay Checkout's success handler for a membership: verifies the
 * subscription signature (HMAC-SHA256 of `payment_id|subscription_id`) on the
 * server, then reads the subscription back before settling the order.
 */
export async function confirmRazorpayMembershipAction(input: {
  orderId: string;
  razorpaySubscriptionId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<ActionResult<{ redirectTo: string }>> {
  const orderId = typeof input?.orderId === "string" ? input.orderId.trim() : "";
  const subscriptionId = typeof input?.razorpaySubscriptionId === "string" ? input.razorpaySubscriptionId.trim() : "";
  const paymentId = typeof input?.razorpayPaymentId === "string" ? input.razorpayPaymentId.trim() : "";
  const signature = typeof input?.razorpaySignature === "string" ? input.razorpaySignature.trim() : "";
  if (!orderId || orderId.length > 64 || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, error: "The payment response was incomplete. If you were charged, contact support with your order ID." };
  }
  const found = await ownPayment(orderId);
  if ("error" in found) return { ok: false, error: found.error };
  const { payment } = found;
  if (payment.itemType !== "plan") return { ok: false, error: "This order is not a membership." };

  const state = await confirmRazorpayMembership(payment, { subscriptionId, paymentId, signature });
  revalidateOrder(payment.orderId);
  if (state.state === "paid") {
    revalidatePath("/", "layout");
    return { ok: true, data: { redirectTo: orderPath(payment.orderId) }, message: "Your membership is active. Enjoy learning!" };
  }
  if (state.state === "processing" || state.state === "pending") {
    return { ok: true, data: { redirectTo: orderPath(payment.orderId) }, message: "We're confirming your membership." };
  }
  if (state.state === "failed") return { ok: false, error: state.reason ?? "The membership could not be started." };
  return { ok: false, error: state.message };
}

/** Let a learner cancel their own order while it is still awaiting payment. */
export async function cancelOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const found = await ownPayment(fd(formData, "orderId"));
  if ("error" in found) return { ok: false, error: found.error };
  const { payment } = found;
  if (payment.status !== "pending") return { ok: false, error: "Only orders awaiting payment can be cancelled." };
  if (isInstallmentOrder(payment) && payment.installmentNumber! > 1) {
    return { ok: false, error: "This payment belongs to your payment plan and can't be cancelled on its own. Contact us if you'd like to stop the plan." };
  }
  if (isOrderBump(payment)) {
    const main = (await getDb()).payments.find((p) => p.id === payment.upsellOfPaymentId);
    if (main) return { ok: false, error: "This add-on is paid together with its main order. Cancel that order instead." };
    // Its main order is gone (that checkout never reached the gateway): the add-on is closed on its own.
    await markPaymentFailed(payment.id);
    revalidateOrder(payment.orderId);
    return { ok: true, data: undefined, message: "Your order has been cancelled." };
  }

  if (isRealGateway(payment.gateway)) {
    const closed = await closeGatewayCheckout(payment);
    if (closed.paid) {
      revalidateOrder(payment.orderId);
      revalidatePath("/", "layout");
      return { ok: false, error: "Your payment has already gone through, so this order can't be cancelled." };
    }
    if (!closed.reached) {
      // Cancelling without closing the checkout would leave it payable.
      return { ok: false, error: `We couldn't reach ${GATEWAY_NAMES[payment.gateway]} to close the payment page. Please try again in a moment.` };
    }
  }
  await markPaymentFailed(payment.id);
  revalidateOrder(payment.orderId);
  return { ok: true, data: undefined, message: "Your order has been cancelled." };
}

/**
 * "Pay installment" on the order page of a part of the learner's payment
 * plan (the link in every reminder leads there): opens the gateway checkout
 * for that part, Stripe's invoice page when an automatic charge failed, or
 * the payment instructions when payments are confirmed by hand.
 */
export async function payInstallmentAction(orderId: string): Promise<ActionResult<CheckoutNext>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in again to continue." };
  if (typeof orderId !== "string" || !orderId || orderId.length > 64) return { ok: false, error: "Order not found." };
  const res = await payInstallment(user, orderId);
  revalidateOrder(orderId);
  if (!res.ok) return { ok: false, error: res.error };
  // The payment may have been found settled at the gateway, which reopens the course.
  revalidatePath("/", "layout");
  return { ok: true, data: res.next, message: res.message };
}

/* ------------------------------------------------------------------ */
/* Admin: transactions                                                 */
/* ------------------------------------------------------------------ */

async function requireAdminActor(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateCommerce(orderId?: string) {
  revalidatePath("/admin/settings/transactions");
  if (orderId) revalidatePath(orderPath(orderId));
  revalidatePath("/", "layout");
}

async function findPayment(paymentId: string): Promise<Payment | null> {
  if (typeof paymentId !== "string" || !paymentId) return null;
  const db = await getDb();
  const row = db.payments.find((p) => p.id === paymentId);
  return row ? { ...row } : null;
}

/** Confirm a payment received outside the gateway and fulfil the order. */
export async function markPaymentPaidAction(paymentId: string): Promise<ActionResult<{ notice?: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can confirm payments." };
  const payment = await findPayment(paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "paid") return { ok: false, error: "This order is already paid." };
  if (payment.status === "refunded") return { ok: false, error: "Refunded orders cannot be marked as paid." };

  if (isRealGateway(payment.gateway) && payment.gatewayOrderId && payment.status === "pending") {
    // Close the learner's open checkout first so the order cannot be paid twice.
    const closed = await closeGatewayCheckout(payment);
    if (closed.paid) {
      revalidateCommerce(payment.orderId);
      return { ok: true, data: {}, message: `Order ${payment.orderId} was already paid through ${GATEWAY_NAMES[payment.gateway]}.` };
    }
    if (!closed.reached) {
      return { ok: false, error: `${GATEWAY_NAMES[payment.gateway]} could not be reached to close the learner's open checkout. Try again, or check the order in the ${GATEWAY_NAMES[payment.gateway]} dashboard.` };
    }
  }

  // Money that did not come through a gateway is recorded as a manual payment.
  const reference = `manual_${actor.id}_${Date.now()}`;
  await mutate((d) => {
    const row = d.payments.find((p) => p.id === payment.id);
    if (row && row.status !== "paid" && isRealGateway(row.gateway) && !isGatewayPaymentReference(row.gateway, row.gatewayPaymentId)) row.gateway = "manual";
  });
  const res = await fulfillPayment(payment.id, payment.gatewayPaymentId ? undefined : reference, { source: "admin" });
  if (!res.ok) return { ok: false, error: res.error };
  await audit(actor, "payment.mark_paid", { type: "payment", id: payment.id }, { orderId: payment.orderId, amount: payment.amount, currency: payment.currency });
  revalidateCommerce(payment.orderId);
  return { ok: true, data: { notice: res.data.notice }, message: `Order ${payment.orderId} marked as paid.` };
}

/**
 * Refund a paid order. Orders paid through Stripe/Razorpay are refunded
 * through the gateway API (optionally a partial amount); other orders — or
 * refunds already made in the gateway dashboard (`recordOnly`) — are only
 * recorded. Either way the order is marked refunded and its access removed.
 */
export async function refundPaymentAction(paymentId: string, opts: { amount?: string; recordOnly?: boolean } = {}): Promise<ActionResult<{ viaGateway: boolean }>> {
  const result = await refundPayment(paymentId, opts);
  if (result.ok) {
    await audit(await getCurrentUser(), "payment.refund", { type: "payment", id: paymentId }, { amount: opts?.amount?.trim() || "remaining", viaGateway: result.data.viaGateway, recordOnly: opts?.recordOnly === true });
  }
  return result;
}

async function refundPayment(paymentId: string, opts: { amount?: string; recordOnly?: boolean }): Promise<ActionResult<{ viaGateway: boolean }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can refund payments." };
  const payment = await findPayment(paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status !== "paid") return { ok: false, error: "Only paid orders can be refunded." };

  const alreadyRefunded = Math.min(payment.amount, payment.refundedAmount ?? 0);
  const remaining = payment.amount - alreadyRefunded;
  let value: number | undefined;
  const rawAmount = typeof opts?.amount === "string" ? opts.amount.trim() : "";
  if (rawAmount) {
    const parsed = parseDecimalAmount(rawAmount);
    if (parsed === null || parsed <= 0) return { ok: false, error: "Enter a refund amount greater than zero, e.g. 12.50.", fieldErrors: { amount: "Enter a valid amount." } };
    if (parsed > remaining) {
      return { ok: false, error: `You can refund at most ${formatPrice(remaining, payment.currency)}.`, fieldErrors: { amount: "More than what was paid." } };
    }
    value = parsed;
  }
  const recordOnly = opts?.recordOnly === true;
  const requested = value ?? remaining;

  if (!acquireRefundLock(payment.id)) return { ok: false, error: "A refund for this order is already in progress." };
  try {
    // Re-read under the lock: a webhook may have recorded a refund since the dialog opened.
    const current = (await findPayment(payment.id)) ?? payment;
    if (current.status !== "paid") return { ok: false, error: "Only paid orders can be refunded." };

    if (!refundsViaGateway(current)) {
      // Manual and free orders: the admin returns the money; only the record changes.
      const res = await applyRefund(current.id, { amount: requested });
      if (!res.ok) return { ok: false, error: res.error };
      revalidateCommerce(current.orderId);
      const label = formatPrice(requested, current.currency, "nothing");
      return { ok: true, data: { viaGateway: false }, message: `Order ${current.orderId} marked as refunded${requested > 0 ? ` (${label})` : ""}.` };
    }

    const name = GATEWAY_NAMES[current.gateway as keyof typeof GATEWAY_NAMES] ?? current.gateway;

    if (recordOnly) {
      // Refunded in the gateway dashboard: record what the gateway reports (so a refund its webhook
      // already recorded is not counted twice), or the typed amount when the gateway can't be asked.
      const ledger = await readGatewayRefunds(current).catch(() => null);
      if (!ledger) {
        const res = await applyRefund(current.id, { amount: requested });
        if (!res.ok) return { ok: false, error: res.error };
        revalidateCommerce(current.orderId);
        return { ok: true, data: { viaGateway: false }, message: `Order ${current.orderId} marked as refunded (${formatPrice(requested, current.currency, "nothing")}).` };
      }
      if (ledger.total <= 0) {
        return { ok: false, error: `${name} shows no refund for this payment yet. Refund it in the ${name} dashboard first, or untick “Already refunded” to refund it from here.` };
      }
      const newest = ledger.unrecorded[0];
      const res = await applyRefund(current.id, { refundId: newest?.id, amount: newest?.amount, total: ledger.total });
      if (!res.ok) return { ok: false, error: res.error };
      revalidateCommerce(current.orderId);
      return {
        ok: true,
        data: { viaGateway: false },
        message: `Order ${current.orderId} marked as refunded (${formatPrice(res.data.payment.refundedAmount ?? ledger.total, current.currency)} refunded on ${name}).`,
      };
    }

    // What the gateway already refunded, read before anything is sent: a retry after a timed-out
    // request records the refund that went through instead of refunding twice.
    const ledger = await readGatewayRefunds(current);
    const recorded = current.refundedAmount ?? 0;
    if (ledger.unrecorded.length) {
      // An earlier refund from this app went through but was never recorded (the request timed out).
      const earlier = ledger.unrecorded[0]!;
      const res = await applyRefund(current.id, { refundId: earlier.id, amount: earlier.amount, total: ledger.total });
      if (!res.ok) return { ok: false, error: res.error };
      revalidateCommerce(current.orderId);
      return {
        ok: true,
        data: { viaGateway: true },
        message: `An earlier refund of ${formatPrice(earlier.amount, current.currency)} had already gone through on ${name} (${earlier.id}). It is recorded now; nothing else was sent.`,
      };
    }
    if (ledger.total > recorded) {
      // Refunded in the gateway dashboard, but the webhook never reached us: record it and let the admin decide.
      const res = await recordGatewayRefund(current.id, { total: ledger.total });
      revalidateCommerce(current.orderId);
      if (res.kind === "refunded") {
        return { ok: true, data: { viaGateway: false }, message: `${name} shows this payment as fully refunded already. Order ${current.orderId} is now marked as refunded.` };
      }
      return {
        ok: false,
        error: `${name} already shows ${formatPrice(ledger.total, current.currency)} refunded on this payment, which wasn't recorded here. It is recorded now; check the order and refund again only if more should go back.`,
      };
    }

    const sent = await sendGatewayRefund(current, requested, ledger);
    const res = await applyRefund(current.id, { refundId: sent.refundId, amount: sent.amount, total: ledger.total + sent.amount });
    if (!res.ok) return { ok: false, error: res.error };
    revalidateCommerce(current.orderId);
    return {
      ok: true,
      data: { viaGateway: true },
      message: `Refunded ${formatPrice(sent.amount, current.currency, "nothing")} through ${name}. It usually reaches the learner within 5–10 business days.`,
    };
  } catch (error) {
    const message = gatewayErrorMessage(error);
    if (error instanceof GatewayError && error.transient) {
      return { ok: false, error: `${message} Retrying is safe: the refunds already on the payment are checked first, so one that went through is recorded instead of being sent again.` };
    }
    return { ok: false, error: message };
  } finally {
    releaseRefundLock(payment.id);
  }
}

/** Ask the gateway for the current state of a pending order and settle it. */
export async function syncPaymentAction(paymentId: string): Promise<ActionResult<{ status: Payment["status"] }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can check payments." };
  const payment = await findPayment(paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!isRealGateway(payment.gateway) || !payment.gatewayOrderId) return { ok: false, error: "This order was not paid through a payment gateway." };
  if (!isConfigured(payment.gateway)) return { ok: false, error: `${GATEWAY_NAMES[payment.gateway]} is not configured.` };
  if (payment.status !== "pending") return { ok: true, data: { status: payment.status }, message: "This order is already settled." };

  const state = await syncPaymentStatus(payment, { source: "admin" });
  revalidateCommerce(payment.orderId);
  switch (state.state) {
    case "paid":
      return { ok: true, data: { status: "paid" }, message: `Payment confirmed: order ${payment.orderId} is now paid.` };
    case "processing":
      return { ok: true, data: { status: "pending" }, message: "The payment is still being processed by the bank." };
    case "failed":
      return { ok: true, data: { status: "failed" }, message: `The checkout ended without payment${state.reason ? `: ${state.reason}` : "."}` };
    case "pending":
      return { ok: true, data: { status: "pending" }, message: `No payment yet — the learner has not completed the ${GATEWAY_NAMES[payment.gateway]} checkout.` };
    default:
      return { ok: false, error: state.message };
  }
}

/** Delete an unpaid or cancelled payment record. Invoiced orders are kept for bookkeeping. */
export async function deletePaymentAction(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can delete transactions." };
  const payment = await findPayment(paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.status === "paid") return { ok: false, error: "Refund this order before deleting it." };
  if (payment.invoiceNumber) return { ok: false, error: `Order ${payment.orderId} has invoice ${payment.invoiceNumber}; invoiced orders are kept for your records.` };
  if (payment.status === "pending" && isRealGateway(payment.gateway) && payment.gatewayOrderId) {
    const closed = await closeGatewayCheckout(payment);
    if (closed.paid) {
      revalidateCommerce(payment.orderId);
      return { ok: false, error: "This order has just been paid, so it can't be deleted." };
    }
    if (!closed.reached) return { ok: false, error: `${GATEWAY_NAMES[payment.gateway]} could not be reached to close the open checkout. Try again in a moment.` };
  }
  await mutate((d) => {
    // Unpaid order bumps go with their main order (they can't be paid without it).
    d.payments = d.payments.filter((p) => !((p.id === paymentId || (p.upsellOfPaymentId === paymentId && isOrderBump(p))) && p.status !== "paid" && !p.invoiceNumber));
  });
  await audit(actor, "payment.delete", { type: "payment", id: payment.id }, { orderId: payment.orderId, status: payment.status });
  revalidateCommerce(payment.orderId);
  return { ok: true, data: undefined, message: "Transaction deleted successfully" };
}

/** Send an in-app payment reminder for one unpaid order. */
export async function sendPaymentReminderAction(paymentId: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can send payment reminders." };
  const payment = await findPayment(paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  const check = await checkReminderEligibility(payment);
  if (!check.ok) return { ok: false, error: check.message };
  const sent = await sendPaymentReminder(payment);
  if (!sent.ok) return { ok: false, error: sent.message };
  revalidateCommerce();
  return { ok: true, data: undefined, message: "Reminder sent" };
}

/** Remind every learner with an eligible unpaid order (requires "Send payment reminders"). */
export async function sendPaymentRemindersAction(): Promise<ActionResult<{ sent: number; skipped: number }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can send payment reminders." };
  const db = await getDb();
  if (!db.settings.commerce.sendPaymentReminders) {
    return { ok: false, error: "Turn on “Send payment reminders” in Payments settings first." };
  }
  const result = await sendPendingPaymentReminders();
  revalidateCommerce();
  const message =
    result.sent === 0
      ? "No reminders were needed. Every unpaid order was reminded recently or no longer applies."
      : `Sent ${result.sent} ${result.sent === 1 ? "reminder" : "reminders"}${result.skipped ? ` (${result.skipped} skipped)` : ""}.`;
  return { ok: true, data: result, message };
}

/**
 * The membership a hand-recorded membership payment extends: the member's
 * current membership when it is not billed by a gateway (a gateway
 * subscription renews itself), otherwise none, and a new one is started.
 */
function planSubscriptionFor(db: Pick<Database, "subscriptions">, userId: string, planId: string): string | undefined {
  const current = currentSubscription(db, userId);
  if (!current || isGatewayManaged(current)) return undefined;
  // Ended memberships of another plan are not revived by a payment for this one.
  if (!isOngoing(current) && current.planId !== planId) return undefined;
  return current.id;
}

function parseMoney(raw: string): number | null {
  if (raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Record a payment by hand (Frappe: Settings > Transactions > New), e.g. a
 * bank transfer or an invoice paid outside the site. When "Received" is on,
 * the order is fulfilled right away exactly like a confirmed checkout.
 */
export async function recordPaymentAction(_prev: ActionResult<{ orderId: string }> | null, formData: FormData): Promise<ActionResult<{ orderId: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can record transactions." };
  const db = await getDb();

  const userId = fd(formData, "userId");
  const itemType = parseItemType(fd(formData, "itemType"));
  const itemId = fd(formData, "itemId");
  const currency = fd(formData, "currency").toUpperCase();
  const billingNameRaw = fd(formData, "billingName");
  const source = fd(formData, "source");
  const gatewayPaymentId = fd(formData, "gatewayPaymentId");
  const couponId = fd(formData, "couponId");
  const received = fdBool(formData, "received");
  const original = parseMoney(fd(formData, "originalAmount"));
  const discount = parseMoney(fd(formData, "discountAmount"));
  const tax = parseMoney(fd(formData, "taxAmount"));

  const errors: Record<string, string> = {};
  const member = db.users.find((u) => u.id === userId);
  if (!userId) errors.userId = "Member is required";
  else if (!member) errors.userId = "This member no longer exists.";
  if (!itemType) errors.itemType = "Paid For is required";
  else if (itemType === "gift") errors.itemType = "Gifts are bought from the gift checkout, not recorded by hand.";

  let itemTitle = "";
  if (itemType && !itemId) {
    errors.itemId = itemType === "batch" ? "Batch is required" : itemType === "plan" ? "Membership plan is required" : itemType === "bundle" ? "Bundle is required" : "Course is required";
  } else if (itemType === "bundle") {
    // A received bundle payment enrolls the member in every course of the bundle.
    const bundle = db.bundles.find((b) => b.id === itemId);
    if (!bundle) errors.itemId = "This bundle no longer exists.";
    else if (!bundleCourses(bundle, db.courses).length) errors.itemId = "None of this bundle's courses exist any more.";
    else itemTitle = bundle.title;
  } else if (itemType === "plan") {
    // A received membership payment starts the member's membership or extends it by one billing period.
    const plan = db.plans.find((p) => p.id === itemId);
    if (!plan) errors.itemId = "This membership plan no longer exists.";
    else itemTitle = plan.name;
  } else if (itemType === "batch") {
    const batch = db.batches.find((b) => b.id === itemId);
    if (!batch) errors.itemId = "This batch no longer exists.";
    else itemTitle = batch.title;
  } else if (itemType) {
    const course = db.courses.find((c) => c.id === itemId);
    if (!course) errors.itemId = "This course no longer exists.";
    else if (itemType === "certificate" && !course.paidCertificate) errors.itemId = "This course does not sell certificates.";
    else itemTitle = itemType === "certificate" ? `Certificate for ${course.title}` : course.title;
  }

  if (!(currencies as readonly string[]).includes(currency)) errors.currency = "Currency is required";
  if (original === null) errors.originalAmount = "Enter an amount of zero or more.";
  if (discount === null) errors.discountAmount = "Enter an amount of zero or more.";
  if (tax === null) errors.taxAmount = "Enter an amount of zero or more.";
  if (original !== null && discount !== null && discount > original) errors.discountAmount = "The discount cannot be larger than the original amount.";
  const billingName = billingNameRaw || member?.name || "";
  if (!billingName) errors.billingName = "Billing Name is required";
  else if (billingName.length > 140) errors.billingName = "Please enter a valid Billing Name";
  if (source.length > 80) errors.source = "Keep the source under 80 characters.";
  if (gatewayPaymentId.length > 120) errors.gatewayPaymentId = "Keep the payment ID under 120 characters.";
  else if (gatewayPaymentId && db.payments.some((p) => p.gatewayPaymentId === gatewayPaymentId)) errors.gatewayPaymentId = "Another transaction already uses this payment ID.";
  const coupon = couponId ? db.coupons.find((c) => c.id === couponId) : null;
  if (couponId && !coupon) errors.couponId = "This coupon no longer exists.";

  if (Object.keys(errors).length || !itemType || !member || original === null || discount === null || tax === null) {
    return { ok: false, error: Object.values(errors)[0] ?? "Fill in every required field", fieldErrors: errors };
  }

  if (received) {
    // Refuse to grant access the learner already paid for (it would record a second sale).
    if (itemType === "course" && db.enrollments.some((e) => e.userId === member.id && e.courseId === itemId && e.paymentId)) {
      return { ok: false, error: `${member.name} already paid for this course.`, fieldErrors: { itemId: "Already paid for by this member." } };
    }
    if (itemType === "batch" && db.batchEnrollments.some((e) => e.userId === member.id && e.batchId === itemId)) {
      return { ok: false, error: `${member.name} is already enrolled in this batch.`, fieldErrors: { itemId: "Already enrolled." } };
    }
    if (itemType === "bundle") {
      const bundle = db.bundles.find((b) => b.id === itemId);
      const included = bundle ? bundleCourses(bundle, db.courses).map((c) => c.id) : [];
      if (included.length && ownedCourseIds(db, member.id, included).length === included.length) {
        return { ok: false, error: `${member.name} already has every course of this bundle.`, fieldErrors: { itemId: "Already owned by this member." } };
      }
    }
    if (itemType === "certificate" && db.enrollments.some((e) => e.userId === member.id && e.courseId === itemId && e.purchasedCertificate)) {
      return { ok: false, error: `${member.name} already purchased this certificate.`, fieldErrors: { itemId: "Already purchased." } };
    }
  }

  const amount = original - discount + tax;
  const payment: Payment = {
    id: uid("pay"),
    orderId: await generateOrderId(),
    userId: member.id,
    itemType,
    itemId,
    itemTitle,
    ...(itemType === "plan" ? { planId: itemId, subscriptionId: planSubscriptionFor(db, member.id, itemId) } : {}),
    ...(itemType === "bundle" ? { bundleId: itemId } : {}),
    originalAmount: original,
    discountAmount: discount,
    taxAmount: tax,
    amount,
    currency,
    couponId: coupon?.id,
    couponCode: coupon?.code,
    billingName,
    source: source || undefined,
    gateway: "manual",
    gatewayPaymentId: gatewayPaymentId || undefined,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    d.payments.push(payment);
  });

  let message = "Transaction created successfully";
  if (received) {
    const res = await fulfillPayment(payment.id, gatewayPaymentId || `manual_${actor.id}_${Date.now()}`, { source: "admin" });
    if (!res.ok) return { ok: false, error: res.error };
    message = res.data.notice ? `Transaction created. ${res.data.notice}` : `Transaction created and ${member.name} now has access.`;
  }
  await audit(actor, "payment.record", { type: "payment", id: payment.id }, { orderId: payment.orderId, amount, currency, received: !!received });
  revalidateCommerce(payment.orderId);
  return { ok: true, data: { orderId: payment.orderId }, message };
}

/** Correct the billing details of an order (name, payment ID, tax IDs, source). */
export async function updatePaymentDetailsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can edit transactions." };
  const db = await getDb();
  const id = fd(formData, "id");
  const payment = db.payments.find((p) => p.id === id);
  if (!payment) return { ok: false, error: "Payment not found." };

  const billingName = fd(formData, "billingName");
  const gatewayPaymentId = fd(formData, "gatewayPaymentId");
  const source = fd(formData, "source");
  const gstin = fd(formData, "gstin").toUpperCase();
  const pan = fd(formData, "pan").toUpperCase();
  // Older forms do not post the VAT number: keep the stored one then.
  const vatId = formData.has("vatId") ? normalizeVatId(fd(formData, "vatId")) : (payment.buyerVatId ?? "");
  const lockedReference = isGatewayPaymentReference(payment.gateway, payment.gatewayPaymentId);

  const errors: Record<string, string> = {};
  if (billingName.length < 2 || billingName.length > 140) errors.billingName = "Please enter a valid Billing Name";
  if (lockedReference && gatewayPaymentId !== payment.gatewayPaymentId) {
    errors.gatewayPaymentId = `This payment ID comes from ${GATEWAY_NAMES[payment.gateway as keyof typeof GATEWAY_NAMES] ?? "the gateway"} and cannot be changed.`;
  } else if (gatewayPaymentId.length > 120) errors.gatewayPaymentId = "Keep the payment ID under 120 characters.";
  else if (gatewayPaymentId && db.payments.some((p) => p.id !== id && p.gatewayPaymentId === gatewayPaymentId)) errors.gatewayPaymentId = "Another transaction already uses this payment ID.";
  if (source.length > 80) errors.source = "Keep the source under 80 characters.";
  if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = "Please enter a valid GST number.";
  if (pan && !PAN_RE.test(pan)) errors.pan = "Please enter a valid pan number.";
  else if (gstin && !pan) errors.pan = "Please enter a valid pan number.";
  if (vatId !== (payment.buyerVatId ?? "")) {
    // A reverse-charged order must name the VAT number it was reverse-charged for.
    const vatError = !vatId && payment.reverseCharge ? "This order was reverse-charged: keep a VAT number on it." : validateVatId(vatId, payment.address?.country ?? "");
    if (vatError) errors.vatId = vatError;
  }
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };

  await mutate((d) => {
    const row = d.payments.find((p) => p.id === id);
    if (!row) return;
    row.billingName = billingName;
    if (!lockedReference) row.gatewayPaymentId = gatewayPaymentId || undefined;
    row.source = source || undefined;
    row.gstin = gstin || undefined;
    row.pan = pan || undefined;
    row.buyerVatId = vatId || undefined;
  });
  await audit(actor, "payment.update", { type: "payment", id: payment.id }, { orderId: payment.orderId });
  revalidateCommerce(payment.orderId);
  revalidatePath(`/billing/invoice/${payment.orderId}`);
  return { ok: true, data: undefined, message: `Transaction updated successfully (${payment.orderId}, ${formatPrice(payment.amount, payment.currency)}).` };
}

/* ------------------------------------------------------------------ */
/* Admin: payment plans (installments)                                 */
/* ------------------------------------------------------------------ */

function revalidateInstallments(): void {
  revalidatePath("/admin/settings/plans");
  revalidatePath("/admin/settings/transactions");
  revalidatePath("/billing/history");
  // Course access and the "or N payments" offer depend on payment plans.
  revalidatePath("/", "layout");
}

function installmentResult(res: InstallmentResult): ActionResult {
  return res.ok ? { ok: true, data: undefined, message: res.message } : { ok: false, error: res.error };
}

export type InstallmentPlanOp = "cancel" | "waive" | "remind";

/**
 * Act on a learner's payment plan (`planKey` is the order id of its first
 * payment): cancel what is left, waive it, or send a reminder for the next
 * payment.
 */
export async function installmentPlanAction(planKey: string, op: InstallmentPlanOp): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage payment plans." };
  if (typeof planKey !== "string" || !planKey || planKey.length > 64) return { ok: false, error: "Payment plan not found." };
  const res =
    op === "cancel" ? await cancelInstallmentPlan(planKey, actor) : op === "waive" ? await waiveInstallments(planKey, actor) : op === "remind" ? await remindInstallment(planKey, actor) : null;
  if (!res) return { ok: false, error: "Unknown action." };
  revalidateInstallments();
  return installmentResult(res);
}

const MAX_BULK_REMINDERS = 100;

/** Remind the learners of several plans about their next payment (one reminder per plan and day). */
export async function remindInstallmentPlansAction(planKeys: string[]): Promise<ActionResult<{ sent: number; skipped: number }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can manage payment plans." };
  const keys = Array.isArray(planKeys) ? [...new Set(planKeys.filter((k): k is string => typeof k === "string" && !!k && k.length <= 64))] : [];
  if (!keys.length) return { ok: false, error: "Select at least one payment plan." };
  if (keys.length > MAX_BULK_REMINDERS) return { ok: false, error: `Remind at most ${MAX_BULK_REMINDERS} plans at a time.` };
  let sent = 0;
  for (const key of keys) if ((await remindInstallment(key, actor)).ok) sent++;
  const skipped = keys.length - sent;
  revalidateInstallments();
  if (!sent) return { ok: false, error: "No reminders were sent: these plans have nothing due, or were already reminded today." };
  return { ok: true, data: { sent, skipped }, message: `Sent ${sent} reminder${sent === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}.` };
}

/** Offer a course in installments, change its terms, or stop offering it. Running plans keep their schedule. */
export async function saveCourseInstallmentsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can change how courses are paid." };
  const courseId = fd(formData, "courseId");
  if (!courseId) return { ok: false, error: "Course not found." };
  if (!fdBool(formData, "offered")) {
    const res = await setCourseInstallments(courseId, null, actor);
    revalidateInstallments();
    return installmentResult(res);
  }
  const parsed = validateInstallmentInput({ count: fd(formData, "count"), intervalDays: fd(formData, "intervalDays"), surchargePercent: fd(formData, "surchargePercent") });
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };
  const res = await setCourseInstallments(courseId, parsed.plan, actor);
  revalidateInstallments();
  return installmentResult(res);
}

/** Turn "pay in installments" on or off for the whole platform. Running plans continue either way. */
export async function setInstallmentsEnabledAction(enabled: boolean): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can change payment settings." };
  const on = enabled === true;
  await mutate((d) => {
    d.settings.growth.installmentsEnabled = on;
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(actor, "settings.update", { type: "settings", id: "growth" }, { installmentsEnabled: on });
  revalidateInstallments();
  return {
    ok: true,
    data: undefined,
    message: on ? "Courses with a payment plan now offer installments at checkout." : "Installments are no longer offered at checkout. Running plans continue.",
  };
}

/* ------------------------------------------------------------------ */
/* Admin: payment settings                                             */
/* ------------------------------------------------------------------ */

const GATEWAY_CHOICES: Settings["commerce"]["paymentGateway"][] = ["manual", "stripe", "razorpay", "none"];

/**
 * Save Settings → Payments (currency, active gateway, tax, reminders). A
 * real gateway can only be activated once its keys are configured, so
 * checkout never offers a gateway that cannot take payments.
 */
export async function savePaymentGatewaySettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can change payment settings." };
  const defaultCurrency = fd(formData, "defaultCurrency").toUpperCase();
  const paymentGateway = fd(formData, "paymentGateway") as Settings["commerce"]["paymentGateway"];
  const applyTax = fdBool(formData, "applyTax");
  const rawTax = fd(formData, "taxPercentage");
  const taxLabel = fd(formData, "taxLabel");

  const errors: Record<string, string> = {};
  if (!(currencies as readonly string[]).includes(defaultCurrency)) errors.defaultCurrency = "Choose a supported currency.";
  if (!GATEWAY_CHOICES.includes(paymentGateway)) errors.paymentGateway = "Choose a payment gateway.";
  else if (isRealGateway(paymentGateway) && !isConfigured(paymentGateway)) {
    errors.paymentGateway = `${GATEWAY_NAMES[paymentGateway]} is not configured. Add its keys to the .env file and restart the server, or choose another gateway.`;
  }
  const taxPercentage = rawTax === "" ? 0 : Number(rawTax);
  if (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100) errors.taxPercentage = "Enter a percentage between 0 and 100.";
  else if (applyTax && taxPercentage <= 0) errors.taxPercentage = "Enter a tax percentage greater than zero, or turn tax off.";
  if (applyTax && !taxLabel) errors.taxLabel = "Tax label is required when tax is applied.";
  else if (taxLabel.length > 30) errors.taxLabel = "Keep the tax label under 30 characters.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };

  await mutate((d) => {
    const c = d.settings.commerce;
    c.defaultCurrency = defaultCurrency;
    c.paymentGateway = paymentGateway;
    c.applyTax = applyTax;
    c.taxPercentage = Math.round(taxPercentage * 100) / 100;
    c.taxLabel = taxLabel || "Tax";
    c.showUsdEquivalent = fdBool(formData, "showUsdEquivalent");
    c.applyRounding = fdBool(formData, "applyRounding");
    c.sendPaymentReminders = fdBool(formData, "sendPaymentReminders");
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(actor, "settings.update", { type: "settings", id: "payments" }, { section: "payments", paymentGateway, defaultCurrency, applyTax });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Payment settings saved" };
}

/** "Test connection" for a configured gateway (an authenticated read-only API call). */
export async function testGatewayConnectionAction(gateway: string): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can test payment gateways." };
  if (!isRealGateway(gateway)) return { ok: false, error: "Unknown payment gateway." };
  const res = await testGatewayConnection(gateway);
  return res.ok ? { ok: true, data: undefined, message: res.message } : { ok: false, error: res.error };
}

/* ------------------------------------------------------------------ */
/* Abandoned-checkout recovery settings                                */
/* ------------------------------------------------------------------ */

/** Turn checkout reminders on/off, set when they go out and the discount of the last one (admin). */
export async function saveRecoverySettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change checkout reminders." };
  const parsed = validateRecoverySettings({ enabled: fdBool(formData, "enabled"), delays: fd(formData, "delays"), couponPercent: fd(formData, "couponPercent") });
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };
  const { enabled, delaysHours, couponPercent } = parsed.value;
  await mutate((d) => {
    d.settings.growth.abandonedCheckoutEnabled = enabled;
    d.settings.growth.abandonedCheckoutDelaysHours = delaysHours;
    d.settings.growth.abandonedCheckoutCouponPercent = couponPercent;
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(user, "settings.checkout_recovery", { type: "settings", id: "growth" }, { enabled, delays: delaysHours.join(","), couponPercent });
  revalidatePath("/admin/settings/plans");
  return { ok: true, data: undefined, message: enabled ? "Checkout reminders saved." : "Checkout reminders turned off." };
}

/** Send the checkout reminders that are due right now instead of waiting for the next scheduled run (admin). */
export async function sendDueCheckoutRemindersAction(): Promise<ActionResult<{ sent: number }>> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can send checkout reminders." };
  const db = await getDb();
  if (!db.settings.growth.abandonedCheckoutEnabled) return { ok: false, error: "Checkout reminders are turned off. Turn them on first." };
  if (!db.settings.email.enabled) return { ok: false, error: "Email sending is turned off in Settings → Email, so no reminder can go out." };
  const run = await processAbandonedCheckouts({ force: true });
  if (run.sent > 0) await audit(user, "checkout_recovery.run", { type: "settings", id: "growth" }, { sent: run.sent, coupons: run.coupons });
  revalidatePath("/admin/settings/plans");
  const closed = run.closed ? ` ${run.closed} checkout${run.closed === 1 ? " was" : "s were"} marked as purchased.` : "";
  const message = run.sent
    ? `Sent ${run.sent} reminder${run.sent === 1 ? "" : "s"}${run.coupons ? `, ${run.coupons} with a discount code` : ""}.${closed}`
    : `No reminders are due right now.${closed}`;
  return { ok: true, data: { sent: run.sent }, message };
}

/** Stop further reminders for abandoned checkouts (e.g. the buyer asked, or bought another way) (admin). */
export async function stopCheckoutRemindersAction(ids: string[]): Promise<ActionResult<{ stopped: number }>> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change checkout reminders." };
  const wanted = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && !!x && x.length <= 64).slice(0, 500) : []);
  if (!wanted.size) return { ok: false, error: "Select at least one checkout." };
  const stopped = await mutate((d) => {
    const last = d.settings.growth.abandonedCheckoutDelaysHours.length;
    let n = 0;
    for (const s of d.checkoutSessions) {
      if (!wanted.has(s.id) || s.completedPaymentId || s.reminderCount >= last) continue;
      s.reminderCount = last;
      n++;
    }
    return n;
  });
  if (!stopped) return { ok: false, error: "These checkouts have no reminders left to stop." };
  await audit(user, "checkout_recovery.stop", { type: "checkout_session", id: [...wanted].join(",").slice(0, 200) }, { stopped });
  revalidatePath("/admin/settings/plans");
  return { ok: true, data: { stopped }, message: stopped === 1 ? "No more reminders will be sent for this checkout." : `No more reminders will be sent for ${stopped} checkouts.` };
}
