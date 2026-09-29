import "server-only";
import type { Batch, Payment } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { enrollUserInBatch, enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { issueCertificate } from "@/lib/services/progress";
import { notify, notifyMany } from "@/lib/services/notifications";
import { formatPrice } from "@/lib/utils";
import { assignInvoiceNumber, isInvoiceable } from "./invoice";

/**
 * Order fulfilment: the single place where a payment turns into access.
 *
 * `fulfillPayment` is called by every confirmation path — the Stripe return
 * URL, the Razorpay checkout callback, both webhooks, the admin "Mark as
 * paid" button and free/no-gateway orders. The pending → paid transition is
 * claimed inside one serialized `mutate`, so however many of those paths race
 * for the same order, exactly one of them enrolls the learner, redeems the
 * coupon, assigns the invoice number and sends the notifications.
 */

export type FulfillmentSource = "checkout" | "stripe_return" | "stripe_webhook" | "razorpay_checkout" | "razorpay_webhook" | "admin" | "sync";

export interface FulfillmentResult {
  payment: Payment;
  /** True when this call performed the fulfilment; false when the order had already been fulfilled. */
  fulfilled: boolean;
  /** Human readable note for administrators (e.g. the batch was full so no seat was allocated). */
  notice?: string;
  certificateCode?: string;
}

export type FulfillmentOutcome = { ok: true; data: FulfillmentResult } | { ok: false; error: string };

/** Gateway payment ids that point at a real Stripe/Razorpay payment (not a manual reference). */
export function isGatewayPaymentReference(gateway: string, id: string | undefined | null): boolean {
  if (!id) return false;
  if (gateway === "stripe") return /^pi_[A-Za-z0-9]+$/.test(id);
  if (gateway === "razorpay") return /^pay_[A-Za-z0-9]+$/.test(id);
  return false;
}

async function adminIds(): Promise<string[]> {
  const db = await getDb();
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

/**
 * Mark an order as paid and grant what was bought. Idempotent: only the call
 * that moves the order from pending (or failed — a later successful retry of
 * a failed gateway attempt) to paid fulfils it; later calls return the paid
 * order with `fulfilled: false`.
 */
export async function fulfillPayment(
  paymentId: string,
  gatewayPaymentId?: string,
  opts: { gatewayOrderId?: string; source?: FulfillmentSource } = {},
): Promise<FulfillmentOutcome> {
  const now = new Date();
  const claim = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { kind: "missing" as const };
    if (row.status === "refunded") return { kind: "refunded" as const, row: { ...row } };
    if (row.status === "paid") {
      // A second confirmation carrying a different real payment id means the learner paid twice.
      const duplicate =
        !!gatewayPaymentId &&
        isGatewayPaymentReference(row.gateway, gatewayPaymentId) &&
        !!row.gatewayPaymentId &&
        row.gatewayPaymentId !== gatewayPaymentId;
      if (gatewayPaymentId && !row.gatewayPaymentId) row.gatewayPaymentId = gatewayPaymentId;
      return { kind: "already" as const, row: { ...row }, duplicate };
    }
    row.status = "paid";
    row.paidAt = now.toISOString();
    if (gatewayPaymentId) row.gatewayPaymentId = gatewayPaymentId;
    if (opts.gatewayOrderId) row.gatewayOrderId = opts.gatewayOrderId;
    row.failureReason = undefined;
    row.checkoutUrl = undefined;
    if (isInvoiceable(row)) assignInvoiceNumber(d, row, now);
    let overLimit: string | null = null;
    if (row.couponId) {
      const coupon = d.coupons.find((c) => c.id === row.couponId);
      if (coupon) {
        coupon.redemptionCount += 1;
        if (coupon.usageLimit > 0 && coupon.redemptionCount > coupon.usageLimit) overLimit = coupon.code;
      }
    }
    // Another paid order for the same item (e.g. a cancelled attempt that was paid in another tab).
    const paidTwice =
      row.amount > 0 &&
      d.payments.some((p) => p.id !== row.id && p.status === "paid" && p.userId === row.userId && p.itemType === row.itemType && p.itemId === row.itemId);
    return { kind: "claimed" as const, row: { ...row }, overLimit, paidTwice };
  });

  if (claim.kind === "missing") return { ok: false, error: "Payment not found." };
  if (claim.kind === "refunded") {
    if (gatewayPaymentId && isGatewayPaymentReference(claim.row.gateway, gatewayPaymentId) && claim.row.gatewayPaymentId !== gatewayPaymentId) {
      await notifyMany(await adminIds(), {
        type: "system",
        subject: `Payment received for refunded order ${claim.row.orderId}`,
        message: `A new ${claim.row.gateway} payment (${gatewayPaymentId}) arrived for an order that was already refunded. Refund it from the ${claim.row.gateway} dashboard.`,
        link: `/admin/settings/transactions?search=${encodeURIComponent(claim.row.orderId)}`,
      });
    }
    return { ok: false, error: "Refunded orders cannot be marked as paid." };
  }
  if (claim.kind === "already") {
    if (claim.duplicate) {
      await notifyMany(await adminIds(), {
        type: "system",
        subject: `Possible duplicate payment for order ${claim.row.orderId}`,
        message: `${claim.row.billingName} paid ${formatPrice(claim.row.amount, claim.row.currency)} again (${gatewayPaymentId}). The order was already paid with ${claim.row.gatewayPaymentId}; refund the duplicate from the gateway dashboard.`,
        link: `/admin/settings/transactions?search=${encodeURIComponent(claim.row.orderId)}`,
      });
    }
    return { ok: true, data: { payment: claim.row, fulfilled: false } };
  }

  const payment = claim.row;
  console.info(`[payments] order ${payment.orderId} paid (${payment.gateway}${opts.source ? `, via ${opts.source}` : ""})`);
  const granted = await grantAccess(payment);
  const couponNotice = claim.overLimit ? `Coupon ${claim.overLimit} has now been redeemed more times than its usage limit allows.` : undefined;

  if (granted.learnerExists) {
    await notify(payment.userId, {
      type: payment.itemType === "certificate" ? "certificate" : "enrollment",
      subject: payment.amount > 0 ? `Payment received for ${payment.itemTitle}` : `You're enrolled: ${payment.itemTitle}`,
      message: `Order ${payment.orderId} · ${formatPrice(payment.amount, payment.currency)}${payment.invoiceNumber && payment.amount > 0 ? ` · Invoice ${payment.invoiceNumber}` : ""}`,
      link: `/billing/success/${payment.orderId}`,
    });
  }
  if (claim.paidTwice) {
    await notifyMany(await adminIds(), {
      type: "system",
      subject: `${payment.billingName} paid twice for ${payment.itemTitle}`,
      message: `Order ${payment.orderId} was paid although another order for the same item is already paid. Refund one of them.`,
      link: `/admin/settings/transactions?search=${encodeURIComponent(payment.itemTitle)}`,
      fromUserId: payment.userId,
    });
  }
  if (granted.notice && payment.amount > 0) {
    // The money was taken but access could not be granted: an administrator has to act.
    await notifyMany(await adminIds(), {
      type: "system",
      subject: `Order ${payment.orderId} needs attention`,
      message: granted.notice,
      link: `/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`,
      fromUserId: payment.userId,
    });
  }

  return {
    ok: true,
    data: {
      payment,
      fulfilled: true,
      notice: [granted.notice, couponNotice].filter(Boolean).join(" ") || undefined,
      certificateCode: granted.certificateCode,
    },
  };
}

