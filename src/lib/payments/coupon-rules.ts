import type { Coupon, Payment, PaymentItemType } from "@/lib/types";
import { SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";

/**
 * Coupon rules shared by the checkout page, the serialized order insert,
 * reopening a failed order and fulfilment. Everything here is a pure function
 * over a database snapshot, so the same checks can run inside `mutate`, where
 * the limit check and the write that reserves a use happen atomically.
 */

const ITEM_LABELS: Record<PaymentItemType, string> = { course: "Course", batch: "Batch", certificate: "Certificate" };

export const COUPON_LIMIT_REACHED = "This coupon has reached its maximum usage limit.";

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function couponAppliesTo(coupon: Coupon, item: { type: PaymentItemType; id: string }): boolean {
  if (!coupon.applicableItems.length) return true;
  if (item.type === "batch") return coupon.applicableItems.some((a) => a.type === "batch" && a.id === item.id);
  // Course and certificate purchases match coupons listed for the course.
  return coupon.applicableItems.some((a) => a.type === "course" && a.id === item.id);
}

/**
 * Redemptions a coupon has used up: paid orders (`redemptionCount`) plus
 * orders still awaiting payment, which reserve a use so a limited code cannot
 * be over-redeemed while checkouts are open.
 */
export function couponUsesTaken(coupon: Pick<Coupon, "id" | "redemptionCount">, payments: readonly Pick<Payment, "status" | "couponId">[]): number {
  const reserved = payments.filter((p) => p.status === "pending" && p.couponId === coupon.id).length;
  return coupon.redemptionCount + reserved;
}

export interface CouponTarget {
  type: PaymentItemType;
  id: string;
  currency: string;
}

export interface CouponContext {
  payments: readonly Pick<Payment, "status" | "couponId">[];
  /** Fixed-amount coupons are stored in this currency. */
  defaultCurrency: string;
  /** Today as YYYY-MM-DD (`toDateKey()`). */
  today: string;
}

/**
 * Why `coupon` cannot be used for `item` right now (enabled, not expired,
 * under its usage limit counting reserved uses, applicable, currency), or
 * null when it can. `code` is what the buyer typed, for the "invalid" message.
 */
export function couponProblem(coupon: Coupon | null | undefined, item: CouponTarget, ctx: CouponContext, code?: string): string | null {
  if (!coupon || !coupon.enabled) return `The coupon code '${code ?? coupon?.code ?? ""}' is invalid.`;
  if (coupon.expiresOn && coupon.expiresOn < ctx.today) return "This coupon has expired.";
  if (coupon.usageLimit > 0 && couponUsesTaken(coupon, ctx.payments) >= coupon.usageLimit) return COUPON_LIMIT_REACHED;
  if (!couponAppliesTo(coupon, item)) return `This coupon is not applicable to this ${ITEM_LABELS[item.type]}.`;
  const defaultCurrency = ctx.defaultCurrency.toUpperCase();
  if (coupon.discountType === "fixed" && item.currency.toUpperCase() !== defaultCurrency) {
    return `This coupon can only be used for prices in ${defaultCurrency}.`;
  }
  return null;
}

/**
 * Uses beyond the limit after an order was fulfilled (paid orders plus the
 * uses still reserved by open orders), or null when the coupon is within its
 * limit. Money that was already taken is never refused, so fulfilment only
 * reports the overflow.
 */
export function couponOverflow(coupon: Pick<Coupon, "id" | "redemptionCount" | "usageLimit">, payments: readonly Pick<Payment, "status" | "couponId">[]): { used: number; limit: number } | null {
  if (coupon.usageLimit <= 0) return null;
  const used = couponUsesTaken(coupon, payments);
  return used > coupon.usageLimit ? { used, limit: coupon.usageLimit } : null;
}

/* ------------------------------------------------------------------ */
/* Guessing protection                                                 */
/* ------------------------------------------------------------------ */

/** Rejected coupon codes allowed per buyer and per IP address. */
export const COUPON_ATTEMPT_RULES = {
  user: { limit: 20, windowMs: 10 * 60 * 1000 },
  ip: { limit: 60, windowMs: 10 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

const g = globalThis as unknown as { __llCouponAttempts?: SlidingWindowRateLimiter };

/** Process-wide counter of rejected coupon codes. */
export const couponAttemptLimiter: SlidingWindowRateLimiter = (g.__llCouponAttempts ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

export interface CouponAttemptKeys {
  userId: string;
  /** Client IP; ignored when unknown (behind no proxy every request would share one bucket). */
  ip?: string | null;
}

function attemptKeys(keys: CouponAttemptKeys): { key: string; rule: RateLimitRule }[] {
  const out: { key: string; rule: RateLimitRule }[] = [{ key: `coupon:user:${keys.userId}`, rule: COUPON_ATTEMPT_RULES.user }];
  if (keys.ip && keys.ip !== "unknown") out.push({ key: `coupon:ip:${keys.ip}`, rule: COUPON_ATTEMPT_RULES.ip });
  return out;
}

/**
 * The message to show when too many coupon codes were rejected recently for
 * this buyer or IP (codes cannot be guessed by trying them one after
 * another), or null. Does not record an attempt.
 */
export function couponAttemptsBlocked(keys: CouponAttemptKeys, limiter: SlidingWindowRateLimiter = couponAttemptLimiter, now: number = Date.now()): string | null {
  let wait = 0;
  for (const { key, rule } of attemptKeys(keys)) {
    const state = limiter.check(key, rule, now);
    if (!state.ok) wait = Math.max(wait, state.retryAfterMs);
  }
  if (wait <= 0) return null;
  const minutes = Math.max(1, Math.ceil(wait / 60_000));
  return `Too many coupon codes were tried. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

/** Count a rejected coupon code against the buyer and their IP. */
export function recordRejectedCoupon(keys: CouponAttemptKeys, limiter: SlidingWindowRateLimiter = couponAttemptLimiter, now: number = Date.now()): void {
  for (const { key, rule } of attemptKeys(keys)) limiter.hit(key, rule, now);
}
