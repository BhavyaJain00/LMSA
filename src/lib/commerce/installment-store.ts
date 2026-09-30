import "server-only";
import type { Database, Payment } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import {
  DEFAULT_INSTALLMENT_INTERVAL_DAYS,
  PLAN_CANCELLED_REASON,
  installmentItemTitle,
  isInstallmentOrder,
  isOwedPart,
  isValidInstallmentPlan,
  partOrderId,
  planKeyOf,
  scheduleDates,
} from "./installments";

/**
 * Writes to the orders of a payment plan. Like `membership-store.ts`, this
 * module imports nothing from the payment flows: order fulfilment
 * (`src/lib/payments/fulfillment.ts`) calls into it, and the gateway side
 * (Stripe subscription, reminders, pay links) lives in
 * `installment-service.ts`.
 */

type PartKey = Pick<Payment, "orderId" | "installmentNumber" | "userId" | "itemId">;

/** Every order of the plan `part` belongs to (live rows; call inside `mutate`). */
export function planRowsIn(d: Pick<Database, "payments">, part: PartKey): Payment[] {
  const key = planKeyOf(part);
  return d.payments
    .filter((p) => p.userId === part.userId && p.itemId === part.itemId && isInstallmentOrder(p) && planKeyOf(p) === key && partOrderId(key, p.installmentNumber!) === p.orderId)
    .sort((a, b) => a.installmentNumber! - b.installmentNumber!);
}

/**
 * Write the orders of parts 2..N once the first part is paid: same buyer,
 * billing details and amounts as part 1, due one interval apart counted from
 * the first payment (`createdAt` of a scheduled part is its due date). The
 * coupon stays on part 1 only, so it is redeemed once. Idempotent: nothing is
 * written when the schedule exists (parts removed later are not recreated).
 */
export async function ensureInstallmentSchedule(anchorId: string): Promise<Payment[]> {
  return mutate((d): Payment[] => {
    const anchor = d.payments.find((p) => p.id === anchorId);
    if (!anchor || !isInstallmentOrder(anchor) || anchor.installmentNumber !== 1 || anchor.status !== "paid") return [];
    const total = anchor.installmentsTotal!;
    if (planRowsIn(d, anchor).some((p) => p.installmentNumber! > 1)) return [];

    const course = d.courses.find((c) => c.id === anchor.itemId);
    const intervalDays = isValidInstallmentPlan(course?.installments) ? course.installments.intervalDays : DEFAULT_INSTALLMENT_INTERVAL_DAYS;
    const dates = scheduleDates(anchor.paidAt ?? new Date().toISOString(), total, intervalDays);
    const title = course?.title ?? anchor.itemTitle.replace(/ · payment \d+ of \d+$/, "");
    const created: Payment[] = [];
    for (let n = 2; n <= total; n++) {
      const row: Payment = {
        id: uid("pay"),
        orderId: partOrderId(anchor.orderId, n),
        userId: anchor.userId,
        itemType: "course",
        itemId: anchor.itemId,
        itemTitle: installmentItemTitle(title, n, total),
        originalAmount: anchor.originalAmount,
        discountAmount: anchor.discountAmount,
        taxAmount: anchor.taxAmount,
        amount: anchor.amount,
        currency: anchor.currency,
        billingName: anchor.billingName,
        address: anchor.address,
        gstin: anchor.gstin,
        pan: anchor.pan,
        source: anchor.source,
        taxCountry: anchor.taxCountry,
        taxRate: anchor.taxRate,
        gateway: anchor.gateway,
        status: "pending",
        createdAt: dates[n - 1]!,
        installmentNumber: n,
        installmentsTotal: total,
      };
      d.payments.push(row);
      created.push({ ...row });
    }
    return created;
  });
}

/**
 * Close every part of a plan that is still owed (pure; call inside `mutate`).
 * The reason starts with `PLAN_CANCELLED_REASON`, which is what tells a
 * cancelled part from a payment attempt that merely failed. Returns the
 * closed rows.
 */
