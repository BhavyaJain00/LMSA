import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Database, Gift, Payment, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { brandFromSettings, enqueueEmail } from "@/lib/email";
import { isSafeAddress } from "@/lib/email/mime";
import { renderEmail, type EmailBlock } from "@/lib/email/templates";
import { notify } from "@/lib/services/notifications";
import { SlidingWindowRateLimiter, perIpLimit, type RateLimitRule } from "@/lib/auth/rate-limit";
import { fulfillPayment } from "@/lib/payments/fulfillment";
import { computeOrderSummary, getBillingItem, orderTaxFields, type BillingItem, type OrderSummary } from "@/lib/data/commerce";
import type { TaxContext } from "./tax";
import { formatDate, formatPrice, shortCode, uid } from "@/lib/utils";
import { currentSubscription, ownedCourseIds, resolveCourseAccess } from "./access";
import { bundleCourses, isBundleOnSale } from "./bundles";
import { isGatewayManaged, isOngoing } from "./subscriptions";
import { intervalNoun, planAccessLabel } from "./plans";
import { firstName, generateGiftCode, giftOrderTitle, giftStatus, isGiftDue, isGiftRedeemable, normalizeGiftCode, type GiftDraft, type GiftItemType } from "./gifts";

/**
 * Gifts: buying a course, bundle or membership plan for someone else.
 *
 * Checkout creates the `Gift` (with its code) and the buyer's order
 * (`itemType "gift"`, `itemId` = the gift id) in one write. Once the order is
 * paid the gift email goes out — right away, or at the chosen send time
 * (`deliverDueGifts`, run by `/api/cron/commerce` and lazily when gift pages
 * are opened). Redeeming the code gives the recipient a zero-amount order of
 * the gifted item that is fulfilled like any purchase, so access, refunds and
 * reports all go through the usual paths.
 */

/* ------------------------------------------------------------------ */
/* Giftable items                                                      */
/* ------------------------------------------------------------------ */

export type GiftItemCheck = { ok: true; item: BillingItem } | { ok: false; error: string };

/** What a gift of `type`/`idOrSlug` would buy, or why it can't be gifted right now. */
export async function resolveGiftItem(type: GiftItemType, idOrSlug: string): Promise<GiftItemCheck> {
  const db = await getDb();
  if (!db.settings.growth.giftsEnabled) return { ok: false, error: "Gifts are not available at the moment." };
  const item = idOrSlug ? await getBillingItem(type, idOrSlug) : null;
  if (!item) return { ok: false, error: "We couldn't find what you want to give." };
  if (item.amount <= 0) return { ok: false, error: "This is free, so there's nothing to buy. Share the link instead." };
  if (type === "course" && item.course) {
    const c = item.course;
    if (!db.settings.features.courses || !c.published || c.upcoming) return { ok: false, error: "This course can't be given as a gift right now." };
    if (!c.paidCourse) return { ok: false, error: "This course is free, so there's nothing to buy. Share the link instead." };
    if (c.disableSelfLearning) return { ok: false, error: "This course is only available through a batch, so it can't be given as a gift." };
  }
  if (type === "bundle" && item.bundle) {
    if (!db.settings.growth.bundlesEnabled || !isBundleOnSale(item.bundle, db.courses)) return { ok: false, error: "This bundle can't be given as a gift right now." };
  }
  if (type === "plan" && item.plan) {
    if (!db.settings.growth.subscriptionsEnabled || !item.plan.active) return { ok: false, error: "This membership plan can't be given as a gift right now." };
  }
  return { ok: true, item };
}

/** The gift as one order: the item's price and tax (gifts take no coupons). */
export function giftSummary(item: BillingItem, settings: Database["settings"], tax?: TaxContext | null): OrderSummary {
  return computeOrderSummary({ ...item, type: "gift", title: giftOrderTitle(item.title) }, null, settings, tax);
}