/** Grant what a paid order bought. Every step is idempotent. */
async function grantAccess(payment: Payment): Promise<{ learnerExists: boolean; notice?: string; certificateCode?: string }> {
  const db = await getDb();
  const user = db.users.find((u) => u.id === payment.userId);
  if (!user) return { learnerExists: false, notice: `The learner account of order ${payment.orderId} no longer exists, so no access was granted.` };

  if (payment.itemType === "course") {
    const course = db.courses.find((c) => c.id === payment.itemId);
    if (!course) return { learnerExists: true, notice: `The course of order ${payment.orderId} no longer exists, so no enrollment was created.` };
    await enrollUserInCourse(user.id, course.id, { paymentId: payment.id });
    return { learnerExists: true };
  }

  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    if (!batch) return { learnerExists: true, notice: `The batch of order ${payment.orderId} no longer exists, so no enrollment was created.` };
    const res = await enrollUserInBatch(user.id, batch.id, { paymentId: payment.id, source: payment.source });
    if (!res.ok) return { learnerExists: true, notice: `${res.error} Order ${payment.orderId} was paid but no seat could be allocated in ${batch.title}.` };
    return { learnerExists: true };
  }

  const course = db.courses.find((c) => c.id === payment.itemId);
  if (!course) return { learnerExists: true, notice: `The course of order ${payment.orderId} no longer exists, so no certificate could be issued.` };
  let enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  if (!enrollment) enrollment = await enrollUserInCourse(user.id, course.id, { notifyInstructors: false });
  const enrollmentId = enrollment.id;
  const complete = await mutate((d) => {
    const row = d.enrollments.find((e) => e.id === enrollmentId);
    if (!row) return false;
    row.purchasedCertificate = true;
    return !!row.completedAt || row.progress >= 100;
  });
  if (complete && db.settings.features.certifications) {
    const cert = await issueCertificate(user, course);
    await mutate((d) => {
      const row = d.certificates.find((c) => c.id === cert.id);
      if (row && !row.published) row.published = true;
    });
    return { learnerExists: true, certificateCode: cert.code };
  }
  return { learnerExists: true };
}