export function cancelScheduleIn(d: Pick<Database, "payments">, part: PartKey, why: string): Payment[] {
  const closed: Payment[] = [];
  for (const row of planRowsIn(d, part)) {
    if (!isOwedPart(row)) continue;
    row.status = "failed";
    row.failureReason = `${PLAN_CANCELLED_REASON}: ${why}`.slice(0, 300);
    row.checkoutUrl = undefined;
    closed.push({ ...row });
  }
  return closed;
}

/**
 * Hand the remaining parts of a plan to a Stripe subscription: each unpaid
 * part carries the subscription id until its invoice is paid, and the due
 * dates follow Stripe's billing cycle (`cycle`) so reminders and the pause
 * rule use the dates Stripe charges on. Parts with a checkout of their own
 * in progress are left alone.
 */
export async function attachStripeSubscription(anchorId: string, subscriptionId: string, cycle?: { startIso: string; intervalDays: number }): Promise<number> {
  return mutate((d) => {
    const anchor = d.payments.find((p) => p.id === anchorId);
    if (!anchor || !isInstallmentOrder(anchor)) return 0;
    const dates = cycle && cycle.intervalDays > 0 ? scheduleDates(cycle.startIso, anchor.installmentsTotal!, cycle.intervalDays) : null;
    let attached = 0;
    for (const row of planRowsIn(d, anchor)) {
      if (row.installmentNumber! < 2 || row.status !== "pending") continue;
      if (row.gatewayOrderId && row.gatewayOrderId !== subscriptionId) continue;
      row.gateway = "stripe";
      row.gatewayOrderId = subscriptionId;
      row.checkoutUrl = undefined;
      const due = dates?.[row.installmentNumber! - 1];
      if (due) row.createdAt = due;
      attached++;
    }
    return attached;
  });
}

/**
 * The Stripe subscription of a plan ended with parts still owed (the card
 * kept failing, or it was cancelled at Stripe): those parts are collected
 * with pay links through `gateway` from now on. Returns the affected parts.
 */
export async function detachStripeSubscription(subscriptionId: string, gateway: string): Promise<Payment[]> {
  return mutate((d) => {
    const released: Payment[] = [];
    for (const row of d.payments) {
      if (row.gatewayOrderId !== subscriptionId || !isInstallmentOrder(row) || !isOwedPart(row)) continue;
      row.gatewayOrderId = undefined;
      row.checkoutUrl = undefined;
      row.gateway = gateway;
      released.push({ ...row });
    }
    return released;
  });
}

/**
 * Make an owed part payable through `gateway` (the platform's gateway changed
 * since the plan was scheduled, or an earlier attempt was cancelled). Only
 * parts without an open gateway checkout are touched.
 */
export async function preparePartForPayment(paymentId: string, gateway: string): Promise<Payment | null> {
  return mutate((d) => {
    const row = d.payments.find((p) => p.id === paymentId);
    if (!row || !isInstallmentOrder(row) || !isOwedPart(row)) return row ? { ...row } : null;
    if (row.status === "failed") {
      row.status = "pending";
      row.failureReason = undefined;
      row.gatewayOrderId = undefined;
      row.checkoutUrl = undefined;
    }
    if (!row.gatewayOrderId && row.gateway !== gateway) row.gateway = gateway;
    return { ...row };
  });
}

/**
 * Turn the parts a plan still owes into zero-amount orders (an administrator
 * waived them). They are settled by the caller through order fulfilment like
 * any free order. Returns the ids of the parts to settle.
 */
export async function zeroOwedParts(part: PartKey): Promise<string[]> {
  return mutate((d) => {
    const ids: string[] = [];
    for (const row of planRowsIn(d, part)) {
      if (!isOwedPart(row)) continue;
      row.status = "pending";
      row.failureReason = undefined;
      row.discountAmount = row.originalAmount;
      row.taxAmount = 0;
      row.amount = 0;
      row.gateway = "free";
      row.gatewayOrderId = undefined;
      row.checkoutUrl = undefined;
      ids.push(row.id);
    }
    return ids;
  });
}