/** "Lifetime access to …", "3 courses: …", "1 month of …" — what the recipient gets. */
export function giftContentsLabel(db: Pick<Database, "courses" | "bundles" | "plans">, gift: Pick<Gift, "itemType" | "itemId">): string {
  if (gift.itemType === "course") return "Lifetime access to the course";
  if (gift.itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === gift.itemId);
    const n = bundle ? bundleCourses(bundle, db.courses).length : 0;
    return n ? `Lifetime access to ${n} course${n === 1 ? "" : "s"}` : "A course bundle";
  }
  const plan = db.plans.find((p) => p.id === gift.itemId);
  if (!plan) return "A membership";
  const span = plan.interval === "one_time" ? "Lifetime membership" : `1 ${intervalNoun(plan.interval)} of membership`;
  return `${span}: ${planAccessLabel(plan.access).toLowerCase()}`;
}

export function giftItemTitle(db: Pick<Database, "courses" | "bundles" | "plans">, gift: Pick<Gift, "itemType" | "itemId">): string {
  if (gift.itemType === "course") return db.courses.find((c) => c.id === gift.itemId)?.title ?? "A course";
  if (gift.itemType === "bundle") return db.bundles.find((b) => b.id === gift.itemId)?.title ?? "A course bundle";
  return db.plans.find((p) => p.id === gift.itemId)?.name ?? "A membership";
}

export function giftItemHref(db: Pick<Database, "courses" | "bundles">, gift: Pick<Gift, "itemType" | "itemId">): string {
  if (gift.itemType === "course") {
    const course = db.courses.find((c) => c.id === gift.itemId);
    return course ? `/courses/${course.slug}` : "/courses";
  }
  if (gift.itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === gift.itemId);
    return bundle ? `/bundles/${bundle.slug}` : "/bundles";
  }
  return "/pricing";
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

export type GiftOrderResult = { ok: true; payment: Payment; gift: Gift; existing: boolean } | { ok: false; error: string };

/**
 * Create the gift and the buyer's pending order in one write. The same buyer
 * submitting the same gift twice (same item and recipient, still unpaid)
 * gets the open order back instead of a second one.
 */
