import type { CheckoutSession, Payment } from "@/lib/types";

/**
 * Abandoned-checkout recovery rules (pure).
 *
 * A `CheckoutSession` is opened (or refreshed) whenever a signed-in buyer
 * views a checkout page. When no purchase follows, reminder emails go out
 * at `settings.growth.abandonedCheckoutDelaysHours` after the buyer's last
 * checkout visit; the last one carries a single-use coupon
 * (`abandonedCheckoutCouponPercent`). A purchase of the item closes the
 * session; one made after a reminder counts as recovered.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Sessions untouched for longer are never reminded (a stale cart is not worth an email). */
export const RECOVERY_WINDOW_DAYS = 30;
/** Days a recovery coupon stays valid. */
export const RECOVERY_COUPON_DAYS = 7;
/** A checkout visit within this time of the last one doesn't rewrite the session. */
export const TOUCH_THROTTLE_MS = 60_000;

export type SessionStatus = "open" | "abandoned" | "completed" | "recovered";

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  open: "In progress",
  abandoned: "Abandoned",
  completed: "Purchased",
  recovered: "Recovered",
};

/**
 * Where a session stands: purchased (after a reminder: recovered), or
 * abandoned once the first reminder delay has passed without a purchase.
 */
export function sessionStatus(s: Pick<CheckoutSession, "completedPaymentId" | "recoveredAt" | "lastStepAt">, delaysHours: readonly number[], now: number = Date.now()): SessionStatus {
  if (s.completedPaymentId) return s.recoveredAt ? "recovered" : "completed";
  const first = delaysHours[0] ?? 1;
  return now - Date.parse(s.lastStepAt) >= first * HOUR ? "abandoned" : "open";
}

/**
 * The reminder to send now (0-based index into the delays), or null. When
 * several fell due at once (e.g. the scheduler was down), only the latest is
 * sent, so a buyer never gets a burst of emails.
 */
export function dueReminder(s: Pick<CheckoutSession, "completedPaymentId" | "lastStepAt" | "reminderCount">, delaysHours: readonly number[], now: number = Date.now()): number | null {
  if (s.completedPaymentId) return null;
  const last = Date.parse(s.lastStepAt);
  if (!Number.isFinite(last) || now - last > RECOVERY_WINDOW_DAYS * DAY) return null;
  let due: number | null = null;
  for (let i = s.reminderCount; i < delaysHours.length; i++) {
    if (last + delaysHours[i] * HOUR <= now) due = i;
  }
  return due;
}

/** Whether reminder `index` is the final one (the one with the coupon). */
export function isFinalReminder(index: number, delaysHours: readonly number[]): boolean {
  return index === delaysHours.length - 1;
}

/** Paid order of the session's item by its buyer, placed after the session started. */
export function completingPayment(s: Pick<CheckoutSession, "userId" | "itemType" | "itemId" | "startedAt">, payments: readonly Payment[]): Payment | null {
  if (!s.userId) return null;
  return payments.find((p) => p.userId === s.userId && p.itemType === s.itemType && p.itemId === s.itemId && (p.status === "paid" || p.status === "refunded") && !!p.paidAt && p.paidAt >= s.startedAt) ?? null;
}

/** Close a session for a paid order; it counts as recovered when a reminder went out first. */
export function completeSession(s: CheckoutSession, payment: Pick<Payment, "id" | "paidAt" | "couponCode">, now: string): boolean {
  if (s.completedPaymentId) return false;
  s.completedPaymentId = payment.id;
  const usedCoupon = !!s.couponSent && payment.couponCode?.toUpperCase() === s.couponSent.toUpperCase();
  if (s.reminderCount > 0 || usedCoupon) s.recoveredAt = payment.paidAt ?? now;
  return true;
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export interface RecoveryStats {
  /** Checkouts started in the period. */
  started: number;
  /** Bought (with or without a reminder). */
  completed: number;
  /** Not bought and past the first reminder delay. */
  abandoned: number;
  /** Abandoned checkouts that got at least one reminder. */
  reminded: number;
  /** Bought after a reminder. */
  recovered: number;
  /** recovered ÷ reminded, in percent. */
  recoveryRate: number;
  /** completed ÷ started, in percent. */
  conversionRate: number;
  /** Money from recovered checkouts, per currency (less refunds). */
  recoveredRevenue: { currency: string; amount: number }[];
}

export function recoveryStats(
  sessions: readonly CheckoutSession[],
  payments: readonly Pick<Payment, "id" | "amount" | "currency" | "status" | "refundedAmount">[],
  delaysHours: readonly number[],
  opts: { since?: number; now?: number } = {},
): RecoveryStats {
  const now = opts.now ?? Date.now();
  const byId = new Map(payments.map((p) => [p.id, p]));
  const revenue = new Map<string, number>();
  let started = 0;
  let completed = 0;
  let abandoned = 0;
  let reminded = 0;
  let recovered = 0;
  for (const s of sessions) {
    if (opts.since !== undefined && Date.parse(s.startedAt) < opts.since) continue;
    started++;
    if (s.reminderCount > 0) reminded++;
    const status = sessionStatus(s, delaysHours, now);
    if (status === "completed" || status === "recovered") completed++;
    if (status === "abandoned") abandoned++;
    if (status !== "recovered") continue;
    recovered++;
    const p = s.completedPaymentId ? byId.get(s.completedPaymentId) : undefined;
    if (!p) continue;
    const kept = p.status === "refunded" ? p.amount - (p.refundedAmount ?? p.amount) : p.amount - (p.refundedAmount ?? 0);
    if (kept > 0) revenue.set(p.currency, (revenue.get(p.currency) ?? 0) + kept);
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    started,
    completed,
    abandoned,
    reminded,
    recovered,
    recoveryRate: pct(recovered, reminded),
    conversionRate: pct(completed, started),
    recoveredRevenue: Array.from(revenue, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/* ------------------------------------------------------------------ */
/* Admin settings form                                                 */
/* ------------------------------------------------------------------ */

export type RecoverySettingsValidation =
  | { ok: true; value: { enabled: boolean; delaysHours: number[]; couponPercent: number } }
  | { ok: false; errors: Record<string, string> };

/** "1, 24, 72" → [1, 24, 72]: 1–5 distinct whole hours between 1 and 720, ascending. */
export function validateRecoverySettings(input: { enabled: boolean; delays: string; couponPercent: string }): RecoverySettingsValidation {
  const errors: Record<string, string> = {};
  const parts = input.delays
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const delays = parts.map(Number);
  if (!parts.length) errors.delays = "Enter when to send the reminders, e.g. 1, 24, 72.";
  else if (parts.length > 5) errors.delays = "Send at most 5 reminders.";
  else if (delays.some((d) => !Number.isInteger(d) || d < 1 || d > 720)) errors.delays = "Use whole hours between 1 and 720 (30 days).";
  else if (new Set(delays).size !== delays.length) errors.delays = "Each reminder needs a different time.";
  const rawPct = input.couponPercent.trim();
  const pct = rawPct === "" ? 0 : Number(rawPct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 90) errors.couponPercent = "Enter a whole percentage between 0 and 90 (0 = no coupon).";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { enabled: input.enabled, delaysHours: [...delays].sort((a, b) => a - b), couponPercent: pct } };
}

/** "1 hour", "1 day", "3 days", "36 hours". */
export function delayLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