/**
 * Mark a pending order as failed (gateway declined, checkout expired, learner
 * cancelled). No-op for orders that are no longer pending, so a late failure
 * event can never undo a payment. When `gatewayOrderId` is given, only the
 * checkout attempt with that id may fail the order (an expired old Stripe
 * session must not cancel a newer one).
 */
export async function markPaymentFailed(paymentId: string, reason?: string, opts: { gatewayOrderId?: string } = {}): Promise<boolean> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || row.status !== "pending") return false;
    if (opts.gatewayOrderId && row.gatewayOrderId && row.gatewayOrderId !== opts.gatewayOrderId) return false;
    row.status = "failed";
    row.failureReason = reason ? reason.slice(0, 300) : undefined;
    row.checkoutUrl = undefined;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const lockState = globalThis as unknown as { __llRefundLocks?: Set<string> };
const refundLocks: Set<string> = (lockState.__llRefundLocks ??= new Set<string>());

/**
 * In-process lock that keeps two administrators (or an admin and a webhook)
 * from refunding the same order at once. Returns false when already held.
 */
export function acquireRefundLock(paymentId: string): boolean {
  if (refundLocks.has(paymentId)) return false;
  refundLocks.add(paymentId);
  return true;
}

export function releaseRefundLock(paymentId: string): void {
  refundLocks.delete(paymentId);
}

export function isRefundInProgress(paymentId: string): boolean {
  return refundLocks.has(paymentId);
}

export interface RefundRecord {
  /** Gateway refund id (re_… / rfnd_…); empty for refunds made outside a gateway. */
  refundId?: string;
  /** Refunded amount in app units. */
  amount: number;
  at?: string;
}

/**
 * Record a refund on a paid order, mark it refunded and remove the access it
 * granted. Idempotent: an order that is already refunded only has missing
 * refund details filled in.
 */
export async function applyRefund(paymentId: string, refund: RefundRecord): Promise<{ ok: true; data: { payment: Payment; changed: boolean } } | { ok: false; error: string }> {
  const at = refund.at ?? new Date().toISOString();
  const claim = await mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row) return { kind: "missing" as const };
    if (row.status === "refunded") {
      if (refund.refundId && !row.refundId) row.refundId = refund.refundId;
      if (row.refundedAmount === undefined) row.refundedAmount = refund.amount;
      if (!row.refundedAt) row.refundedAt = at;
      return { kind: "already" as const, row: { ...row } };
    }
    if (row.status !== "paid") return { kind: "not_paid" as const };
    row.status = "refunded";
    row.refundId = refund.refundId || undefined;
    row.refundedAmount = Math.min(row.amount, Math.max(0, Math.round(refund.amount)));
    row.refundedAt = at;
    // A refunded order no longer counts as a redemption of its coupon.
    if (row.couponId) {
      const coupon = d.coupons.find((c) => c.id === row.couponId);
      if (coupon) coupon.redemptionCount = Math.max(0, coupon.redemptionCount - 1);
    }
    return { kind: "claimed" as const, row: { ...row } };
  });
  if (claim.kind === "missing") return { ok: false, error: "Payment not found." };
  if (claim.kind === "not_paid") return { ok: false, error: "Only paid orders can be refunded." };
  if (claim.kind === "already") return { ok: true, data: { payment: claim.row, changed: false } };

  const payment = claim.row;
  await revokeAccess(payment);
  const partial = (payment.refundedAmount ?? payment.amount) < payment.amount;
  await notify(payment.userId, {
    type: "system",
    subject: `Your payment for ${payment.itemTitle} was ${partial ? "partially " : ""}refunded`,
    message: `Order ${payment.orderId} · ${formatPrice(payment.refundedAmount ?? payment.amount, payment.currency)} refunded`,
    link: `/billing/success/${payment.orderId}`,
  });
  console.info(`[payments] order ${payment.orderId} refunded (${payment.gateway})`);
  return { ok: true, data: { payment, changed: true } };
}