export async function insertGiftOrder(input: {
  buyer: Pick<User, "id">;
  item: BillingItem;
  summary: OrderSummary;
  draft: GiftDraft;
  billing: Pick<Payment, "billingName" | "address" | "gstin" | "pan" | "source">;
  gateway: string;
  /** Affiliate credited for the sale (referral cookie or linked click at checkout). */
  affiliateId?: string;
}): Promise<GiftOrderResult> {
  const { buyer, item, summary, draft } = input;
  const type = item.type as GiftItemType;
  return mutate((d): GiftOrderResult => {
    const open = d.payments.find((p) => {
      if (p.userId !== buyer.id || p.itemType !== "gift" || p.status !== "pending") return false;
      const g = d.gifts.find((x) => x.id === p.itemId);
      return !!g && g.itemType === type && g.itemId === item.id && g.recipientEmail === draft.recipientEmail;
    });
    if (open) {
      const gift = d.gifts.find((g) => g.id === open.itemId)!;
      // The buyer may have changed the note or the date before paying.
      gift.recipientName = draft.recipientName;
      gift.message = draft.message;
      gift.sendAt = draft.sendAt;
      return { ok: true, payment: { ...open }, gift: { ...gift }, existing: true };
    }
    const codes = new Set(d.gifts.map((g) => g.code));
    let code = generateGiftCode();
    while (codes.has(code)) code = generateGiftCode();
    const orders = new Set(d.payments.map((p) => p.orderId));
    let orderId = `ORD-${shortCode(2, 4)}`;
    while (orders.has(orderId)) orderId = `ORD-${shortCode(2, 4)}`;
    const now = new Date().toISOString();
    const gift: Gift = {
      id: uid("gft"),
      code,
      purchaserId: buyer.id,
      recipientEmail: draft.recipientEmail,
      recipientName: draft.recipientName,
      message: draft.message,
      itemType: type,
      itemId: item.id,
      paymentId: "",
      sendAt: draft.sendAt,
      createdAt: now,
    };
    const payment: Payment = {
      id: uid("pay"),
      orderId,
      userId: buyer.id,
      itemType: "gift",
      itemId: gift.id,
      giftId: gift.id,
      itemTitle: giftOrderTitle(item.title),
      ...(item.plan ? { planId: item.plan.id } : {}),
      ...(item.bundle ? { bundleId: item.bundle.id } : {}),
      originalAmount: summary.originalAmount,
      discountAmount: summary.discountAmount,
      taxAmount: summary.taxAmount,
      amount: summary.total,
      currency: summary.currency,
      ...orderTaxFields(summary),
      ...input.billing,
      ...(input.affiliateId ? { affiliateId: input.affiliateId } : {}),
      gateway: summary.total <= 0 ? "free" : input.gateway,
      status: "pending",
      createdAt: now,
    };
    gift.paymentId = payment.id;
    d.gifts.push(gift);
    d.payments.push(payment);
    return { ok: true, payment: { ...payment }, gift: { ...gift }, existing: false };
  });
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

function giftEmailBlocks(db: Database, gift: Gift, buyerName: string): EmailBlock[] {
  const title = giftItemTitle(db, gift);
  const blocks: EmailBlock[] = [
    { type: "paragraph", text: `${buyerName} gave you ${gift.itemType === "plan" ? "a membership" : gift.itemType === "bundle" ? "a course bundle" : "a course"} at ${db.settings.brand.name}: ${title}.` },
  ];
  if (gift.message) blocks.push({ type: "quote", text: gift.message, cite: buyerName });
  blocks.push(
    { type: "details", rows: [{ label: "Your gift", value: title }, { label: "Includes", value: giftContentsLabel(db, gift) }] },
    { type: "button", label: "Redeem your gift", url: `/redeem?code=${encodeURIComponent(gift.code)}`, fallback: true },
    { type: "code", text: gift.code, label: "Your gift code" },
    { type: "muted", text: "Log in or create a free account with any email address to redeem it. The code works once." },
  );
  return blocks;
}

/** Send the gift email (and tell the recipient in the app when they already have an account). Never throws. */
async function sendGiftEmail(giftId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const gift = db.gifts.find((g) => g.id === giftId);
    if (!gift) return false;
    const buyer = db.users.find((u) => u.id === gift.purchaserId);
    const buyerName = buyer?.name ?? "Someone";
    const recipient = db.users.find((u) => u.email.toLowerCase() === gift.recipientEmail && u.enabled);
    if (recipient) {
      await notify(recipient.id, {
        type: "system",
        subject: `${buyerName} sent you a gift`,
        message: `${giftItemTitle(db, gift)} is waiting for you. Redeem it to start.`,
        link: `/redeem?code=${encodeURIComponent(gift.code)}`,
        fromUserId: gift.purchaserId,
        dedupeKey: `gift:${gift.id}:received`,
        email: false,
      });
    }
    if (!db.settings.email.enabled || !isSafeAddress(gift.recipientEmail)) return false;
    const brand = brandFromSettings(db.settings);
    const subject = `${buyerName} sent you a gift: ${giftItemTitle(db, gift)}`;
    const rendered = renderEmail(brand, subject, {
      preheader: gift.message ? `"${gift.message.slice(0, 120)}"` : `Redeem it at ${brand.name}.`,
      eyebrow: "A gift for you",
      heading: `${firstName(buyerName)} sent you a gift`,
      greeting: `Hi ${firstName(gift.recipientName ?? recipient?.name)},`,
      blocks: giftEmailBlocks(db, gift, buyerName),
      signoff: ["Happy learning,", `The ${brand.name} team`],
      footer: { reason: `You received this email because ${buyerName} bought you a gift at ${brand.name}.` },
    });
    await enqueueEmail({ to: gift.recipientEmail, toName: gift.recipientName, userId: recipient?.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category: "notification" });
    return true;
  } catch (error) {
    console.error("[gifts] could not send a gift email:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

export type DeliverResult = { ok: true; emailed: boolean; message: string } | { ok: false; error: string };

/**
 * Deliver a paid gift: stamp `sentAt` (claimed in one write so two runs never
 * send it twice), email the recipient and tell the buyer. `resend` sends a
 * delivered, unredeemed gift again (e.g. the recipient lost the email).
 */
export async function deliverGift(giftId: string, opts: { resend?: boolean; now?: Date; actor?: Pick<User, "id"> } = {}): Promise<DeliverResult> {
  const now = opts.now ?? new Date();
  const claim = await mutate((d) => {
    const gift = d.gifts.find((g) => g.id === giftId);
    if (!gift) return { error: "Gift not found." };
    const order = d.payments.find((p) => p.id === gift.paymentId);
    if (!isGiftRedeemable(gift, order)) {
      return { error: gift.redeemedAt ? "This gift was already redeemed." : order?.status === "pending" ? "This gift isn't paid yet." : "This gift was cancelled or refunded." };
    }
    if (opts.resend) {
      if (!gift.sentAt) return { error: "This gift hasn't been sent yet." };
    } else if (!isGiftDue(gift, order, now.getTime())) return { skip: true as const };
    gift.sentAt = now.toISOString();
    return { gift: { ...gift } };
  });
  if ("error" in claim) return { ok: false, error: claim.error ?? "This gift can't be sent." };
  if ("skip" in claim) return { ok: true, emailed: false, message: "Nothing to send yet." };
  const gift = claim.gift;
  const emailed = await sendGiftEmail(gift.id);
  const db = await getDb();
  const title = giftItemTitle(db, gift);
  const to = gift.recipientName ? `${gift.recipientName} (${gift.recipientEmail})` : gift.recipientEmail;
  await notify(gift.purchaserId, {
    type: "system",
    subject: emailed ? `Your gift to ${gift.recipientName ?? gift.recipientEmail} was ${opts.resend ? "sent again" : "delivered"}` : `Share your gift with ${gift.recipientName ?? gift.recipientEmail}`,
    message: emailed
      ? `We emailed ${to} a link to redeem ${title}.`
      : `We couldn't email ${to}. Share the gift code ${gift.code} or the redeem link from your gifts page with them.`,
    link: "/gift",
    dedupeKey: opts.resend ? undefined : `gift:${gift.id}:delivered`,
  });
  if (opts.actor) await audit(opts.actor, "gift.resend", { type: "gift", id: gift.id }, { emailed });
  return { ok: true, emailed, message: emailed ? `Gift email ${opts.resend ? "sent again" : "sent"} to ${gift.recipientEmail}.` : "Email is turned off, so the buyer was asked to share the code." };
}

const lazyState = globalThis as unknown as { __llGiftDeliveryAt?: number };
/** Lazy runs (page views) check at most this often; the cron always runs. */
const LAZY_INTERVAL_MS = 60_000;

/** Deliver every paid gift whose send time has come. Returns how many were delivered. */
export async function deliverDueGifts(opts: { now?: Date; force?: boolean } = {}): Promise<{ delivered: number }> {
  const now = opts.now ?? new Date();
  if (!opts.force && lazyState.__llGiftDeliveryAt && now.getTime() - lazyState.__llGiftDeliveryAt < LAZY_INTERVAL_MS) return { delivered: 0 };
  lazyState.__llGiftDeliveryAt = now.getTime();
  const db = await getDb();
  const orders = new Map(db.payments.map((p) => [p.id, p]));
  const due = db.gifts.filter((g) => isGiftDue(g, orders.get(g.paymentId), now.getTime()));
  let delivered = 0;
  for (const gift of due) {
    const res = await deliverGift(gift.id, { now });
    if (res.ok && res.message !== "Nothing to send yet.") delivered++;
  }
  return { delivered };
}

/** `deliverDueGifts` for page views: never throws. */
export async function deliverDueGiftsQuietly(): Promise<void> {
  await deliverDueGifts().catch((error) => console.error("[gifts] delivery run failed:", error instanceof Error ? error.message : String(error)));
}

/** The buyer changes the send time or recipient details of a gift that was not sent yet. */
export async function updateScheduledGift(user: Pick<User, "id">, giftId: string, draft: GiftDraft): Promise<{ ok: true } | { ok: false; error: string }> {
  return mutate((d) => {
    const gift = d.gifts.find((g) => g.id === giftId && g.purchaserId === user.id);
    if (!gift) return { ok: false as const, error: "Gift not found." };
    if (gift.sentAt || gift.redeemedAt) return { ok: false as const, error: "This gift was already delivered, so it can't be changed." };
    const order = d.payments.find((p) => p.id === gift.paymentId);
    if (!order || order.status === "failed" || order.status === "refunded") return { ok: false as const, error: "This gift was cancelled or refunded." };
    gift.recipientEmail = draft.recipientEmail;
    gift.recipientName = draft.recipientName;
    gift.message = draft.message;
    gift.sendAt = draft.sendAt;
    return { ok: true as const };
  });
}

/* ------------------------------------------------------------------ */
/* Redemption                                                          */
/* ------------------------------------------------------------------ */

const REDEEM_RULES = {
  user: { limit: 10, windowMs: 10 * 60_000 },
  ip: { limit: 30, windowMs: 10 * 60_000 },
  shared: { limit: 300, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

const limiterState = globalThis as unknown as { __llGiftRedeemLimiter?: SlidingWindowRateLimiter };
const redeemLimiter: SlidingWindowRateLimiter = (limiterState.__llGiftRedeemLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

function redeemKeys(userId: string, ip: string | null | undefined): { key: string; rule: RateLimitRule }[] {
  return [{ key: `gift:user:${userId}`, rule: REDEEM_RULES.user }, perIpLimit("gift:ip", ip, REDEEM_RULES.ip, REDEEM_RULES.shared)];
}

/** Message when too many wrong codes were tried from this account or address, else null (does not count an attempt). */
export function redeemAttemptsBlocked(userId: string, ip: string | null | undefined, now: number = Date.now()): string | null {
  let wait = 0;
  for (const { key, rule } of redeemKeys(userId, ip)) {
    const state = redeemLimiter.check(key, rule, now);
    if (!state.ok) wait = Math.max(wait, state.retryAfterMs);
  }
  if (wait <= 0) return null;
  const minutes = Math.max(1, Math.ceil(wait / 60_000));
  return `Too many gift codes were tried. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

function recordFailedRedeem(userId: string, ip: string | null | undefined): void {
  for (const { key, rule } of redeemKeys(userId, ip)) redeemLimiter.hit(key, rule);
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The gift with this (normalised) code, compared in constant time. */
export function findGiftByCode<G extends Pick<Gift, "code">>(gifts: readonly G[], code: string): G | null {
  const wanted = digest(code);
  let found: G | null = null;
  for (const g of gifts) if (timingSafeEqual(digest(g.code), wanted) && !found) found = g;
  return found;
}

export interface GiftPreview {
  code: string;
  title: string;
  contents: string;
  itemType: GiftItemType;
  href: string;
  imageUrl?: string;
  fromName: string;
  recipientName?: string;
  message?: string;
  status: ReturnType<typeof giftStatus>;
  redeemable: boolean;
  /** The viewer redeemed it. */
  mine: boolean;
}

/** What the redeem page shows for a code (rate limited by the caller), or null when it is unknown. */
export async function previewGift(rawCode: string, viewer: Pick<User, "id">): Promise<GiftPreview | null> {
  const code = normalizeGiftCode(rawCode);
  if (!code) return null;
  const db = await getDb();
  const gift = findGiftByCode(db.gifts, code);
  if (!gift) return null;
  const order = db.payments.find((p) => p.id === gift.paymentId);
  const status = giftStatus(gift, order);
  // Unpaid and cancelled gifts are not shown to anyone but their buyer.
  if ((status === "awaiting_payment" || status === "cancelled") && gift.purchaserId !== viewer.id) return null;
  const course = gift.itemType === "course" ? db.courses.find((c) => c.id === gift.itemId) : undefined;
  const bundle = gift.itemType === "bundle" ? db.bundles.find((b) => b.id === gift.itemId) : undefined;
  return {
    code: gift.code,
    title: giftItemTitle(db, gift),
    contents: giftContentsLabel(db, gift),
    itemType: gift.itemType,
    href: giftItemHref(db, gift),
    imageUrl: course?.imageUrl ?? bundle?.imageUrl ?? (bundle ? bundleCourses(bundle, db.courses).find((c) => c.imageUrl)?.imageUrl : undefined),
    fromName: db.users.find((u) => u.id === gift.purchaserId)?.name ?? "Someone",
    recipientName: gift.recipientName,
    message: gift.message,
    status,
    redeemable: isGiftRedeemable(gift, order),
    mine: gift.redeemedBy === viewer.id,
  };
}

/**
 * `previewGift` for the redeem page, with the same guessing protection as
 * redeeming: unknown codes count against the account and address.
 */
export async function lookupGift(rawCode: string, viewer: Pick<User, "id">, ip: string | null | undefined): Promise<{ preview: GiftPreview | null; error: string | null }> {
  const blocked = redeemAttemptsBlocked(viewer.id, ip);
  if (blocked) return { preview: null, error: blocked };
  const preview = await previewGift(rawCode, viewer);
  if (!preview) {
    recordFailedRedeem(viewer.id, ip);
    return { preview: null, error: "This gift code isn't valid. Check it against the gift email." };
  }
  return { preview, error: null };
}

export type RedeemResult = { ok: true; href: string; title: string; orderId: string } | { ok: false; error: string; field?: "code" };

/** Why `user` can't receive this gift right now (they already have it), or null. */
function alreadyHas(db: Database, user: Pick<User, "id">, gift: Gift): string | null {
  if (gift.itemType === "course") {
    const access = resolveCourseAccess(db, user.id, gift.itemId);
    if (access.granted && access.via !== "membership" && access.via !== "installments") return "You already have this course. Pass the code on to someone else instead.";
    return null;
  }
  if (gift.itemType === "bundle") {
    const bundle = db.bundles.find((b) => b.id === gift.itemId);
    const ids = bundle ? bundleCourses(bundle, db.courses).map((c) => c.id) : [];
    if (!ids.length) return "The courses of this gift are no longer available. Please contact us.";
    if (ownedCourseIds(db, user.id, ids).length === ids.length) return "You already have every course of this bundle. Pass the code on to someone else instead.";
    return null;
  }
  const current = currentSubscription(db, user.id);
  if (current && isOngoing(current) && (isGatewayManaged(current) || current.planId !== gift.itemId)) {
    return "You already have a running membership. Redeem this gift once it has ended, or pass the code on.";
  }
  return null;
}

/**
 * Redeem a gift code for `user`: checked and claimed in one write (single
 * use), then the recipient's zero-amount order is fulfilled. Wrong codes are
 * rate limited per account and address.
 */
export async function redeemGift(user: Pick<User, "id" | "name">, rawCode: string, ip: string | null | undefined): Promise<RedeemResult> {
  const blocked = redeemAttemptsBlocked(user.id, ip);
  if (blocked) return { ok: false, error: blocked, field: "code" };
  const code = normalizeGiftCode(rawCode);
  if (!code) {
    recordFailedRedeem(user.id, ip);
    return { ok: false, error: "That doesn't look like a gift code. It has the form GIFT-XXXX-XXXX-XXXX.", field: "code" };
  }

  const claim = await mutate((d): { error: string; field?: "code" } | { payment: Payment; gift: Gift; title: string } => {
    const gift = findGiftByCode(d.gifts, code);
    const order = gift ? d.payments.find((p) => p.id === gift.paymentId) : undefined;
    if (!gift || !order || order.status === "pending" || order.status === "failed") return { error: "This gift code isn't valid.", field: "code" };
    if (order.status === "refunded") return { error: "This gift was refunded, so the code no longer works." };
    if (gift.redeemedAt) return { error: gift.redeemedBy === user.id ? "You already redeemed this gift." : "This gift code was already used." };
    const problem = alreadyHas(d, user, gift);
    if (problem) return { error: problem };
    const title = giftItemTitle(d, gift);
    const price = gift.itemType === "course" ? (d.courses.find((c) => c.id === gift.itemId)?.price ?? 0) : gift.itemType === "bundle" ? (d.bundles.find((b) => b.id === gift.itemId)?.price ?? 0) : (d.plans.find((p) => p.id === gift.itemId)?.price ?? 0);
    const current = gift.itemType === "plan" ? currentSubscription(d, user.id) : null;
    const orders = new Set(d.payments.map((p) => p.orderId));
    let orderId = `ORD-${shortCode(2, 4)}`;
    while (orders.has(orderId)) orderId = `ORD-${shortCode(2, 4)}`;
    const now = new Date().toISOString();
    const payment: Payment = {
      id: uid("pay"),
      orderId,
      userId: user.id,
      itemType: gift.itemType,
      itemId: gift.itemId,
      itemTitle: `${title} · gift`,
      ...(gift.itemType === "plan" ? { planId: gift.itemId, ...(current && isOngoing(current) ? { subscriptionId: current.id } : {}) } : {}),
      ...(gift.itemType === "bundle" ? { bundleId: gift.itemId } : {}),
      giftId: gift.id,
      originalAmount: price,
      discountAmount: price,
      taxAmount: 0,
      amount: 0,
      currency: order.currency,
      billingName: user.name,
      source: "Gift",
      gateway: "free",
      status: "pending",
      createdAt: now,
    };
    d.payments.push(payment);
    gift.redeemedBy = user.id;
    gift.redeemedAt = now;
    return { payment: { ...payment }, gift: { ...gift }, title };
  });

  if ("error" in claim) {
    if (claim.field === "code") recordFailedRedeem(user.id, ip);
    return { ok: false, error: claim.error, field: claim.field };
  }
  const res = await fulfillPayment(claim.payment.id, undefined, { source: "checkout" });
  if (!res.ok) {
    // Put the code back so it can be tried again.
    await mutate((d) => {
      const gift = d.gifts.find((g) => g.id === claim.gift.id);
      if (gift && gift.redeemedBy === user.id) {
        gift.redeemedBy = undefined;
        gift.redeemedAt = undefined;
      }
      d.payments = d.payments.filter((p) => p.id !== claim.payment.id);
    });
    return { ok: false, error: res.error };
  }
  await notify(claim.gift.purchaserId, {
    type: "system",
    subject: `${user.name} redeemed your gift`,
    message: `${claim.title} is now theirs. Thank you for sharing the learning!`,
    link: "/gift",
    fromUserId: user.id,
    dedupeKey: `gift:${claim.gift.id}:redeemed`,
  });
  const db = await getDb();
  return { ok: true, href: giftItemHref(db, claim.gift), title: claim.title, orderId: claim.payment.orderId };
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export interface GiftRow {
  id: string;
  code: string;
  itemType: GiftItemType;
  title: string;
  href: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  sendAt?: string;
  sentAt?: string;
  redeemedAt?: string;
  redeemedByName?: string;
  purchaserName: string;
  purchaserEmail: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: ReturnType<typeof giftStatus>;
  createdAt: string;
}

function toRow(db: Database, gift: Gift, now: number): GiftRow {
  const order = db.payments.find((p) => p.id === gift.paymentId);
  const buyer = db.users.find((u) => u.id === gift.purchaserId);
  return {
    id: gift.id,
    code: gift.code,
    itemType: gift.itemType,
    title: giftItemTitle(db, gift),
    href: giftItemHref(db, gift),
    recipientEmail: gift.recipientEmail,
    recipientName: gift.recipientName,
    message: gift.message,
    sendAt: gift.sendAt,
    sentAt: gift.sentAt,
    redeemedAt: gift.redeemedAt,
    redeemedByName: gift.redeemedBy ? (db.users.find((u) => u.id === gift.redeemedBy)?.name ?? "Deleted user") : undefined,
    purchaserName: buyer?.name ?? "Deleted user",
    purchaserEmail: buyer?.email ?? "",
    orderId: order?.orderId ?? null,
    amount: order?.amount ?? 0,
    currency: order?.currency ?? db.settings.commerce.defaultCurrency,
    status: giftStatus(gift, order, now),
    createdAt: gift.createdAt,
  };
}

/** Gifts the member bought, and gifts addressed to them or redeemed by them (newest first). */
export async function getMyGifts(user: Pick<User, "id" | "email">): Promise<{ sent: GiftRow[]; received: GiftRow[] }> {
  const db = await getDb();
  const now = Date.now();
  const email = user.email.toLowerCase();
  const newest = (a: Gift, b: Gift) => b.createdAt.localeCompare(a.createdAt);
  const sent = db.gifts.filter((g) => g.purchaserId === user.id).sort(newest).map((g) => toRow(db, g, now));
  const received = db.gifts
    .filter((g) => g.purchaserId !== user.id && (g.redeemedBy === user.id || (g.recipientEmail === email && !!g.sentAt)))
    .sort(newest)
    .map((g) => toRow(db, g, now))
    .filter((r) => r.status === "delivered" || r.status === "redeemed");
  return { sent, received };
}

export type AdminGiftStatus = "all" | ReturnType<typeof giftStatus>;

export interface AdminGiftFilter {
  status: AdminGiftStatus;
  search?: string;
  page: number;
}

export const ADMIN_GIFTS_PAGE_SIZE = 25;

const STATUSES: readonly AdminGiftStatus[] = ["all", "awaiting_payment", "scheduled", "sending", "delivered", "redeemed", "cancelled", "refunded"];

export function parseAdminGiftFilter(sp: Record<string, string | string[] | undefined> | URLSearchParams): AdminGiftFilter {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? "") : typeof sp[k] === "string" ? (sp[k] as string) : "");
  const status = get("gstatus") as AdminGiftStatus;
  const page = Number.parseInt(get("gpage"), 10);
  return { status: STATUSES.includes(status) ? status : "all", search: get("gq").trim().slice(0, 100) || undefined, page: Number.isFinite(page) && page > 0 ? page : 1 };
}

export interface AdminGiftStats {
  total: number;
  paid: number;
  redeemed: number;
  scheduled: number;
  revenue: { currency: string; amount: number }[];
}

/** Admin list of every gift with filters, paging and totals. */
export async function getAdminGifts(filter: AdminGiftFilter, opts: { all?: boolean } = {}): Promise<{ rows: GiftRow[]; total: number; page: number; pageCount: number; stats: AdminGiftStats }> {
  const db = await getDb();
  const now = Date.now();
  const all = db.gifts
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((g) => toRow(db, g, now));
  const revenue = new Map<string, number>();
  let paid = 0;
  for (const r of all) {
    if (r.status === "awaiting_payment" || r.status === "cancelled" || r.status === "refunded") continue;
    paid++;
    revenue.set(r.currency, (revenue.get(r.currency) ?? 0) + r.amount);
  }
  const stats: AdminGiftStats = {
    total: all.length,
    paid,
    redeemed: all.filter((r) => r.status === "redeemed").length,
    scheduled: all.filter((r) => r.status === "scheduled").length,
    revenue: Array.from(revenue, ([currency, amount]) => ({ currency, amount })),
  };
  const q = filter.search?.toLowerCase();
  const matched = all.filter((r) => {
    if (filter.status !== "all" && r.status !== filter.status) return false;
    if (!q) return true;
    return `${r.title} ${r.recipientEmail} ${r.recipientName ?? ""} ${r.purchaserName} ${r.purchaserEmail} ${r.code} ${r.orderId ?? ""}`.toLowerCase().includes(q);
  });
  if (opts.all) return { rows: matched, total: matched.length, page: 1, pageCount: 1, stats };
  const pageCount = Math.max(1, Math.ceil(matched.length / ADMIN_GIFTS_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  return { rows: matched.slice((page - 1) * ADMIN_GIFTS_PAGE_SIZE, page * ADMIN_GIFTS_PAGE_SIZE), total: matched.length, page, pageCount, stats };
}

function csvCell(value: string | number | undefined | null): string {
  let s = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function giftsToCsv(rows: readonly GiftRow[]): string {
  const header = ["Created at", "Status", "Item type", "Item", "Buyer", "Buyer email", "Recipient", "Recipient email", "Send at", "Sent at", "Redeemed at", "Redeemed by", "Order ID", "Currency", "Amount"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.createdAt, r.status, r.itemType, r.title, r.purchaserName, r.purchaserEmail, r.recipientName ?? "", r.recipientEmail, r.sendAt ?? "", r.sentAt ?? "", r.redeemedAt ?? "", r.redeemedByName ?? "", r.orderId ?? "", r.currency, (r.amount / 100).toFixed(2)]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Human summary of when a gift goes out, for the checkout and the order page. */
export function deliveryLabel(gift: Pick<Gift, "sendAt" | "sentAt">): string {
  if (gift.sentAt) return `Delivered on ${formatDate(gift.sentAt)}`;
  return gift.sendAt ? `Will be emailed on ${formatDate(gift.sendAt)}` : "Emailed as soon as the payment is confirmed";
}

/** The gift behind a buyer's gift order (order page). */
export async function getGiftForOrder(payment: Pick<Payment, "itemType" | "itemId">): Promise<(GiftRow & { priceLabel: string }) | null> {
  if (payment.itemType !== "gift") return null;
  const db = await getDb();
  const gift = db.gifts.find((g) => g.id === payment.itemId);
  if (!gift) return null;
  const row = toRow(db, gift, Date.now());
  return { ...row, priceLabel: formatPrice(row.amount, row.currency) };
}
