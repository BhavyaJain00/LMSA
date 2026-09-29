import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature checks for payment gateways, built on `node:crypto`.
 *
 * Every comparison is constant-time and every check fails closed: a missing
 * secret, a malformed header or an unexpected encoding is a failed check.
 */

type RawBody = Buffer | Uint8Array | string;

function toBuffer(body: RawBody): Buffer {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

/** Hex HMAC-SHA256 of `payload` keyed with `secret`. */
export function hmacSha256Hex(secret: string, payload: RawBody): string {
  return createHmac("sha256", secret).update(toBuffer(payload)).digest("hex");
}

/** Constant-time comparison of two hex digests (false for bad input or length mismatch). */
export function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  if (typeof expectedHex !== "string" || typeof receivedHex !== "string") return false;
  if (!/^[0-9a-f]+$/i.test(expectedHex) || !/^[0-9a-f]+$/i.test(receivedHex)) return false;
  if (expectedHex.length !== receivedHex.length || expectedHex.length % 2 !== 0) return false;
  const a = Buffer.from(expectedHex.toLowerCase(), "hex");
  const b = Buffer.from(receivedHex.toLowerCase(), "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Stripe                                                              */
/* ------------------------------------------------------------------ */

/** Seconds a Stripe webhook timestamp may differ from the server clock. */
export const STRIPE_TOLERANCE_SECONDS = 300;

export type StripeSignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Verify a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=<hex>…]`).
 * The signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's
 * signing secret; any matching `v1` signature is accepted (Stripe sends
 * several while a secret is being rolled). Rejects timestamps outside the
 * tolerance window to stop replays.
 */
export function verifyStripeSignature(
  rawBody: RawBody,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): StripeSignatureCheck {
  if (!secret) return { ok: false, reason: "Webhook signing secret is not configured." };
  if (!header || header.length > 4096) return { ok: false, reason: "Missing Stripe-Signature header." };

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return { ok: false, reason: "Malformed signature timestamp." };
      timestamp = Number(value);
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (timestamp === null) return { ok: false, reason: "Signature timestamp missing." };
  if (!signatures.length) return { ok: false, reason: "No v1 signature in header." };
  if (signatures.length > 16) return { ok: false, reason: "Too many signatures in header." };

  const tolerance = opts.toleranceSeconds ?? STRIPE_TOLERANCE_SECONDS;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "Signature timestamp outside the tolerance window." };

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), toBuffer(rawBody)]);
  const expected = hmacSha256Hex(secret, signedPayload);
  // Check every candidate without short-circuiting on the first match.
  let matched = false;
  for (const sig of signatures) {
    if (safeEqualHex(expected, sig)) matched = true;
  }
  return matched ? { ok: true, timestamp } : { ok: false, reason: "Signature mismatch." };
}

/**
 * Build a `Stripe-Signature` header for a payload (used by the admin
 * "send a test event" tool and by tests). Never exposes the secret.
 */
export function signStripePayload(rawBody: RawBody, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), toBuffer(rawBody)]);
  return `t=${timestamp},v1=${hmacSha256Hex(secret, signedPayload)}`;
}

/* ------------------------------------------------------------------ */
/* Razorpay                                                            */
/* ------------------------------------------------------------------ */

/**
 * Verify the signature Razorpay Checkout returns to the browser after a
 * successful payment: HMAC-SHA256(key_secret, `${order_id}|${payment_id}`).
 */
export function verifyRazorpayPaymentSignature(input: { orderId: string; paymentId: string; signature: string }, keySecret: string): boolean {
  if (!keySecret || !input.orderId || !input.paymentId || !input.signature) return false;
  if (input.signature.length > 256 || input.orderId.length > 64 || input.paymentId.length > 64) return false;
  const expected = hmacSha256Hex(keySecret, `${input.orderId}|${input.paymentId}`);
  return safeEqualHex(expected, input.signature.trim());
}

/** Verify an `X-Razorpay-Signature` header: HMAC-SHA256(webhook_secret, rawBody). */
export function verifyRazorpayWebhookSignature(rawBody: RawBody, header: string | null | undefined, webhookSecret: string): boolean {
  if (!webhookSecret || !header || header.length > 256) return false;
  const expected = hmacSha256Hex(webhookSecret, rawBody);
  return safeEqualHex(expected, header.trim());
}
