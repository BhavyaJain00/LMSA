import type { Gift, Payment } from "@/lib/types";

/**
 * Gift rules (pure, unit tested): codes, delivery timing, status and the
 * checkout form. A gift is a course, bundle or membership plan bought for
 * someone else. The buyer's order (`itemType "gift"`) carries the gift id;
 * the code only works once that order is paid and stops working when it is
 * refunded. Redeeming it is single-use.
 */

export type GiftItemType = Gift["itemType"];

export const GIFT_ITEM_TYPES: readonly GiftItemType[] = ["course", "bundle", "plan"];

export function parseGiftItemType(raw: unknown): GiftItemType | null {
  return raw === "course" || raw === "bundle" || raw === "plan" ? raw : null;
}

/** Crockford-like alphabet without 0/O, 1/I/L: codes are read and typed by people. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_GROUPS = 3;
const CODE_GROUP_SIZE = 4;

/** "GIFT-8F3K-2Q9Z-7MWD": 12 random characters (about 59 bits), so codes cannot be guessed. */
export const GIFT_CODE_RE = /^GIFT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/** A new random gift code. `random` fills a byte array (crypto.getRandomValues by default). */
export function generateGiftCode(random: (bytes: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b)): string {
  const parts: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    // Rejection sampling keeps every character equally likely.
    let part = "";
    while (part.length < CODE_GROUP_SIZE) {
      const bytes = random(new Uint8Array(8));
      for (const b of bytes) {
        if (b >= 248) continue; // 248 = 8 * 31
        part += CODE_ALPHABET[b % CODE_ALPHABET.length];
        if (part.length === CODE_GROUP_SIZE) break;
      }
    }
    parts.push(part);
  }
  return `GIFT-${parts.join("-")}`;
}

/**
 * Normalise what someone typed or pasted ("gift 8f3k 2q9z 7mwd",
 * "8F3K-2Q9Z-7MWD") into the canonical form, or null when it cannot be a
 * gift code. Characters outside the alphabet (0, O, 1, I, L) are rejected.
 */
export function normalizeGiftCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[\s_-]+/g, "");
  if (s.length > 40) return null;
  if (s.startsWith("GIFT")) s = s.slice(4);
  if (s.length !== CODE_GROUPS * CODE_GROUP_SIZE) return null;
  const groups = s.match(/.{4}/g) ?? [];
  const code = `GIFT-${groups.join("-")}`;
  return GIFT_CODE_RE.test(code) ? code : null;
}

export type GiftStatus = "awaiting_payment" | "scheduled" | "sending" | "delivered" | "redeemed" | "cancelled" | "refunded";

export const GIFT_STATUS_LABELS: Record<GiftStatus, string> = {
  awaiting_payment: "Awaiting payment",
  scheduled: "Scheduled",
  sending: "Being sent",
  delivered: "Delivered",
  redeemed: "Redeemed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/**
 * Where a gift stands: its order decides first (unpaid, cancelled,
 * refunded), then redemption, then delivery. "sending" is a paid gift whose
 * send time has passed but whose email was not sent yet (the next delivery
 * run sends it).
 */
export function giftStatus(gift: Pick<Gift, "sendAt" | "sentAt" | "redeemedAt">, order: Pick<Payment, "status"> | null | undefined, now: number = Date.now()): GiftStatus {
  if (!order || order.status === "failed") return "cancelled";
  if (order.status === "refunded") return "refunded";
  if (order.status === "pending") return "awaiting_payment";
  if (gift.redeemedAt) return "redeemed";
  if (gift.sentAt) return "delivered";
  if (gift.sendAt && Date.parse(gift.sendAt) > now) return "scheduled";
  return "sending";
}

/** A paid gift whose email is due and was not sent yet. */
export function isGiftDue(gift: Pick<Gift, "sendAt" | "sentAt" | "redeemedAt">, order: Pick<Payment, "status"> | null | undefined, now: number = Date.now()): boolean {
  return giftStatus(gift, order, now) === "sending";
}

/** Whether the code can be redeemed now (paid, not refunded, not used). Delivery is not required: the buyer may hand the code over. */
export function isGiftRedeemable(gift: Pick<Gift, "redeemedAt">, order: Pick<Payment, "status"> | null | undefined): boolean {
  return !!order && order.status === "paid" && !gift.redeemedAt;
}

/* ------------------------------------------------------------------ */
/* Checkout form                                                       */
/* ------------------------------------------------------------------ */

export const GIFT_MESSAGE_MAX = 600;
export const GIFT_NAME_MAX = 80;
/** A gift can be scheduled at most this far ahead. */
export const GIFT_MAX_SCHEDULE_DAYS = 365;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export interface GiftFormInput {
  recipientEmail: string;
  recipientName: string;
  message: string;
  /** ISO time to send the gift email at; empty = right after payment. */
  sendAt: string;
}

export interface GiftDraft {
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  sendAt?: string;
}

export type GiftValidation = { ok: true; value: GiftDraft } | { ok: false; errors: Record<string, string> };

/**
 * Validate the recipient part of the gift checkout. A send time within the
 * next five minutes (or in the past) means "now". Buyers may not send a gift
 * to their own address (they can simply buy the item).
 */
export function validateGiftInput(input: GiftFormInput, opts: { buyerEmail?: string; now?: number } = {}): GiftValidation {
  const now = opts.now ?? Date.now();
  const errors: Record<string, string> = {};
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  const recipientName = input.recipientName.replace(/\s+/g, " ").trim();
  const message = input.message.replace(/\r\n/g, "\n").trim();

  if (!recipientEmail) errors.recipientEmail = "Enter the recipient's email address.";
  else if (recipientEmail.length > 254 || !EMAIL_RE.test(recipientEmail)) errors.recipientEmail = "Enter a valid email address.";
  else if (opts.buyerEmail && recipientEmail === opts.buyerEmail.trim().toLowerCase()) errors.recipientEmail = "That's your own address. Buy it for yourself instead, or enter the recipient's email.";
  if (recipientName.length > GIFT_NAME_MAX) errors.recipientName = `Keep the name under ${GIFT_NAME_MAX} characters.`;
  if (message.length > GIFT_MESSAGE_MAX) errors.message = `Keep the message under ${GIFT_MESSAGE_MAX} characters.`;

  let sendAt: string | undefined;
  const rawSend = input.sendAt.trim();
  if (rawSend) {
    const t = Date.parse(rawSend);
    if (!Number.isFinite(t)) errors.sendAt = "Choose a valid date.";
    else if (t > now + GIFT_MAX_SCHEDULE_DAYS * 86_400_000) errors.sendAt = `Schedule the gift at most ${GIFT_MAX_SCHEDULE_DAYS} days ahead.`;
    else if (t > now + 5 * 60_000) sendAt = new Date(t).toISOString();
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { recipientEmail, recipientName: recipientName || undefined, message: message || undefined, sendAt } };
}

/** "Gift: Python for beginners". */
export function giftOrderTitle(itemTitle: string): string {
  return `Gift: ${itemTitle}`;
}

/** First name for greetings, falling back to "there". */
export function firstName(name: string | undefined | null): string {
  return name?.trim().split(/\s+/)[0] || "there";
}