/**
 * A partial refund made outside the app (gateway dashboard): record the
 * amount on the order but keep the learner's access.
 */
export async function recordPartialRefund(paymentId: string, refund: RefundRecord): Promise<boolean> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || row.status !== "paid") return false;
    const amount = Math.min(row.amount, Math.max(0, Math.round(refund.amount)));
    if ((row.refundedAmount ?? 0) >= amount) return false;
    row.refundedAmount = amount;
    row.refundedAt = refund.at ?? new Date().toISOString();
    if (refund.refundId) row.refundId = refund.refundId;
    return true;
  });
}

/** Remove the access a refunded order granted (keeps access that came from other orders or batches). */
async function revokeAccess(payment: Payment): Promise<void> {
  const db = await getDb();
  if (payment.itemType === "course") {
    const enrollment = db.enrollments.find((e) => e.userId === payment.userId && e.courseId === payment.itemId);
    if (!enrollment) return;
    if (enrollment.batchId) {
      // Access also comes from a batch: keep it, just detach the refunded payment.
      await mutate((d) => {
        const row = d.enrollments.find((e) => e.id === enrollment.id);
        if (row && row.paymentId === payment.id) row.paymentId = undefined;
      });
    } else {
      await unenrollUserFromCourse(payment.userId, payment.itemId);
    }
    return;
  }

  if (payment.itemType === "batch") {
    const batch = db.batches.find((b) => b.id === payment.itemId);
    const seat = db.batchEnrollments.find((e) => e.batchId === payment.itemId && e.userId === payment.userId);
    await mutate((d) => {
      d.batchEnrollments = d.batchEnrollments.filter((e) => !(e.batchId === payment.itemId && e.userId === payment.userId));
    });
    if (!batch) return;
    const current = await getDb();
    // Other batches the learner still belongs to keep their course access.
    const otherBatches = current.batchEnrollments
      .filter((e) => e.userId === payment.userId && e.batchId !== batch.id)
      .map((e) => current.batches.find((b) => b.id === e.batchId))
      .filter((b): b is Batch => !!b);
    const viaBatch = current.enrollments.filter((e) => e.userId === payment.userId && e.batchId === batch.id && batch.courseIds.includes(e.courseId));
    for (const e of viaBatch) {
      // Only rows this batch purchase created are removed. A row that existed
      // before the learner joined (a separate order or a free enrollment)
      // got this batch's payment id attached only if it had none, so it is
      // recognised by being older than the batch seat.
      const createdByBatch = e.paymentId === payment.id && (!seat || e.enrolledAt >= seat.enrolledAt);
      const otherBatch = otherBatches.find((b) => b.courseIds.includes(e.courseId));
      if (createdByBatch && !otherBatch) {
        await unenrollUserFromCourse(payment.userId, e.courseId);
        continue;
      }
      await mutate((d) => {
        const row = d.enrollments.find((r) => r.id === e.id);
        if (!row) return;
        row.batchId = otherBatch?.id;
        if (row.paymentId === payment.id) row.paymentId = undefined;
      });
    }
    return;
  }

  await mutate((d) => {
    const enrollment = d.enrollments.find((e) => e.userId === payment.userId && e.courseId === payment.itemId);
    if (enrollment) enrollment.purchasedCertificate = false;
    const course = d.courses.find((c) => c.id === payment.itemId);
    const cert = d.certificates.find((c) => c.userId === payment.userId && c.courseId === payment.itemId);
    // Paid certificates are revoked (unpublished) with the refund; free ones stay.
    if (cert && course?.paidCertificate) cert.published = false;
  });
}
