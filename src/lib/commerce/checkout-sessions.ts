import "server-only";
import type { CheckoutSession, Coupon, Database, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { brandFromSettings, enqueueEmail, preferencesUrl, unsubscribeUrl } from "@/lib/email";
import { isSafeAddress } from "@/lib/email/mime";
import { resolveEmailPreferences } from "@/lib/email/preferences";
import { renderEmail, type EmailBlock } from "@/lib/email/templates";
import { csvCell, getBillingItem, type BillingItem } from "@/lib/data/commerce";
import { addDays, formatPrice, shortCode, toDateKey, uid } from "@/lib/utils";
import { isRecurringInterval } from "./plans";
import { resolveCourseAccess } from "./access";
import {
  RECOVERY_COUPON_DAYS,
  SESSION_STATUS_LABELS,
  TOUCH_THROTTLE_MS,
  completeSession,
  completingPayment,
  dueReminder,
  isFinalReminder,
  recoveryStats,
  sessionStatus,
  type RecoveryStats,
  type SessionStatus,
} from "./checkout-recovery";

/**
 * Abandoned-checkout recovery: tracking checkout visits, the reminder run
 * (lazy on admin pages + `/api/cron/commerce`), closing sessions when the
 * item is bought (`payment.paid`), and the admin report.
 */

/** Item types a checkout page sells (gifts and seats have their own flows). */
const TRACKED = new Set(["course", "batch", "certificate", "plan", "bundle"]);

/**
 * Record a checkout visit: opens a session for the buyer and item, or
 * refreshes the open one (which also restarts the reminder clock). Visits
 * within a minute of the last one don't write. Never throws.
 */
export async function trackCheckoutView(user: Pick<User, "id" | "email">, item: Pick<BillingItem, "type" | "id">): Promise<void> {
  if (!TRACKED.has(item.type)) return;
  try {
    const db = await getDb();
    const now = Date.now();
    const open = db.checkoutSessions.find((s) => s.userId === user.id && s.itemType === item.type && s.itemId === item.id && !s.completedPaymentId);
    if (open && now - Date.parse(open.lastStepAt) < TOUCH_THROTTLE_MS) return;
    const at = new Date(now).toISOString();
    await mutate((d) => {
      const row = d.checkoutSessions.find((s) => s.userId === user.id && s.itemType === item.type && s.itemId === item.id && !s.completedPaymentId);
      if (row) {
        row.lastStepAt = at;
        row.email = user.email;
        return;
      }
      d.checkoutSessions.push({ id: uid("chk"), userId: user.id, email: user.email, itemType: item.type, itemId: item.id, startedAt: at, lastStepAt: at, reminderCount: 0 });
    });
  } catch (error) {
    console.error("[checkouts] could not record a checkout visit:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * A paid order closes the buyer's open checkout of the same item (counted as
 * recovered when a reminder went out before). Called from `payment.paid`.
 */
export async function completeCheckoutSessions(paymentId: string): Promise<number> {
  const db = await getDb();
  const payment = db.payments.find((p) => p.id === paymentId);
  if (!payment || payment.status !== "paid" || !TRACKED.has(payment.itemType)) return 0;
  if (!db.checkoutSessions.some((s) => s.userId === payment.userId && s.itemType === payment.itemType && s.itemId === payment.itemId && !s.completedPaymentId)) return 0;
  const now = new Date().toISOString();
  return mutate((d) => {
    let n = 0;
    for (const s of d.checkoutSessions) {
      if (s.userId === payment.userId && s.itemType === payment.itemType && s.itemId === payment.itemId && completeSession(s, payment, now)) n++;
    }
    return n;
  });
}

/* ------------------------------------------------------------------ */
/* Reminder run                                                        */
/* ------------------------------------------------------------------ */

const RUN_INTERVAL_MS = 5 * 60_000;
const g = globalThis as unknown as { __llCheckoutRecoveryAt?: number; __llCheckoutRecoveryRunning?: Promise<RecoveryRunResult> };

export interface RecoveryRunResult {
  sent: number;
  coupons: number;
  closed: number;
  skipped: boolean;
}

/** Whether the buyer can't (or needn't) be sent back to this checkout: they own it, or an order is already open. */
function noLongerBuyable(db: Database, s: CheckoutSession): boolean {
  if (!s.userId) return true;
  if (db.payments.some((p) => p.userId === s.userId && p.itemType === s.itemType && p.itemId === s.itemId && p.status === "pending")) return true;
  if (s.itemType === "course") return resolveCourseAccess(db, s.userId, s.itemId).granted;
  if (s.itemType === "batch") return db.batchEnrollments.some((e) => e.userId === s.userId && e.batchId === s.itemId);
  if (s.itemType === "certificate") return !!db.enrollments.find((e) => e.userId === s.userId && e.courseId === s.itemId)?.purchasedCertificate;
  return false;
}

/** What a recovery coupon for `item` is limited to (null: the item can't take one). */
function recoveryCouponTarget(item: BillingItem): Coupon["applicableItems"][number] | null {
  if (item.type === "course" || item.type === "certificate") return { type: "course", id: item.id };
  if (item.type === "batch" || item.type === "bundle") return { type: item.type, id: item.id };
  // Memberships that renew don't take coupons.
  if (item.type === "plan" && item.plan && !isRecurringInterval(item.plan.interval)) return { type: "plan", id: item.id };
  return null;
}

/**
 * The personal coupon of a final reminder: one use, by the buyer who left
 * the checkout, for the item they left (never a site-wide code).
 */
function couponFor(item: BillingItem, percent: number, userId: string): Coupon | null {
  if (percent <= 0) return null;
  const target = recoveryCouponTarget(item);
  if (!target) return null;
  const now = new Date();
  return {
    id: uid("cpn"),
    code: `COMEBACK-${shortCode(2, 4).replace("-", "")}`,
    discountType: "percentage",
    value: percent,
    expiresOn: toDateKey(addDays(now, RECOVERY_COUPON_DAYS)),
    usageLimit: 1,
    redemptionCount: 0,
    enabled: true,
    applicableItems: [target],
    ownerUserId: userId,
    createdAt: now.toISOString(),
  };
}

async function sendReminder(db: Database, user: User, item: BillingItem, index: number, coupon: Coupon | null): Promise<void> {
  const brand = brandFromSettings(db.settings);
  const final = isFinalReminder(index, db.settings.growth.abandonedCheckoutDelaysHours);
  const checkoutPath = `/billing/${item.type}/${encodeURIComponent(item.id)}${coupon ? `?coupon=${encodeURIComponent(coupon.code)}` : ""}`;
  const price = formatPrice(item.amount, item.currency);
  const subject = coupon ? `${coupon.value}% off ${item.name}, just for you` : index === 0 ? `You left ${item.name} in your checkout` : `Still thinking about ${item.name}?`;
  const blocks: EmailBlock[] = [
    {
      type: "paragraph",
      text:
        index === 0
          ? `You started checking out ${item.name} but didn't finish. Your order is one step away, and your billing details are saved.`
          : `${item.name} is still waiting for you. Pick up where you left off whenever you're ready.`,
    },
    { type: "details", rows: [{ label: "Item", value: item.title }, { label: "Price", value: price }] },
  ];
  if (coupon) {
    blocks.push(
      { type: "code", label: `Your ${coupon.value}% discount code`, text: coupon.code },
      { type: "callout", tone: "success", text: `The code is applied when you use the button below. It works once and expires on ${coupon.expiresOn}.` },
    );
  }
  blocks.push({ type: "button", label: "Complete your purchase", url: checkoutPath, fallback: true });
  if (final && !coupon) blocks.push({ type: "muted", text: "This is the last reminder we'll send about this checkout." });
  const rendered = renderEmail(brand, subject, {
    preheader: coupon ? `Save ${coupon.value}% on ${item.name} with your personal code.` : `Finish your order for ${item.name}.`,
    eyebrow: "Your checkout",
    heading: coupon ? "A little something to help you decide" : "Did something go wrong?",
    greeting: `Hi ${user.name.split(/\s+/)[0] || "there"},`,
    blocks,
    signoff: ["Happy learning,", `The ${brand.name} team`],
    footer: {
      reason: `You're receiving this because you started a checkout at ${brand.name}.`,
      preferencesUrl: preferencesUrl(),
      unsubscribeUrl: unsubscribeUrl(user.id, "payments"),
      unsubscribeLabel: "Unsubscribe from payment reminders",
    },
  });
  await enqueueEmail({ to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "reminder" });
}

async function runRecovery(): Promise<RecoveryRunResult> {
  const db = await getDb();
  const growth = db.settings.growth;
  const result: RecoveryRunResult = { sent: 0, coupons: 0, closed: 0, skipped: false };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Sessions whose purchase was missed by the event (e.g. paid while the server restarted) are closed first.
  const missed = db.checkoutSessions.filter((s) => !s.completedPaymentId && completingPayment(s, db.payments));
  if (missed.length) {
    result.closed = await mutate((d) => {
      let n = 0;
      for (const s of d.checkoutSessions) {
        const paid = !s.completedPaymentId ? completingPayment(s, d.payments) : null;
        if (paid && completeSession(s, paid, nowIso)) n++;
      }
      return n;
    });
  }
  if (!growth.abandonedCheckoutEnabled || !db.settings.email.enabled) return result;

  const fresh = await getDb();
  const delays = fresh.settings.growth.abandonedCheckoutDelaysHours;
  for (const s of fresh.checkoutSessions) {
    const index = dueReminder(s, delays, now);
    if (index === null || noLongerBuyable(fresh, s)) continue;
    const user = fresh.users.find((u) => u.id === s.userId);
    const item = await getBillingItem(s.itemType as BillingItem["type"], s.itemId);
    // Claim the reminder first (serialized), so concurrent runs never send it twice.
    const final = isFinalReminder(index, delays);
    const coupon = item && final && s.userId ? couponFor(item, fresh.settings.growth.abandonedCheckoutCouponPercent, s.userId) : null;
    const claimed = await mutate((d) => {
      const row = d.checkoutSessions.find((x) => x.id === s.id);
      if (!row || row.completedPaymentId || row.reminderCount > index) return false;
      row.reminderCount = index + 1;
      row.lastReminderAt = nowIso;
      const deliverable = !!user && !!item && user.enabled && isSafeAddress(user.email) && resolveEmailPreferences(user).payments;
      if (deliverable && coupon) {
        d.coupons.push(coupon);
        row.couponSent = coupon.code;
      }
      return deliverable;
    });
    if (!claimed || !user || !item) continue;
    try {
      await sendReminder(fresh, user, item, index, coupon);
      result.sent++;
      if (coupon) result.coupons++;
    } catch (error) {
      console.error("[checkouts] could not send a checkout reminder:", error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

/**
 * Send the checkout reminders that are due. Page views run it at most every
 * five minutes; the cron endpoint passes `force`. Concurrent calls share one run.
 */
export async function processAbandonedCheckouts(opts: { force?: boolean } = {}): Promise<RecoveryRunResult> {
  if (g.__llCheckoutRecoveryRunning) return g.__llCheckoutRecoveryRunning;
  const last = g.__llCheckoutRecoveryAt ?? 0;
  if (!opts.force && Date.now() - last < RUN_INTERVAL_MS) return { sent: 0, coupons: 0, closed: 0, skipped: true };
  g.__llCheckoutRecoveryAt = Date.now();
  const run = runRecovery().finally(() => {
    g.__llCheckoutRecoveryRunning = undefined;
  });
  g.__llCheckoutRecoveryRunning = run;
  return run;
}

/** `processAbandonedCheckouts` for page views: never throws. */
export async function processAbandonedCheckoutsQuietly(): Promise<void> {
  await processAbandonedCheckouts().catch((error) => console.error("[checkouts] recovery run failed:", error instanceof Error ? error.message : String(error)));
}

/* ------------------------------------------------------------------ */
/* Admin report                                                        */
/* ------------------------------------------------------------------ */

export interface CheckoutFilter {
  status: SessionStatus | "all";
  /** Only sessions started within this many days (0 = all time). */
  days: number;
  search: string | null;
  page: number;
}

const PERIODS = [7, 30, 90, 0] as const;

export function parseCheckoutFilter(sp: Record<string, string | string[] | undefined> | URLSearchParams): CheckoutFilter {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const status = get("cstatus");
  const days = Number(get("cdays") || 30);
  const page = Number(get("cpage"));
  return {
    status: status === "open" || status === "abandoned" || status === "completed" || status === "recovered" ? status : "all",
    days: (PERIODS as readonly number[]).includes(days) ? days : 30,
    search: get("cq").slice(0, 100) || null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export interface CheckoutRow {
  id: string;
  userName: string;
  email: string;
  itemType: string;
  itemTitle: string;
  itemHref: string | null;
  status: SessionStatus;
  statusLabel: string;
  startedAt: string;
  lastStepAt: string;
  reminderCount: number;
  lastReminderAt?: string;
  couponSent?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
}

const ITEM_LABEL: Record<string, string> = { course: "Course", batch: "Batch", certificate: "Certificate", plan: "Membership", bundle: "Bundle" };

function itemInfo(db: Database, type: string, id: string): { title: string; href: string | null } {
  if (type === "course" || type === "certificate") {
    const c = db.courses.find((x) => x.id === id);
    return c ? { title: type === "certificate" ? `Certificate for ${c.title}` : c.title, href: `/courses/${c.slug}` } : { title: "Deleted course", href: null };
  }
  if (type === "batch") {
    const b = db.batches.find((x) => x.id === id);
    return b ? { title: b.title, href: `/batches/${b.slug}` } : { title: "Deleted batch", href: null };
  }
  if (type === "bundle") {
    const b = db.bundles.find((x) => x.id === id);
    return b ? { title: b.title, href: `/bundles/${b.slug}` } : { title: "Deleted bundle", href: null };
  }
  if (type === "plan") {
    const p = db.plans.find((x) => x.id === id);
    return p ? { title: p.name, href: "/pricing" } : { title: "Deleted plan", href: null };
  }
  return { title: id, href: null };
}

const PAGE_SIZE = 25;

export async function getAdminCheckouts(
  filter: CheckoutFilter,
  opts: { all?: boolean } = {},
): Promise<{ rows: CheckoutRow[]; total: number; page: number; pageCount: number; stats: RecoveryStats; settings: Database["settings"]["growth"] }> {
  const db = await getDb();
  const now = Date.now();
  const delays = db.settings.growth.abandonedCheckoutDelaysHours;
  const since = filter.days > 0 ? now - filter.days * 86_400_000 : undefined;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const payments = new Map(db.payments.map((p) => [p.id, p]));
  const q = filter.search?.toLowerCase();
  const rows: CheckoutRow[] = [];
  for (const s of db.checkoutSessions) {
    if (since !== undefined && Date.parse(s.startedAt) < since) continue;
    const status = sessionStatus(s, delays, now);
    if (filter.status !== "all" && status !== filter.status) continue;
    const user = s.userId ? users.get(s.userId) : undefined;
    const info = itemInfo(db, s.itemType, s.itemId);
    const email = user?.email ?? s.email ?? "";
    const userName = user?.name ?? "Deleted member";
    if (q && !`${userName} ${email} ${info.title} ${s.couponSent ?? ""}`.toLowerCase().includes(q)) continue;
    const paid = s.completedPaymentId ? payments.get(s.completedPaymentId) : undefined;
    rows.push({
      id: s.id,
      userName,
      email,
      itemType: ITEM_LABEL[s.itemType] ?? s.itemType,
      itemTitle: info.title,
      itemHref: info.href,
      status,
      statusLabel: SESSION_STATUS_LABELS[status],
      startedAt: s.startedAt,
      lastStepAt: s.lastStepAt,
      reminderCount: s.reminderCount,
      lastReminderAt: s.lastReminderAt,
      couponSent: s.couponSent,
      orderId: paid?.orderId,
      amount: paid?.amount,
      currency: paid?.currency,
    });
  }
  rows.sort((a, b) => b.lastStepAt.localeCompare(a.lastStepAt));
  const stats = recoveryStats(db.checkoutSessions, db.payments, delays, { since, now });
  if (opts.all) return { rows, total: rows.length, page: 1, pageCount: 1, stats, settings: db.settings.growth };
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: rows.length, page, pageCount, stats, settings: db.settings.growth };
}

export function checkoutsToCsv(rows: readonly CheckoutRow[]): string {
  const header = ["Started at", "Last visit", "Member", "Email", "Item type", "Item", "Status", "Reminders sent", "Last reminder", "Coupon sent", "Order", "Amount", "Currency"];
  return [
    header.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        r.startedAt,
        r.lastStepAt,
        r.userName,
        r.email,
        r.itemType,
        r.itemTitle,
        r.statusLabel,
        r.reminderCount,
        r.lastReminderAt ?? "",
        r.couponSent ?? "",
        r.orderId ?? "",
        r.amount !== undefined ? (r.amount / 100).toFixed(2) : "",
        r.currency ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}
